// The snapshot's static items are depth-sorted. Recompute their visible subset
// only when the camera, zoom, snapshot or mining highlights change. Animated
// frames and all moving actors/effects are still evaluated on every draw.
export function createVisibleStaticDepthCache() {
  let entry = null;
  let hits = 0, misses = 0;
  return {
    get({ items, spatialIndex, bounds, zoom, miningSites, showMineral }) {
      const same = entry && entry.items === items && entry.spatialIndex === spatialIndex
        && entry.miningSites === miningSites && entry.zoom === zoom
        && entry.minX === bounds.minX && entry.maxX === bounds.maxX
        && entry.minY === bounds.minY && entry.maxY === bounds.maxY;
      if (same) {
        hits++;
        return entry.visible;
      }
      const candidates = spatialIndex.query(bounds);
      // The index has already culled by position. Never thin resources by
      // camera zoom: the existing mineral predicate is authoritative.
      const visible = candidates.filter(item =>
        item.kind !== 'mineral'
          || showMineral(item, zoom, miningSites.has(item.x + ':' + item.y)));
      entry = {
        items, spatialIndex, miningSites, zoom,
        minX: bounds.minX, maxX: bounds.maxX, minY: bounds.minY, maxY: bounds.maxY,
        visible
      };
      misses++;
      return visible;
    },
    clear() { entry = null; },
    stats() { return { hits, misses, cachedItems: entry?.visible.length || 0 }; }
  };
}
