import { compareDepth } from './depth-order.js';

// Only presentation items are indexed. The world tiles, mines, collision and
// harvesting inventories remain unchanged. Rebuilt once per world/day snapshot.
export function createStaticDepthSpatialIndex(sortedItems, chunkSize = 16) {
  if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) throw new Error('Invalid depth chunk size');
  const bins = new Map();
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const item of sortedItems) {
    minX = Math.min(minX, item.x); maxX = Math.max(maxX, item.x);
    minY = Math.min(minY, item.y); maxY = Math.max(maxY, item.y);
    const key = Math.floor(item.x / chunkSize) + ':' + Math.floor(item.y / chunkSize);
    let bin = bins.get(key);
    if (!bin) bins.set(key, bin = []);
    bin.push(item);
  }
  let lastExamined = 0;
  const query = bounds => {
    if (!bounds || ![bounds.minX, bounds.maxX, bounds.minY, bounds.maxY].every(Number.isFinite)
        || bounds.minX > bounds.maxX || bounds.minY > bounds.maxY) {
      lastExamined = 0;
      return [];
    }
    // Full-map zoom: items are already sorted. Sorting the same thousands of
    // sprites every frame is wasted work. The caller treats query output as
    // read-only, and still applies its existing mineral visibility predicate.
    if (sortedItems.length && bounds.minX <= minX && bounds.maxX >= maxX
        && bounds.minY <= minY && bounds.maxY >= maxY) {
      lastExamined = sortedItems.length;
      return sortedItems;
    }
    const result = [];
    let examined = 0;
    const minCX = Math.floor(bounds.minX / chunkSize), maxCX = Math.floor(bounds.maxX / chunkSize);
    const minCY = Math.floor(bounds.minY / chunkSize), maxCY = Math.floor(bounds.maxY / chunkSize);
    for (let cy = minCY; cy <= maxCY; cy++) for (let cx = minCX; cx <= maxCX; cx++) {
      const bin = bins.get(cx + ':' + cy);
      if (!bin) continue;
      examined += bin.length;
      for (const item of bin) {
        if (item.x >= bounds.minX && item.x <= bounds.maxX
            && item.y >= bounds.minY && item.y <= bounds.maxY) result.push(item);
      }
    }
    lastExamined = examined;
    // Existing snapshot comparator is the authoritative paint order.
    // Reapply it only to the tiny visible set, not to every world item.
    return result.sort(compareDepth);
  };
  return { query, stats: () => ({ totalItems: sortedItems.length, chunkCount: bins.size, lastExamined }) };
}
