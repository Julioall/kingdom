// Deterministic campaign tactics: generals select missions, commanders are the
// moving anchors. Deliberately bounded: no neural inference per soldier.
const ROLES = ['vanguard', 'support', 'flank-left', 'flank-right', 'reserve'];
const LIMIT_THREATS = 12;
const DEPLOY_DISTANCE = 13;
const CLASS_PRIORITY = Object.freeze({ lanceiro: 0, guerreiro: 1, arqueiro: 2, monge: 3 });
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
  observedThreats = [], openFront = true, sideMorale = 80, mode = 'hierarchical',
  projectTarget = position => position }) {
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
  // Distribute small armies symmetrically instead of assigning a left flank
  // before there is a right one. Keep roles stable with unit order.
  const roles = candidates.length === 1 ? ['vanguard']
    : candidates.length === 2 ? ['vanguard', 'support']
      : candidates.length === 3 ? ['vanguard', 'flank-left', 'flank-right']
        : candidates.length === 4 ? ['vanguard', 'support', 'flank-left', 'flank-right']
          : ROLES;
  // Unit identity survives losses. Otherwise every casualty eliminating a
  // unit would renumber the wings and make entire bodies reverse direction.
  const survivingVanguard = candidates.some(({ unit }) =>
    previousById.get(String(unit.id))?.role === 'vanguard');
  const forward = orientation || normalized(home || destination, destination);
  const lateral = { x: -forward.y, y: forward.x };
  // Marches obey the vanguard's ACTUAL position, not a common far-away
  // destination. Wings open out only when the center reaches deployment range.
  const leadCommander = candidates[0]?.commander || destination;
  const armyDeployedToFront = dist(leadCommander, destination) <= DEPLOY_DISTANCE;
  const threatList = observedThreats.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))
    .sort((a, b) => dist(a, destination) - dist(b, destination) || a.id - b.id)
    .slice(0, LIMIT_THREATS);
  const contested = threatList.some(p => dist(p, destination) <= 14);
  const focus = threatList[0] || null;
  const frontsUnderPressure = (previous?.squads || []).some(squad =>
    squad.role === 'vanguard' && (squad.morale < 60 || squad.strength < (squad.initialStrength || squad.strength)));
  const leadUnderContact = (previous?.squads || []).some(squad =>
    squad.role === 'vanguard' && ['contact', 'charging'].includes(squad.phase)
      && day - (squad.contactSinceDay ?? day) >= 2);

  for (let index = 0; index < candidates.length; index++) {
    const { unit, members, commander } = candidates[index];
    const id = String(unit.id);
    const prior = previousById.get(id);
    const role = prior?.role === 'vanguard' || !survivingVanguard && index === 0
      ? 'vanguard' : prior?.role || roles[index % roles.length];
    const avgStamina = members.reduce((sum, p) => sum + (Number(p.stamina) || 0), 0) / members.length;
    const morale = mode === 'hierarchical'
      ? moraleForSquad(sideMorale, prior, members.length, day, avgStamina)
      : sideMorale;
    const routed = mode === 'hierarchical' && morale < 25;
    const regrouping = mode === 'hierarchical' && !routed && morale < 42;
    const previousCommit = role === 'reserve' ? prior?.reserveCommittedDay : null;
    const releaseTriggered = frontsUnderPressure || (leadUnderContact && contested);
    // A reserve does not yo-yo between its original holding position and
    // the melee whenever the front briefly changes phase. Once committed,
    // finish the reinforcement while enemy contact persists.
    const previouslyCommitted = Number.isFinite(previousCommit)
      && (contested || day - previousCommit < 6);
    const releasedReserve = role === 'reserve' && mode === 'hierarchical'
      && (releaseTriggered || previouslyCommitted);
    const mission = routed ? 'rout' : regrouping ? 'regroup'
      : generalOrder?.action === 'hold_position' ? 'hold'
        : role === 'flank-left' || role === 'flank-right' ? 'flank'
          : role === 'reserve' && !releasedReserve ? 'reserve'
            : role === 'reserve' ? 'reinforce' : 'advance';
    // Wings must clear the entire infantry frontage (roughly 7 tiles for
    // five abreast). A three-tile offset overlapped the center and caused
    // competing destinations. Reserve remains visibly BEHIND the army.
    const offset = !openFront ? 0 : role === 'flank-left' ? -10 : role === 'flank-right' ? 10 : 0;
    const depth = role === 'support' ? 5 : role === 'reserve' ? 11 : 0;
    // March to an assembly position first. At visual contact the wings make a
    // REAL lateral maneuver, then swing onto the enemy's flank. Reserve remains
    // behind the center until contact/pressure calls it forward.
    const atFront = dist(commander, destination) <= DEPLOY_DISTANCE;
    const side = role === 'flank-left' ? -1 : role === 'flank-right' ? 1 : 0;
    // Once the general has deployed a wing, do not cancel its maneuver
    // merely because its captain traveled OUTSIDE the central deployment
    // radius or the general briefly switched from envelop to press-front.
    const mustFlank = mode === 'hierarchical' && openFront && side !== 0
      && contested && !!focus && generalOrder?.action !== 'hold_position'
      && (prior?.flankStage || !['assemble', 'press-front'].includes(generalOrder?.battlePlan));
    const flankActivated = mustFlank && (atFront || armyDeployedToFront || !!prior?.flankStage);
    const outerWaypoint = focus && projectTarget({
      x: focus.x + lateral.x * side * 11 - forward.x * 6,
      y: focus.y + lateral.y * side * 11 - forward.y * 6
    });
    // The captain reaching the waypoint is NOT enough. The shield/spear line
    // must arrive as a body before it pivots and attacks the enemy's side.
    const wingFollowers = members.filter(p => p.id !== commander.id);
    const assembledFollowers = wingFollowers.filter(p => dist(p, commander) <= 5.5).length;
    const wingReady = assembledFollowers >= Math.ceil(wingFollowers.length * .65);
    const reachedWing = outerWaypoint && dist(commander, outerWaypoint) <= 3.5;
    const passedWing = prior?.flankStage === 'strike' || (reachedWing && wingReady);
    const flankStage = mustFlank ? (passedWing ? 'strike' : 'swing') : null;
    const central = routed && home ? home : destination;
    let goal = routed || regrouping ? {
      x: central.x - forward.x * (regrouping ? 8 : 0),
      y: central.y - forward.y * (regrouping ? 8 : 0)
    } : {
      x: central.x + lateral.x * offset - forward.x * depth,
      y: central.y + lateral.y * offset - forward.y * depth
    };
    if (flankActivated) goal = flankStage === 'swing' ? outerWaypoint : {
      x: focus.x + lateral.x * side * 3 + forward.x * 2,
      y: focus.y + lateral.y * side * 3 + forward.y * 2
    };
    if (mission === 'reinforce') goal = {
      x: destination.x - forward.x * 1.5,
      y: destination.y - forward.y * 1.5
    };
    if (mission === 'hold') goal = prior?.holdPoint || { x: commander.x, y: commander.y };
    if (!armyDeployedToFront && !['vanguard'].includes(role)
        && !['hold', 'rout', 'regroup'].includes(mission)) {
      // Columns behind the general: 2-file wing offsets on the road, support
      // behind the shield center and the reserve last. No wing is allowed
      // to race unaccompanied to its final battlefield slot.
      const file = role === 'flank-left' ? -2.5 : role === 'flank-right' ? 2.5 : 0;
      const trail = role === 'reserve' ? 9 : role === 'support' ? 4.5 : 2;
      goal = {
        x: leadCommander.x - forward.x * trail + lateral.x * file,
        y: leadCommander.y - forward.y * trail + lateral.y * file
      };
    }
    // A reserve can FOLLOW the moving center in marching order. After
    // reaching the battle line, lock a real rear assembly point until it is
    // explicitly committed. Recomputing this from the front every day makes
    // "holding" units creep directly into combat without an order.
    const reserveHoldPoint = mission === 'reserve'
      && (armyDeployedToFront || !!prior?.reserveHoldPoint)
      ? prior?.reserveHoldPoint || projectTarget(goal) : null;
    if (reserveHoldPoint) goal = reserveHoldPoint;
    goal = projectTarget(goal);
    const count = kind => members.filter(p => p.militaryClass === kind).length;
    const spears = count('lanceiro'), shields = count('guerreiro');
    const narrow = !openFront || generalOrder?.formationType === 'column' && !atFront;
    let formationType = !(atFront || flankActivated) || narrow ? 'column'
      : role === 'support' ? 'line'
      // The wing marches around the adversary in files, then deploys
      // a recognizably different wedge for the inward strike.
      : flankActivated ? flankStage === 'strike' ? 'wedge' : 'column'
      : role === 'reserve' && contested ? 'square'
      : spears >= shields && spears >= 2 ? 'spear_line'
        : shields >= 2 ? 'shield_wall' : 'line';
    if (prior && prior.formationType !== formationType
      && day - (prior.formationChangedDay ?? -Infinity) < 2
      && !routed && dist(commander, focus || destination) > 5 && openFront
      && !(flankActivated && flankStage === 'strike' && prior?.flankStage !== 'strike')) {
      formationType = prior.formationType;
    }
    const formationChangedDay = formationType !== prior?.formationType ? day
      : prior.formationChangedDay ?? day;
    const directContact = focus && dist(commander, focus) <= 9;
    const readyToCharge = wingFollowers.length === 0
      || assembledFollowers >= Math.ceil(wingFollowers.length * .6);
    const charge = mode === 'hierarchical' && role === 'vanguard'
      && mission === 'advance' && atFront && directContact && readyToCharge
      && dist(commander, focus) > 4.3;
    if (charge) {
      const towardEnemy = normalized(commander, focus);
      const step = Math.min(3.5, dist(commander, focus) - 3.25);
      goal = projectTarget({
        x: commander.x + towardEnemy.x * step,
        y: commander.y + towardEnemy.y * step
      });
    }
    const phase = routed ? 'rout' : regrouping ? 'rally'
      : mission === 'hold' ? 'holding'
        : mission === 'reserve' ? reserveHoldPoint ? 'holding' : 'marching'
          : flankActivated ? flankStage === 'strike' ? 'striking' : 'flanking'
          : !atFront ? 'marching' : charge ? 'charging'
          : directContact ? 'contact' : 'deploying';
    // A marching body faces its travel direction; the shield wall faces the
    // opponent once it stops. Do not have wedge troops march sideways while
    // their sprites stare at a distant enemy.
    const desiredFacing = ['contact', 'charging', 'holding', 'striking'].includes(phase) && focus
      ? normalized(commander, focus) : dist(commander, goal) > 2
        ? normalized(commander, goal) : forward;
    // A shield wall is not a weather vane. Tiny changes to a commander goal
    // or reported enemy should not rotate every soldier's desired position
    // each day. Allow a deliberate turn for a real change of direction.
    const priorFacing = prior?.orientation;
    const dot = priorFacing ? priorFacing.x * desiredFacing.x
      + priorFacing.y * desiredFacing.y : -1;
    const face = priorFacing && prior?.formationType === formationType && dot >= .90
      ? priorFacing : desiredFacing;
    const squad = {
      id, unitId: unit.id, commanderId: commander.id,
      generalId: unit.generalId ?? generalOrder?.issuerId ?? null,
      memberIds: members.map(p => p.id), role, mission, formationType,
      orientation: face, target: goal, morale: Number(morale.toFixed(2)), routed,
      influence: mode === 'hierarchical' ? observedInfluence(goal, threatList) : 0,
      day, strength: members.length,
      initialStrength: prior?.initialStrength ?? members.length,
      phase, flankStage, formationChangedDay,
      contactSinceDay: ['contact', 'charging'].includes(phase)
        ? prior && ['contact', 'charging'].includes(prior.phase)
          ? prior.contactSinceDay ?? day : day
        : null,
      reserveCommittedDay: releasedReserve
        ? previousCommit ?? day : null,
      holdPoint: mission === 'hold' ? goal : null,
      reserveHoldPoint,
      flankWaypoint: flankActivated ? outerWaypoint : null,
      contactEnemyId: focus?.id ?? null
    };
    // Infantry does not sprint ahead while its formation stretches out behind.
    // Keep a real moving commander, but pace long marches: if many followers
    // lag beyond six tiles, the commander holds two days out of every three
    // until his body of troops closes the gap. Contact and rout override pacing.
    const followers = members.filter(p => p.id !== commander.id);
    const stragglers = followers.filter(p => dist(p, commander) > 6.5);
    const needsReform = stragglers.length >= Math.max(2, Math.ceil(followers.length * .4));
    // A captain should assemble troops even after reaching the deployment
    // zone, unless the enemy is in immediate weapon-contact distance.
    // Every third day allows progress if an obstruction prevents full order.
    // Wing commanders must keep their soldiers with them DURING the outer
    // maneuver, not merely after arriving at the waypoint. Once the wedge
    // pivots inward, pause again if its rear rank loses contact. Immediate
    // melee, rout and manual control still take precedence.
    const pacing = (phase === 'marching' || phase === 'deploying'
        || phase === 'contact' || phase === 'flanking'
        || phase === 'striking' && !wingReady)
      && (!focus || dist(commander, focus) > 4.5)
      && needsReform && day % 3 !== 0;
    if (pacing) {
      squad.target = { x: commander.x, y: commander.y };
      squad.phase = 'reforming';
    }
    // Same class stays in the same rank. A real medieval line puts melee troops
    // in front, archers behind the shields/spears and clerics in the rear.
    if (formationType !== 'column') squad.slotAssignments = medievalSlotAssignments(
      members, commander.id, formationType);
    let totalError = 0, evaluated = 0, rankReady = 0, nearCommander = 0;
    for (const member of members) if (member.id !== commander.id) {
      const slot = squadSlot(squad, member.id, commander);
      if (!slot) continue;
      const error = dist(member, slot);
      totalError += error; evaluated++;
      if (error <= 3.25) rankReady++;
      if (dist(member, commander) <= 8) nearCommander++;
    }
    squad.meanRankError = evaluated ? Number((totalError / evaluated).toFixed(2)) : 0;
    squad.rankIntegrity = evaluated ? Number((rankReady / evaluated).toFixed(3)) : 1;
    squad.commanderCoverage = evaluated ? Number((nearCommander / evaluated).toFixed(3)) : 1;
    squad.cohesion = evaluated
      ? Number(clamp(1 - totalError / (evaluated * 5), 0, 1).toFixed(3)) : 1;
    for (const member of members) memberToSquad[member.id] = squads.length;
    squads.push(squad);
  }
  return { mode, day, squads, memberToSquad, observedThreatCount: threatList.length };
}

export function squadFollowerTarget(member, commander, slot, separationLimit = 10) {
  if (!commander) return { target: slot || null, rejoining: false };
  const rejoining = dist(member, commander) > separationLimit;
  return { target: rejoining || !slot
    ? { x: commander.x, y: commander.y } : slot, rejoining };
}

export function squadSlot(squad, memberId, commander, spacing = 1.5) {
  if (!squad || !commander || squad.commanderId === memberId) return null;
  const followers = squad.memberIds.filter(id => id !== squad.commanderId);
  const index = followers.indexOf(memberId);
  if (index < 0) return null;
  const direction = squad.orientation || { x: 1, y: 0 };
  const lateral = { x: -direction.y, y: direction.x };
  let row, column;
  if (squad.formationType !== 'column' && squad.slotAssignments?.[memberId]) {
    const slot = squad.slotAssignments[memberId];
    return {
      x: commander.x + direction.x * slot.forward + lateral.x * slot.lateral,
      y: commander.y + direction.y * slot.forward + lateral.y * slot.lateral
    };
  }
  if (squad.formationType === 'column') {
    // A 3-file marching column prevents a ten-person unit from stretching
    // into a very long single-file snake behind the commander.
    const width = Math.min(3, followers.length);
    row = Math.floor(index / width);
    column = index % width - (Math.min(width, followers.length - row * width) - 1) / 2;
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

/**
 * Class-aware relative ranks. Commander occupies the rally center instead of
 * walking at the tip of the spear. All offsets are geometry only: actual
 * collision, hitboxes, stamina, arrow trajectories and damage remain in the
 * authoritative simulation.
 */
export function medievalSlotAssignments(members, commanderId, formationType) {
  const soldiers = members.filter(p => p.id !== commanderId).slice()
    .sort((a, b) => (CLASS_PRIORITY[a.militaryClass] ?? 1)
      - (CLASS_PRIORITY[b.militaryClass] ?? 1) || a.id - b.id);
  const melee = soldiers.filter(p => !['arqueiro', 'monge'].includes(p.militaryClass));
  const archers = soldiers.filter(p => p.militaryClass === 'arqueiro');
  const clerics = soldiers.filter(p => p.militaryClass === 'monge');
  const slots = Object.create(null);
  const row = (people, width, forward, gap = 1.45, stepBack = 1.4) => {
    for (let i = 0; i < people.length; i++) {
      const r = Math.floor(i / width);
      const count = Math.min(width, people.length - r * width);
      slots[people[i].id] = {
        forward: forward - r * stepBack,
        lateral: (i % width - (count - 1) / 2) * gap
      };
    }
  };
  if (formationType === 'square') {
    const perimeter = [
      [2.4,-1.5],[2.4,0],[2.4,1.5],[0.9,2.4],[-0.9,2.4],
      [-2.4,1.5],[-2.4,0],[-2.4,-1.5],[0.9,-2.4],[-0.9,-2.4]
    ];
    melee.forEach((p, i) => {
      const [forward, lateral] = perimeter[i % perimeter.length];
      slots[p.id] = { forward, lateral };
    });
    row(archers, 3, -0.5, 1.0, 0.9);
    row(clerics, 2, -1.4, 0.8, 0.8);
  } else if (formationType === 'wedge') {
    for (let i = 0, r = 0, start = 0; i < melee.length; i++) {
      while (i >= start + r + 1) { start += r + 1; r++; }
      slots[melee[i].id] = { forward: 3.0 - r * 1.3,
        lateral: (i - start - r / 2) * 2.0 };
    }
    row(archers, 4, -2.3);
    row(clerics, 3, -4.1);
  } else {
    const spears = melee.filter(p => p.militaryClass === 'lanceiro');
    const shields = melee.filter(p => p.militaryClass === 'guerreiro');
    const others = melee.filter(p => !['guerreiro', 'lanceiro'].includes(p.militaryClass));
    if (formationType === 'spear_line') {
      row(spears, 5, 2.7, 1.35);
      row([...shields, ...others], 5, 0.6, 1.35);
    } else if (formationType === 'shield_wall') {
      row(shields, 5, 2.3, 1.15);
      row([...spears, ...others], 5, 0.7, 1.35);
    } else row(melee, 5, 2.2, 1.35);
    // Ranged support and healers do not squeeze into the shield line.
    row(archers, 5, -2.3, 1.55);
    row(clerics, 3, -4.0, 1.5);
  }
  return slots;
}
