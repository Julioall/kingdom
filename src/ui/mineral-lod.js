// Rendering-only level of detail. Deposits remain in the simulation, are
// always inspectable/minable, and reappear when zooming in. Never sample
// rare gold/silver or a deposit currently being mined.
export function shouldDrawMineralAtZoom(item, zoom, highlighted = false) {
  if (highlighted || (item.gold || 0) > .05 || (item.silver || 0) > .05) return true;
  // Stone-only tiles do not contribute to the dense yellow ore overlay.
  if (Math.max(item.copper || 0, item.iron || 0) <= .05) return true;
  if (!Number.isFinite(zoom) || zoom >= 4) return true;
  const sampleRate = zoom < 1 ? 32 : zoom < 2 ? 16 : zoom < 3 ? 8 : 4;
  const hash = (Math.imul(Math.floor(item.x), 73856093)
    ^ Math.imul(Math.floor(item.y), 19349663)) >>> 0;
  return hash % sampleRate === 0;
}
