export const CLOUD_CONFIG = Object.freeze({
  count: 36,
  worldSize: 1024,
  worldPadding: 620,
  minWidth: 105,
  maxWidth: 560,
  windX: 8,
  windY: .7,
  speedVariation: .32,
  opacity: .88,
  shadowOpacity: .16,
  shadowRevealOpacity: .02,
  shadowBlur: .28,
  zoomFadeStart: 1.05,
  zoomFadeEnd: 2.8,
  proximityFadeStart: .34,
  proximityFadeEnd: 1.05
});

const smoothstep = (start, end, value) => {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
};
const shadowCache = new WeakMap();

export function cloudOpacityAtZoom(zoom, distance = Infinity, width = 240, config = CLOUD_CONFIG) {
  const zoomOpacity = 1 - smoothstep(config.zoomFadeStart, config.zoomFadeEnd, zoom);
  const proximity = 1 - smoothstep(width * config.proximityFadeStart, width * config.proximityFadeEnd, distance);
  const proximityFade = smoothstep(config.zoomFadeStart, 2.5, zoom);
  return config.opacity * zoomOpacity * (1 - proximity * proximityFade);
}

export function cloudShadowOpacity(cloudOpacity, config = CLOUD_CONFIG) {
  return config.shadowOpacity * Math.max(0, Math.min(1,
    (config.shadowRevealOpacity - cloudOpacity) / config.shadowRevealOpacity));
}

function createRandom(seed) {
  let state = (Number(seed) >>> 0) || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function shadowFor(image) {
  if (!image.complete || !image.naturalWidth || !image.naturalHeight) return null;
  let shadow = shadowCache.get(image);
  if (!shadow) {
    const width = image.naturalWidth, height = image.naturalHeight;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, width, height);
    for (let index = 0; index < pixels.data.length; index += 4) {
      if (pixels.data[index] < 100 || pixels.data[index + 1] < 100 || pixels.data[index + 2] < 90) {
        pixels.data[index + 3] = 0;
        continue;
      }
      pixels.data[index] = 23;
      pixels.data[index + 1] = 42;
      pixels.data[index + 2] = 53;
      pixels.data[index + 3] = Math.round(pixels.data[index + 3] * .82);
    }
    context.putImageData(pixels, 0, 0);
    shadow = canvas;
    shadowCache.set(image, shadow);
  }
  return shadow;
}

function chooseSprite(random) {
  const value = random();
  if (value < .22) return random() < .5 ? 0 : 4;
  if (value < .52) return random() < .5 ? 1 : 5;
  return [2, 3, 6, 7][Math.floor(random() * 4)];
}

export function createCloudSystem(images, seed = 2026, config = CLOUD_CONFIG) {
  const random = createRandom(seed);
  const clouds = Array.from({ length: config.count }, (_, index) => {
    const spriteIndex = chooseSprite(random);
    const profile = spriteIndex === 0 || spriteIndex === 4 ? .58
      : spriteIndex === 1 || spriteIndex === 5 ? .34 : .15;
    const sizeRange = profile === .58 ? [.58, 1] : profile === .34 ? [.3, .68] : [.05, .35];
    const width = config.minWidth + (config.maxWidth - config.minWidth)
      * (sizeRange[0] + random() * (sizeRange[1] - sizeRange[0]));
    const speed = config.windX * (1 + (random() * 2 - 1) * config.speedVariation);
    return {
      id: index,
      spriteIndex,
      x: random() * (config.worldSize + config.worldPadding * 2) - config.worldPadding,
      y: random() * (config.worldSize + config.worldPadding * 2) - config.worldPadding,
      width,
      speedX: speed,
      speedY: config.windY * (random() * 2 - 1) * .55
    };
  });

  function update(deltaSeconds) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    const edge = config.worldSize + config.worldPadding;
    for (const cloud of clouds) {
      const image = images[cloud.spriteIndex];
      const height = image?.naturalWidth ? cloud.width * image.naturalHeight / image.naturalWidth : cloud.width * .44;
      cloud.x += cloud.speedX * deltaSeconds;
      cloud.y += cloud.speedY * deltaSeconds;
      if (cloud.x > edge) cloud.x = -config.worldPadding - cloud.width;
      if (cloud.y > edge) cloud.y = -config.worldPadding - height;
      if (cloud.y + height < -config.worldPadding) cloud.y = edge;
    }
  }

  function visibleWorldBounds(camera, viewportWidth, viewportHeight, margin) {
    return {
      left: -camera.offsetX / camera.scale - margin,
      top: -camera.offsetY / camera.scale - margin,
      right: (viewportWidth - camera.offsetX) / camera.scale + margin,
      bottom: (viewportHeight - camera.offsetY) / camera.scale + margin
    };
  }

  function drawShadows(context, camera, viewportWidth, viewportHeight, center, zoom) {
    const bounds = visibleWorldBounds(camera, viewportWidth, viewportHeight, 0);
    const closeFade = smoothstep(1.2, 5, zoom);
    context.save();
    context.setTransform(...camera.transform);
    context.imageSmoothingEnabled = true;
    context.filter = 'blur(' + config.shadowBlur + 'px)';
    for (const cloud of clouds) {
      const image = images[cloud.spriteIndex];
      const shadow = image && shadowFor(image);
      if (!shadow) continue;
      const width = cloud.width;
      const height = width * shadow.height / shadow.width;
      const x = cloud.x + width * .025, y = cloud.y + width * .16;
      if (x > bounds.right || x + width < bounds.left || y > bounds.bottom || y + height < bounds.top) continue;
      const distance = Math.hypot(cloud.x + width / 2 - center.x, cloud.y + height / 2 - center.y);
      const cloudOpacity = cloudOpacityAtZoom(zoom, distance, width, config);
      const shadowOpacity = cloudShadowOpacity(cloudOpacity, config);
      if (shadowOpacity <= 0) continue;
      context.globalAlpha = shadowOpacity * (1 - closeFade * .2);
      context.drawImage(shadow, x, y, width, height);
    }
    context.restore();
  }

  function drawAtmosphere(context, camera, viewportWidth, viewportHeight, center, zoom) {
    const bounds = visibleWorldBounds(camera, viewportWidth, viewportHeight, 0);
    context.save();
    context.setTransform(...camera.transform);
    context.imageSmoothingEnabled = false;
    for (const cloud of clouds) {
      const image = images[cloud.spriteIndex];
      if (!image?.complete || !image.naturalWidth) continue;
      const width = cloud.width;
      const height = width * image.naturalHeight / image.naturalWidth;
      if (cloud.x > bounds.right || cloud.x + width < bounds.left
        || cloud.y > bounds.bottom || cloud.y + height < bounds.top) continue;
      const distance = Math.hypot(cloud.x + width / 2 - center.x, cloud.y + height / 2 - center.y);
      const opacity = cloudOpacityAtZoom(zoom, distance, width, config);
      if (opacity <= .005) continue;
      context.globalAlpha = opacity;
      context.drawImage(image, cloud.x, cloud.y, width, height);
    }
    context.restore();
  }

  return {
    update,
    drawShadows,
    drawAtmosphere,
    getClouds: () => clouds.map(cloud => ({ ...cloud }))
  };
}
