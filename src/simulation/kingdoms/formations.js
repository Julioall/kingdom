import { clamp } from '../core/math.js';

const FORMATION_TYPES = new Set(['line', 'column']);
const FORMATION_STATES = new Set(['forming', 'marching', 'maintaining', 'attacking', 'retreating']);

function unitVector(from, to) {
  const dx = (to?.x || 0) - (from?.x || 0), dy = (to?.y || 0) - (from?.y || 0);
  const length = Math.hypot(dx, dy) || 1;
  return { x: dx / length, y: dy / length };
}

export function createFormation({ campaignId, kingdomId, role, memberIds, origin, destination, day }) {
  const forward = unitVector(origin, destination);
  return {
    id: 'formation:' + campaignId + ':' + kingdomId,
    campaignId, kingdomId, role,
    type: 'column', state: 'forming', spacing: 2,
    leaderId: memberIds[0] ?? null,
    orientation: { x: forward.x, y: forward.y },
    origin: { x: origin.x, y: origin.y },
    destination: { x: destination.x, y: destination.y },
    memberIds: memberIds.slice(), orderVersion: 0,
    transitions: [{ day, from: null, to: 'forming', reason: 'mobilização da formação' }],
    metrics: { day, cohesion: 1, meanSlotError: 0, outsideSlots: 0, blockedMoves: 0 }
  };
}

export function setFormationState(formation, state, day, reason) {
  if (!formation || !FORMATION_STATES.has(state) || formation.state === state) return false;
  const previous = formation.state;
  formation.state = state;
  formation.orderVersion = (formation.orderVersion || 0) + 1;
  formation.transitions ||= [];
  formation.transitions.push({ day, from: previous, to: state, reason: String(reason || '').slice(0, 120) });
  if (formation.transitions.length > 20) formation.transitions.shift();
  return true;
}

export function setFormationType(formation, type, day, reason) {
  if (!formation || !FORMATION_TYPES.has(type) || formation.type === type) return false;
  const previous = formation.type;
  formation.type = type;
  formation.orderVersion = (formation.orderVersion || 0) + 1;
  formation.transitions ||= [];
  formation.transitions.push({ day, from: previous, to: type, reason: String(reason || 'terreno observado').slice(0, 120) });
  if (formation.transitions.length > 20) formation.transitions.shift();
  return true;
}

export function setFormationDestination(formation, destination) {
  if (!formation || !destination || !Number.isFinite(destination.x) || !Number.isFinite(destination.y)) return false;
  const changed = formation.destination?.x !== destination.x || formation.destination?.y !== destination.y;
  if (!changed) return false;
  const previousDestination = formation.destination || formation.origin || destination;
  formation.destination = { x: destination.x, y: destination.y };
  const forward = unitVector(previousDestination, destination);
  formation.orientation = { x: forward.x, y: forward.y };
  return true;
}

export function formationSlot(formation, memberId, destination = formation?.destination) {
  if (!formation || !destination) return null;
  const members = Array.isArray(formation.memberIds) ? formation.memberIds : [];
  let index = members.indexOf(memberId);
  if (index < 0) index = 0;
  const count = Math.max(1, members.length);
  const spacing = Number.isFinite(formation.spacing) ? formation.spacing : 1;
  const forward = formation.orientation || { x: 1, y: 0 };
  const lateral = { x: -forward.y, y: forward.x };
  if (count <= 7) {
    if (formation.type === 'line') {
      const offset = (index - (count - 1) / 2) * spacing;
      return { x: destination.x + lateral.x * offset, y: destination.y + lateral.y * offset };
    }
    return { x: destination.x - forward.x * index * spacing, y: destination.y - forward.y * index * spacing };
  }
  if (formation.type === 'line') {
    const offset = (index % 7 - Math.min(6, count - 1) / 2) * spacing;
    const depth = Math.floor(index / 7) * spacing;
    return { x: destination.x + lateral.x * offset - forward.x * depth, y: destination.y + lateral.y * offset - forward.y * depth };
  }
  return { x: destination.x - forward.x * Math.floor(index / 3) * spacing - lateral.x * (index % 3 - 1) * spacing, y: destination.y - forward.y * Math.floor(index / 3) * spacing - lateral.y * (index % 3 - 1) * spacing };
}

export function measureFormation(formation, members, day, destination = formation?.destination, slotFor = formationSlot) {
  if (!formation) return null;
  const assigned = (members || []).filter(person => person?.alive && formation.memberIds.includes(person.id));
  if (!assigned.length) {
    formation.metrics = { day, cohesion: 0, meanSlotError: 0, outsideSlots: 0, blockedMoves: formation.metrics?.blockedMoves || 0 };
    return formation.metrics;
  }
  let totalError = 0, outsideSlots = 0;
  for (const person of assigned) {
    const slot = slotFor(formation, person.id, destination);
    const error = Math.hypot(person.x - slot.x, person.y - slot.y);
    totalError += error;
    if (error > formation.spacing * 1.5) outsideSlots++;
  }
  const meanSlotError = totalError / assigned.length;
  formation.metrics = {
    day,
    cohesion: Number(clamp(1 - meanSlotError / Math.max(.1, formation.spacing * 2), 0, 1).toFixed(3)),
    meanSlotError: Number(meanSlotError.toFixed(3)),
    outsideSlots,
    blockedMoves: formation.metrics?.blockedMoves || 0
  };
  return formation.metrics;
}

export function recordFormationBlockedMove(formation) {
  if (!formation) return;
  formation.metrics ||= { cohesion: 1, meanSlotError: 0, outsideSlots: 0, blockedMoves: 0 };
  formation.metrics.blockedMoves = Math.min(999, (formation.metrics.blockedMoves || 0) + 1);
}
