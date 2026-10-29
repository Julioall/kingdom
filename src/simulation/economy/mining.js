import { invalidateNavigation } from '../individuals/navigation-cache.js';

// Work is bounded by the existing mining rate. Large veins require more work,
// then release their finite stock as individually collectible fragments.
export function workMineralDeposit(world, tile, kind, rate) {
  const field = kind === 'stone' ? 'stoneDeposit' : kind + 'Ore';
  const reserve = tile[field] || 0;
  if (!(reserve > 0) || !Number.isFinite(reserve) || !(rate > 0) || !Number.isFinite(rate)) return { worked: 0, dropped: 0 };
  const progress = (tile.miningWork ||= {});
  const previous = progress[kind]?.reserve === reserve ? progress[kind].work : 0;
  const worked = Math.min(rate, Math.max(0, reserve - previous));
  progress[kind] = { reserve, work: previous + worked };
  if (previous + worked < reserve - 1e-9) return { worked, dropped: 0 };
  tile[field] = 0;
  delete progress[kind];
  invalidateNavigation(world);
  let remaining = reserve, fragment = 0;
  while (remaining > 0) {
    const amount = Math.min(1, remaining);
    const angle = fragment * 2.399963229728653;
    const radius = Math.min(1.1, .18 * Math.sqrt(fragment));
    let x = tile.x + Math.cos(angle) * radius, y = tile.y + Math.sin(angle) * radius;
    const ground = world.tiles?.[Math.round(y) * world.width + Math.round(x)];
    if (!ground || ground.terrain !== 'land' || ground.elevationLevel !== tile.elevationLevel) { x = tile.x; y = tile.y; }
    (world.loot ||= []).push({ id: world.nextId++,
      x, y,
      resources: { [kind]: amount }, mineralKind: kind, sourceTileIndex: tile.i,
      available: true, droppedDay: world.day });
    remaining -= amount;
    fragment++;
  }
  return { worked, dropped: reserve };
}
