import { clamp } from '../core/math.js';

export const ROAD_RULES = Object.freeze({
  footstepWear: .25,
  dailyRecovery: .998,
  consolidatedDailyRecovery: .9997,
  maxWear: 32,
  visibleAt: 2.5,
  fastAt: 7
});

const SETTLEMENT_ZONES = Object.freeze({
  castelo: { radius: 11, strength: .95 },
  vila: { radius: 8, strength: .88 },
  mercado: { radius: 8, strength: .84 },
  centro_militar: { radius: 7, strength: .82 },
  casa: { radius: 5, strength: .76 },
  abrigo: { radius: 5, strength: .72 },
  'posto de coleta': { radius: 5, strength: .62 },
  acampamento: { radius: 6, strength: .62 },
  curral: { radius: 4, strength: .45 }
});

export function isRoadTile(tile, fast = false) {
  return !!tile && (tile.roadWear || 0) >= (fast ? ROAD_RULES.fastAt : ROAD_RULES.visibleAt);
}

export function recordFootstep(tile, agent, day = null) {
  // Animal tracks are not roads; only inhabitants contribute to the shared paths.
  if (!agent || agent.speciesId != null || !tile || tile.terrain !== 'land') return;
  tile.roadWear = Math.min(ROAD_RULES.maxWear, (tile.roadWear || 0) + ROAD_RULES.footstepWear);
  if (Number.isFinite(day)) tile.lastRoadUseDay = day;
}

export function updateRoadWear(world) {
  for (const tile of world.tiles) {
    if ((tile.roadWear || 0) > .01) tile.roadWear *= isRoadTile(tile, true)
      ? ROAD_RULES.consolidatedDailyRecovery : ROAD_RULES.dailyRecovery;
    else tile.roadWear = 0;
    tile.peoplePresence = 0;
    tile.civilizationPressure = 0;
  }
  for (const person of world.people || []) {
    if (!person.alive) continue;
    const centerX = Math.round(person.x), centerY = Math.round(person.y), radius = 5;
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      const distance = Math.hypot(dx, dy);
      if (distance > radius) continue;
      const x = centerX + dx, y = centerY + dy;
      if (x < 0 || y < 0 || x >= world.width || y >= world.height) continue;
      const tile = world.tiles[y * world.width + x];
      if (tile && tile.terrain === 'land') tile.peoplePresence += .14 * (1 - distance / (radius + 1));
    }
  }
  for (const structure of world.structures || []) {
    const zone = SETTLEMENT_ZONES[structure.type];
    if (!zone || !structure.complete) continue;
    const centerX = Math.round(structure.x), centerY = Math.round(structure.y);
    for (let dy = -zone.radius; dy <= zone.radius; dy++) for (let dx = -zone.radius; dx <= zone.radius; dx++) {
      const distance = Math.hypot(dx, dy);
      if (distance >= zone.radius) continue;
      const x = centerX + dx, y = centerY + dy;
      if (x < 0 || y < 0 || x >= world.width || y >= world.height) continue;
      const tile = world.tiles[y * world.width + x];
      if (!tile || tile.terrain !== 'land') continue;
      const pressure = zone.strength * Math.pow(1 - distance / zone.radius, 1.4);
      tile.civilizationPressure = Math.max(tile.civilizationPressure, pressure);
    }
  }
  for (const tile of world.tiles) {
    const footTraffic = clamp((tile.peoplePresence || 0) * 2.2, 0, 1);
    const roadTraffic = clamp((tile.roadWear || 0) / 18 * .78, 0, 1);
    tile.civilizationPressure = Math.max(tile.civilizationPressure, footTraffic, roadTraffic);
  }
}

export function roadPressure(tile) {
  return Math.max(0, Math.min(1, (tile && tile.roadWear || 0) / 18 * .72 + (tile && tile.peoplePresence || 0) / 3));
}
