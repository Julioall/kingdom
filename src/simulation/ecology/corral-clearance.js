import { PLANTS } from '../../config/ecosystem.js';
import { invalidateNavigation } from '../individuals/navigation-cache.js';
import { corralFenceRadius } from './herd.js';

export const CORRAL_NATURAL_CLEARANCE = 3;

const CLEARABLE_PLANTS = ['berry', 'browse', 'broadleaf', 'conifer'];
const CLEARABLE_PLANT_INDICES = CLEARABLE_PLANTS
  .map(id => PLANTS.findIndex(plant => plant.id === id))
  .filter(index => index >= 0);

export function corralNaturalClearanceTiles(world) {
  const indices = new Set();
  if (!world?.width || !world?.height || !world.tiles) return indices;

  const corrals = world.structures || [];
  for (const pen of corrals) {
    if (pen.type !== 'curral' || pen.destroyedDay != null || pen.integrity === 0) continue;
    const radius = Math.max(Number(pen.radius) || 3.5, corralFenceRadius(pen)) + CORRAL_NATURAL_CLEARANCE;
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
  return indices;
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
