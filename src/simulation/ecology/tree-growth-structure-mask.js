// Exact inverse index of the historical square structure exclusion check.
// Rebuilt only on weekly vegetation regeneration; no long-lived invalidation.
export function treeGrowthStructureMask(world) {
  const width = world.width, height = world.height;
  const blocked = new Uint8Array(world.tiles.length);
  for (const structure of world.structures || []) {
    const radius = structure.radius || 1.5;
    if (!(radius >= 0) || !Number.isFinite(structure.x) || !Number.isFinite(structure.y)) continue;
    const minX = Math.max(0, Math.ceil(structure.x - radius));
    const maxX = Math.min(width - 1, Math.floor(structure.x + radius));
    const minY = Math.max(0, Math.ceil(structure.y - radius));
    const maxY = Math.min(height - 1, Math.floor(structure.y + radius));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      if (Math.abs(x - structure.x) <= radius && Math.abs(y - structure.y) <= radius)
        blocked[y * width + x] = 1;
    }
  }
  return blocked;
}
