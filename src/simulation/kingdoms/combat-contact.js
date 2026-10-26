// Combat geometry is independent from navigation footprints and the renderer.
// Coordinates are in world cells; timings are simulated milliseconds.
import { combatPathObstruction } from '../physics/hitboxes.js';

export const COMBAT_PROFILES = Object.freeze({
  guerreiro: { windup: 200, active: 100, recovery: 100, reach: 1.8, radius: .17, arc: 1.2 },
  lanceiro: { windup: 100, active: 100, recovery: 200, reach: 3.2, radius: .12, arc: 0 },
  arqueiro: { windup: 500, active: 1, recovery: 299, reach: 8, radius: .08, arc: 0 }
});
export const COMBAT_STEP_MS = 1000 / 30;
export const BODY_RADIUS = .32;

export function combatActionPhase(action, elapsed) {
  if (elapsed < action.windupMs) return 'windup';
  if (elapsed < action.windupMs + action.activeMs) return 'active';
  if (elapsed < action.durationMs) return 'recovery';
  return 'complete';
}

export function segmentCircle(from, to, center, radius) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const length2 = dx * dx + dy * dy;
  const ox = from.x - center.x, oy = from.y - center.y;
  const c = ox * ox + oy * oy - radius * radius;
  if (c <= 0) return 0;
  if (!length2) return null;
  const b = ox * dx + oy * dy, discriminant = b * b - length2 * c;
  if (discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / length2;
  return t >= 0 && t <= 1 ? t : null;
}

export function frontGuard(target, origin) {
  const dx = origin.x - target.x, dy = origin.y - target.y;
  const fx = target.militaryFacingX ?? 1, fy = target.militaryFacingY ?? 0;
  return (dx * fx + dy * fy) / ((Math.hypot(dx, dy) || 1) * (Math.hypot(fx, fy) || 1)) >= .5;
}

export function createCombatAction(world, actor, target, day, options = {}) {
  const profile = COMBAT_PROFILES[actor.militaryClass];
  if (!profile) return null;
  world.combatSequence = (world.combatSequence || 0) + 1;
  const origin = { x: actor.x, y: actor.y };
  const aim = { x: target.x, y: target.y };
  const angle = Math.atan2(aim.y - origin.y, aim.x - origin.x);
  const reach = options.reach ?? profile.reach;
  const aimDistance = Math.hypot(aim.x - origin.x, aim.y - origin.y);
  if (actor.militaryClass === 'arqueiro' && aimDistance > reach) {
    aim.x = origin.x + Math.cos(angle) * reach; aim.y = origin.y + Math.sin(angle) * reach;
  }
  const flightMs = actor.militaryClass === 'arqueiro'
    ? Math.max(100, Math.min(850, Math.hypot(aim.x - origin.x, aim.y - origin.y) * 55)) : 0;
  const durationMs = Math.max(profile.windup + profile.active + profile.recovery, profile.windup + flightMs);
  const action = { id: world.combatSequence, day, actorId: actor.id, targetId: target.id,
    targetKind: options.structure ? 'structure' : 'person', weapon: actor.militaryClass,
    comboIndex: Math.max(1, Math.min(3, Math.trunc(options.comboIndex || 1))),
    origin, aim, angle, sourceElevation: actor.towerMounted ? 3 : 0,
    targetElevation: target.towerMounted ? 3 : 0,
    windupMs: profile.windup, activeMs: profile.active, recoveryMs: profile.recovery, flightMs,
    durationMs,
    geometry: { type: actor.militaryClass === 'arqueiro' ? 'projectile' : profile.arc ? 'swept-arc' : 'swept-segment',
      reach, radius: profile.radius, arcRadians: profile.arc },
    timing: { windupStartMs: 0, releaseMs: profile.windup,
      activeEndMs: profile.windup + profile.active, contactMs: null,
      recoveryStartMs: profile.windup + profile.active, completionMs: durationMs },
    reach, phase: 'windup', hitTargets: [], result: null };
  actor.combatAction = action;
  return action;
}

export function combatWeaponPoint(action, elapsed) {
  if (action.weapon === 'arqueiro') {
    const t = Math.min(1, Math.max(0, (elapsed - action.windupMs) / action.flightMs));
    return { x: action.origin.x + (action.aim.x - action.origin.x) * t,
      y: action.origin.y + (action.aim.y - action.origin.y) * t };
  }
  const profile = COMBAT_PROFILES[action.weapon];
  const t = Math.min(1, Math.max(0, (elapsed - action.windupMs) / action.activeMs));
  const angle = action.angle + (t - .5) * profile.arc * 2;
  const reach = action.reach * (profile.arc ? 1 : .2 + .8 * t);
  return { x: action.origin.x + Math.cos(angle) * reach, y: action.origin.y + Math.sin(angle) * reach };
}

// Earliest angle at which the whole finite blade touches a circle. Ordering by
// distance along the blade would let a later, nearer body steal an earlier hit.
function sweptBladeContact(action, fromMs, toMs, center, radius) {
  const arc = COMBAT_PROFILES[action.weapon].arc;
  const angleAt = ms => action.angle + (Math.max(0, Math.min(1,
    (ms - action.windupMs) / action.activeMs)) - .5) * arc * 2;
  const startAngle = angleAt(fromMs), endAngle = angleAt(toMs), span = endAngle - startAngle;
  const dx = center.x - action.origin.x, dy = center.y - action.origin.y, d = Math.hypot(dx, dy);
  if (d > action.reach + radius) return null;
  if (d <= radius) return { fraction: 0, distanceFraction: 0, point: { ...action.origin } };
  const half = d <= action.reach ? Math.asin(Math.min(1, radius / d))
    : Math.acos(Math.max(-1, Math.min(1, (d * d + action.reach ** 2 - radius ** 2) / (2 * d * action.reach))));
  const theta = Math.atan2(dy, dx);
  const relativeCenter = startAngle + Math.atan2(Math.sin(theta - startAngle), Math.cos(theta - startAngle));
  let first = null;
  for (const turn of [-1, 0, 1]) {
    const angle = relativeCenter + turn * Math.PI * 2;
    const entry = Math.max(startAngle, angle - half);
    if (entry > endAngle + 1e-10 || entry > angle + half + 1e-10) continue;
    const tip = { x: action.origin.x + Math.cos(entry) * action.reach,
      y: action.origin.y + Math.sin(entry) * action.reach };
    const distanceFraction = segmentCircle(action.origin, tip, center, radius + 1e-10);
    if (distanceFraction == null) continue;
    const fraction = span > 1e-10 ? Math.max(0, Math.min(1, (entry - startAngle) / span)) : 0;
    if (!first || fraction < first.fraction) first = { fraction, distanceFraction,
      point: { x: action.origin.x + (tip.x - action.origin.x) * distanceFraction,
        y: action.origin.y + (tip.y - action.origin.y) * distanceFraction } };
  }
  return first;
}

function projectileElevation(action, elapsed) {
  const progress = Math.max(0, Math.min(1, (elapsed - action.windupMs) / action.flightMs));
  return action.sourceElevation + (action.targetElevation - action.sourceElevation) * progress;
}

function sweptContact(from, to, center, radius, fromHeight, toHeight, targetHeight) {
  if (targetHeight == null) return segmentCircle(from, to, center, radius);
  let low = 0, high = 1;
  const dz = toHeight - fromHeight;
  if (Math.abs(dz) < 1e-10) {
    if (Math.abs(fromHeight - targetHeight) > .65) return null;
  } else {
    const a = (targetHeight - .65 - fromHeight) / dz, b = (targetHeight + .65 - fromHeight) / dz;
    low = Math.max(0, Math.min(a, b)); high = Math.min(1, Math.max(a, b));
    if (low > high) return null;
  }
  const at = fraction => ({ x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction });
  const fraction = segmentCircle(at(low), at(high), center, radius);
  return fraction == null ? null : low + (high - low) * fraction;
}

// Resolve a tactical exchange at fixed substeps, preserving the synchronous campaign
// accounting contract. Reactions can move during preparation through beforeStep.
// The timeline is also consumed by presentation and, later, audio.
export function resolveCombatAction(world, actor, action, candidates, applyDamage, options = {}) {
  if (action.phase === 'complete') return action.result;
  const profile = COMBAT_PROFILES[action.weapon];
  let previous = combatWeaponPoint(action, action.windupMs);
  const end = action.windupMs + (action.flightMs || action.activeMs);
  const structure = action.targetKind === 'structure';
  for (let cursor = 0; cursor < end;) {
    const start = cursor;
    // Split exactly at release, rather than drifting across it in floating point.
    const now = Math.min(end, start + COMBAT_STEP_MS, start < action.windupMs ? action.windupMs : Infinity);
    cursor = now;
    options.beforeStep?.(now, action);
    if (!actor.alive && (action.weapon !== 'arqueiro' || start < action.windupMs)) { action.result = { kind: 'cancelled', atMs: start }; break; }
    if (now < action.windupMs) continue;
    action.phase = 'active';
    const current = combatWeaponPoint(action, now);
    const hits = [];
    const sourceHeight = action.weapon === 'arqueiro'
      ? projectileElevation(action, Math.max(start, action.windupMs)) : action.sourceElevation;
    const currentHeight = action.weapon === 'arqueiro'
      ? projectileElevation(action, now) : action.sourceElevation;
    const projectileObstruction = action.weapon === 'arqueiro' ? combatPathObstruction(world, previous, current, {
      sourceElevation: sourceHeight, targetElevation: currentHeight,
      ignoreStructureId: structure ? action.targetId : null
    }) : null;
    const blockedContacts = [];
    for (const target of candidates) {
      if ((structure ? target.destroyedDay != null : !target.alive || target.restingStructureId != null)
        || target.kingdomId === actor.kingdomId || action.hitTargets.includes(target.id)) continue;
      if (!structure && action.weapon !== 'arqueiro' && !!target.towerMounted !== !!actor.towerMounted) continue;
      const radius = structure ? (options.targetRadius ?? .8) : BODY_RADIUS;
      const fromHeight = sourceHeight;
      const toHeight = currentHeight;
      const targetHeight = structure ? null : target.towerMounted ? 3 : 0;
      const fx = target.militaryFacingX ?? 1, fy = target.militaryFacingY ?? 0, length = Math.hypot(fx, fy) || 1;
      const guardCenter = { x: target.x + fx / length * .42, y: target.y + fy / length * .42 };
      const canGuard = !structure && options.guarding?.has(target.id) && frontGuard(target, action.origin)
        && (target.militaryClass === 'guerreiro' || target.militaryClass === 'lanceiro' && action.weapon !== 'arqueiro');
      const guardFraction = canGuard ? sweptContact(previous, current, guardCenter,
        (target.militaryClass === 'guerreiro' ? .4 : .25) + profile.radius, fromHeight, toHeight, targetHeight) : null;
      let fraction = sweptContact(previous, current, target, radius + profile.radius, fromHeight, toHeight, targetHeight);
      let guarding = guardFraction != null && (fraction == null || guardFraction <= fraction);
      if (guarding) fraction = guardFraction;
      let point = fraction == null ? null : { x: previous.x + (current.x - previous.x) * fraction,
        y: previous.y + (current.y - previous.y) * fraction };
      let distanceFraction = fraction;
      // The sword blade occupies its length, while a spear only hits with its tip.
      if (action.weapon === 'guerreiro') {
        const blade = sweptBladeContact(action, Math.max(start, action.windupMs), now, target, radius + profile.radius);
        const shield = canGuard ? sweptBladeContact(action, Math.max(start, action.windupMs), now,
          guardCenter, (target.militaryClass === 'guerreiro' ? .4 : .25) + profile.radius) : null;
        guarding = !!shield && (!blade || shield.fraction < blade.fraction
          || Math.abs(shield.fraction - blade.fraction) < 1e-9 && shield.distanceFraction <= blade.distanceFraction);
        const contact = guarding ? shield : blade;
        fraction = contact?.fraction ?? null;
        distanceFraction = contact?.distanceFraction ?? null;
        point = contact?.point ?? null;
      }
      if (fraction != null) {
        const obstruction = action.weapon === 'arqueiro' ? null : combatPathObstruction(world, action.origin, point, {
          sourceElevation: action.sourceElevation, targetElevation: action.sourceElevation,
          ignoreStructureId: structure ? target.id : null
        });
        const atMs = Math.max(start, action.windupMs)
          + (now - Math.max(start, action.windupMs)) * fraction;
        if (obstruction) {
          blockedContacts.push({ target, obstruction, atMs });
          continue;
        }
        hits.push({ target, fraction, distanceFraction, point, guarding, guardCenter });
      }
    }
    hits.sort((a, b) => a.fraction - b.fraction || a.distanceFraction - b.distanceFraction || a.target.id - b.target.id);
    if (projectileObstruction && (!hits.length || projectileObstruction.fraction <= hits[0].fraction)) {
      const atMs = Math.max(start, action.windupMs)
        + (now - Math.max(start, action.windupMs)) * projectileObstruction.fraction;
      action.timing.contactMs = atMs;
      action.result = { kind: 'obstructed', atMs, point: projectileObstruction.point,
        contactElevation: projectileElevation(action, atMs),
        obstruction: projectileObstruction, hitbox: action.geometry };
      break;
    }
    if (hits.length) {
      const { target, point, guarding, fraction, guardCenter } = hits[0];
      const atMs = Math.max(start, action.windupMs)
        + (now - Math.max(start, action.windupMs)) * fraction;
      const parryWindowMs = options.parryWindows?.get(target.id) || 0;
      const parryAtMs = action.windupMs + action.activeMs * .5;
      const parried = guarding && action.weapon !== 'arqueiro'
        && options.parrying?.has(target.id) && Math.abs(atMs - parryAtMs) <= parryWindowMs;
      const normalLength = Math.hypot(point.x - target.x, point.y - target.y) || 1;
      action.hitTargets.push(target.id);
      const blockKind = target.militaryClass === 'guerreiro' ? 'shield' : 'weapon-guard';
      action.timing.contactMs = atMs;
      const targetContact = guarding ? guardCenter : { x: target.x, y: target.y };
      action.result = { kind: structure ? 'structure' : parried ? 'parry' : guarding
        ? blockKind : 'body', blockKind: guarding ? blockKind : null,
      targetId: target.id, atMs, point,
      targetPosition: targetContact,
      hitbox: { shape: structure ? 'structure-contact' : 'circle',
        radius: structure ? (options.targetRadius ?? .8) + profile.radius
          : guarding ? (target.militaryClass === 'guerreiro' ? .4 : .25) + profile.radius
            : BODY_RADIUS + profile.radius },
      normal: { x: (point.x - target.x) / normalLength, y: (point.y - target.y) / normalLength },
      damageApplied: parried ? 0 : applyDamage(target, guarding), fatal: !structure && !target.alive,
      structureDestroyed: structure && target.destroyedDay != null };
      action.result.contactElevation = action.weapon === 'arqueiro'
        ? projectileElevation(action, action.result.atMs) : action.sourceElevation;
      if (guarding) {
        target.militaryAnimation = 'defend'; target.militaryAnimationDay = action.day;
        target.combatDefense = { actionId: action.id, day: action.day, atMs: action.result.atMs,
          kind: action.result.kind, blockKind };
      }
      break; // Single-target attacks; no cleave or friendly fire.
    }
    if (blockedContacts.length) {
      blockedContacts.sort((a, b) => a.atMs - b.atMs || a.target.id - b.target.id);
      const { obstruction, atMs } = blockedContacts[0];
      action.timing.contactMs = atMs;
      action.result = { kind: 'obstructed', atMs, point: obstruction.point,
        obstruction, hitbox: action.geometry };
      break;
    }
    previous = current;
  }
  action.result ??= { kind: 'miss', atMs: end, hitbox: action.geometry };
  action.phase = 'complete';
  // Keep bounded combat events for playback effects without changing entity IDs or RNG.
  world.combatEvents ??= [];
  world.combatEvents.push({ ...action, hitTargets: [...action.hitTargets] });
  world.combatEvents = world.combatEvents.slice(-128);
  return action.result;
}
