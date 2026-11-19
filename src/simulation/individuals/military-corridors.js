// Unit-level, physically enforced corridor admission. A lock does not move
// people: the existing A*, canStep, hitboxes and passage handoff remain
// authoritative. State belongs to the world so deterministic replay/reset
// never depends on hidden module-global traffic history.
import { militaryPassageYieldDecision } from './military-passage.js';

const MAX_CORRIDOR_CELLS = 40;
const MAX_PARTICIPANT_DISTANCE = 28;
const WAIT_TTL_DAYS = 2;
const IDLE_RECOVERY_DAYS = 6;
// A live rear guard can need many daily turns to move 9 soldiers through a
// narrow gate. Short idle leases rotated ownership before all ranks crossed.
const ACTIVE_REAR_GUARD_STALE_DAYS = 48;
const OFFSETS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

const sameUnit = (a, b) => String(a) === String(b);
const cellIndex = (world, point) => Math.round(point.y) * world.width + Math.round(point.x);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const validUnit = person => person?.alive && person.role === 'soldier'
  && person.campaignId != null && person.kingdomId != null
  && person.militaryUnitId != null && person.tacticalRole && !person.playerControlled;

function actorById(world, id) {
  return world.peopleById instanceof Map
    ? world.peopleById.get(id)
    : (world.people || []).find(person => person.id === id);
}

function isNarrowTile(world, tile, canStep) {
  if (tile?.terrain !== 'land') return false;
  let exits = 0;
  for (const [dx, dy] of OFFSETS) {
    const x = tile.x + dx, y = tile.y + dy;
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) continue;
    if (canStep(tile, world.tiles[y * world.width + x])) exits++;
    if (exits > 2) return false;
  }
  return exits === 2;
}

function narrowRegion(world, tile, canStep) {
  if (!isNarrowTile(world, tile, canStep)) return null;
  const queue = [tile], members = new Set([tile.i]);
  let lowest = tile.i;
  for (let head = 0; head < queue.length; head++) {
    const from = queue[head];
    for (const [dx, dy] of OFFSETS) {
      const x = from.x + dx, y = from.y + dy;
      if (x < 0 || y < 0 || x >= world.width || y >= world.height) continue;
      const next = world.tiles[y * world.width + x];
      if (members.has(next.i) || !canStep(from, next)
          || !isNarrowTile(world, next, canStep)) continue;
      // A too-long or branched passage is deliberately left to the existing
      // movement system instead of silently claiming an incomplete segment.
      if (queue.length === MAX_CORRIDOR_CELLS) return null;
      queue.push(next); members.add(next.i); lowest = Math.min(lowest, next.i);
    }
  }
  return { key: lowest, cells: members, tiles: queue };
}

function nearestActors(world, region) {
  const left = Math.min(...region.tiles.map(t => t.x));
  const right = Math.max(...region.tiles.map(t => t.x));
  const top = Math.min(...region.tiles.map(t => t.y));
  const bottom = Math.max(...region.tiles.map(t => t.y));
  const x = (left + right) / 2, y = (top + bottom) / 2;
  const radius = Math.hypot(right - left, bottom - top) / 2 + 2;
  return world.peopleSpatialIndex?.query?.(x, y, radius) || world.people || [];
}

function traffic(world) {
  if (!world.militaryCorridorTraffic) {
    world.militaryCorridorTraffic = { corridors: {}, blocked: 0, releases: 0, recoveries: 0 };
  }
  return world.militaryCorridorTraffic;
}

function activeOccupants(world, region, person) {
  return nearestActors(world, region).filter(candidate =>
    validUnit(candidate) && candidate.kingdomId === person.kingdomId
    && candidate.campaignId === person.campaignId
    && region.cells.has(cellIndex(world, candidate)));
}

function participants(world, owner, source, region, direction) {
  const furthest = Math.max(...region.tiles.map(tile =>
    (tile.x - source.x) * direction.x + (tile.y - source.y) * direction.y));
  const members = (world.people || []).filter(person =>
    validUnit(person) && person.kingdomId === owner.kingdomId
    && person.campaignId === owner.campaignId
    && sameUnit(person.militaryUnitId, owner.militaryUnitId)
    && distance(person, source) <= MAX_PARTICIPANT_DISTANCE
    && ((person.x - source.x) * direction.x + (person.y - source.y) * direction.y)
      <= furthest + 0.5);
  if (!members.some(person => person.id === owner.id)) members.push(owner);
  return members.map(person => person.id).sort((a, b) => String(a).localeCompare(String(b), 'en'));
}

function corridorExit(world, source, region, direction, canStep) {
  if (!direction) return null;
  const along = tile => (tile.x - source.x) * direction.x
    + (tile.y - source.y) * direction.y;
  const frontier = [];
  for (const tile of region.tiles) for (const [dx, dy] of OFFSETS) {
    const x = tile.x + dx, y = tile.y + dy;
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) continue;
    const outside = world.tiles[y * world.width + x];
    if (region.cells.has(outside.i) || !canStep(tile, outside)) continue;
    const progress = along(outside);
    if (progress <= along(tile)) continue;
    frontier.push({ outside, progress });
  }
  frontier.sort((a, b) => b.progress - a.progress
    || a.outside.i - b.outside.i);
  return frontier.length ? { x: frontier[0].outside.x,
    y: frontier[0].outside.y } : null;
}

function newClaim(world, key, owner, source, region, direction, waiting = [], canStep = () => false) {
  return {
    key, ownerUnitId: owner.militaryUnitId, kingdomId: owner.kingdomId,
    campaignId: owner.campaignId, enteredDay: world.day || 0,
    lastProgressDay: world.day || 0,
    direction, source: { x: source.x, y: source.y },
    exit: corridorExit(world, source, region, direction, canStep),
    maxProgress: direction ? Math.max(...region.tiles.map(tile =>
      (tile.x - source.x) * direction.x + (tile.y - source.y) * direction.y)) : null,
    members: participants(world, owner, source, region, direction || { x: 0, y: 0 }),
    completed: [], waiting
  };
}

function hasOwnerInside(world, region, claim) {
  return nearestActors(world, region).some(person =>
    person.alive && person.kingdomId === claim.kingdomId
    && person.campaignId === claim.campaignId
    && sameUnit(person.militaryUnitId, claim.ownerUnitId)
    && region.cells.has(cellIndex(world, person)));
}

function memberStillExpected(world, claim, id) {
  const person = actorById(world, id);
  return validUnit(person) && person.campaignId === claim.campaignId
    && person.kingdomId === claim.kingdomId
    && sameUnit(person.militaryUnitId, claim.ownerUnitId);
}

function resolved(world, region, claim) {
  if (hasOwnerInside(world, region, claim)) return false;
  return claim.members.every(id => claim.completed.includes(id) || !memberStillExpected(world, claim, id));
}

function queueRepresentative(world, record, key, region, day) {
  const person = actorById(world, record.personId);
  if (!validUnit(person) || person.kingdomId !== record.kingdomId
      || person.campaignId !== record.campaignId
      || !sameUnit(person.militaryUnitId, record.unitId)
      || day - record.day > WAIT_TTL_DAYS
      || !region.tiles.some(tile => distance(tile, person) <= 4)) return null;
  return person;
}

function queuedWinner(world, region, records, applicant, day) {
  let winner = applicant;
  for (const record of records) {
    const contender = queueRepresentative(world, record, region.key, region, day);
    if (!contender || sameUnit(contender.militaryUnitId, winner.militaryUnitId)) continue;
    if (militaryPassageYieldDecision(winner, contender) === true)
      winner = contender;
    else if (militaryPassageYieldDecision(contender, winner) !== true
        && String(contender.militaryUnitId) < String(winner.militaryUnitId))
      winner = contender;
  }
  return winner;
}

function waitingRecord(agent, day) {
  return { personId: agent.id, unitId: agent.militaryUnitId,
    kingdomId: agent.kingdomId, campaignId: agent.campaignId, day };
}

function markWait(world, actor, corridorKey, owner) {
  const day = world.day || 0;
  const state = traffic(world);
  state.blocked++;
  if (actor.militaryCorridorWait?.day !== day)
    actor.militaryCorridorWaitDays = (actor.militaryCorridorWaitDays || 0) + 1;
  actor.militaryCorridorWait = { day, corridorKey, ownerUnitId: owner };
}

function cleanup(world, region, key) {
  const state = traffic(world);
  let claim = state.corridors[key];
  if (!claim) return null;
  const day = world.day || 0;
  if (claim.empty) {
    claim.waiting = (claim.waiting || []).filter(item =>
      queueRepresentative(world, item, key, region, day));
    return claim;
  }
  if (resolved(world, region, claim)) {
    state.releases++;
    // Keep the wait queue for deterministic priority when the next unit
    // approaches. A new claim does not inherit the previous owner's members.
    state.corridors[key] = { waiting: claim.waiting, empty: true };
    return state.corridors[key];
  }
  // A physically present rear guard is not an abandoned claim just because
  // the bridge happens to be empty for six days. Never declare its crossing
  // complete on time alone: stalled live columns keep the lock until the
  // longer safety timeout, while a commander who actually turned back may
  // relinquish it after the ordinary abandoned-order grace period.
  const recoveryAfter = claim.abandoned
    ? IDLE_RECOVERY_DAYS : ACTIVE_REAR_GUARD_STALE_DAYS;
  if (!hasOwnerInside(world, region, claim)
      && day - claim.lastProgressDay >= recoveryAfter) {
    state.recoveries++;
    state.corridors[key] = { waiting: claim.waiting, empty: true };
    return state.corridors[key];
  }
  return claim;
}

// Ask for admission BEFORE requesting an occupant to yield. Refusals
// preserve physical position and let a squad wait in its approach lane.
export function admitMilitaryCorridorStep(world, actor, from, to, canStep) {
  if (!validUnit(actor) || !from || !to) return true;
  const region = narrowRegion(world, to, canStep)
    || narrowRegion(world, from, canStep);
  if (!region || !region.cells.has(cellIndex(world, to))) return true;

  const key = actor.kingdomId + ':' + actor.campaignId + ':' + region.key;
  const state = traffic(world), day = world.day || 0;
  let claim = cleanup(world, region, key);
  if (claim && !claim.empty && sameUnit(claim.ownerUnitId, actor.militaryUnitId)) {
    delete actor.militaryCorridorWait;
    return true;
  }
  const waiting = claim?.waiting || [];
  if (claim && !claim.empty) {
    const existing = waiting.find(item => sameUnit(item.unitId, actor.militaryUnitId));
    if (existing) existing.day = day;
    else waiting.push(waitingRecord(actor, day));
    markWait(world, actor, region.key, claim.ownerUnitId);
    return false;
  }

  const occupants = activeOccupants(world, region, actor);
  let incumbent = null;
  for (const person of occupants) {
    if (!incumbent || militaryPassageYieldDecision(incumbent, person) === true)
      incumbent = person;
  }
  // A soldier already inside must be allowed to clear the entire segment
  // before a new unit begins entering from the opposite bank.
  const candidate = incumbent || queuedWinner(world, region, waiting, actor, day);
  if (!sameUnit(candidate.militaryUnitId, actor.militaryUnitId)) {
    if (!waiting.some(item => sameUnit(item.unitId, actor.militaryUnitId)))
      waiting.push(waitingRecord(actor, day));
    markWait(world, actor, region.key, candidate.militaryUnitId);
    state.corridors[key] = { empty: true, waiting };
    // If an incumbent was found, reserve the corridor for them immediately.
    if (incumbent) state.corridors[key] = newClaim(world, key, incumbent,
      from, region, null, waiting, canStep);
    return false;
  }
  const nextWaiting = waiting.filter(item => !sameUnit(item.unitId, actor.militaryUnitId)
    && queueRepresentative(world, item, key, region, day));
  state.corridors[key] = newClaim(world, key, actor,
    from, region, { x: to.x - from.x, y: to.y - from.y },
    nextWaiting, canStep);
  delete actor.militaryCorridorWait;
  return true;
}

// Called only AFTER the authoritative move completed; no optimistic
// completion or release on an attempted/blocked step.
export function recordMilitaryCorridorStep(world, actor, from, to, canStep) {
  if (!validUnit(actor) || !from || !to) return;
  const region = narrowRegion(world, from, canStep)
    || narrowRegion(world, to, canStep);
  if (!region) return;
  const key = actor.kingdomId + ':' + actor.campaignId + ':' + region.key;
  const claim = traffic(world).corridors[key];
  if (!claim || claim.empty || !sameUnit(claim.ownerUnitId, actor.militaryUnitId)) return;
  const fromInside = region.cells.has(cellIndex(world, from));
  const toInside = region.cells.has(cellIndex(world, to));
  if (!fromInside && !toInside) return;
  claim.lastProgressDay = world.day || 0;
  if (toInside) claim.abandoned = false;
  if (!claim.members.includes(actor.id)) claim.members.push(actor.id);
  if (fromInside && !toInside) {
    const progress = claim.direction
      ? (to.x - claim.source.x) * claim.direction.x
        + (to.y - claim.source.y) * claim.direction.y : null;
    // The commander must physically retreat across his original entry to
    // cancel a crossing. Remaining members may still occupy the passage,
    // in which case cleanup will not release the reservation.
    if (claim.direction && actor.id === actor.commanderId
        && progress <= 0.25) claim.abandoned = true;
    // If the corridor was occupied before a lease existed, its entry
    // direction is unknown: only physical evacuation can release it.
    if ((progress == null || progress > claim.maxProgress + 0.25)
        && !claim.completed.includes(actor.id)) claim.completed.push(actor.id);
  }
  cleanup(world, region, key);
}


/**
 * Rear-guard route: follow the actual narrow passage to its exit rather
 * than chasing a captain who may already be flanking far across the field.
 * Once a soldier physically leaves the segment, normal formation slots
 * and their existing movement/collision rules take over.
 */
export function militaryCorridorRearGuardTarget(world, soldier) {
  if (!validUnit(soldier)) return null;
  for (const claim of Object.values(world.militaryCorridorTraffic?.corridors || {})) {
    if (!claim || claim.empty || !claim.exit
        || claim.kingdomId !== soldier.kingdomId
        || claim.campaignId !== soldier.campaignId
        || !sameUnit(claim.ownerUnitId, soldier.militaryUnitId)
        || !claim.members.includes(soldier.id)
        || claim.completed.includes(soldier.id)) continue;
    if (distance(soldier, claim.source) > MAX_PARTICIPANT_DISTANCE + 5) continue;
    const target = world.tiles[claim.exit.y * world.width + claim.exit.x];
    if (target?.terrain !== 'land') continue;
    // The regular movement caller may use an arrival radius greater than
    // one tile. A waypoint ON the exit made soldiers stop on the final bridge
    // cell forever, preventing both completion and the next rank's passage.
    // Assign distinct, deeper far-bank assembly slots instead. They remain
    // normal A* destinations, subject to all physical movement guards.
    const deltaX = claim.exit.x - claim.source.x;
    const deltaY = claim.exit.y - claim.source.y;
    const forward = Math.abs(deltaX) >= Math.abs(deltaY)
      ? { x: Math.sign(deltaX), y: 0 }
      : { x: 0, y: Math.sign(deltaY) };
    const lateral = { x: -forward.y, y: forward.x };
    const index = Math.max(0, claim.members.indexOf(soldier.id));
    const depth = 3 + Math.floor(index / 3) * 2;
    const side = (index % 3 - 1) * 2;
    const point = { x: claim.exit.x + forward.x * depth + lateral.x * side,
      y: claim.exit.y + forward.y * depth + lateral.y * side };
    const staging = point.x >= 0 && point.y >= 0
      && point.x < world.width && point.y < world.height
      ? world.tiles[point.y * world.width + point.x] : null;
    if (staging?.terrain === 'land') return point;
    // If staging is unavailable, fall back to the legal exit instead of
    // constructing a target inside obstacles. Arrival-radius callers must
    // separately make sure they cross the final corridor tile.
    return { x: claim.exit.x, y: claim.exit.y };
  }
  return null;
}

/**
 * A squad with the current corridor lease may negotiate an occupied entrance
 * even if a waiting squad has a nominally higher battlefield role. Never
 * displace a manually controlled soldier, a reserve holding its ground, or
 * an infantryman in combat/contact. Existing physical canStep still decides
 * whether an actual lateral yield is legal.
 */
export function militaryCorridorYieldDecision(world, blocker, requester) {
  if (!validUnit(requester) || !validUnit(blocker)
      || blocker.kingdomId !== requester.kingdomId
      || blocker.campaignId !== requester.campaignId
      || sameUnit(blocker.militaryUnitId, requester.militaryUnitId)) return null;
  for (const claim of Object.values(world.militaryCorridorTraffic?.corridors || {})) {
    if (!claim || claim.empty || claim.kingdomId !== requester.kingdomId
        || claim.campaignId !== requester.campaignId
        || distance(blocker, claim.source) > 4) continue;
    if (sameUnit(claim.ownerUnitId, blocker.militaryUnitId)) return false;
    if (!sameUnit(claim.ownerUnitId, requester.militaryUnitId)) continue;
    if (blocker.tacticalReserveHolding
        || ['holding', 'contact'].includes(blocker.tacticalPhase)) return false;
    return true;
  }
  return null;
}
