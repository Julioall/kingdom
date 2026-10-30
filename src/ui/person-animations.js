import { DASH_TRAIL_FADE_MS } from './dash-presentation.js';
import { ARROW_RAIN_TIMING } from '../simulation/kingdoms/combat-contact.js';
import { getAnimationFrame } from './animations.js';
import { trainingDummiesForWorld } from '../simulation/world/training-dummies.js';
import { createBloodParticles, BLOOD_EFFECT_DURATION_MS } from './blood-presentation.js';

const DEATH_SPRITE_FRAME_SIZE = 128;
const DEATH_SPRITE_FRAME_COUNT = 7;
const DEATH_TRANSFORM_DURATION_MS = 700;
const DEATH_SKULL_HOLD_DURATION_MS = 10_000;
const DEATH_DISAPPEAR_DURATION_MS = 700;

export function priestCastAnimationPose(world, person, animation) {
  if (!person.alive || person.militaryClass !== 'monge') return null;
  const now = world.magicTimeMs || 0;
  const stepAt = elapsed => Math.floor(Math.max(0, elapsed) * animation.fps / 1000);
  let frame;
  if (person.magicCast) {
    const step = stepAt(now - person.magicCast.startedAt);
    // User-facing frames 4–7 are zero-based indices 3–6. Play the opening
    // once, then hold this four-frame window until authoritative activation.
    frame = step < 3 ? step : 3 + (step - 3) % 4;
  } else {
    const activation = (world.magicEvents || []).findLast(event => event.kind === 'activated'
      && event.casterId === person.id);
    if (!activation || now < activation.at) return null;
    frame = 7 + stepAt(now - activation.at);
    if (frame >= animation.frames) return null;
  }
  return { elapsedMs: (frame + .001) * 1000 / animation.fps, loop: false };
}

function carriedSprite(person) {
  if ((person.carriedMeat || 0) > .01) return 'meat';
  if ((person.carriedGold || 0) > .01) return 'gold';
  if ((person.carriedStone || 0) > .01) return 'stone';
  if ((person.carriedWood || 0) > .01) return 'wood';
  return null;
}

export function residentSpritePose(person, pose, day) {
  const state = String(person.state || '').toLowerCase();
  const action = person.brain?.lastAction;
  const activity = person.visualActivity?.day === day ? person.visualActivity : null;
  const cargo = carriedSprite(person);
  const activityTool = activity?.kind === 'mine' ? 'pickaxe'
    : activity?.kind === 'chop' ? 'axe'
      : activity?.kind === 'build' ? 'hammer'
        : ['hunt', 'fish'].includes(activity?.kind) ? 'knife' : null;
  const stateTool = cargo ? null : state.startsWith('extraindo ') || state === 'minerando rocha' ? 'pickaxe'
    : state === 'derrubando árvore' ? 'axe'
      : state.startsWith('construindo ') ? 'hammer'
        : ['caça sem captura', 'pesca sem captura', 'pescando'].includes(state) ? 'knife' : null;
  const tool = activity?.tool || activityTool || stateTool;
  // A day's extraction can produce a load before its work animation is shown.
  // While stationary, show the actual work first; in motion, show its cargo.
  const interaction = !pose.moving && tool;
  const equipped = action === 'build' ? 'hammer' : action === 'hunt' ? 'knife'
    : action === 'gather' ? (state.includes('pedra') || state.includes('ouro') ? 'pickaxe' : 'axe')
      : (person.carriedStone || 0) > .01 ? 'pickaxe' : null;
  const variant = cargo || tool || equipped;
  const spriteAction = interaction ? 'interact-' + tool : (pose.moving ? 'run' : 'idle') + (variant ? '-' + variant : '');
  const targetDirection = !pose.moving && activity && Number.isFinite(activity.x - person.x) ? activity.x - person.x : 0;
  const direction = targetDirection || pose.dirX || pose.facingX || 1;
  return { action: spriteAction, flip: direction < 0,
    cargoInSprite: interaction ? null : cargo };
}

export function createActorAnimationClock() {
  const actors = new Map();
  return {
    startAt(id, key, start) { actors.set(id, { key, start }); },
    elapsed(id, key, now) {
      let entry = actors.get(id);
      if (!entry || entry.key !== key) {
        entry = { key, start: now };
        actors.set(id, entry);
      }
      return Math.max(0, now - entry.start);
    },
    retain(ids) { for (const id of actors.keys()) if (!ids.has(id)) actors.delete(id); },
    clear() { actors.clear(); }
  };
}

// Compare immutable primitive records: the Worker reuses the WorldView object.
// Render-frame redraws therefore cannot generate duplicate activity effects.
export function createActivityEffects() {
  const previous = new Map();
  let lastCombatEvent = 0;
  let effects = [], nextId = 0;
  function add(animation, x, y, now, pixels, extra = {}) {
    effects.push({ id: ++nextId, animation, x, y, startedAt: now, pixels, ...extra });
  }
  function addArrowProjectile(palette, origin, sourceElevation, endpoint, impactElevation,
    startedAt, flightDuration, arcHeight, arcProgressEnd = 1) {
    const fallDuration = arcHeight > 0 ? 240 : 0, restDuration = 1200;
    add('unit.' + palette + '.archer.arrow', origin.x, origin.y - sourceElevation, startedAt, 96, {
      projectile: true, targetX: endpoint.x, targetY: endpoint.y - impactElevation,
      flightDuration, fallDuration, groundY: endpoint.y + (arcHeight > 0 ? .3 : 0), arcHeight, arcProgressEnd,
      duration: flightDuration + fallDuration + restDuration
    });
  }
  return {
    observe(world, now, reset = false) {
      if (reset) { previous.clear(); effects = []; lastCombatEvent = world.combatSequence || 0; }
      for (const event of world.combatEvents || []) {
        if (event.id <= lastCombatEvent) continue;
        lastCombatEvent = event.id;
        // Batched catch-up should not replay obsolete days as a burst of impacts.
        if (event.day !== world.day || event.result?.kind === 'cancelled') continue;
        const actor = world.people.find(p => p.id === event.actorId);
        const palette = world.kingdoms?.find(k => k.id === actor?.kingdomId)?.palette || 'blue';
        const contactElevation = event.result?.contactElevation ?? event.targetElevation;
        if (event.manualControl) for (const hit of event.hitEvents || []) {
          if (!(hit.damageApplied > 0) || hit.kind === 'training-dummy') continue;
          const target = world.people.find(person => person.id === hit.targetId);
          if (target) add('combat-damage-number', target.x, target.y, now + Math.max(0, hit.atMs || 0), 0,
            { damageNumber: true, damage: hit.damageApplied, duration: 1050 });
        }
        if (event.result?.kind === 'parry' && actor) {
          add('parry-stars', actor.x, actor.y, now + Math.max(0, event.result.atMs || 0), 64,
            { personId: actor.id, duration: 3000 });
        }
        if (['shield-bash', 'lance-charge'].includes(event.attackVariant)) {
          for (const hit of event.hitEvents || []) {
            if (hit.parried || !['body', 'shield', 'weapon-guard'].includes(hit.kind)) continue;
            const victim = world.people.find(person => person.id === hit.targetId && person.alive);
            if (victim) {
              add('parry-stars', victim.x, victim.y, now + Math.max(0, hit.atMs || 0) + 600, 64,
                { personId: victim.id, duration: 3000 });
              add('effect.dust-01', victim.x, victim.y, now + Math.max(0, hit.atMs || 0) + 600, 96,
                { duration: 500 });
            }
          }
        }
        if (['lance-charge', 'shield-bash'].includes(event.attackVariant) && actor) {
          const shield = event.attackVariant === 'shield-bash';
          const endPosition = event.endPosition || {
            x: event.origin.x + Math.cos(event.angle) * (event.advanceDistance || (shield ? 5 : 3.5)),
            y: event.origin.y + Math.sin(event.angle) * (event.advanceDistance || (shield ? 5 : 3.5))
          };
          const dashDistance = Math.hypot(endPosition.x - event.origin.x, endPosition.y - event.origin.y);
          const activeDuration = event.activeMs || (shield ? 450 : 780);
          add(shield ? 'shield-dash' : 'lance-dash', event.origin.x, event.origin.y, now + event.windupMs, 64,
            { personId: actor.id, angle: event.angle, advanceDistance: event.advanceDistance,
              endX: endPosition.x, endY: endPosition.y, dashDistance, activeDuration,
              duration: activeDuration + DASH_TRAIL_FADE_MS });
          const dustCount = Math.max(2, Math.ceil(dashDistance / .65));
          for (let index = 1; index <= dustCount; index++) {
            const progress = index / dustCount;
            const timeProgress = shield ? Math.sqrt(progress) : progress;
            add('effect.dust-01', event.origin.x + (endPosition.x - event.origin.x) * progress,
              event.origin.y + (endPosition.y - event.origin.y) * progress,
              now + event.windupMs + activeDuration * timeProgress, 96, { duration: 800 });
          }
        }
        if (event.weapon === 'arqueiro') {
          if (event.attackVariant === 'rain') {
            const center = event.aim;
            const launchAt = now + event.windupMs;
            const { ascentMs, descentMs, skyHeight } = ARROW_RAIN_TIMING;
            const sourceY = event.origin.y - (event.sourceElevation || 0) - .6;
            add('unit.' + palette + '.archer.arrow', event.origin.x, sourceY, launchAt, 96, {
              projectile: true, rainSignal: true, targetX: event.origin.x, targetY: sourceY - skyHeight,
              flightDuration: ascentMs, duration: ascentMs, arcHeight: 0
            });
            const count = event.arrowCount || 24;
            const rainDuration = event.rainDurationMs || 3000;
            const radius = event.areaRadius || 2.8;
            const phase = (event.id % 17) * .11;
            for (let index = 0; index < count; index++) {
              const angle = phase + index * 2.399963229728653;
              const distanceFromCenter = radius * Math.sqrt((index + .5) / count);
              const endpoint = { x: center.x + Math.cos(angle) * distanceFromCenter,
                y: center.y + Math.sin(angle) * distanceFromCenter };
              const launchOffset = count > 1 ? rainDuration * index / (count - 1) : 0;
              const skyOrigin = { x: endpoint.x, y: endpoint.y - skyHeight };
              addArrowProjectile(palette, skyOrigin, 0, endpoint, 0,
                launchAt + ascentMs + launchOffset, descentMs, 0);
            }
          } else if (event.attackVariant === 'cone') {
            const centerDistance = Math.hypot(event.aim.x - event.origin.x, event.aim.y - event.origin.y);
            const count = event.arrowCount || 3;
            const halfAngle = event.halfAngle ?? .22;
            for (let index = 0; index < count; index++) {
              const spread = count > 1 ? ((index / (count - 1)) * 2 - 1) * halfAngle : 0;
              const angle = event.angle + spread;
              let endpoint = { x: event.origin.x + Math.cos(angle) * centerDistance,
                y: event.origin.y + Math.sin(angle) * centerDistance };
              const isCenterShot = Math.abs(spread) < 1e-6;
              if (isCenterShot && event.result?.point) endpoint = event.result.point;
              const flightDuration = isCenterShot && Number.isFinite(event.result?.atMs)
                ? Math.max(1, event.result.atMs - event.windupMs)
                : Math.max(100, Math.min(850, centerDistance * 55));
              addArrowProjectile(palette, event.origin, event.sourceElevation, endpoint,
                isCenterShot ? contactElevation : 0,
                now + event.windupMs, flightDuration, 0);
            }
          } else {
            const endpoint = event.result?.point || event.aim;
            const flightDuration = Math.max(1, event.result.atMs - event.windupMs);
            const arcProgressEnd = Math.max(0, Math.min(1, flightDuration / (event.flightMs || flightDuration)));
            addArrowProjectile(palette, event.origin, event.sourceElevation, endpoint, contactElevation,
              now + event.windupMs, flightDuration, event.arcHeight || 0, arcProgressEnd);
          }
        }
        if (event.targetKind === 'training-dummy') {
          const dummy = trainingDummiesForWorld(world).find(item => item.id === event.targetId);
          if (dummy) {
            for (const hit of event.hitEvents || []) {
              if (hit.targetId !== dummy.id || !(hit.damageApplied > 0)) continue;
              add('training-dummy-damage', dummy.x, dummy.y, now + hit.atMs, 0,
                { trainingDummyDamage: true, damage: hit.damageApplied, duration: 1050 });
            }
          }
        }
        if (event.hitEvents?.length) {
          for (const hit of event.hitEvents) {
            if (hit.kind === 'parry') continue;
            add('effect.dust-02', hit.point.x, hit.point.y - contactElevation, now + hit.atMs, 64);
            if (hit.damageApplied > 0 && !['shield-bash', 'lance-charge'].includes(event.attackVariant)
                && world.people.some(person => person.id === hit.targetId)) {
              const angle = event.attackVariant === 'rain' ? Math.PI / 2
                : Number.isFinite(event.angle) ? event.angle
                  : Math.atan2(hit.point.y - event.origin.y, hit.point.x - event.origin.x);
              add('combat-blood', hit.point.x, hit.point.y - (contactElevation || 0), now + hit.atMs, 0,
                { blood: true, duration: BLOOD_EFFECT_DURATION_MS,
                  particles: createBloodParticles(event.id * 73856093 + hit.targetId, angle, hit.damageApplied) });
            }
            if (event.attackVariant === 'shield-bash')
              add('effect.explosion-01', hit.point.x, hit.point.y - contactElevation, now + hit.atMs, 128,
                { duration: 360 });
          }
        } else if (event.result?.point && event.result.kind !== 'parry') add('effect.dust-02', event.result.point.x,
          event.result.point.y - contactElevation, now + event.result.atMs, 64);
      }
      const living = new Set();
      for (const person of world.people) {
        const old = previous.get(person.id);
        if (!person.alive) {
          if (old) add('person-death', person.x, person.y, now, DEATH_SPRITE_FRAME_SIZE, {
            deathAnimation: true, frameCount: DEATH_SPRITE_FRAME_COUNT,
            transformDurationMs: DEATH_TRANSFORM_DURATION_MS,
            skullHoldDurationMs: DEATH_SKULL_HOLD_DURATION_MS,
            disappearDurationMs: DEATH_DISAPPEAR_DURATION_MS,
            duration: DEATH_TRANSFORM_DURATION_MS + DEATH_SKULL_HOLD_DURATION_MS + DEATH_DISAPPEAR_DURATION_MS
          });
          continue;
        }
        living.add(person.id);
        const activity = person.visualActivity;
        const activityKey = activity && `${activity.day}:${activity.kind}:${activity.x}:${activity.y}`;
        if (old) {
          if (person.lastArrowSequence && person.lastArrowSequence !== old.arrowSequence && person.lastArrow && !person.lastArrow.actionId) {
            const arrow = person.lastArrow;
            const palette = world.kingdoms?.find(k => k.id === person.kingdomId)?.palette || 'blue';
            const flightDuration = Math.max(350, Math.min(850,
              Math.hypot(arrow.targetX - arrow.x, arrow.targetY - arrow.y) * 55));
            const arcHeight = arrow.arcHeight ?? Math.min(1.7,
              .45 + Math.hypot(arrow.targetX - arrow.x, arrow.targetY - arrow.y) * .15);
            addArrowProjectile(palette, { x: arrow.x, y: arrow.y }, arrow.elevation,
              { x: arrow.targetX, y: arrow.targetY }, arrow.targetElevation, now,
              flightDuration, arcHeight);
          }
          // Healing visuals are supplied by the native ground magic seals.
          if (activity?.day === world.day && activityKey !== old.activityKey) {
            if (['chop', 'mine', 'build'].includes(activity.kind)) add('effect.dust-02', activity.x, activity.y, now, 64);
            if (['drink', 'fish'].includes(activity.kind)) add('effect.water-splash', activity.x, activity.y, now, 128);
          }
          const dx = person.x - old.x, dy = person.y - old.y;
          const tile = world.tiles[Math.round(person.y) * world.width + Math.round(person.x)];
          if (Math.hypot(dx, dy) > .1 && tile?.terrain === 'land') add('effect.dust-01', old.x, old.y, now, 96);
          if (!person.combatAction && person.militaryAnimation !== 'heal' && person.militaryAnimationDay === world.day && person.militaryAnimationDay !== old.battleDay) {
            add('effect.dust-02', person.x, person.y, now, 64);
          }
        }
        previous.set(person.id, { x: person.x, y: person.y, activityKey, battleDay: person.militaryAnimationDay,
          healingSequence: person.lastHealingSequence, arrowSequence: person.lastArrowSequence });
      }
      for (const id of previous.keys()) if (!living.has(id)) previous.delete(id);
      const deathEffects = effects.filter(effect => effect.deathAnimation);
      effects = [...effects.filter(effect => !effect.deathAnimation).slice(-96), ...deathEffects];
    },
    active(now) {
      effects = effects.filter(effect => Number.isFinite(effect.duration)
        ? now - effect.startedAt < effect.duration
        : !getAnimationFrame(effect.animation, now - effect.startedAt).done);
      return effects.filter(effect => now >= effect.startedAt);
    }
  };
}
