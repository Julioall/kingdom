// Combat geometry is independent from navigation footprints and the renderer.
// Coordinates are in world cells; timings are simulated milliseconds.
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
  const action = { id: world.combatSequence, day, actorId: actor.id, targetId: target.id,
    targetKind: options.structure ? 'structure' : 'person', weapon: actor.militaryClass,
    origin, aim, angle, sourceElevation: actor.towerMounted ? 3 : 0,
    targetElevation: target.towerMounted ? 3 : 0,
    windupMs: profile.windup, activeMs: profile.active, recoveryMs: profile.recovery, flightMs,
    durationMs: Math.max(profile.windup + profile.active + profile.recovery, profile.windup + flightMs),
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

// Resolve a tactical exchange at fixed substeps, preserving the synchronous campaign
// accounting contract. Reactions can move during preparation through beforeStep.
// The timeline is also consumed by presentation and, later, audio.
export function resolveCombatAction(world, actor, action, candidates, applyDamage, options = {}) {
  if (action.phase === 'complete') return action.result;
  const profile = COMBAT_PROFILES[action.weapon];
  let previous = combatWeaponPoint(action, action.windupMs);
  const end = action.windupMs + (action.flightMs || action.activeMs);
  const structure = action.targetKind === 'structure';
  for (let start = 0; start < end; start += COMBAT_STEP_MS) {
    const now = Math.min(end, start + COMBAT_STEP_MS);
    options.beforeStep?.(now, action);
    if (!actor.alive && (action.weapon !== 'arqueiro' || start < action.windupMs)) { action.result = { kind: 'cancelled', atMs: start }; break; }
    if (now < action.windupMs) continue;
    action.phase = 'active';
    const current = combatWeaponPoint(action, now);
    const hits = [];
    for (const target of candidates) {
      if ((!structure && (!target.alive || target.restingStructureId != null))
        || target.kingdomId === actor.kingdomId || action.hitTargets.includes(target.id)) continue;
      if (!structure && action.weapon !== 'arqueiro' && !!target.towerMounted !== !!actor.towerMounted) continue;
      const radius = structure ? (options.targetRadius ?? .8) : BODY_RADIUS;
      const height = action.weapon === 'arqueiro'
        ? action.sourceElevation + (action.targetElevation - action.sourceElevation)
          * Math.min(1, Math.max(0, (now - action.windupMs) / action.flightMs)) : action.sourceElevation;
      if (!structure && Math.abs(height - (target.towerMounted ? 3 : 0)) > .65) continue;
      const fx = target.militaryFacingX ?? 1, fy = target.militaryFacingY ?? 0, length = Math.hypot(fx, fy) || 1;
      const guardCenter = { x: target.x + fx / length * .42, y: target.y + fy / length * .42 };
      const canGuard = !structure && options.guarding?.has(target.id) && frontGuard(target, action.origin)
        && (target.militaryClass === 'guerreiro' || target.militaryClass === 'lanceiro' && action.weapon !== 'arqueiro');
      const guardFraction = canGuard ? segmentCircle(previous, current, guardCenter,
        (target.militaryClass === 'guerreiro' ? .4 : .25) + profile.radius) : null;
      let fraction = segmentCircle(previous, current, target, radius + profile.radius);
      let guarding = guardFraction != null && (fraction == null || guardFraction <= fraction);
      if (guarding) fraction = guardFraction;
      let point = fraction == null ? null : { x: previous.x + (current.x - previous.x) * fraction,
        y: previous.y + (current.y - previous.y) * fraction };
      // The sword blade occupies its length, while a spear only hits with its tip.
      if (action.weapon === 'guerreiro') {
        // Sweep the entire blade, including the inner arc between fixed samples.
        const previousAngle = Math.atan2(previous.y - action.origin.y, previous.x - action.origin.x);
        const currentAngle = Math.atan2(current.y - action.origin.y, current.x - action.origin.x);
        const delta = Math.atan2(Math.sin(currentAngle - previousAngle), Math.cos(currentAngle - previousAngle));
        for (let i = 0; i <= 16; i++) {
          const angle = previousAngle + delta * i / 16;
          const tip = { x: action.origin.x + Math.cos(angle) * action.reach,
            y: action.origin.y + Math.sin(angle) * action.reach };
          const blade = segmentCircle(action.origin, tip, target, radius + profile.radius);
          const shield = canGuard ? segmentCircle(action.origin, tip, guardCenter,
            (target.militaryClass === 'guerreiro' ? .4 : .25) + profile.radius) : null;
          if (blade != null || shield != null) {
            guarding = shield != null && (blade == null || shield <= blade);
            fraction = guarding ? shield : blade;
            point = { x: action.origin.x + (tip.x - action.origin.x) * fraction,
              y: action.origin.y + (tip.y - action.origin.y) * fraction }; break;
          }
        }
      }
      if (fraction != null) hits.push({ target, fraction, point, guarding });
    }
    hits.sort((a, b) => a.fraction - b.fraction || a.target.id - b.target.id);
    if (hits.length) {
      const { target, point, guarding } = hits[0];
      const normalLength = Math.hypot(point.x - target.x, point.y - target.y) || 1;
      action.hitTargets.push(target.id);
      action.result = { kind: structure ? 'structure' : guarding
        ? target.militaryClass === 'guerreiro' ? 'shield' : 'weapon-guard' : 'body',
      targetId: target.id, atMs: now, point,
      normal: { x: (point.x - target.x) / normalLength, y: (point.y - target.y) / normalLength },
      damageApplied: applyDamage(target, guarding), fatal: !structure && !target.alive };
      if (guarding) {
        target.militaryAnimation = 'defend'; target.militaryAnimationDay = action.day;
        target.combatDefense = { actionId: action.id, day: action.day, atMs: now, kind: action.result.kind };
      }
      break; // Single-target attacks; no cleave or friendly fire.
    }
    previous = current;
  }
  action.result ??= { kind: 'miss', atMs: end };
  action.phase = 'complete';
  // Bounded diagnostic/event history, separate from economic entity IDs and RNG.
  world.combatEvents ??= [];
  world.combatEvents.push({ ...action, hitTargets: [...action.hitTargets] });
  world.combatEvents = world.combatEvents.slice(-128);
  return action.result;
}
