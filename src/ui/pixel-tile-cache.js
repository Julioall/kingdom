export function createPixelTileCache({ createCanvas = () => document.createElement('canvas'), maxBytes = 8 * 1024 * 1024 } = {}) {
  const sources = new WeakMap();
  const entries = new Map();
  let nextSourceId = 1, bytes = 0, hits = 0, misses = 0, evictions = 0;

  function release(key, entry) {
    bytes -= entry.bytes;
    entry.canvas.width = entry.canvas.height = 0;
    entries.delete(key);
  }

  return {
    get(image, sourceX, sourceY, sourceWidth, sourceHeight, width, height) {
      if (!image || width <= 0 || height <= 0) return null;
      let sourceId = sources.get(image);
      if (!sourceId) { sourceId = nextSourceId++; sources.set(image, sourceId); }
      const key = [sourceId, sourceX, sourceY, sourceWidth, sourceHeight, width, height].join(':');
      let entry = entries.get(key);
      if (entry) {
        entries.delete(key); entries.set(key, entry); hits++;
        return entry.canvas;
      }
      misses++;
      const entryBytes = width * height * 4;
      if (entryBytes > maxBytes) return null;
      while (bytes + entryBytes > maxBytes && entries.size) {
        const [oldKey, oldest] = entries.entries().next().value;
        release(oldKey, oldest); evictions++;
      }
      const canvas = createCanvas();
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) return null;
      context.imageSmoothingEnabled = false;
      context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);
      entry = { canvas, bytes: entryBytes };
      entries.set(key, entry); bytes += entryBytes;
      return canvas;
    },
    stats() { return { entries: entries.size, bytes, maxBytes, hits, misses, evictions }; },
  };
}
