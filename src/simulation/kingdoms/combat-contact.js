// Combat geometry is independent from navigation footprints and the renderer.
// Coordinates are in world cells; timings are simulated milliseconds.
import { combatPathObstruction, worldCollisionIndex } from '../physics/hitboxes.js';
import { rand } from '../core/random.js';

export const COMBAT_PROFILES = Object.freeze({
  guerreiro: { windup: 200, active: 100, recovery: 100, reach: 1.8, radius: .17, arc: 1.2 },
  lanceiro: { windup: 100, active: 100, recovery: 200, reach: 3.2, radius: .12, arc: 0 },
  arqueiro: { windup: 500, active: 1, recovery: 299, reach: 8, radius: .08, arc: 0 }
});
export const COMBAT_STEP_MS = 1000 / 30;
export const BODY_RADIUS = .32;
export const ARROW_RAIN_TIMING = Object.freeze({ ascentMs: 550, descentMs: 500, skyHeight: 7 });
const BOW_DRAW_MIN_MS = 450;
const BOW_DRAW_MAX_MS = 900;
const BOW_ARC_BASE_HEIGHT = .45;
const BOW_ARC_CHARGE_HEIGHT = 1.25;

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
  const aim = Number.isFinite(options.aim?.x) && Number.isFinite(options.aim?.y)
    ? { x: options.aim.x, y: options.aim.y } : { x: target.x, y: target.y };
  let angle = Math.atan2(aim.y - origin.y, aim.x - origin.x);
  const reach = options.reach ?? profile.reach;
  const aimDistance = Math.hypot(aim.x - origin.x, aim.y - origin.y);
  if (actor.militaryClass === 'arqueiro' && aimDistance > reach) {
    aim.x = origin.x + Math.cos(angle) * reach; aim.y = origin.y + Math.sin(angle) * reach;
  }
  const shotDistance = Math.hypot(aim.x - origin.x, aim.y - origin.y);
  const attackVariant = actor.militaryClass === 'arqueiro'
    ? options.attackVariant || 'standard' : options.attackVariant || null;
  const distanceCharge = actor.militaryClass === 'arqueiro'
    ? Math.max(0, Math.min(1, shotDistance / Math.max(.1, reach))) : 0;
  const bowCharge = attackVariant === 'charged' || attackVariant === 'rain' ? 1
    : attackVariant === 'cone' ? .55 : distanceCharge;
  const windupMs = attackVariant === 'shield-bash' ? 1000
    : attackVariant === 'lance-charge' ? 180
    : attackVariant === 'lance-flurry' ? 120
    : attackVariant === 'charged' ? 5000
    : attackVariant === 'rain' ? 1500
      : attackVariant === 'cone' ? 750
        : actor.militaryClass === 'arqueiro'
          ? BOW_DRAW_MIN_MS + bowCharge * (BOW_DRAW_MAX_MS - BOW_DRAW_MIN_MS) : profile.windup;
  const activeMs = attackVariant === 'shield-bash' ? 450
    : attackVariant === 'lance-charge' ? 780
      : attackVariant === 'lance-flurry' ? (options.flurryDurationMs ?? 5000) : profile.active;
  const recoveryMs = attackVariant === 'shield-bash' ? 180
    : attackVariant === 'lance-charge' ? 180
      : attackVariant === 'lance-flurry' ? 180 : profile.recovery;
  const rainDurationMs = attackVariant === 'rain' ? (options.rainDurationMs ?? 3000) : 0;
  const arcHeight = attackVariant === 'charged' ? 0
    : attackVariant === 'rain' ? 4.2
      : attackVariant === 'cone' ? 0
        : actor.militaryClass === 'arqueiro'
          ? BOW_ARC_BASE_HEIGHT + bowCharge * BOW_ARC_CHARGE_HEIGHT : 0;
  if (actor.militaryClass === 'arqueiro' && attackVariant === 'standard' && shotDistance > 0
      && !options.targetLock) {
    const spread = (rand(world) * 2 - 1) * shotDistance * .1;
    const directionX = (aim.x - origin.x) / shotDistance;
    const directionY = (aim.y - origin.y) / shotDistance;
    aim.x -= directionY * spread;
    aim.y += directionX * spread;
    angle = Math.atan2(aim.y - origin.y, aim.x - origin.x);
  }
  const flightMs = attackVariant === 'rain' ? ARROW_RAIN_TIMING.ascentMs + ARROW_RAIN_TIMING.descentMs
    : actor.militaryClass === 'arqueiro'
    ? Math.max(100, Math.min(850, Math.hypot(aim.x - origin.x, aim.y - origin.y) * 55)) : 0;
  const durationMs = Math.max(windupMs + activeMs + recoveryMs,
    windupMs + flightMs, windupMs + rainDurationMs + flightMs + (options.areaRadius || 0) * 55);
  const action = { id: world.combatSequence, day, actorId: actor.id, targetId: target.id,
    targetKind: options.targetKind || (options.structure ? 'structure' : 'person'), weapon: actor.militaryClass, attackVariant,
    manualControl: options.manualControl === true,
    arrowCount: options.arrowCount, halfAngle: options.halfAngle,
    rainDurationMs, areaRadius: options.areaRadius,
    advanceDistance: options.advanceDistance, shieldOffset: options.shieldOffset, weaponOffset: options.weaponOffset,
    strikeIntervalMs: options.strikeIntervalMs, thrustDurationMs: options.thrustDurationMs,
    noContactTimeoutMs: options.noContactTimeoutMs,
    animationSpeedMultiplier: options.animationSpeedMultiplier,
    hitEvents: [], lastHitAtByTarget: {},
    lastContactAtMs: attackVariant === 'lance-flurry' ? windupMs : null,
    comboIndex: Math.max(1, Math.min(actor.militaryClass === 'guerreiro' ? 4 : 3,
      Math.trunc(options.comboIndex || 1))),
    origin, aim, angle, sourceElevation: actor.towerMounted ? 3 : 0,
    targetElevation: target.towerMounted ? 3 : 0,
    bowCharge, arcHeight, windupMs, activeMs, recoveryMs, flightMs,
    durationMs,
    geometry: { type: attackVariant === 'shield-bash' ? 'shield-charge'
      : attackVariant === 'lance-charge' ? 'spear-charge'
        : attackVariant === 'lance-flurry' ? 'spear-flurry'
      : actor.militaryClass === 'arqueiro' ? 'projectile' : profile.arc ? 'swept-arc' : 'swept-segment',
      reach, radius: attackVariant === 'shield-bash' || attackVariant === 'lance-charge'
        ? options.radius ?? profile.radius : profile.radius,
      arcRadians: profile.arc },
    timing: { windupStartMs: 0, releaseMs: windupMs,
      activeEndMs: windupMs + activeMs, contactMs: null,
      recoveryStartMs: windupMs + activeMs, completionMs: durationMs },
    reach, phase: 'windup', hitTargets: [], result: null };
  actor.combatAction = action;
  return action;
}

export function isCombatTargetEligible(world, attacker, target, day = world?.day) {
  if (!attacker || !target || target.alive === false || target.restingStructureId != null
      || attacker.id === target.id || attacker.kingdomId != null && target.kingdomId === attacker.kingdomId) return false;
  // Geometry-only callers may use lightweight target records; runtime people always have a role.
  if (target.role == null || target.role === 'soldier') return true;
  const currentDay = Number.isFinite(day) ? day : 0;
  return (world?.people || []).some(victim => victim.alive && victim.kingdomId === attacker.kingdomId
    && victim.lastAttackedById === target.id && Number.isFinite(victim.lastAttackedDay)
    && victim.lastAttackedDay <= currentDay && currentDay - victim.lastAttackedDay <= 2);
}

export function combatWeaponPoint(action, elapsed) {
  if (action.weapon === 'arqueiro') {
    const t = Math.min(1, Math.max(0, (elapsed - action.windupMs) / action.flightMs));
    return { x: action.origin.x + (action.aim.x - action.origin.x) * t,
      y: action.origin.y + (action.aim.y - action.origin.y) * t };
  }
  if (action.attackVariant === 'shield-bash') {
    const linearProgress = Math.min(1, Math.max(0, (elapsed - action.windupMs) / action.activeMs));
    const progress = linearProgress * linearProgress;
    const distance = (action.advanceDistance || 0) * progress + (action.shieldOffset || 0);
    return { x: action.origin.x + Math.cos(action.angle) * distance,
      y: action.origin.y + Math.sin(action.angle) * distance };
  }
  if (action.attackVariant === 'lance-charge') {
    const progress = Math.min(1, Math.max(0, (elapsed - action.windupMs) / action.activeMs));
    const distance = (action.weaponOffset || 0) + (action.advanceDistance || 0) * progress;
    return { x: action.origin.x + Math.cos(action.angle) * distance,
      y: action.origin.y + Math.sin(action.angle) * distance };
  }
  if (action.attackVariant === 'lance-flurry') {
    const interval = Math.max(1, action.strikeIntervalMs || 700);
    const thrust = Math.max(1, action.thrustDurationMs || 220);
    const phase = Math.max(0, elapsed - action.windupMs) % interval;
    const extension = phase <= thrust ? phase / thrust
      : phase < thrust + 100 ? 1 - (phase - thrust) / 100 : 0;
    const distance = action.reach * (.24 + extension * .76);
    return { x: action.origin.x + Math.cos(action.angle) * distance,
      y: action.origin.y + Math.sin(action.angle) * distance };
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
  return action.sourceElevation + (action.targetElevation - action.sourceElevation) * progress
    + Math.sin(Math.PI * progress) * (action.arcHeight || 0);
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
  const weaponRadius = action.geometry.radius ?? profile.radius;
  let previous = combatWeaponPoint(action, action.windupMs);
  let end = action.windupMs + (action.flightMs || action.activeMs);
  const structure = action.targetKind === 'structure';
  const aimedAtTrainingDummy = action.targetKind === 'training-dummy';
  // Geometry is stable throughout one exchange; avoid rebuilding structure
  // hitboxes and their signature for every projectile substep/contact.
  let collisionIndex;
  const obstruction = (from, to, settings) => combatPathObstruction(world, from, to,
    { ...settings, collisionIndex: collisionIndex ||= worldCollisionIndex(world) });
  for (let cursor = !options.beforeStep && actor.alive ? action.windupMs : 0; cursor < end;) {
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
    const projectileObstruction = action.weapon === 'arqueiro' && action.attackVariant !== 'rain' ? obstruction(previous, current, {
      sourceElevation: sourceHeight, targetElevation: currentHeight,
      ignoreStructureId: structure || aimedAtTrainingDummy ? action.targetId : null
    }) : null;
    const blockedContacts = [];
    for (const target of candidates) {
      const trainingDummy = target.trainingDummy === true;
      // The signal arrow goes upward; only the rain at the aimed area can hit.
      if (action.attackVariant === 'rain') continue;
      const alreadyHit = action.hitTargets.includes(target.id);
      const canRepeatHit = action.attackVariant === 'lance-flurry';
      const lastHitAt = action.lastHitAtByTarget?.[target.id];
      if ((structure ? target.destroyedDay != null : !target.alive || target.restingStructureId != null)
        || target.kingdomId === actor.kingdomId && !trainingDummy || alreadyHit && !canRepeatHit) continue;
      if (!structure && !trainingDummy && !isCombatTargetEligible(world, actor, target, action.day)) continue;
      if (!structure && !trainingDummy && action.weapon !== 'arqueiro'
          && !!target.towerMounted !== !!actor.towerMounted) continue;
      const radius = structure ? (options.targetRadius ?? .8) : target.hitRadius ?? BODY_RADIUS;
      const fromHeight = sourceHeight;
      const toHeight = currentHeight;
      const targetHeight = structure || trainingDummy ? null : target.towerMounted ? 3 : 0;
      const fx = target.militaryFacingX ?? 1, fy = target.militaryFacingY ?? 0, length = Math.hypot(fx, fy) || 1;
      const guardCenter = { x: target.x + fx / length * .42, y: target.y + fy / length * .42 };
      const canGuard = !structure && !trainingDummy && options.guarding?.has(target.id) && frontGuard(target, action.origin)
        && (target.militaryClass === 'guerreiro' || target.militaryClass === 'lanceiro' && action.weapon !== 'arqueiro');
      const guardFraction = canGuard ? sweptContact(previous, current, guardCenter,
        (target.militaryClass === 'guerreiro' ? .4 : .25) + weaponRadius, fromHeight, toHeight, targetHeight) : null;
      let fraction = sweptContact(previous, current, target, radius + weaponRadius, fromHeight, toHeight, targetHeight);
      let guarding = guardFraction != null && (fraction == null || guardFraction <= fraction);
      if (guarding) fraction = guardFraction;
      let point = fraction == null ? null : { x: previous.x + (current.x - previous.x) * fraction,
        y: previous.y + (current.y - previous.y) * fraction };
      let distanceFraction = fraction;
      // The sword blade occupies its length, while a spear only hits with its tip.
      if (action.weapon === 'guerreiro' && action.attackVariant !== 'shield-bash') {
        const blade = sweptBladeContact(action, Math.max(start, action.windupMs), now, target, radius + weaponRadius);
        const shield = canGuard ? sweptBladeContact(action, Math.max(start, action.windupMs), now,
          guardCenter, (target.militaryClass === 'guerreiro' ? .4 : .25) + weaponRadius) : null;
        guarding = !!shield && (!blade || shield.fraction < blade.fraction
          || Math.abs(shield.fraction - blade.fraction) < 1e-9 && shield.distanceFraction <= blade.distanceFraction);
        const contact = guarding ? shield : blade;
        fraction = contact?.fraction ?? null;
        distanceFraction = contact?.distanceFraction ?? null;
        point = contact?.point ?? null;
      }
      if (fraction != null) {
        const contactObstruction = action.weapon === 'arqueiro' ? null : obstruction(action.origin, point, {
          sourceElevation: action.sourceElevation, targetElevation: action.sourceElevation,
          ignoreStructureId: structure || trainingDummy ? target.id : null
        });
        const atMs = Math.max(start, action.windupMs)
          + (now - Math.max(start, action.windupMs)) * fraction;
        if (canRepeatHit && Number.isFinite(lastHitAt)
            && atMs - lastHitAt < (action.strikeIntervalMs || 700) * .9) continue;
        if (contactObstruction) {
          blockedContacts.push({ target, obstruction: contactObstruction, atMs });
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
    if (action.attackVariant === 'lance-flurry' && Number.isFinite(action.noContactTimeoutMs)) {
      const noContactDeadline = action.lastContactAtMs + action.noContactTimeoutMs;
      const firstHitAt = hits.length
        ? Math.max(start, action.windupMs)
          + (now - Math.max(start, action.windupMs)) * hits[0].fraction
        : Infinity;
      if (noContactDeadline <= now && firstHitAt > noContactDeadline) {
        end = noContactDeadline;
        action.activeMs = Math.max(0, end - action.windupMs);
        action.durationMs = action.windupMs + action.activeMs + action.recoveryMs;
        action.timing.activeEndMs = action.windupMs + action.activeMs;
        action.timing.recoveryStartMs = action.timing.activeEndMs;
        action.timing.completionMs = action.durationMs;
        break;
      }
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
      if (!action.hitTargets.includes(target.id)) action.hitTargets.push(target.id);
      const blockKind = target.militaryClass === 'guerreiro' ? 'shield' : 'weapon-guard';
      if (!structure) action.targetKind = target.trainingDummy ? 'training-dummy' : 'person';
      action.timing.contactMs = atMs;
      const targetContact = guarding ? guardCenter : { x: target.x, y: target.y };
      action.result = { kind: structure ? 'structure' : target.trainingDummy ? 'training-dummy' : parried ? 'parry' : guarding
        ? blockKind : 'body', blockKind: guarding ? blockKind : null,
      targetId: target.id, atMs, point,
      targetPosition: targetContact,
      hitbox: { shape: structure ? 'structure-contact' : 'circle',
        radius: structure ? (options.targetRadius ?? .8) + weaponRadius
          : guarding ? (target.militaryClass === 'guerreiro' ? .4 : .25) + weaponRadius
            : (target.hitRadius ?? BODY_RADIUS) + weaponRadius },
      normal: { x: (point.x - target.x) / normalLength, y: (point.y - target.y) / normalLength },
      damageApplied: parried ? 0 : applyDamage(target, guarding), fatal: !structure && !target.alive,
      structureDestroyed: structure && target.destroyedDay != null };
      action.result.contactElevation = action.weapon === 'arqueiro'
        ? projectileElevation(action, action.result.atMs) : action.sourceElevation;
      action.lastHitAtByTarget[target.id] = atMs;
      if (action.attackVariant === 'lance-flurry') action.lastContactAtMs = atMs;
      action.hitEvents.push({ targetId: target.id, atMs, point: { ...point }, kind: action.result.kind,
        damageApplied: action.result.damageApplied,
        ...(target.trainingDummy ? { health: target.health, maxHealth: target.maxHealth } : {}), guarding, parried });
      if (guarding) {
        target.militaryAnimation = 'defend'; target.militaryAnimationDay = action.day;
        target.combatDefense = { actionId: action.id, day: action.day, atMs: action.result.atMs,
          kind: action.result.kind, blockKind };
      }
      if (['shield-bash', 'lance-charge', 'lance-flurry'].includes(action.attackVariant) && !parried) {
        previous = current;
        continue;
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
  if (action.weapon === 'arqueiro' && action.result.kind === 'miss') {
    action.result.point = { ...action.aim };
    action.result.contactElevation = 0;
  }
  action.phase = 'complete';
  action.endPosition = { x: actor.x, y: actor.y };
  // Keep bounded combat events for playback effects without changing entity IDs or RNG.
  world.combatEvents ??= [];
  world.combatEvents.push({ ...action, hitTargets: [...action.hitTargets] });
  world.combatEvents = world.combatEvents.slice(-128);
  return action.result;
}
