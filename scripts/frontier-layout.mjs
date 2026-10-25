import { recomputeKingdomTerritories } from '../src/simulation/kingdoms/territories.js';
import { cellAt } from '../src/simulation/world/spatial.js';

function moveKingdom(world, kingdom, requestedX, requestedY, placements) {
  const community = world.communities.find(item => item.id === kingdom.communityId);
  const people = world.people.filter(item => item.kingdomId === kingdom.id);
  const grounds = community ? Object.values(community.grounds || {}).filter(point => point
    && Number.isFinite(point.x) && Number.isFinite(point.y)) : [];
  const assets = [
    ...people,
    ...(community ? [community] : []),
    ...world.structures.filter(item => item.kingdomId === kingdom.id),
    ...world.settlements.filter(item => item.kingdomId === kingdom.id),
    ...world.animals.filter(item => community && item.herdCommunityId === community.id),
    ...grounds,
    ...(community && community.properties || [])
  ];
  const otherCenters = world.kingdoms.filter(item => item.id !== kingdom.id);
  const candidates = world.tiles.filter(tile => tile.terrain === 'land').map(tile => {
    const dx = tile.x - kingdom.x, dy = tile.y - kingdom.y;
    const staysOnLand = assets.every(asset => cellAt(world, asset.x + dx, asset.y + dy)?.terrain === 'land')
      && people.every(person => !Number.isFinite(person.lastSafeX) || !Number.isFinite(person.lastSafeY)
        || cellAt(world, person.lastSafeX + dx, person.lastSafeY + dy)?.terrain === 'land');
    const hasSeparation = otherCenters.every(other => Math.hypot(tile.x - other.x, tile.y - other.y) >= 28);
    return { x: tile.x, y: tile.y, dx, dy, staysOnLand, hasSeparation,
      offset: Math.hypot(tile.x - requestedX, tile.y - requestedY) };
  }).filter(item => item.staysOnLand && item.hasSeparation)
    .sort((a, b) => a.offset - b.offset || a.y - b.y || a.x - b.x);
  const target = candidates[0];
  if (!target) throw new Error('Não foi possível posicionar ' + kingdom.name + ' em terra sem sobrepor os outros reinos.');
  const { x, y, dx, dy } = target;
  placements.push({ kingdom: kingdom.name, requested: { x: requestedX, y: requestedY },
    placed: { x, y }, snapped: target.offset > .01 });
  kingdom.x = x;
  kingdom.y = y;
  if (community) { community.x += dx; community.y += dy; }
  for (const structure of world.structures.filter(item => item.kingdomId === kingdom.id)) {
    structure.x += dx;
    structure.y += dy;
  }
  for (const settlement of world.settlements.filter(item => item.kingdomId === kingdom.id)) {
    settlement.x += dx;
    settlement.y += dy;
  }
  for (const person of people) {
    person.x += dx;
    person.y += dy;
    if (Number.isFinite(person.lastSafeX)) person.lastSafeX += dx;
    if (Number.isFinite(person.lastSafeY)) person.lastSafeY += dy;
    person.perception = null;
  }
  for (const animal of world.animals.filter(item => community && item.herdCommunityId === community.id)) {
    animal.x += dx;
    animal.y += dy;
  }
  if (community) {
    for (const point of grounds) { point.x += dx; point.y += dy; }
    for (const property of community.properties || []) { property.x += dx; property.y += dy; }
  }
}

export function applyFrontierLayout(world) {
  const placements = [];
  moveKingdom(world, world.kingdoms[0], 31, 31, placements);
  moveKingdom(world, world.kingdoms[1], 60, 60, placements);
  recomputeKingdomTerritories(world);
  return placements;
}
