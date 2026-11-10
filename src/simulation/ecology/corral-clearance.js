import { PLANTS } from '../../config/ecosystem.js';
import { invalidateNavigation } from '../individuals/navigation-cache.js';
import { corralFenceRadius } from './herd.js';

export const CORRAL_NATURAL_CLEARANCE = 3;

const CLEARABLE_PLANTS = ['berry', 'browse', 'broadleaf', 'conifer'];
const CLEARABLE_PLANT_INDICES = CLEARABLE_PLANTS
  .map(id => PLANTS.findIndex(plant => plant.id === id))
  .filter(index => index >= 0);

// Only the *geometry* is cached: weather, soil, vegetation, animals and
// daily vegetation clearance still run at their original frequency.
// The cache is process-local, does not enter saves or Worker snapshots.
export const CORRAL_CLEARANCE_GEOMETRY_REFRESH_DAYS = 30;
const clearanceByWorld = new WeakMap();

function activeCorralGeometry(world) {
  const entries = [];
  for (const pen of world.structures || []) {
    if (pen.type !== 'curral' || pen.destroyedDay != null || pen.integrity === 0) continue;
    const radius = Math.max(Number(pen.radius) || 3.5, corralFenceRadius(pen)) + CORRAL_NATURAL_CLEARANCE;
    entries.push({ x: pen.x, y: pen.y, radius });
  }
  const signature = [world.width, world.height, ...entries.flatMap(pen =>
    [pen.x, pen.y, pen.radius])].join(':');
  return { signature, entries };
}

/** Read-only cache telemetry for simulation profiling/tests. */
export function corralClearanceCacheDiagnostics(world) {
  const state = world && clearanceByWorld.get(world);
  return state ? { hits: state.hits, rebuilds: state.rebuilds,
    lastRebuildDay: state.day } : { hits: 0, rebuilds: 0, lastRebuildDay: null };
}

export function corralNaturalClearanceTiles(world) {
  if (!world?.width || !world?.height || !world.tiles) return new Set();
  const day = Number.isSafeInteger(world.day) && world.day >= 0 ? world.day : 0;
  const { signature, entries } = activeCorralGeometry(world);
  let cache = clearanceByWorld.get(world);
  if (cache && cache.signature === signature && cache.tiles === world.tiles
      && day >= cache.day && day - cache.day < CORRAL_CLEARANCE_GEOMETRY_REFRESH_DAYS) {
    cache.hits++;
    // Preserve the old public API: callers receive their own mutable Set.
    return new Set(cache.indices);
  }
  const indices = new Set();
  for (const pen of entries) {
    const { radius } = pen;
    const minX = Math.max(0, Math.floor(pen.x - radius));
    const maxX = Math.min(world.width - 1, Math.ceil(pen.x + radius));
    const minY = Math.max(0, Math.floor(pen.y - radius));
    const maxY = Math.min(world.height - 1, Math.ceil(pen.y + radius));
    const radiusSquared = radius * radius;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const dx = x - pen.x, dy = y - pen.y;
      if (dx * dx + dy * dy <= radiusSquared) indices.add(y * world.width + x);
    }
  }
  clearanceByWorld.set(world, {
    signature, tiles: world.tiles, day, indices,
    hits: cache?.hits || 0, rebuilds: (cache?.rebuilds || 0) + 1
  });
  return new Set(indices);
}

export function clearWildVegetationNearCorrals(world, clearance = corralNaturalClearanceTiles(world)) {
  let changed = false;
  for (const index of clearance) {
    const tile = world.tiles[index];
    if (!tile) continue;
    for (const plantIndex of CLEARABLE_PLANT_INDICES) {
      if (!(tile.plantResourceMask & (1 << plantIndex)) && !(tile.plants?.[plantIndex] > 0)) continue;
      if (tile.plants) tile.plants[plantIndex] = 0;
      tile.plantResourceMask &= ~(1 << plantIndex);
      changed = true;
    }
    if (tile.stump) {
      tile.stump = null;
      changed = true;
    }
  }
  if (changed) invalidateNavigation(world);
  return { clearance, changed };
}
