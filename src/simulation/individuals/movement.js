import { cellAt } from '../world/spatial.js';
import { distance } from '../core/math.js';
import { magicModifiers } from '../magic/effects.js';
import { isCombatStunned } from '../kingdoms/combat-status.js';
import { carriedResources } from '../economy/inventories.js';
import { isTreeAnchor } from '../ecology/plants.js';
import { canEnterForeignTerritory, markTerritoryStep } from '../kingdoms/territories.js';
import { isRoadTile, recordFootstep } from '../world/roads.js';
import { canTraverseElevation } from '../world/island-terrain.js';
import { congestionRouteStep, rememberedRouteStep, rememberRouteArrival } from './navigation.js';
import { peopleNear } from './spatial-index.js';
import { consumePersonEnergy } from './energy.js';
import { collidesWithWorldAt, hitboxesOverlap, mineralHitbox, npcHitbox, worldCollisionIndex } from '../physics/hitboxes.js';
import { assignedHerdPen, corralFenceRadius, herdPenRadius } from '../ecology/herd.js';

const PASSAGE_BUSY_ACTIONS = new Set(['forage', 'hunt', 'deliver', 'drink', 'rest', 'build', 'gather',
  'collect_log', 'collect_feed', 'trade', 'capture_sheep', 'lead_sheep', 'raid', 'campaign']);
const MAX_PASSAGE_HANDOFF_DEPTH = 12;

function insideCorral(x, y, structure, radius) {
  return x > structure.x - radius && x < structure.x + radius
    && y > structure.y - radius && y < structure.y + radius;
}

function resourceBlocksTile(w, tile) {
  return isTreeAnchor(w, tile) || !!mineralHitbox(tile);
}

export function corralGate(w, structure, radiusOverride) {
  const radius = Math.max(2, Math.round(radiusOverride || corralFenceRadius(structure)));
  const centerX = Math.round(structure.x), centerY = Math.round(structure.y);
  const candidates = [];
  for (let offset = -radius; offset <= radius; offset++) {
    candidates.push({ x: centerX + offset, y: centerY + radius, priority: Math.abs(offset), corner: Math.abs(offset) === radius });
  }
  for (let offset = -radius + 1; offset < radius; offset++) {
    candidates.push({ x: centerX - radius, y: centerY + offset, priority: radius + Math.abs(offset) + 2, corner: false });
    candidates.push({ x: centerX + radius, y: centerY + offset, priority: radius + Math.abs(offset) + 2, corner: false });
  }
  for (let offset = -radius; offset <= radius; offset++) {
    candidates.push({ x: centerX + offset, y: centerY - radius, priority: radius * 2 + Math.abs(offset) + 4, corner: Math.abs(offset) === radius });
  }
  candidates.sort((a, b) => Number(a.corner) - Number(b.corner) || a.priority - b.priority || a.y - b.y || a.x - b.x);
  const walkableGates = candidates.filter(candidate => !candidate.corner && (() => {
    const tile = cellAt(w, candidate.x, candidate.y);
    if (!tile || tile.terrain !== 'land' || resourceBlocksTile(w, tile)) return false;
    const dx = Math.abs(candidate.x - centerX) === radius ? Math.sign(candidate.x - centerX) : 0;
    const dy = Math.abs(candidate.y - centerY) === radius ? Math.sign(candidate.y - centerY) : 0;
    const inside = cellAt(w, candidate.x - dx, candidate.y - dy);
    const outside = cellAt(w, candidate.x + dx, candidate.y + dy);
    return inside && inside.terrain === 'land' && !resourceBlocksTile(w, inside)
      && outside && outside.terrain === 'land' && !resourceBlocksTile(w, outside);
  })());
  if (walkableGates.length) return walkableGates[0];
  return candidates.find(candidate => !candidate.corner && (() => {
    const tile = cellAt(w, candidate.x, candidate.y);
    return tile?.terrain === 'land' && !resourceBlocksTile(w, tile);
  })())
    || candidates.find(candidate => !candidate.corner && cellAt(w, candidate.x, candidate.y)?.terrain === 'land')
    || candidates.find(candidate => cellAt(w, candidate.x, candidate.y)?.terrain === 'land') || candidates[0];
}

function activeCorrals(w) {
  return w.structures.filter(structure => structure.complete && structure.type === 'curral').map(structure => {
    const radius = corralFenceRadius(structure);
    return { structure, radius, gate: corralGate(w, structure, radius) };
  });
}

function isCorralFenceCell(corrals, x, y) {
  for (const { structure, radius, gate } of corrals) {
    const dx = x - Math.round(structure.x), dy = y - Math.round(structure.y);
    const onPerimeter = Math.abs(dx) <= radius && Math.abs(dy) <= radius
      && (Math.abs(dx) === radius || Math.abs(dy) === radius);
    if (onPerimeter && !(gate.x === x && gate.y === y)) return true;
  }
  return false;
}

function corralGateExitCell(corral) {
  const centerX = Math.round(corral.structure.x), centerY = Math.round(corral.structure.y);
  const outwardX = Math.abs(corral.gate.x - centerX) === corral.radius
    ? Math.sign(corral.gate.x - centerX) : 0;
  const outwardY = Math.abs(corral.gate.y - centerY) === corral.radius
    ? Math.sign(corral.gate.y - centerY) : 0;
  return { x: corral.gate.x + outwardX, y: corral.gate.y + outwardY };
}

function corralWaypoint(agent, target, corrals) {
  for (const corral of corrals) {
    const { structure, radius, gate } = corral;
    const targetIsInside = insideCorral(target.x, target.y, structure, radius)
      || isCorralFenceCell([corral], Math.round(target.x), Math.round(target.y));
    if (distance(agent, gate) <= .01) {
      const centerX = Math.round(structure.x), centerY = Math.round(structure.y);
      const outwardX = Math.abs(gate.x - centerX) === radius ? Math.sign(gate.x - centerX) : 0;
      const outwardY = Math.abs(gate.y - centerY) === radius ? Math.sign(gate.y - centerY) : 0;
      return { x: gate.x + (targetIsInside ? -outwardX : outwardX), y: gate.y + (targetIsInside ? -outwardY : outwardY) };
    }
    if (insideCorral(agent.x, agent.y, structure, radius) === targetIsInside) continue;
    if (distance(agent, gate) > .01) return gate;
  }
  return target;
}

function canEnter(w, agent, tile, aquatic, pen, corrals, movementOptions) {
  if (!tile || (aquatic ? tile.terrain !== 'water' : tile.terrain === 'water' || tile.terrain === 'rock')) return false;
  if (!aquatic && !canEnterForeignTerritory(w, agent, tile)) return false;
  if (movementOptions?.allowedTile && !movementOptions.allowedTile(tile)) return false;
  if (!aquatic && isCorralFenceCell(corrals, tile.x, tile.y)) return false;
  if (pen && distance(tile, pen) > herdPenRadius(pen) && !movementOptions?.allowPenReturn) {
    const penCorral = corrals.find(corral => corral.structure.id === pen.id);
    const isGate = penCorral && tile.x === penCorral.gate.x && tile.y === penCorral.gate.y;
    const exit = penCorral && corralGateExitCell(penCorral);
    const isGateExit = penCorral && Math.round(agent.x) === penCorral.gate.x
      && Math.round(agent.y) === penCorral.gate.y && tile.x === exit.x && tile.y === exit.y;
    if (!isGate && !isGateExit) return false;
  }
  if (!aquatic && movementOptions?.collisionIndex
      && collidesWithWorldAt(w, agent, tile.x, tile.y, movementOptions.collisionIndex)) return false;
  return true;
}

function canStep(w, agent, from, to, aquatic, pen, corrals, movementOptions) {
  if (!to || !canEnter(w, agent, to, aquatic, pen, corrals, movementOptions)) return false;
  const dx = to.x - from.x, dy = to.y - from.y;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) return false;
  const fromTile = cellAt(w, from.x, from.y) || from;
  if (!aquatic && !canTraverseElevation(fromTile, to)) return false;
  if (dx && dy) {
    const horizontal = cellAt(w, from.x + dx, from.y);
    const vertical = cellAt(w, from.x, from.y + dy);
    if (!canEnter(w, agent, horizontal, aquatic, pen, corrals, movementOptions)
      || !canEnter(w, agent, vertical, aquatic, pen, corrals, movementOptions)
      || (!aquatic && (!canTraverseElevation(fromTile, horizontal) || !canTraverseElevation(horizontal, to)
        || !canTraverseElevation(fromTile, vertical) || !canTraverseElevation(vertical, to)))) return false;
  }
  return true;
}

// Connected, walkable ground around an objective, using the same terrain,
// ramps, trees and fences as actual movement. Occupants can move aside later.
export function reachableAreaAround(w, agent, center, radius) {
  const corrals = activeCorrals(w);
  const movementOptions = { collisionIndex: worldCollisionIndex(w) };
  // Visit only the bounding rectangle of the requested local radius.
  // Enumerating by y then x preserves w.tiles' row-major order, including the
  // original start-tile tie-break and BFS ordering.
  const candidates = [];
  // 0 = unchecked, 1 = passable, 2 = blocked. A scoped cache avoids running
  // expensive collision/territory checks again for each BFS edge. A diagonal
  // side tile may lie *outside* the requested circle, so check it lazily.
  const passability = new Uint8Array(w.tiles.length);
  const isPassable = tile => {
    if (!tile) return false;
    let status = passability[tile.i];
    if (!status) {
      status = canEnter(w, agent, tile, false, null, corrals, movementOptions) ? 1 : 2;
      passability[tile.i] = status;
    }
    return status === 1;
  };
  const minX = Math.max(0, Math.ceil(center.x - radius));
  const maxX = Math.min(w.width - 1, Math.floor(center.x + radius));
  const minY = Math.max(0, Math.ceil(center.y - radius));
  const maxY = Math.min(w.height - 1, Math.floor(center.y + radius));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const tile = w.tiles[y * w.width + x];
      if (tile && distance(tile, center) <= radius && isPassable(tile)) candidates.push(tile);
    }
  }
  const start = candidates.reduce((best, tile) => !best || distance(tile, center) < distance(best, center) ? tile : best, null);
  if (!start) return [];
  const allowed = new Set(candidates.map(tile => tile.i)), seen = new Set([start.i]), queue = [start];
  const canStepWithinArea = (from, to) => {
    // Destination passability was already validated when forming candidates.
    const fromTile = cellAt(w, from.x, from.y) || from;
    if (!canTraverseElevation(fromTile, to)) return false;
    const dx = to.x - from.x, dy = to.y - from.y;
    if (!dx || !dy) return true;
    const horizontal = cellAt(w, from.x + dx, from.y);
    const vertical = cellAt(w, from.x, from.y + dy);
    return isPassable(horizontal) && isPassable(vertical)
      && canTraverseElevation(fromTile, horizontal) && canTraverseElevation(horizontal, to)
      && canTraverseElevation(fromTile, vertical) && canTraverseElevation(vertical, to);
  };
  for (let index = 0; index < queue.length; index++) {
    const from = queue[index];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const next = cellAt(w, from.x + dx, from.y + dy);
      if (!next || !allowed.has(next.i) || seen.has(next.i)
          || !canStepWithinArea(from, next)) continue;
      seen.add(next.i); queue.push(next);
    }
  }
  return queue;
}

function personOnTile(w, tile, except = null) {
  if (!tile) return null;
  const destinationHitbox = npcHitbox(except || { x: tile.x, y: tile.y }, tile.x, tile.y);
  return peopleNear(w, tile.x, tile.y, 1).find(person => person !== except && person.alive
    && person.restingStructureId == null
    && hitboxesOverlap(destinationHitbox, npcHitbox(person))) || null;
}

function personById(w, id) {
  if (w.peopleById instanceof Map) {
    const person = w.peopleById.get(id);
    return person?.alive ? person : undefined;
  }
  return (w.people || []).find(person => person.id === id && person.alive);
}

function ledSheepFor(w, person) {
  return person.leadingSheepId == null ? null : w.animals.find(animal => animal.id === person.leadingSheepId
    && animal.alive && animal.beingLedBy === person.id) || null;
}

function syncLedSheepPosition(w, person) {
  const sheep = ledSheepFor(w, person);
  if (!sheep) return;
  // A passage handoff is part of the handler's actual step, so keep the pair
  // together before another traveler attempts to occupy the just-cleared tile.
  sheep.x = person.x + .25;
  sheep.y = person.y + .15;
}

function canYieldPassage(w, person, requester) {
  if (person.role === 'soldier') {
    const healthyAndReady = person.alive && !person.towerMounted
      && w.day - (person.lastMilitaryAttackDay ?? -Infinity) > 1
      && person.health >= 28 && person.energy >= 12;
    const sameCampaign = person.kingdomId === requester.kingdomId && person.campaignId != null
      && person.campaignId === requester.campaignId;
    // Local shepherds may pass a healthy guard on friendly ground; active
    // combat, tower duty and recently attacked soldiers remain in position.
    const friendlyShepherdPass = ledSheepFor(w, requester) && person.kingdomId != null
      && person.kingdomId === requester.kingdomId
      && cellAt(w, Math.round(person.x), Math.round(person.y))?.kingdomId === person.kingdomId;
    return healthyAndReady && (sameCampaign || friendlyShepherdPass);
  }
  const ledSheep = ledSheepFor(w, person);
  const assignment = person.assignment;
  const activeAssignment = assignment && (assignment.expiresDay == null || assignment.expiresDay >= w.day) && !assignment.pauseReason;
  const shepherdCanYield = ledSheep && person.brain?.lastAction === 'lead_sheep';
  return person.alive && person.role !== 'soldier'
    && (!activeAssignment || shepherdCanYield)
    && (!PASSAGE_BUSY_ACTIONS.has(person.brain?.lastAction) || shepherdCanYield)
    && !(Number.isFinite(person.health) && person.health < 30)
    && !(Number.isFinite(person.energy) && person.energy < 12);
}

function respondToPassageRequest(w, person) {
  const request = person.passageRequest;
  if (!request) return false;
  person.passageRequest = null;
  if (request.expiresDay < w.day) return false;
  const requester = personById(w, request.requesterId);
  if (!requester || Math.hypot(requester.x - request.x, requester.y - request.y) > 2) return false;
  const passageChain = request.passageChain instanceof Set ? request.passageChain : new Set();
  if (passageChain.has(person.id) || passageChain.size >= MAX_PASSAGE_HANDOFF_DEPTH) {
    requester.passageResponse = { personId: person.id, accepted: false, day: w.day };
    return false;
  }
  if (!canYieldPassage(w, person, requester)) {
    requester.passageResponse = { personId: person.id, accepted: false, day: w.day };
    return false;
  }

  const from = { x: Math.round(person.x), y: Math.round(person.y) };
  const corrals = activeCorrals(w);
  const movementOptions = { collisionIndex: worldCollisionIndex(w) };
  const candidates = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const tile = cellAt(w, from.x + dx, from.y + dy);
    if (!tile || personOnTile(w, tile, person) || !canStep(w, person, from, tile, false, null, corrals, movementOptions)) continue;
    const approachX = from.x - Math.round(requester.x), approachY = from.y - Math.round(requester.y);
    const lateral = Math.abs(dx * approachX + dy * approachY);
    candidates.push({ tile, lateral });
  }
  candidates.sort((a, b) => a.lateral - b.lateral
    || Math.hypot(b.tile.x - requester.x, b.tile.y - requester.y) - Math.hypot(a.tile.x - requester.x, a.tile.y - requester.y)
    || a.tile.y - b.tile.y || a.tile.x - b.tile.x);
  passageChain.add(person.id);
  try {
    for (const { tile } of candidates) {
      if (moveOne(w, person, tile, false, { passageYield: true, passageChain })) {
        requester.passageResponse = { personId: person.id, accepted: true, day: w.day };
        return true;
      }
    }
  } finally {
    passageChain.delete(person.id);
  }
  requester.passageResponse = { personId: person.id, accepted: false, day: w.day };
  return false;
}

function findRouteStep(w, agent, destination, aquatic, pen, corrals, startOverride = null, movementOptions = null, avoidFirstStepIndex = -1) {
  const start = startOverride || cellAt(w, Math.round(agent.x), Math.round(agent.y));
  if (!start) return null;
  const count = w.tiles.length, startIndex = start.y * w.width + start.x;
  const previous = new Int32Array(count); previous.fill(-2);
  const queue = new Int32Array(count); let head = 0, tail = 0;
  previous[startIndex] = -1; queue[tail++] = startIndex;
  const goalTile = cellAt(w, Math.round(destination.x), Math.round(destination.y));
  const arrivalRadius = movementOptions?.arrivalRadius || 1.5;
  const goalIsEnterable = !movementOptions?.arrivalRadius && goalTile && canEnter(w, agent, goalTile, aquatic, pen, corrals, movementOptions);
  const offsets = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]];
  let goalIndex = -1;
  while (head < tail) {
    const index = queue[head++], tile = w.tiles[index];
    if (goalIsEnterable ? index === goalTile.i : distance(tile, destination) <= arrivalRadius && canEnter(w, agent, tile, aquatic, pen, corrals, movementOptions)) {
      goalIndex = index; break;
    }
    for (const [dx, dy] of offsets) {
      const next = cellAt(w, tile.x + dx, tile.y + dy);
      if (index === startIndex && next?.i === avoidFirstStepIndex) continue;
      if (!next || previous[next.i] !== -2 || !canStep(w, agent, tile, next, aquatic, pen, corrals, movementOptions)) continue;
      previous[next.i] = index; queue[tail++] = next.i;
    }
  }
  if (goalIndex < 0 || goalIndex === startIndex) return null;
  let stepIndex = goalIndex;
  while (previous[stepIndex] !== startIndex && previous[stepIndex] >= 0) stepIndex = previous[stepIndex];
  return w.tiles[stepIndex];
}

function navigationContext(w, agent, corrals, collisionKey = '') {
  const unrestricted = agent.role === 'soldier' && (agent.campaignId != null || agent.militaryReturningHome)
    || agent.foodReserve <= 8 || agent.hydration <= 9;
  const forbidden = unrestricted ? [] : Object.entries(agent.territoryWarnings || {})
    .filter(([owner, until]) => Number(owner) !== agent.kingdomId && Number.isFinite(until) && until >= w.day)
    .map(([owner]) => Number(owner)).sort((a, b) => a - b);
  const fences = corrals.map(({ structure, radius, gate }) =>
    [structure.id, structure.x, structure.y, radius, gate.x, gate.y].join(':')).join(';');
  return forbidden.join(',') + '|' + fences + '|structures:' + collisionKey;
}

function localCongestionStep(w, agent, start, canStepFree) {
  const route = agent.navigationRoute;
  if (!route || !start) return null;
  let cursor = route.cursor ?? -1;
  if (route.path[cursor] !== start.i) cursor = route.path.indexOf(start.i);
  if (cursor < 0) return null;
  const goals = new Map();
  for (let i = cursor + 1; i < Math.min(route.path.length, cursor + 9); i++) goals.set(route.path[i], i);
  const queue = [{ tile: start, previous: -1, depth: 0 }], seen = new Set([start.i]);
  // At most 81 cells, regardless of map size. Rejoin the planned corridor
  // rather than launch another map-wide search for a temporary occupant.
  for (let head = 0; head < queue.length; head++) {
    const entry = queue[head];
    const rejoin = goals.get(entry.tile.i);
    if (rejoin !== undefined) {
      const path = [];
      for (let position = head; position >= 0; position = queue[position].previous) path.push(queue[position].tile.i);
      path.reverse();
      agent.navigationRoute = { ...route, path: path.concat(route.path.slice(rejoin + 1)), cursor: 0, completed: false };
      agent.navigationLocalDetours = (agent.navigationLocalDetours || 0) + 1;
      return w.tiles[path[1]];
    }
    if (entry.depth >= 6) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const x = entry.tile.x + dx, y = entry.tile.y + dy;
      if (Math.abs(x - start.x) > 4 || Math.abs(y - start.y) > 4) continue;
      const next = cellAt(w, x, y);
      if (!next || seen.has(next.i) || !canStepFree(entry.tile, next)) continue;
      seen.add(next.i);
      queue.push({ tile: next, previous: head, depth: entry.depth + 1 });
    }
  }
  return null;
}

function persistentCongestionStep(w, agent, start, destination, canEnterFree, canStepFree, movementOptions) {
  const key = agent.navigationRoute?.key, day = w.day || 0;
  let congestion = agent.navigationCongestion;
  if (!congestion || congestion.key !== key || congestion.startIndex !== start.i) {
    congestion = { key, startIndex: start.i, blockedDays: 0, lastBlockedDay: null, nextSearchDay: day + 3 };
    agent.navigationCongestion = congestion;
  }
  if (congestion.lastBlockedDay !== day) { congestion.blockedDays++; congestion.lastBlockedDay = day; }
  if (congestion.blockedDays < 3 || day < congestion.nextSearchDay) return null;
  congestion.nextSearchDay = day + 4 + Math.abs(agent.id || 0) % 2;
  return congestionRouteStep(w, agent, start, destination, canEnterFree, canStepFree,
    !!movementOptions?.preferRoads, movementOptions?.arrivalRadius || 0);
}

export function moveOne(w, agent, target, aquatic, movementOptions = null) {
    if (isCombatStunned(agent, w.day, w.magicTimeMs || 0)) return false;
    if (agent.playerControlled) return false;
    if (agent.magicCast) return false;
    if (!target) return false;
    if (agent.speciesId == null && !movementOptions?.passageYield && !movementOptions?.magicExtraStep) {
      const speed = agent.magicEffects?.length ? magicModifiers(agent, w).speed : 1;
      agent.magicStrideCredit = Math.min(2, (agent.magicStrideCredit || 0) + speed);
      if (agent.magicStrideCredit < 1) return false;
      agent.magicStrideCredit -= 1;
    }
    movementOptions = { ...(movementOptions || {}), collisionIndex: worldCollisionIndex(w) };
    if (!movementOptions?.passageYield) respondToPassageRequest(w, agent);
    const currentTile = cellAt(w, Math.round(agent.x), Math.round(agent.y));
    if (Number.isFinite(agent.kingdomId) && currentTile && (currentTile.kingdomId == null || currentTile.kingdomId === agent.kingdomId)
        && !Number.isFinite(agent.lastSafeX)) {
      agent.lastSafeX = currentTile.x; agent.lastSafeY = currentTile.y;
    }
    const corrals = activeCorrals(w);
    const destination = corralWaypoint(agent, target, corrals);
    const current = { x: Math.round(agent.x), y: Math.round(agent.y) };
    const pen = agent.speciesId === 'sheep' && agent.herdCommunityId !== null
      ? assignedHerdPen(w, agent) : null;
    const returningToPen = pen
      && !insideCorral(agent.x, agent.y, pen, corralFenceRadius(pen))
      && insideCorral(target.x, target.y, pen, corralFenceRadius(pen));
    if (returningToPen) movementOptions.allowPenReturn = true;
    function stepToward(from, avoidPeople = true) {
      const canEnterAgent = tile => canEnter(w, agent, tile, aquatic, pen, corrals, movementOptions)
        && (!avoidPeople || aquatic || agent.speciesId != null || !personOnTile(w, tile, agent));
      const canStepAgent = (fromTile, toTile) => canStep(w, agent, fromTile, toTile, aquatic, pen, corrals, movementOptions)
        && (!avoidPeople || aquatic || agent.speciesId != null || !personOnTile(w, toTile, agent));
      if (!aquatic && agent.speciesId == null) {
        const remembered = rememberedRouteStep(w, agent, from, destination,
          canEnterAgent, canStepAgent, !!movementOptions?.preferRoads, movementOptions?.arrivalRadius || 0,
          { cacheable: !movementOptions?.allowedTile,
            contextKey: navigationContext(w, agent, corrals, movementOptions?.collisionIndex?.signature) });
        return remembered;
      }
      const choices = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const tile = cellAt(w, from.x + dx, from.y + dy);
        if (!canStepAgent(from, tile)) continue;
        choices.push(tile);
      }
      const roadBias = agent.speciesId == null ? (movementOptions?.preferRoads ? 1.2 : .42) : 0;
      choices.sort((a, b) => {
        const scoreA = distance(a, destination) + a.slope * .08 - (isRoadTile(a) ? roadBias : 0);
        const scoreB = distance(b, destination) + b.slope * .08 - (isRoadTile(b) ? roadBias : 0);
        return scoreA - scoreB;
      });
      const avoidX = agent.lastStepFromX, avoidY = agent.lastStepFromY;
      const destinationIsPrevious = Number.isFinite(avoidX) && Number.isFinite(avoidY)
        && distance({ x: avoidX, y: avoidY }, destination) <= 1.5;
      const shouldAvoidPrevious = Number.isFinite(avoidX) && Number.isFinite(avoidY) && !destinationIsPrevious;
      const next = choices.find(tile => !(shouldAvoidPrevious && tile.x === avoidX && tile.y === avoidY)
        && distance(tile, destination) < distance(from, destination) - .001);
      if (next) return next;
      const avoidIndex = shouldAvoidPrevious ? avoidY * w.width + avoidX : -1;
      return findRouteStep(w, agent, destination, aquatic, pen, corrals, from,
        { ...movementOptions, allowedTile: tile => canEnterAgent(tile) }, avoidIndex)
        || (avoidIndex >= 0 ? findRouteStep(w, agent, destination, aquatic, pen, corrals, from,
          { ...movementOptions, allowedTile: tile => canEnterAgent(tile) }) : null);
    }
    let first;
    if (!aquatic && agent.speciesId == null) {
      const preferred = stepToward(current, false);
      const blocker = personOnTile(w, preferred, agent);
      if (blocker) {
        const passageChain = movementOptions.passageChain instanceof Set ? movementOptions.passageChain : new Set();
        if (!passageChain.has(blocker.id) && passageChain.size < MAX_PASSAGE_HANDOFF_DEPTH) {
          const ownsChainEntry = !passageChain.has(agent.id);
          if (ownsChainEntry) passageChain.add(agent.id);
          blocker.passageRequest = { requesterId: agent.id, x: preferred.x, y: preferred.y,
            expiresDay: w.day + 1, passageChain };
          agent.passageRequestSent = { personId: blocker.id, x: preferred.x, y: preferred.y, day: w.day };
          try {
            respondToPassageRequest(w, blocker);
          } finally {
            if (ownsChainEntry) passageChain.delete(agent.id);
          }
        }
        const canEnterFree = tile => canEnter(w, agent, tile, aquatic, pen, corrals, movementOptions) && !personOnTile(w, tile, agent);
        const canStepFree = (from, to) => canStep(w, agent, from, to, aquatic, pen, corrals, movementOptions) && !personOnTile(w, to, agent);
        first = !personOnTile(w, preferred, agent) ? preferred : localCongestionStep(w, agent,
          currentTile, canStepFree) || persistentCongestionStep(w, agent, currentTile, destination, canEnterFree, canStepFree, movementOptions);
        if (first) delete agent.navigationCongestion;
      } else {
        first = preferred;
        delete agent.navigationCongestion;
      }
    } else {
      first = stepToward(current, true);
    }
    let route = first ? [first] : [];
    if (route.length && agent.speciesId == null && isRoadTile(currentTile, true) && isRoadTile(first, true)) {
      // Consolidated paths grant one extra step for every ten ordinary road steps.
      agent.roadStrideProgress = Math.min(10, (agent.roadStrideProgress || 0) + 1);
      if (agent.roadStrideProgress >= 10) {
        const planned = agent.navigationRoute?.path;
        const cursor = agent.navigationRoute?.cursor ?? -1;
        const firstPosition = planned?.[cursor + 1] === first.i ? cursor + 1 : planned?.indexOf(first.i);
        const plannedSecondIndex = planned?.[firstPosition + 1];
        const second = Number.isInteger(plannedSecondIndex) ? w.tiles[plannedSecondIndex]
          : planned ? null : cellAt(w, first.x + first.x - current.x, first.y + first.y - current.y);
        if (isRoadTile(second, true) && canStep(w, agent, first, second, aquatic, pen, corrals, movementOptions)
            && (aquatic || agent.speciesId != null || !personOnTile(w, second, agent))
            && distance(second, destination) < distance(first, destination) - .001) {
          route.push(second);
          agent.roadStrideProgress = 0;
        } else agent.roadStrideProgress = 9;
      }
    } else if (route.length && agent.speciesId == null) {
      agent.roadStrideProgress = 0;
    }
    if (!route.length) {
      if (agent.speciesId == null) agent.roadStrideProgress = 0;
      return false;
    }
    for (const next of route) {
      let boundaryCost = 0;
      if (agent.communityId !== undefined && agent.communityId !== null) {
        for (const fence of w.structures) {
          if (!fence.complete || fence.type !== 'divisa' || fence.communityId === agent.communityId) continue;
          const radius = fence.radius || 4;
          const before = distance(agent, fence) < radius, after = distance(next, fence) < radius;
          if (before !== after) boundaryCost += .58;
        }
      }
      const carryingCost = carriedResources(agent) > .01 ? Math.min(1.2, carriedResources(agent) / 24) * .14 : 0;
      const foreignBorderCost = agent.kingdomId != null && next.kingdomId != null && next.kingdomId !== agent.kingdomId ? .85 : 0;
      const onRoad = isRoadTile(cellAt(w, Math.round(agent.x), Math.round(agent.y)), true) && isRoadTile(next, true);
      const travelCost = (.18 + next.slope * .12 + boundaryCost + carryingCost + foreignBorderCost) * (onRoad ? .78 : 1);
      const actualTravelCost = consumePersonEnergy(agent, travelCost);
      agent.travelCost = (agent.travelCost || 0) + actualTravelCost;
      agent.lastStepFromX = Math.round(agent.x); agent.lastStepFromY = Math.round(agent.y);
      agent.headingX = next.x - agent.x; agent.headingY = next.y - agent.y;
      agent.x = next.x; agent.y = next.y;
      w.peopleSpatialIndex?.move(agent);
      if (agent.speciesId == null && agent.leadingSheepId != null) syncLedSheepPosition(w, agent);
      markTerritoryStep(w, agent, next);
      recordFootstep(next, agent, w.day);
    }
    rememberRouteArrival(agent, route.at(-1).i);
    if (agent.speciesId == null && !movementOptions.magicExtraStep && agent.magicStrideCredit >= 1) {
      agent.magicStrideCredit -= 1;
      moveOne(w, agent, target, aquatic, { ...movementOptions, magicExtraStep: true });
    }
    return true;
  }
