// Rasterize at backing-pixel resolution. Integer translation lets pan reuse the
// same pixels while adjoining chunks share exactly the same rounded tile edges.
export function createTerrainChunkCache({ width, height, tileSize, createCanvas = () => document.createElement('canvas'),
  chunkSide = 16, maxChunkPixels = 512, maxBytes = 32 * 1024 * 1024, padding = 2 }) {
  const entries = new Map();
  let tiles = null, seed = null, signatures = [], revision = 0, bytes = 0;
  let side = chunkSide, columns = Math.ceil(width / side), rasterKey = null;
  let hits = 0, rebuilds = 0, evictions = 0, lastDraw = { hits: 0, rebuilds: 0, visible: 0 };

  function release(key, entry) {
    bytes -= entry.bytes;
    entry.canvas.width = entry.canvas.height = 0;
    entries.delete(key);
  }
  function clearSurfaces() {
    for (const [key, entry] of entries) release(key, entry);
    rasterKey = null;
  }
  function invalidate(x, y) {
    const minX = Math.max(0, Math.floor((x - padding) / side));
    const maxX = Math.min(columns - 1, Math.floor((x + padding) / side));
    const minY = Math.max(0, Math.floor((y - padding) / side));
    const maxY = Math.min(Math.ceil(height / side) - 1, Math.floor((y + padding) / side));
    for (let cy = minY; cy <= maxY; cy++) for (let cx = minX; cx <= maxX; cx++) {
      const entry = entries.get(cy * columns + cx);
      if (entry) entry.dirty = true;
    }
  }

  return {
    get revision() { return revision; },
    sync(world, signatureFor) {
      if (tiles !== world.tiles || seed !== world.seed) {
        clearSurfaces(); signatures = []; tiles = world.tiles; seed = world.seed;
      }
      let changed = false;
      for (let index = 0; index < tiles.length; index++) {
        const tile = tiles[index], signature = signatureFor(tile);
        if (signatures[index] === signature) continue;
        signatures[index] = signature;
        invalidate(tile.x, tile.y);
        changed = true;
      }
      if (changed) revision++;
      return changed;
    },
    invalidateAll() { clearSurfaces(); revision++; },
    draw(target, camera, styleKey, paint) {
      const scale = camera.transform[0];
      const nextSide = Math.max(1, Math.min(chunkSide, Math.floor(maxChunkPixels / (tileSize * scale))));
      const key = [scale, nextSide, styleKey].join(':');
      if (key !== rasterKey) {
        clearSurfaces(); side = nextSide; columns = Math.ceil(width / side); rasterKey = key;
      }
      lastDraw = { hits: 0, rebuilds: 0, visible: 0 };
      const view = camera.view;
      if (view.width <= 0 || view.height <= 0) return;
      const minCX = Math.max(0, Math.floor(view.x / tileSize / side));
      const maxCX = Math.min(columns - 1, Math.ceil((view.x + view.width) / tileSize / side) - 1);
      const minCY = Math.max(0, Math.floor(view.y / tileSize / side));
      const maxCY = Math.min(Math.ceil(height / side) - 1, Math.ceil((view.y + view.height) / tileSize / side) - 1);
      for (let cy = minCY; cy <= maxCY; cy++) for (let cx = minCX; cx <= maxCX; cx++) {
        const entryKey = cy * columns + cx;
        const x = cx * side, y = cy * side, right = Math.min(width, x + side), bottom = Math.min(height, y + side);
        const pixelX = Math.round(x * tileSize * scale), pixelY = Math.round(y * tileSize * scale);
        const pixelWidth = Math.round(right * tileSize * scale) - pixelX;
        const pixelHeight = Math.round(bottom * tileSize * scale) - pixelY;
        if (pixelWidth <= 0 || pixelHeight <= 0) continue;
        let entry = entries.get(entryKey);
        if (!entry) {
          const entryBytes = pixelWidth * pixelHeight * 4;
          while (bytes + entryBytes > maxBytes && entries.size) {
            const [oldKey, oldest] = entries.entries().next().value;
            release(oldKey, oldest); evictions++;
          }
          const canvas = createCanvas();
          canvas.width = pixelWidth; canvas.height = pixelHeight;
          entry = { canvas, bytes: entryBytes, dirty: true };
          bytes += entryBytes;
        }
        entries.delete(entryKey); entries.set(entryKey, entry);
        if (entry.dirty) {
          const context = entry.canvas.getContext('2d');
          context.setTransform(1, 0, 0, 1, 0, 0);
          context.clearRect(0, 0, pixelWidth, pixelHeight);
          const transform = [scale, 0, 0, scale, -pixelX, -pixelY];
          context.setTransform(...transform);
          context.imageSmoothingEnabled = false;
          paint(context, { minX: Math.max(0, x - padding), minY: Math.max(0, y - padding),
            maxX: Math.min(width - 1, right - 1 + padding), maxY: Math.min(height - 1, bottom - 1 + padding) }, transform);
          entry.dirty = false; rebuilds++; lastDraw.rebuilds++;
        } else { hits++; lastDraw.hits++; }
        lastDraw.visible++;
        target.drawImage(entry.canvas, pixelX + camera.transform[4], pixelY + camera.transform[5]);
      }
    },
    stats() { return { entries: entries.size, bytes, maxBytes, hits, rebuilds, evictions, side, lastDraw: { ...lastDraw } }; },
  };
}
