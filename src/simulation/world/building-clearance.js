export const LAKE_BUILDING_CLEARANCE = 5;
export const MINERAL_BUILDING_CLEARANCE = 8;
const DEPOSIT_FIELDS = ['stoneDeposit', 'goldOre', 'silverOre', 'copperOre', 'ironOre'];

export function initialSettlementCenters(width, height) {
  return [8.5, 17.5].map(y => ({ x: Math.round(18 * width / 36), y: Math.round(y * height / 26) }));
}

export function hasBuildingResourceClearance(world, site, radius = 2.5, minerals = true) {
  const reach = radius + Math.max(LAKE_BUILDING_CLEARANCE, minerals ? MINERAL_BUILDING_CLEARANCE : 0);
  const lakeDistanceSquared = (radius + LAKE_BUILDING_CLEARANCE) ** 2;
  const mineralDistanceSquared = (radius + MINERAL_BUILDING_CLEARANCE) ** 2;
  for (let y = Math.max(0, Math.floor(site.y - reach)); y <= Math.min(world.height - 1, Math.ceil(site.y + reach)); y++) {
    for (let x = Math.max(0, Math.floor(site.x - reach)); x <= Math.min(world.width - 1, Math.ceil(site.x + reach)); x++) {
      const tile = world.tiles[y * world.width + x];
      if (!tile) continue;
      const distanceSquared = (x - site.x) ** 2 + (y - site.y) ** 2;
      if (tile.waterKind === 'lake' && distanceSquared < lakeDistanceSquared) return false;
      if (minerals && distanceSquared < mineralDistanceSquared
        && DEPOSIT_FIELDS.some(field => (tile[field] || 0) > .05)) return false;
    }
  }
  return true;
}
