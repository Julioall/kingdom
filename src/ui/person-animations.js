import { getAnimationFrame } from './animations.js';

function carriedSprite(person) {
  if ((person.carriedMeat || 0) > .01) return 'meat';
  if ((person.carriedGold || 0) > .01) return 'gold';
  if ((person.carriedWood || 0) > .01) return 'wood';
  return null;
}

export function residentSpritePose(person, pose, day) {
  const state = String(person.state || '').toLowerCase();
  const action = person.brain?.lastAction;
  const activity = person.visualActivity?.day === day ? person.visualActivity : null;
  const cargo = carriedSprite(person);
  const tool = activity?.tool || (activity?.kind === 'mine' || state.startsWith('extraindo ') || state === 'minerando rocha' ? 'pickaxe'
    : activity?.kind === 'chop' || state === 'derrubando árvore' ? 'axe'
      : activity?.kind === 'build' || state.startsWith('construindo ') ? 'hammer'
        : ['hunt', 'fish'].includes(activity?.kind) || ['caça sem captura', 'pesca sem captura', 'pescando'].includes(state) ? 'knife' : null);
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
        if (event.weapon === 'arqueiro') {
          const endpoint = event.result?.point || event.aim;
          add('unit.' + palette + '.archer.arrow', event.origin.x, event.origin.y - event.sourceElevation,
            now + event.windupMs, 48, { projectile: true, targetX: endpoint.x,
              targetY: endpoint.y - contactElevation,
              duration: Math.max(1, event.result.atMs - event.windupMs) });
        }
        if (event.result?.point) add('effect.dust-02', event.result.point.x,
          event.result.point.y - contactElevation, now + event.result.atMs, 64);
      }
      const living = new Set();
      for (const person of world.people) {
        if (!person.alive) continue;
        living.add(person.id);
        const old = previous.get(person.id);
        const activity = person.visualActivity;
        const activityKey = activity && `${activity.day}:${activity.kind}:${activity.x}:${activity.y}`;
        if (old) {
          if (person.lastArrowSequence && person.lastArrowSequence !== old.arrowSequence && person.lastArrow && !person.lastArrow.actionId) {
            const arrow = person.lastArrow;
            const palette = world.kingdoms?.find(k => k.id === person.kingdomId)?.palette || 'blue';
            add('unit.' + palette + '.archer.arrow', arrow.x, arrow.y - arrow.elevation, now, 48,
              { projectile: true, targetX: arrow.targetX, targetY: arrow.targetY - arrow.targetElevation,
                duration: Math.max(350, Math.min(850, Math.hypot(arrow.targetX - arrow.x, arrow.targetY - arrow.y) * 55)) });
          }
          if (person.lastHealingSequence && person.lastHealingSequence !== old.healingSequence) {
            const palette = world.kingdoms?.find(k => k.id === person.kingdomId)?.palette || 'blue';
            add('unit.' + palette + '.monk.heal-effect', person.x, person.y, now, 48, { personId: person.id });
          }
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
      effects = effects.slice(-96);
    },
    active(now) {
      effects = effects.filter(effect => effect.projectile ? now - effect.startedAt < effect.duration : !getAnimationFrame(effect.animation, now - effect.startedAt).done);
      return effects.filter(effect => now >= effect.startedAt);
    }
  };
}
