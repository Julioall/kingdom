import { rand } from '../core/random.js';
import { log } from '../core/events.js';
import { cellAt } from '../world/spatial.js';

const CASTLE_RADIUS = 18;
const TOWER_RADIUS = 13;

function structureRadius(structure) {
  if (structure.type === 'castelo') return structure.territoryRadius || CASTLE_RADIUS;
  if (structure.type === 'torre') return structure.territoryRadius || TOWER_RADIUS;
  return 0;
}

export function recomputeKingdomTerritories(world) {
  for (const kingdom of world.kingdoms || []) kingdom.territoryTileCount = 0;
  for (const tile of world.tiles) {
    tile.kingdomId = null;
    if (tile.terrain === 'water') continue;
    let bestKingdom = null, bestDistance = Infinity;
    for (const structure of world.structures) {
      if (!structure.complete || !structure.kingdomId) continue;
      const radius = structureRadius(structure);
      if (!radius) continue;
      const distance = Math.hypot(tile.x - structure.x, tile.y - structure.y);
      if (distance > radius || distance >= bestDistance) continue;
      bestKingdom = world.kingdoms.find(kingdom => kingdom.id === structure.kingdomId) || null;
      bestDistance = distance;
    }
    if (bestKingdom) {
      tile.kingdomId = bestKingdom.id;
      bestKingdom.territoryTileCount++;
    }
  }
}

export function kingdomRelation(world, aId, bId) {
  const low = Math.min(aId, bId), high = Math.max(aId, bId), key = low + ':' + high;
  return world.kingdomRelations[key] || (world.kingdomRelations[key] = {
    a: low, b: high, status: 'peace', tension: 0, borderIncidents: 0, lastIncidentDay: -1
  });
}

export function markTerritoryStep(world, person, tile) {
  if (!person || person.kingdomId == null || !tile) return;
  const ownerId = tile.kingdomId;
  if (ownerId == null || ownerId === person.kingdomId) {
    person.lastSafeX = tile.x;
    person.lastSafeY = tile.y;
    person.territoryExposure = null;
    person.territoryAwareness = ownerId == null
      ? { ownerId: null, name: 'terra comum', warning: false, day: world.day }
      : { ownerId, name: world.kingdoms.find(kingdom => kingdom.id === ownerId)?.name || 'seu reino', warning: false, day: world.day };
    return;
  }

  const owner = world.kingdoms.find(kingdom => kingdom.id === ownerId);
  if (!person.territoryExposure || person.territoryExposure.ownerId !== ownerId) {
    person.territoryExposure = { ownerId, enteredDay: world.day, lastCheckDay: -1 };
  }
  person.territoryAwareness = { ownerId, name: owner?.name || 'reino estrangeiro', warning: true, day: world.day };
  person.lastLesson = 'Você entrou no território de ' + (owner?.name || 'outro reino') + '. A guarda pode abordar você; uma morte pode iniciar uma guerra.';
}

function nearestSafeTile(world, person, ownerId) {
  const start = Number.isFinite(person.lastSafeX) && Number.isFinite(person.lastSafeY)
    ? cellAt(world, person.lastSafeX, person.lastSafeY) : null;
  if (start && (start.kingdomId == null || start.kingdomId === ownerId)) return start;
  let best = null, bestDistance = Infinity;
  for (const tile of world.tiles) {
    if (tile.terrain === 'water' || (tile.kingdomId != null && tile.kingdomId !== ownerId)) continue;
    const distance = Math.hypot(tile.x - person.x, tile.y - person.y);
    if (distance < bestDistance) { best = tile; bestDistance = distance; }
  }
  return best;
}

function nearbyGuardStrength(world, kingdomId, person) {
  const soldiers = world.people.filter(candidate => candidate.alive && candidate.role === 'soldier'
    && candidate.kingdomId === kingdomId && Math.hypot(candidate.x - person.x, candidate.y - person.y) <= 7).length;
  const posts = world.structures.filter(structure => structure.complete && structure.kingdomId === kingdomId
    && (structure.type === 'torre' || structure.type === 'centro_militar')
    && Math.hypot(structure.x - person.x, structure.y - person.y) <= (structure.type === 'torre' ? 12 : 8)).length;
  return { soldiers, posts };
}

export function resolveBorderIncursions(world, killPerson) {
  const incidents = [];
  for (const person of world.people) {
    const exposure = person.territoryExposure;
    if (!person.alive || !exposure || exposure.lastCheckDay === world.day) continue;
    const home = world.kingdoms.find(kingdom => kingdom.id === person.kingdomId);
    const host = world.kingdoms.find(kingdom => kingdom.id === exposure.ownerId);
    if (!home || !host || home.id === host.id) { person.territoryExposure = null; continue; }
    const relation = kingdomRelation(world, home.id, host.id);
    const guard = nearbyGuardStrength(world, host.id, person);
    const detectionChance = Math.min(.62, .025 + guard.posts * .095 + Math.min(guard.soldiers, 4) * .075
      + (relation.status === 'at-war' ? .2 : 0));
    exposure.lastCheckDay = world.day;
    if (rand(world) >= detectionChance) continue;

    world.borderIncidents++;
    relation.borderIncidents++;
    relation.lastIncidentDay = world.day;
    relation.tension = Math.min(1, relation.tension + .18 + guard.soldiers * .035);
    const deathChance = Math.min(.72, .09 + Math.min(guard.soldiers, 4) * .1 + (relation.status === 'at-war' ? .24 : 0));
    const killed = rand(world) < deathChance;
    if (killed) {
      killPerson(world, person, 'invasion');
      const warChance = Math.min(.82, .18 + relation.tension * .58 + guard.soldiers * .025);
      const warStarted = relation.status !== 'at-war' && rand(world) < warChance;
      if (warStarted) {
        relation.status = 'at-war';
        relation.startedDay = world.day;
        world.wars.push({ a: relation.a, b: relation.b, startedDay: world.day, cause: 'morador morto durante uma invasão territorial' });
        log(world, 'A morte de ' + person.name + ' durante uma invasão levou ' + home.name + ' e ' + host.name + ' à guerra.');
      } else {
        log(world, person.name + ' de ' + home.name + ' morreu após ser descoberto em território de ' + host.name + '. A relação entre os reinos ficou mais tensa.');
      }
      incidents.push({ personId: person.id, homeId: home.id, hostId: host.id, killed: true, warStarted });
      continue;
    }

    const safe = nearestSafeTile(world, person, home.id);
    if (safe) { person.x = safe.x; person.y = safe.y; person.lastSafeX = safe.x; person.lastSafeY = safe.y; }
    person.injury = Math.min(8, (person.injury || 0) + .65);
    person.conflictRisk = Math.max(person.conflictRisk || 0, .8);
    person.territoryExposure = null;
    person.territoryAwareness = { ownerId: host.id, name: host.name, warning: true, caught: true, day: world.day };
    person.state = 'expulso do território de ' + host.name;
    const warChance = Math.min(.45, relation.tension * .22);
    const warStarted = relation.status !== 'at-war' && rand(world) < warChance;
    if (warStarted) {
      relation.status = 'at-war'; relation.startedDay = world.day;
      world.wars.push({ a: relation.a, b: relation.b, startedDay: world.day, cause: 'confronto de fronteira' });
      log(world, 'O confronto que expulsou ' + person.name + ' de ' + host.name + ' iniciou uma guerra entre ' + home.name + ' e ' + host.name + '.');
    } else {
      log(world, person.name + ' foi descoberto e expulso do território de ' + host.name + '. A relação com ' + home.name + ' se deteriorou.');
    }
    incidents.push({ personId: person.id, homeId: home.id, hostId: host.id, killed: false, warStarted });
  }
  return incidents;
}

export const TERRITORY_RULES = Object.freeze({ castleRadius: CASTLE_RADIUS, towerRadius: TOWER_RADIUS });
