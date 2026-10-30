import { clamp, hash01, spatialNoise } from '../core/math.js';
import { PLANTS } from '../../config/ecosystem.js';
import { MINERAL_BUILDING_CLEARANCE } from './building-clearance.js';
import { invalidateNavigation } from '../individuals/navigation-cache.js';

const SILVER_SITES_PER_GOLD_SITE = 2;
const COPPER_SITES_PER_GOLD_SITE = 5;
const IRON_SITE_FRACTION_OF_TREE_SITES = 1 / 8;
const DEPOSIT_FIELDS = ['stoneDeposit', 'goldOre', 'silverOre', 'copperOre', 'ironOre'];

export function reduceInitialMineralSites(world) {
  for (const field of ['stoneDeposit', 'goldOre']) {
    const sites = world.tiles.filter(tile => (tile[field] || 0) > 0)
      .sort((a, b) => hash01(world.seed + 563, a.x, a.y) - hash01(world.seed + 563, b.x, b.y) || a.i - b.i);
    for (const tile of sites.slice(Math.floor(sites.length / 4))) tile[field] = 0;
  }
}

// Move finite reserves rather than deleting ore underneath the initial town.
// Occupied destination tiles are excluded so deposit counts remain conserved.
export function relocateSettlementMinerals(world) {
  const structures = world.structures.filter(s => s.destroyedDay == null);
  const farFromBuildings = tile => structures.every(s =>
    Math.hypot(tile.x - s.x, tile.y - s.y) >= MINERAL_BUILDING_CLEARANCE + (s.radius || 2.5));
  const destinations = world.tiles.filter(tile => tile.terrain === 'land' && farFromBuildings(tile)
    && DEPOSIT_FIELDS.every(field => !(tile[field] > 0)))
    .sort((a, b) => hash01(world.seed + 547, a.x, a.y) - hash01(world.seed + 547, b.x, b.y) || a.i - b.i);
  let cursor = 0;
  for (const tile of world.tiles) {
    if (farFromBuildings(tile)) continue;
    for (const field of DEPOSIT_FIELDS) {
      if (!(tile[field] > 0)) continue;
      const destination = destinations[cursor++];
      if (!destination) throw new Error('Não há terreno livre para afastar as jazidas da vila.');
      destination[field] = tile[field];
      tile[field] = 0;
    }
  }
  invalidateNavigation(world);
}

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
 * Initial gold/stone density is one quarter of its original value. Silver and
 * copper follow the remaining gold sites; iron keeps a quarter of its old sites. The richer
 * veins make each mining trip more useful while keeping all ore finite.
 */
export function seedAdditionalMinerals(world) {
  const land = world.tiles.filter(tile => tile.terrain === 'land');
  const goldCount = land.filter(tile => tile.goldOre > .05).length;
  const silverTarget = goldCount * SILVER_SITES_PER_GOLD_SITE;
  const copperTarget = goldCount * COPPER_SITES_PER_GOLD_SITE;

  const candidates = land.filter(tile => tile.goldOre <= .05);
  // Prefer one visible mineral per patch. If a gold-rich seed lacks enough
  // separate patches, allow silver and copper to share land, not to disappear.
  const silverSites = rankedSites(world.seed, candidates, 191, 'high').slice(0, silverTarget);
  const silverSet = new Set(silverSites);
  const copperCandidates = candidates.filter(tile => !silverSet.has(tile));
  const copperSites = rankedSites(world.seed, copperCandidates, 173, 'low').slice(0, copperTarget);
  for (const tile of silverSites) tile.silverOre = 6 + hash01(world.seed + 197, tile.x, tile.y) * 14;
  for (const tile of copperSites) tile.copperOre = 20 + hash01(world.seed + 181, tile.x, tile.y) * 40;

  const broadleaf = PLANTS.findIndex(plant => plant.id === 'broadleaf');
  const conifer = PLANTS.findIndex(plant => plant.id === 'conifer');
  const treeSiteCount = land.filter(tile =>
    (tile.plants[broadleaf] || 0) > .01 || (tile.plants[conifer] || 0) > .01).length;
  const ironTarget = Math.floor(Math.ceil(treeSiteCount * IRON_SITE_FRACTION_OF_TREE_SITES) / 4);
  // Prefer unoccupied ground to avoid putting ore hitboxes on top of trees,
  // precious-metal deposits or stone. If there is not enough free land, use
  // deterministic fallback patches rather than silently lowering abundance.
  const clearGround = land.filter(tile =>
    tile.goldOre <= .05 && tile.silverOre <= .05 && tile.copperOre <= .05
    && tile.stoneDeposit <= .7
    && (tile.plants[broadleaf] || 0) <= .01 && (tile.plants[conifer] || 0) <= .01);
  const available = new Set(clearGround);
  const fallback = land.filter(tile => !available.has(tile));
  const ironSites = rankedSites(world.seed, clearGround, 211, 'high').slice(0, ironTarget);
  if (ironSites.length < ironTarget) {
    ironSites.push(...rankedSites(world.seed, fallback, 229, 'high')
      .slice(0, ironTarget - ironSites.length));
  }
  for (const tile of ironSites) tile.ironOre = 12 + hash01(world.seed + 227, tile.x, tile.y) * 24;
}
