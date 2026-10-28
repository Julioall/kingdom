import { clamp, hash01, spatialNoise } from '../core/math.js';
import { PLANTS } from '../../config/ecosystem.js';

// Mineral deposits are finite. This routine only runs while constructing a new
// seeded world: depletion does not trigger periodic, free ore respawn.
function geologicalRank(seed, tile, salt, preference) {
  const patch = spatialNoise(seed + salt + 37, tile.x, tile.y, 11);
  const elevation = clamp((tile.elevationLevel || 0) / 2, 0, 1);
  const slope = clamp(tile.slope || 0, 0, 1);
  return hash01(seed + salt, tile.x, tile.y) * .48 + patch * .25
    + (preference === 'high' ? elevation * .2 + slope * .07
      : (1 - elevation) * .13 + slope * .14);
}

function rankedSites(seed, tiles, salt, preference) {
  return tiles.map(tile => ({ tile, score: geologicalRank(seed, tile, salt, preference) }))
    .sort((a, b) => b.score - a.score || a.tile.i - b.tile.i)
    .map(entry => entry.tile);
}

/**
 * Gold deposits keep their original generation unchanged. Each existing gold
 * deposit anchors 10 silver deposits and 100 copper deposits. Iron is not
 * money; its deposit-site frequency follows the same seeded tree-site scale,
 * while elevation, slope, and geological patches determine where it appears.
 */
export function seedAdditionalMinerals(world) {
  const land = world.tiles.filter(tile => tile.terrain === 'land');
  const goldCount = land.filter(tile => tile.goldOre > .05).length;
  const silverTarget = goldCount * 10;
  const copperTarget = goldCount * 100;

  const candidates = land.filter(tile => tile.goldOre <= .05);
  // Prefer one visible mineral per patch. If a gold-rich seed lacks enough
  // separate patches, allow silver and copper to share land, not to disappear.
  const silverSites = rankedSites(world.seed, candidates, 191, 'high').slice(0, silverTarget);
  const silverSet = new Set(silverSites);
  const copperCandidates = candidates.filter(tile => !silverSet.has(tile));
  const copperSites = rankedSites(world.seed, copperCandidates, 173, 'low').slice(0, copperTarget);
  for (const tile of silverSites) tile.silverOre = 1 + hash01(world.seed + 197, tile.x, tile.y) * 3;
  for (const tile of copperSites) tile.copperOre = 2 + hash01(world.seed + 181, tile.x, tile.y) * 6;

  const broadleaf = PLANTS.findIndex(plant => plant.id === 'broadleaf');
  const conifer = PLANTS.findIndex(plant => plant.id === 'conifer');
  const treeSiteCount = land.filter(tile =>
    (tile.plants[broadleaf] || 0) > .01 || (tile.plants[conifer] || 0) > .01).length;
  // Comparable to living tree-site frequency, not to the fixed coin exchange
  // rate. Terrain features guide the patches; mineable reserves stay finite.
  const ironSites = rankedSites(world.seed, land, 211, 'high').slice(0, treeSiteCount);
  for (const tile of ironSites) tile.ironOre = 3 + hash01(world.seed + 227, tile.x, tile.y) * 9;
}
