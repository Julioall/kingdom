import { rand } from '../core/random.js';
import { log } from '../core/events.js';
import { cellAt } from '../world/spatial.js';
import { reportTerritoryLoss } from './frontier-intelligence.js';
import { invalidateNavigation } from '../individuals/navigation-cache.js';

const CASTLE_RADIUS = 18;
const TOWER_RADIUS = 13;
export const TERRITORY_AVOIDANCE_DAYS = 180;

function structureRadius(structure) {
  if (structure.type === 'torre' && (structure.destroyedDay != null || structure.health === 0)) return 0;
  if (Number.isFinite(structure.integrity) && structure.integrity <= 0) return 0;
  const condition = Number.isFinite(structure.integrity) ? Math.max(.25, Math.min(1, structure.integrity)) : 1;
  if (structure.type === 'castelo') return (structure.territoryRadius || CASTLE_RADIUS) * condition;
  if (structure.type === 'torre') return (structure.territoryRadius || TOWER_RADIUS) * condition;
  return 0;
}

export function recomputeKingdomTerritories(world, context = null) {
  const previousOwners = world.tiles.map(tile => tile.kingdomId);
  const kingdoms = world.kingdoms || [];
  const kingdomById = new Map();
  for (const kingdom of kingdoms) {
    kingdom.territoryTileCount = 0;
    if (!kingdomById.has(kingdom.id)) kingdomById.set(kingdom.id, kingdom);
  }
  const territoryStructures = [];
  for (const structure of world.structures) {
    if (!structure.complete || !structure.kingdomId) continue;
    const radius = structureRadius(structure);
    if (!radius) continue;
    territoryStructures.push({
      x: structure.x, y: structure.y, radius,
      kingdom: kingdomById.get(structure.kingdomId) || null
    });
  }
  for (const tile of world.tiles) {
    tile.kingdomId = null;
    if (tile.terrain === 'water') continue;
    let bestKingdom = null, bestDistance = Infinity;
    for (const structure of territoryStructures) {
      const distance = Math.hypot(tile.x - structure.x, tile.y - structure.y);
      if (distance > structure.radius || distance >= bestDistance) continue;
      bestKingdom = structure.kingdom;
      bestDistance = distance;
    }
    if (bestKingdom) {
      tile.kingdomId = bestKingdom.id;
      bestKingdom.territoryTileCount++;
    }
  }
  for (const claim of world.territoryClaims || []) {
    if (claim.status !== 'annexed' || claim.expiresDay != null && claim.expiresDay < world.day) continue;
    const owner = kingdomById.get(claim.ownerId);
    if (!owner) continue;
    for (const tile of world.tiles) {
      if (tile.terrain === 'water' || Math.hypot(tile.x - claim.x, tile.y - claim.y) > claim.radius) continue;
      if (tile.kingdomId != null) {
        const previousOwner = kingdomById.get(tile.kingdomId);
        if (previousOwner) previousOwner.territoryTileCount = Math.max(0, previousOwner.territoryTileCount - 1);
      }
      tile.kingdomId = owner.id;
      owner.territoryTileCount++;
    }
  }
  const losses = new Map();
  if (world.tiles.some((tile, index) => tile.kingdomId !== previousOwners[index])) invalidateNavigation(world);
  world.tiles.forEach((tile, index) => {
    const previous = previousOwners[index];
    const opponent = tile.kingdomId ?? (context?.defenderId === previous ? context.attackerId : null);
    if (previous == null || opponent == null || opponent === previous) return;
    const key = previous + ':' + opponent;
    const entry = losses.get(key) || { kingdomId: previous, opponentId: opponent, tiles: 0, location: { x: tile.x, y: tile.y } };
    entry.tiles++;
    losses.set(key, entry);
  });
  for (const loss of losses.values()) reportTerritoryLoss(world, loss.kingdomId, loss.opponentId,
    loss.tiles, loss.location, context?.day ?? world.day);
}

export function kingdomRelation(world, aId, bId) {
  const low = Math.min(aId, bId), high = Math.max(aId, bId), key = low + ':' + high;
  return world.kingdomRelations[key] || (world.kingdomRelations[key] = {
    a: low, b: high, status: 'peace', tension: 0, borderIncidents: 0, lastIncidentDay: -1, resolvedDay: -1
  });
}

function startBorderWar(world, home, host, relation, person, guard, cause) {
  const location = { x: Number(person.x.toFixed(1)), y: Number(person.y.toFixed(1)) };
  const id = world.nextId++;
  const evidence = {
    location,
    incidentDay: world.day,
    source: 'incursão descoberta por uma patrulha territorial',
    intruderId: person.id,
    intruderName: person.name,
    attacker: { source: 'relato do morador sobre sua morte ou expulsão', location, certainty: 'última posição conhecida' },
    defender: { source: 'guarda local', soldiers: guard.soldiers, posts: guard.posts, location, certainty: 'observação direta' }
  };
  relation.status = 'at-war';
  relation.startedDay = world.day;
  relation.warId = id;
  relation.warCause = cause;
  const war = { id, a: relation.a, b: relation.b, attackerId: home.id, defenderId: host.id,
    startedDay: world.day, cause, evidence, status: 'active' };
  world.wars.push(war);
  const attackerIntel = { day: world.day, kind: 'war-declared', opponentId: host.id, cause, source: evidence.attacker.source, location };
  const defenderIntel = { day: world.day, kind: 'border-threat', opponentId: home.id, cause, source: evidence.defender.source,
    soldiersObserved: guard.soldiers, postsObserved: guard.posts, location };
  const attackerKingdom = world.kingdoms.find(kingdom => kingdom.id === home.id);
  const defenderKingdom = world.kingdoms.find(kingdom => kingdom.id === host.id);
  for (const [kingdom, intel] of [[attackerKingdom, attackerIntel], [defenderKingdom, defenderIntel]]) {
    if (!kingdom) continue;
    kingdom.militaryIntel ||= [];
    kingdom.militaryIntel.push(intel);
    if (kingdom.militaryIntel.length > 16) kingdom.militaryIntel.shift();
  }
  return war;
}

export function markTerritoryStep(world, person, tile) {
  if (!person || person.kingdomId == null || !tile) return;
  const ownerId = tile.kingdomId;
  if (ownerId == null || ownerId === person.kingdomId) {
    person.lastSafeX = tile.x;
    person.lastSafeY = tile.y;
    person.territoryExposure = null;
    const activeWarning = Object.entries(person.territoryWarnings || {})
      .filter(([, until]) => Number.isFinite(until) && until >= world.day)
      .sort(([, a], [, b]) => b - a)[0] || null;
    const warnedOwnerId = activeWarning ? Number(activeWarning[0]) : null;
    const warnedOwner = warnedOwnerId == null ? null
      : world.kingdoms.find(kingdom => kingdom.id === warnedOwnerId) || null;
    person.territoryAwareness = ownerId == null
      ? { ownerId: null, name: 'terra comum', warning: !!activeWarning, caught: !!activeWarning, day: world.day,
        ...(warnedOwner ? { threatOwnerId: warnedOwner.id, threatName: warnedOwner.name,
          warningUntilDay: activeWarning[1] } : {}) }
      : { ownerId, name: world.kingdoms.find(kingdom => kingdom.id === ownerId)?.name || 'seu reino',
        warning: !!activeWarning, caught: !!activeWarning, day: world.day,
        ...(warnedOwner ? { threatOwnerId: warnedOwner.id, threatName: warnedOwner.name,
          warningUntilDay: activeWarning[1] } : {}) };
    return;
  }

  const owner = world.kingdoms.find(kingdom => kingdom.id === ownerId);
  if (!person.territoryExposure || person.territoryExposure.ownerId !== ownerId) {
    person.territoryExposure = { ownerId, enteredDay: world.day, lastCheckDay: -1 };
  }
  const previouslyCaught = Number(person.territoryWarnings?.[ownerId]) >= world.day;
  person.territoryAwareness = { ownerId, name: owner?.name || 'reino estrangeiro', warning: true,
    caught: previouslyCaught, day: world.day };
  person.lastLesson = previouslyCaught
    ? 'Você voltou ao território de ' + (owner?.name || 'outro reino') + ' depois de ser expulso; a guarda pode abordar ou ferir você.'
    : 'Você entrou no território de ' + (owner?.name || 'outro reino') + '. A guarda pode abordar você; uma morte pode iniciar uma guerra.';
}

export function canEnterForeignTerritory(world, person, tile) {
  if (!person || !tile || tile.kingdomId == null || tile.kingdomId === person.kingdomId) return true;
  if (person.role === 'soldier' && (person.campaignId != null || person.militaryReturningHome)) return true;
  const warnedUntil = person.territoryWarnings && person.territoryWarnings[tile.kingdomId];
  if (!Number.isFinite(warnedUntil) || warnedUntil < world.day) return true;
  return person.foodReserve <= 8 || person.hydration <= 9;
}

function nearestSafeTile(world, person, ownerId) {
  const occupiedByAnotherPerson = tile => world.people.some(other => other !== person && other.alive
    && Math.round(other.x) === tile.x && Math.round(other.y) === tile.y);
  const start = Number.isFinite(person.lastSafeX) && Number.isFinite(person.lastSafeY)
    ? cellAt(world, person.lastSafeX, person.lastSafeY) : null;
  if (start && (start.kingdomId == null || start.kingdomId === ownerId) && !occupiedByAnotherPerson(start)) return start;
  let best = null, bestDistance = Infinity;
  for (const tile of world.tiles) {
    if (tile.terrain === 'water' || (tile.kingdomId != null && tile.kingdomId !== ownerId)
        || occupiedByAnotherPerson(tile)) continue;
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
    && Math.hypot(structure.x - person.x, structure.y - person.y) <= (structure.type === 'torre'
      ? structure.frontierOutpost ? 8 : 12 : 8)).length;
  return { soldiers, posts };
}

export function resolveBorderIncursions(world, killPerson) {
  if (world.day <= 45) return [];
  const incidents = [];
  for (const person of world.people) {
    const exposure = person.territoryExposure;
    if (!person.alive || person.role === 'soldier' && (person.campaignId != null || person.militaryReturningHome) || !exposure || exposure.lastCheckDay === world.day) continue;
    const home = world.kingdoms.find(kingdom => kingdom.id === person.kingdomId);
    const host = world.kingdoms.find(kingdom => kingdom.id === exposure.ownerId);
    if (!home || !host || home.id === host.id) { person.territoryExposure = null; continue; }
    const relation = kingdomRelation(world, home.id, host.id);
    const guard = nearbyGuardStrength(world, host.id, person);
    const hasLocalPatrol = guard.posts > 0 || guard.soldiers > 0;
    const detectionChance = hasLocalPatrol
      ? Math.min(.62, .025 + guard.posts * .095 + Math.min(guard.soldiers, 4) * .075
        + (relation.status === 'at-war' ? .2 : 0))
      : 0;
    exposure.lastCheckDay = world.day;
    if (rand(world) >= detectionChance) continue;

    world.borderIncidents++;
    relation.borderIncidents++;
    relation.lastIncidentDay = world.day;
    relation.tension = Math.min(1, relation.tension + .18 + guard.soldiers * .035);
    const deathChance = guard.soldiers > 0
      ? Math.min(.72, .09 + Math.min(guard.soldiers, 4) * .1 + (relation.status === 'at-war' ? .24 : 0))
      : 0;
    const killed = rand(world) < deathChance;
    if (killed) {
      killPerson(person, 'invasion');
      const warChance = Math.min(.82, .18 + relation.tension * .58 + guard.soldiers * .025);
      const warStarted = relation.status !== 'at-war' && world.day > (relation.ceasefireUntilDay ?? -1) && rand(world) < warChance;
      if (warStarted) {
        startBorderWar(world, home, host, relation, person, guard, 'morador morto durante uma invasão territorial');
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
    person.lastLesson = 'A guarda de ' + host.name + ' descobriu a incursão e causou ferimentos. Evite esse território e procure uma rota segura.';
    const warChance = Math.min(.45, relation.tension * .22);
    const warStarted = relation.status !== 'at-war' && world.day > (relation.ceasefireUntilDay ?? -1) && rand(world) < warChance;
    if (warStarted) {
      startBorderWar(world, home, host, relation, person, guard, 'confronto de fronteira');
      log(world, 'O confronto que expulsou ' + person.name + ' de ' + host.name + ' iniciou uma guerra entre ' + home.name + ' e ' + host.name + '.');
    } else {
      log(world, person.name + ' foi descoberto e expulso do território de ' + host.name + '. A relação com ' + home.name + ' se deteriorou.');
    }
    person.territoryWarnings ||= {};
    person.territoryWarnings[host.id] = world.day + TERRITORY_AVOIDANCE_DAYS;
    incidents.push({ personId: person.id, homeId: home.id, hostId: host.id, killed: false, warStarted });
  }
  return incidents;
}

export const TERRITORY_RULES = Object.freeze({ castleRadius: CASTLE_RADIUS, towerRadius: TOWER_RADIUS });
