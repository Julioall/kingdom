import { hash01 } from '../simulation/core/math.js';

export const MAP_DECORATION_SPRITES = Object.freeze([
  'bone-14', 'bone-15',
  'mushroom-01', 'mushroom-02', 'mushroom-03',
  'plant-10', 'plant-11'
]);

const BONES = MAP_DECORATION_SPRITES.slice(0, 2);
const MUSHROOMS = MAP_DECORATION_SPRITES.slice(2, 5);
const PLANTS = MAP_DECORATION_SPRITES.slice(5);

export function mapDecorationAt(tile, seed) {
  if (!tile || tile.terrain !== 'land' || tile.cropFieldId != null) return null;
  const chance = hash01(seed + 3851, tile.x, tile.y);
  const variants = chance < .003 ? BONES : chance < .02 ? MUSHROOMS : chance < .045 ? PLANTS : null;
  if (!variants) return null;
  const variant = Math.min(variants.length - 1,
    Math.floor(hash01(seed + 4421, tile.x, tile.y) * variants.length));
  const size = .76 + hash01(seed + 4789, tile.x, tile.y) * .24;
  return { sprite: variants[variant], size };
}
