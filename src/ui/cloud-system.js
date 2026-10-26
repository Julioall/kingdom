export const CLOUD_CONFIG = Object.freeze({
  count: 36,
  worldSize: 1024,
  worldPadding: 220,
  minWidth: 105,
  maxWidth: 560,
  windX: 8,
  windY: .7,
  speedVariation: .32,
  opacity: .64,
  shadowOpacity: .16,
  shadowRevealOpacity: .02,
  shadowBlur: .28,
  zoomOutFadeStart: .5,
  zoomOutFadeEnd: 1,
  zoomOutCloudMultiplier: 1.5,
  zoomFadeStart: 1,
  zoomFadeEnd: 2,
  proximityFadeStart: .34,
  proximityFadeEnd: 1.05
});

const smoothstep = (start, end, value) => {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
};

export function atmosphereZoomProfile(zoom) {
  const elevated = 1 - smoothstep(.5, 1, zoom);
  const fogOpacity = zoom <= .75
    ? .84 + (.38 - .84) * smoothstep(.5, .75, zoom)
    : .38 * (1 - smoothstep(.75, 1, zoom));
  return {
    fogOpacity,
    fogDensity: elevated,
    cloudLayerOpacity: 1 - .25 * elevated,
    foregroundOpacity: .32 * elevated,
    foregroundScale: 1.5 * (.7 + .3 * elevated),
  };
}
const cloudScaleAtZoom = (zoom, config) => 2 - smoothstep(config.zoomOutFadeStart, config.zoomOutFadeEnd, zoom);
const cloudCountAtZoom = (zoom, config) => {
  const fartherView = 1 - smoothstep(config.zoomOutFadeStart, config.zoomOutFadeEnd, zoom);
  return config.count * (1 + (config.zoomOutCloudMultiplier - 1) * fartherView);
};
const shadowCache = new WeakMap();

export function cloudOpacityAtZoom(zoom, distance = Infinity, width = 240, config = CLOUD_CONFIG) {
  const zoomOpacity = 1 - smoothstep(config.zoomFadeStart, config.zoomFadeEnd, zoom);
  const proximity = 1 - smoothstep(width * config.proximityFadeStart, width * config.proximityFadeEnd, distance);
  const proximityFade = smoothstep(config.zoomFadeStart, config.zoomFadeEnd, zoom);
  return config.opacity * zoomOpacity * (1 - proximity * proximityFade);
}

export function cloudShadowOpacity(cloudOpacity, config = CLOUD_CONFIG) {
  return config.shadowOpacity * (1 - Math.max(0, Math.min(1, cloudOpacity / config.opacity)));
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
    const ratio = Math.min(1, 384 / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * ratio));
    const height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0, width, height);
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
    // Bake the softness once, rather than filtering every shadow on every frame.
    shadow = document.createElement('canvas');
    shadow.width = width;
    shadow.height = height;
    const shadowContext = shadow.getContext('2d');
    shadowContext.filter = 'blur(.28px)';
    shadowContext.drawImage(canvas, 0, 0);
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
  const maxCloudCount = Math.ceil(config.count * config.zoomOutCloudMultiplier);
  const clouds = Array.from({ length: maxCloudCount }, (_, index) => {
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
      visibility: index < config.count ? 1 : 0,
      speedX: speed,
      speedY: config.windY * (random() * 2 - 1) * .55
    };
  });
  // A separate, screen-filling bank sits much closer to the camera than the map clouds.
  const foregroundAnchors = [[-.1, .08], [.9, .3], [.02, .9]];
  const foregroundClouds = foregroundAnchors.map(([x, y], index) => ({
    spriteIndex: index % 2 === 0 ? 0 : 4,
    x: x + (random() - .5) * .08,
    y: y + (random() - .5) * .08,
    width: .38 + random() * .25,
    speed: .003 + random() * .003,
    drift: 0,
  }));

  let view = null;
  function setView(camera, viewportWidth, viewportHeight, zoom) {
    const firstView = !view;
    view = { camera, viewportWidth, viewportHeight, zoom };
    if (firstView) {
      const count = cloudCountAtZoom(zoom, config);
      for (const cloud of clouds) cloud.visibility = Math.max(0, Math.min(1, count - cloud.id));
    }
  }

  function update(deltaSeconds, nextView) {
    if (nextView) setView(nextView.camera, nextView.viewportWidth, nextView.viewportHeight, nextView.zoom);
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    const zoom = view?.zoom ?? 1;
    const scale = cloudScaleAtZoom(zoom, config);
    const desiredCount = cloudCountAtZoom(zoom, config);
    const blend = 1 - Math.exp(-deltaSeconds * 4);
    const screenBounds = view
      ? visibleWorldBounds(view.camera, view.viewportWidth, view.viewportHeight, 0)
      : { left: 0, top: 0, right: config.worldSize, bottom: config.worldSize };
    const bounds = {
      left: Math.min(-config.worldPadding, screenBounds.left),
      right: Math.max(config.worldSize + config.worldPadding, screenBounds.right),
      top: Math.min(-config.worldPadding, screenBounds.top),
      bottom: Math.max(config.worldSize + config.worldPadding, screenBounds.bottom),
    };
    const margin = 32;
    for (const cloud of foregroundClouds) {
      cloud.drift += cloud.speed * deltaSeconds;
      if (!view) continue;
      const profile = atmosphereZoomProfile(zoom);
      const width = view.viewportWidth * cloud.width * profile.foregroundScale;
      const panX = (view.camera.offsetX + config.worldSize / 2 * view.camera.scale - view.viewportWidth / 2) * .24;
      const left = (cloud.x + cloud.drift) * view.viewportWidth + panX - width * .3;
      if (left > view.viewportWidth + margin) {
        cloud.drift = (-margin - width + width * .3 - panX) / view.viewportWidth - cloud.x;
      }
    }
    for (const cloud of clouds) {
      const image = images[cloud.spriteIndex];
      const sourceHeight = image?.naturalWidth ? cloud.width * image.naturalHeight / image.naturalWidth : cloud.width * .44;
      const width = cloud.width * scale, height = sourceHeight * scale;
      const offsetX = (cloud.width - width) / 2, offsetY = (sourceHeight - height) / 2;
      const target = Math.max(0, Math.min(1, desiredCount - cloud.id));
      cloud.visibility += (target - cloud.visibility) * blend;
      cloud.x += cloud.speedX * deltaSeconds;
      cloud.y += cloud.speedY * deltaSeconds;
      // Include the full scaled body and its shadow; both destinations stay outside the viewport.
      if (cloud.x + offsetX > bounds.right + margin) {
        cloud.x = bounds.left - margin - width * 1.025 - offsetX;
      }
      if (cloud.speedY > 0 && cloud.y + offsetY > bounds.bottom + margin) {
        cloud.y = bounds.top - margin - height - width * .16 - offsetY;
      } else if (cloud.speedY < 0 && cloud.y + offsetY + height + width * .16 < bounds.top - margin) {
        cloud.y = bounds.bottom + margin - offsetY;
      }
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
    setView(camera, viewportWidth, viewportHeight, zoom);
    const bounds = visibleWorldBounds(camera, viewportWidth, viewportHeight, 0);
    const closeFade = smoothstep(1.2, 5, zoom);
    context.save();
    context.setTransform(...camera.transform);
    context.imageSmoothingEnabled = true;
    for (let index = 0; index < clouds.length; index++) {
      const cloud = clouds[index];
      if (cloud.visibility <= .005) continue;
      const image = images[cloud.spriteIndex];
      if (!image?.complete || !image.naturalWidth) continue;
      const sourceWidth = cloud.width;
      const sourceHeight = sourceWidth * image.naturalHeight / image.naturalWidth;
      const width = sourceWidth * cloudScaleAtZoom(zoom, config);
      const height = width * image.naturalHeight / image.naturalWidth;
      const x = cloud.x + (cloud.width - width) / 2 + width * .025;
      const y = cloud.y + (sourceHeight - height) / 2 + width * .16;
      if (x > bounds.right || x + width < bounds.left || y > bounds.bottom || y + height < bounds.top) continue;
      const distance = Math.hypot(cloud.x + sourceWidth / 2 - center.x, cloud.y + sourceHeight / 2 - center.y);
      const cloudOpacity = cloudOpacityAtZoom(zoom, distance, width, config);
      const shadowOpacity = cloudShadowOpacity(cloudOpacity, config);
      if (shadowOpacity <= 0) continue;
      const shadow = shadowFor(image);
      if (!shadow) continue;
      context.globalAlpha = shadowOpacity * cloud.visibility * (1 - closeFade * .2);
      context.drawImage(shadow, x, y, width, height);
    }
    context.restore();
  }

  function drawAtmosphere(context, camera, viewportWidth, viewportHeight, center, zoom) {
    setView(camera, viewportWidth, viewportHeight, zoom);
    if (zoom >= config.zoomFadeEnd) return;
    const bounds = visibleWorldBounds(camera, viewportWidth, viewportHeight, 0);
    context.save();
    context.setTransform(...camera.transform);
    context.imageSmoothingEnabled = false;
    for (let index = 0; index < clouds.length; index++) {
      const cloud = clouds[index];
      if (cloud.visibility <= .005) continue;
      const image = images[cloud.spriteIndex];
      if (!image?.complete || !image.naturalWidth) continue;
      const sourceHeight = cloud.width * image.naturalHeight / image.naturalWidth;
      const width = cloud.width * cloudScaleAtZoom(zoom, config);
      const height = width * image.naturalHeight / image.naturalWidth;
      const x = cloud.x + (cloud.width - width) / 2;
      const y = cloud.y + (sourceHeight - height) / 2;
      if (x > bounds.right || x + width < bounds.left
        || y > bounds.bottom || y + height < bounds.top) continue;
      const distance = Math.hypot(x + width / 2 - center.x, y + height / 2 - center.y);
      const opacity = cloudOpacityAtZoom(zoom, distance, width, config);
      if (opacity <= .005) continue;
      context.globalAlpha = opacity * cloud.visibility;
      context.drawImage(image, x, y, width, height);
    }
    context.restore();
    drawForeground(context, camera, viewportWidth, viewportHeight, zoom);
  }

  function drawForeground(context, camera, viewportWidth, viewportHeight, zoom) {
    const profile = atmosphereZoomProfile(zoom);
    if (profile.foregroundOpacity <= .005) return;
    const pixelRatioX = camera.width / viewportWidth;
    const pixelRatioY = camera.height / viewportHeight;
    context.save();
    context.setTransform(pixelRatioX, 0, 0, pixelRatioY, 0, 0);
    context.imageSmoothingEnabled = false;
    context.globalAlpha = profile.foregroundOpacity;
    // Stronger camera parallax helps distinguish these banks from the map layer.
    const panX = (camera.offsetX + config.worldSize / 2 * camera.scale - viewportWidth / 2) * .24;
    const panY = (camera.offsetY + config.worldSize / 2 * camera.scale - viewportHeight / 2) * .24;
    for (const cloud of foregroundClouds) {
      const image = images[cloud.spriteIndex];
      if (!image?.complete || !image.naturalWidth) continue;
      const width = viewportWidth * cloud.width * profile.foregroundScale;
      const height = width * image.naturalHeight / image.naturalWidth;
      const x = (cloud.x + cloud.drift) * viewportWidth + panX - width * .3;
      const y = cloud.y * viewportHeight + panY - height * .3;
      if (x > viewportWidth || x + width < 0 || y > viewportHeight || y + height < 0) continue;
      context.drawImage(image, x, y, width, height);
    }
    context.restore();
  }

  return {
    update,
    drawShadows,
    drawAtmosphere,
    getClouds: () => clouds.map(cloud => ({ ...cloud })),
    getForegroundClouds: () => foregroundClouds.map(cloud => ({ ...cloud })),
  };
}
