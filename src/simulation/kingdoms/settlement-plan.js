export const HOME_OFFSETS = [-9, -3, 3, 9].flatMap(y => [[-9, y], [9, y]]);
export const TOWER_OFFSETS = [[-13, -13], [13, -13], [-13, 13], [13, 13]];

export function settlementPlan(center, front) {
  const point = (x, y) => ({ x: center.x + x, y: center.y + y * front });
  return {
    castle: point(0, 0), village: point(3, -7), market: point(-3, -7),
    barracks: point(0, 10), archery: point(-4, 5), monastery: point(4, 5),
    homes: HOME_OFFSETS.map(([x, y]) => point(x, y)),
    towers: TOWER_OFFSETS.map(([x, y]) => point(x, y))
  };
}

export function plannedBuildingSites(plan) {
  return [plan.castle, plan.village, plan.market, plan.barracks,
    plan.archery, plan.monastery, ...plan.homes, ...plan.towers];
}
