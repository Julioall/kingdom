// Deterministic campaign tactics: generals select missions, commanders are the
// moving anchors. Deliberately bounded: no neural inference per soldier.
const ROLES = ['vanguard', 'support', 'flank-left', 'flank-right', 'reserve'];
const LIMIT_THREATS = 12;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const normalized = (from, to) => {
  const dx = to.x - from.x, dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: dx / length, y: dy / length };
};

// Influence considers only enemies reported by the local observer, never
// the entire opposing army. Limited to twelve observations per campaign side.
export function observedInfluence(point, observedThreats = []) {
  let score = 0;
  for (const threat of observedThreats.slice(0, LIMIT_THREATS)) {
    const distance = dist(point, threat);
    const radius = threat.militaryClass === 'arqueiro' ? 10 : 4;
    if (distance < radius) score += (radius - distance) / radius;
  }
  return Number(score.toFixed(3));
}

function moraleForSquad(sideMorale, prior, strength, day, stamina) {
  const old = prior?.morale ?? sideMorale;
  if (prior?.day === day) return old;
  const casualties = Math.max(0, (prior?.strength ?? strength) - strength);
  const fatigue = stamina < 20 ? 3 : stamina < 40 ? 1 : 0;
  const recovery = casualties === 0 && stamina >= 45 ? 1 : 0;
  return clamp(Math.min(sideMorale, old) - casualties * 12 - fatigue + recovery, 0, 100);
}

export function planSquadTactics({ units = [], troops = [], generalOrder = null,
  destination, home, orientation = null, day, previous = null,
  observedThreats = [], openFront = true, sideMorale = 80, mode = 'hierarchical' }) {
  if (!destination || !Number.isFinite(destination.x) || !Number.isFinite(destination.y))
    return { day, squads: [], memberToSquad: {}, mode };
  const byId = new Map(troops.filter(p => p?.alive).map(p => [p.id, p]));
  const previousById = new Map((previous?.squads || []).map(s => [s.id, s]));
  const candidates = [];
  for (const unit of units) {
    const members = (unit.memberIds || []).map(id => byId.get(id)).filter(Boolean);
    const soldiers = members.filter(p => p.militaryRank !== 'general');
    if (!soldiers.length) continue;
    const commander = soldiers.find(p => p.id === unit.commanderId)
      || soldiers.find(p => p.militaryRank === 'comandante') || soldiers[0];
    if (!commander) continue;
    candidates.push({ unit, members: soldiers, commander });
  }
  const squads = [], memberToSquad = {};
  const forward = orientation || normalized(home || destination, destination);
  const lateral = { x: -forward.y, y: forward.x };
  const threatList = observedThreats.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))
    .sort((a, b) => dist(a, destination) - dist(b, destination) || a.id - b.id)
    .slice(0, LIMIT_THREATS);
  const contested = threatList.some(p => dist(p, destination) <= 12);
  for (let index = 0; index < candidates.length; index++) {
    const { unit, members, commander } = candidates[index];
    const role = ROLES[index % ROLES.length];
    const id = String(unit.id);
    const prior = previousById.get(id);
    const avgStamina = members.reduce((sum, p) => sum + (Number(p.stamina) || 0), 0) / members.length;
    const morale = mode === 'hierarchical'
      ? moraleForSquad(sideMorale, prior, members.length, day, avgStamina)
      : sideMorale;
    const routed = mode === 'hierarchical' && morale < 25;
    const regrouping = mode === 'hierarchical' && !routed && morale < 42;
    const mission = routed ? 'rout' : regrouping ? 'regroup'
      : generalOrder?.action === 'hold_position' ? 'hold'
        : role === 'flank-left' || role === 'flank-right' ? 'flank'
          : role === 'reserve' ? 'reserve' : 'advance';
    const offset = role === 'flank-left' ? -4 : role === 'flank-right' ? 4
      : (role === 'support' ? -2.2 : role === 'reserve' ? 0 : 1.5);
    const depth = role === 'support' ? 3 : role === 'reserve' ? 6 : 0;
    const central = routed && home ? home : destination;
    const goal = routed || regrouping ? {
      x: central.x - forward.x * (regrouping ? 8 : 0),
      y: central.y - forward.y * (regrouping ? 8 : 0)
    } : {
      x: central.x + lateral.x * offset - forward.x * depth,
      y: central.y + lateral.y * offset - forward.y * depth
    };
    // Hysteresis avoids oscillating between formations every simulation day.
    const atFront = dist(commander, destination) <= 14;
    const scores = {
      column: atFront ? 1 : 10,
      line: openFront && atFront ? 10 : -10,
      wedge: mode === 'hierarchical' && openFront && atFront && members.length >= 4 && mission === 'flank' ? 12 : -10,
      square: mode === 'hierarchical' && openFront && atFront && contested && (mission === 'hold' || role === 'reserve') ? 11 : -10
    };
    if (mode === 'hierarchical' && observedInfluence(goal, threatList) > 1.5) scores.column += 2;
    if (prior && scores[prior.formationType] != null) scores[prior.formationType] += 1;
    const formationType = Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
    const face = dist(commander, goal) > 2 ? normalized(commander, goal)
      : contested ? normalized(commander, threatList[0]) : forward;
    const squad = {
      id, unitId: unit.id, commanderId: commander.id,
      generalId: unit.generalId ?? generalOrder?.issuerId ?? null,
      memberIds: members.map(p => p.id), role, mission, formationType,
      orientation: face, target: goal, morale: Number(morale.toFixed(2)), routed,
      influence: mode === 'hierarchical' ? observedInfluence(goal, threatList) : 0,
      day, strength: members.length
    };
    for (const member of members) memberToSquad[member.id] = squads.length;
    squads.push(squad);
  }
  return { mode, day, squads, memberToSquad, observedThreatCount: threatList.length };
}

export function squadSlot(squad, memberId, commander, spacing = 1.5) {
  if (!squad || !commander || squad.commanderId === memberId) return null;
  const followers = squad.memberIds.filter(id => id !== squad.commanderId);
  const index = followers.indexOf(memberId);
  if (index < 0) return null;
  const direction = squad.orientation || { x: 1, y: 0 };
  const lateral = { x: -direction.y, y: direction.x };
  let row, column;
  if (squad.formationType === 'column') {
    row = index; column = 0;
  } else if (squad.formationType === 'wedge') {
    row = 0;
    let start = 0;
    while (index >= start + row + 1) { start += row + 1; row++; }
    column = index - start - row / 2;
  } else {
    const width = squad.formationType === 'square' ? 3 : 5;
    row = Math.floor(index / width);
    column = index % width - (Math.min(width, followers.length - row * width) - 1) / 2;
  }
  const depth = 1.5 + row * spacing;
  return {
    x: commander.x - direction.x * depth + lateral.x * column * spacing,
    y: commander.y - direction.y * depth + lateral.y * column * spacing
  };
}
