// Water presentation is independent of combat, economy and World state writes.
// The host provides the water sprite and the existing decoration painter; this
// module owns only backing canvases, cache invalidation and draw composition.
export function createWaterLayer({
  tileSize, texture, referenceRendering = false, drawDecorations,
  createCanvas = () => document.createElement('canvas')
}) {
  const oceanPatterns = new WeakMap();
  const oceanBackdropCache = createCanvas();
  const waterLayerCache = createCanvas();
  let oceanBackdropKey = '', waterLayerKey = '';
  let backdropBuilds = 0, layerBuilds = 0;

  function drawBackdrop(context, camera) {
    context.fillStyle = '#16536e';
    context.fillRect(0, 0, context.canvas.width, context.canvas.height);
    if (!texture.complete || !texture.naturalWidth) return;
    let pattern = referenceRendering ? null : oceanPatterns.get(context);
    if (!pattern) {
      pattern = context.createPattern(texture, 'repeat');
      if (pattern && !referenceRendering) oceanPatterns.set(context, pattern);
    }
    if (!pattern) return;
    const patternScale = camera.transform[0] * tileSize / texture.naturalWidth;
    if (pattern.setTransform && typeof DOMMatrix === 'function') {
      pattern.setTransform(new DOMMatrix([
        patternScale, 0, 0, patternScale, camera.transform[4], camera.transform[5]
      ]));
    }
    context.fillStyle = pattern;
    context.fillRect(0, 0, context.canvas.width, context.canvas.height);
  }

  function drawCached(target, camera, view, { seed, day, animationTime, assetRevision }) {
    const oceanKey = [camera.width, camera.height, camera.transform[0], texture.naturalWidth, seed].join(':');
    const period = Math.max(1, camera.transform[0] * tileSize);
    if (oceanBackdropKey !== oceanKey) {
      oceanBackdropCache.width = camera.width + Math.ceil(period * 2);
      oceanBackdropCache.height = camera.height + Math.ceil(period * 2);
      drawBackdrop(oceanBackdropCache.getContext('2d'),
        { ...camera, transform: [camera.transform[0], 0, 0, camera.transform[3], 0, 0] });
      oceanBackdropKey = oceanKey;
      backdropBuilds++;
    }
    const viewKey = [oceanKey, ...camera.transform].join(':');
    const key = [viewKey, Math.floor(animationTime / 110), day, assetRevision].join(':');
    if (waterLayerKey !== key) {
      if (waterLayerCache.width !== camera.width || waterLayerCache.height !== camera.height) {
        waterLayerCache.width = camera.width;
        waterLayerCache.height = camera.height;
      }
      const context = waterLayerCache.getContext('2d');
      context.setTransform(1, 0, 0, 1, 0, 0);
      const offsetX = ((camera.transform[4] % period) + period) % period - period;
      const offsetY = ((camera.transform[5] % period) + period) % period - period;
      context.drawImage(oceanBackdropCache, offsetX, offsetY);
      context.setTransform(...camera.transform);
      context.imageSmoothingEnabled = false;
      context.save();
      try {
        context.beginPath();
        context.rect(view.x, view.y, view.width, view.height);
        context.clip();
        drawDecorations(context, view.bounds);
      } finally {
        context.restore();
      }
      waterLayerKey = key;
      layerBuilds++;
    }
    target.save();
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.drawImage(waterLayerCache, 0, 0);
    target.restore();
  }

  return {
    drawBackdrop, drawCached,
    stats: () => ({ backdropBuilds, layerBuilds })
  };
}
