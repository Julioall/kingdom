import { SPELLS, equippedSpells, availableSpells } from './catalog.js';
import { MAGIC_EFFECTS, applyMagicEffect, magicIncapacitated, removeMagicEffects, magicModifiers } from './effects.js';
import { changePersonHealth, killPerson } from '../individuals/lifecycle.js';
import { initializeCombatResources } from '../kingdoms/combat-resources.js';
import { isCombatTargetEligible } from '../kingdoms/combat-contact.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const usable = person => person.alive && person.restingStructureId == null;
const hostile = (caster, spell) => spell.kind === 'debuff' || spell.kind === 'dispel';
const sameSide = (a, b) => a.kingdomId != null && a.kingdomId === b.kingdomId || a.id === b.id;

function record(world, event) {
  world.magicSequence = (world.magicSequence || 0) + 1;
  (world.magicEvents ||= []).push({ id: world.magicSequence, at: world.magicTimeMs || 0, ...event });
  if (world.magicEvents.length > 64) world.magicEvents.shift();
}
function metrics(world) {
  return world.magicStats ||= { casts: 0, cancelled: 0, manaSpent: 0, healing: 0, poisonDamage: 0,
    effectsApplied: 0, cleansed: 0, dispelled: 0 };
}
function validTarget(world, caster, target, spell) {
  return usable(target) && (hostile(caster, spell)
    ? !sameSide(caster, target) && isCombatTargetEligible(world, caster, target, world.day)
    : sameSide(caster, target));
}

export function configureMagicLoadout(person, ids, role = null) {
  if (person.militaryClass !== 'monge' || !Array.isArray(ids) || !ids.length || ids.length > 5
      || new Set(ids).size !== ids.length || ids.some(id => !availableSpells(person).includes(id))) return false;
  person.magicSpells = ids.slice();
  if (role) person.magicRole = role;
  return true;
}

export function beginSpell(world, caster, spellId, { targetId = null, x, y } = {}) {
  const spell = SPELLS[spellId], now = world.magicTimeMs || 0;
  if (!spell || caster?.role !== 'soldier' || caster.militaryClass !== 'monge'
      || magicIncapacitated(caster, world.day, world.magicTimeMs || 0) || caster.magicCast || !equippedSpells(caster).includes(spellId))
    return { ok: false, reason: 'spell-unavailable' };
  if ((caster.magicReadyAt || 0) > now || (caster.magicCooldowns?.[spellId] || 0) > now) return { ok: false, reason: 'spell-cooldown' };
  initializeCombatResources(caster);
  if (caster.mana < spell.mana) return { ok: false, reason: 'not-enough-mana' };
  const target = targetId == null ? null : world.people.find(person => person.id === targetId);
  if (targetId != null && (!target || !validTarget(world, caster, target, spell))) return { ok: false, reason: 'invalid-target' };
  const position = target || { x, y };
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)
      || position.x < 0 || position.y < 0 || position.x >= world.width || position.y >= world.height
      || distance(caster, position) > spell.range + 1e-6) return { ok: false, reason: 'out-of-range' };
  if (!spell.radius && !target) return { ok: false, reason: 'target-required' };
  caster.mana -= spell.mana;
  (caster.magicCooldowns ||= {})[spellId] = now + spell.castMs + spell.cooldownMs;
  caster.magicReadyAt = now + spell.castMs + 1500;
  caster.magicCast = { spellId, startedAt: now, completesAt: now + spell.castMs,
    targetId: spell.radius ? null : target?.id ?? null, x: position.x, y: position.y,
    originX: caster.x, originY: caster.y };
  caster.militaryAnimation = 'heal'; caster.militaryAnimationDay = world.day;
  caster.militaryFacingX = position.x - caster.x; caster.militaryFacingY = position.y - caster.y;
  caster.state = 'conjurando ' + spell.name;
  metrics(world).casts++; metrics(world).manaSpent += spell.mana;
  record(world, { kind: 'cast', spellId, casterId: caster.id,
    targetId: caster.magicCast.targetId, x: position.x, y: position.y });
  return { ok: true, cast: caster.magicCast };
}

export function cancelSpell(world, caster, reason = 'interrupted') {
  if (!caster.magicCast) return false;
  const cast = caster.magicCast;
  caster.magicCast = null; caster.playerHealing = false;
  caster.militaryAnimation = 'idle'; caster.state = 'conjuração interrompida';
  metrics(world).cancelled++;
  record(world, { kind: 'cancelled', spellId: cast.spellId, casterId: caster.id, reason });
  return true;
}

function completeSpell(world, caster, cast, changed) {
  const spell = SPELLS[cast.spellId], now = world.magicTimeMs;
  const target = cast.targetId == null ? null : world.people.find(person => person.id === cast.targetId);
  if (cast.targetId != null && (!target || !validTarget(world, caster, target, spell)
      || distance(caster, target) > spell.range)) { cancelSpell(world, caster, 'target-lost'); return; }
  const center = target || cast;
  const targets = world.people.filter(person => validTarget(world, caster, person, spell)
    && (spell.radius ? distance(person, center) <= spell.radius : person.id === cast.targetId))
    .sort((a, b) => (spell.kind === 'heal' ? a.health - b.health : distance(a, center) - distance(b, center)) || a.id - b.id)
    .slice(0, spell.maxTargets);
  caster.magicCast = null;
  if (spell.kind === 'area') {
    world.magicZoneSequence = (world.magicZoneSequence || 0) + 1;
    (world.magicZones ||= []).push({ id: world.magicZoneSequence,
      spellId: spell.id, sourceId: caster.id, kingdomId: caster.kingdomId, x: center.x, y: center.y,
      radius: spell.radius, intensity: spell.intensity, startedAt: now, expiresAt: now + spell.durationMs });
  }
  for (const person of targets) {
    if (spell.heal) {
      const restored = changePersonHealth(world, person, spell.heal * 100, 'cleric-healing');
      metrics(world).healing += restored * (person.maxCombatHealth || 100) / 100;
      caster.magicHealingDone = (caster.magicHealingDone || 0) + restored * (person.maxCombatHealth || 100) / 100;
      if (restored > 0) {
        person.lastHealingSequence = (person.lastHealingSequence || 0) + 1;
        person.lastHealing = { day: world.day, casterId: caster.id, healthRestored: restored, primaryTargetId: target?.id };
      }
    }
    if (spell.effect) {
      if (applyMagicEffect(person, spell.effect, { now, intensity: spell.intensity,
        durationMs: spell.durationMs, sourceId: caster.id, spellId: spell.id, color: spell.color })) metrics(world).effectsApplied++;
    }
    if (spell.kind === 'cleanse') metrics(world).cleansed += removeMagicEffects(person, 'debuff');
    if (spell.kind === 'dispel') metrics(world).dispelled += removeMagicEffects(person, 'buff');
    changed.add(person);
  }
  caster.lastHealingCast = spell.kind === 'heal' ? { day: world.day, primaryTargetId: target?.id,
    recipientIds: targets.map(person => person.id) } : caster.lastHealingCast;
  caster.state = 'conjurou ' + spell.name;
  caster.militaryAnimation = 'idle';
  caster.militaryMerit = (caster.militaryMerit || 0) + targets.length * .1;
  record(world, { kind: 'activated', spellId: spell.id, casterId: caster.id, x: center.x, y: center.y,
    targetIds: targets.map(person => person.id) });
}

function targetScore(world, caster, spell, target, allies, enemies) {
  const hpMissing = 100 - target.health;
  const nearby = list => list.filter(person => distance(person, target) <= Math.max(.1, spell.radius));
  const affected = spell.radius ? nearby(hostile(caster, spell) ? enemies : allies) : [target];
  const fresh = affected.filter(person => !(person.magicEffects || []).some(effect => effect.id === spell.effect
    && effect.expiresAt - world.magicTimeMs > spell.durationMs * .35));
  const enemyNear = enemies.filter(person => distance(person, target) <= 6).length;
  switch (spell.id) {
    case 'heal': return hpMissing >= 5 ? hpMissing * .8 + (target.health < 35 ? 45 : 0) : 0;
    case 'area-heal': return affected.filter(person => person.health < 88).length >= 2
      ? affected.reduce((sum, person) => sum + Math.min(20, 100 - person.health), 0) * 1.2 : 0;
    case 'greater-heal': return affected.filter(person => person.health < 65).length >= 4
      ? affected.reduce((sum, person) => sum + Math.min(30, 100 - person.health), 0) : 0;
    case 'regeneration': return hpMissing > 12 && fresh.length && enemyNear ? 22 + hpMissing * .3 : 0;
    case 'fortitude': return enemyNear ? fresh.filter(person => (person.stamina ?? 400) < 260).length * 14 : 0;
    case 'haste': return enemyNear ? fresh.length * 7 : 0;
    case 'blessed-weapons': return enemyNear ? fresh.filter(person => person.militaryClass !== 'monge').length * 10 : 0;
    case 'protection': return enemyNear ? fresh.filter(person => person.health < 85).length * 15 : 0;
    case 'weakness': return affected.some(person => allies.some(ally => distance(ally, person) < 4)) ? fresh.length * 10 : 0;
    case 'slow': return fresh.filter(person => person.militaryClass !== 'arqueiro' && person.militaryClass !== 'monge').length * 10;
    case 'exhaustion': return fresh.filter(person => (person.stamina ?? 400) < 220).length * 13;
    case 'curse': return enemies.some(person => person.militaryClass === 'monge' && distance(person, target) < 7)
      ? fresh.filter(person => person.health < 85).length * 19 : 0;
    case 'poison': return fresh.length * 9;
    case 'purify': return affected.reduce((sum, person) => sum + (person.magicEffects || [])
      .filter(effect => MAGIC_EFFECTS[effect.id]?.cleansable).length * 25, 0);
    case 'dispel': return affected.reduce((sum, person) => sum + (person.magicEffects || [])
      .filter(effect => MAGIC_EFFECTS[effect.id]?.dispellable).length * 20, 0);
    case 'sanctuary': return enemyNear >= 2 && affected.length >= 3
      && !(world.magicZones || []).some(zone => zone.kingdomId === caster.kingdomId && distance(zone, target) < spell.radius)
      ? Math.min(60, affected.length * 10) : 0;
    default: return 0;
  }
}

export function chooseMagicAction(world, caster) {
  if (magicIncapacitated(caster, world.day, world.magicTimeMs || 0) || caster.magicCast || caster.playerControlled
      || (caster.magicReadyAt || 0) > (world.magicTimeMs || 0)) return null;
  const general = world.people.find(person => person.id === caster.generalId);
  const campaign = (world.campaigns || []).find(item => item.id === caster.campaignId);
  const side = campaign && [campaign.attacker, campaign.defender].find(item => item.kingdomId === caster.kingdomId);
  const orders = caster.magicOrders || side?.magicOrders || general?.magicOrders;
  if (orders?.holdFire) return null;
  const local = world.people.filter(person => usable(person) && distance(person, caster) <= 10);
  const allies = local.filter(person => sameSide(caster, person));
  const enemies = local.filter(person => !sameSide(caster, person)
    && isCombatTargetEligible(world, caster, person, world.day));
  let best = null;
  for (const id of equippedSpells(caster)) {
    const spell = SPELLS[id];
    if ((caster.mana ?? 200) < spell.mana || (caster.magicCooldowns?.[id] || 0) > (world.magicTimeMs || 0)) continue;
    const targets = hostile(caster, spell) ? enemies : allies;
    for (const target of targets) {
      if (distance(caster, target) > spell.range) continue;
      let score = targetScore(world, caster, spell, target, allies, enemies);
      if (score <= 0) continue;
      if (orders?.preferredSpells?.includes(id)) score *= 1.3;
      if (orders?.targetId === target.id) score *= 1.2;
      // Mana efficiency matters when reserves run low; no fixed spell sequence.
      score *= Math.min(1, (caster.mana ?? 200) / (spell.mana * 2));
      if (!best || score > best.score) best = { spellId: id, targetId: target.id, score };
    }
  }
  return best;
}

export function updatePriestDecisions(world) {
  for (const caster of world.people) {
    if (caster.role !== 'soldier' || caster.militaryClass !== 'monge' || !usable(caster)) continue;
    const decision = chooseMagicAction(world, caster);
    if (decision) beginSpell(world, caster, decision.spellId, decision);
  }
}

export function magicHasActivity(world) {
  return !!world.magicZones?.length || world.people.some(person => person.magicCast
    || person.combatStunnedUntilMs != null
    || person.playerHealing || person.magicEffects?.length || person.alive && person.militaryClass === 'monge');
}

function advanceMagicStep(world, elapsedMs, changed) {
  world.magicTimeMs = (world.magicTimeMs || 0) + elapsedMs;
  const now = world.magicTimeMs;
  world.magicZones = (world.magicZones || []).filter(zone => zone.expiresAt > now);
  for (const person of world.people) {
    if (person.combatStunnedUntilMs != null && person.combatStunnedUntilMs <= now) {
      delete person.combatStunnedUntilMs;
      delete person.combatDisarmedUntilDay; delete person.combatDisarmedById;
      person.combatLaunch = null;
      if (person.alive) { person.militaryAnimation = 'idle'; person.state = 'retomando combate'; }
      changed.add(person);
    }
    if (person.magicCast) {
      const cast = person.magicCast;
      if (magicIncapacitated(person, world.day, world.magicTimeMs || 0) || person.militaryClass !== 'monge'
          || !equippedSpells(person).includes(cast.spellId)
          || distance(person, { x: cast.originX, y: cast.originY }) > .75)
        cancelSpell(world, person);
      else if (now >= cast.completesAt) completeSpell(world, person, cast, changed);
      if (person.magicCast !== cast) changed.add(person);
    }
    const effects = person.magicEffects;
    if (effects?.length) {
      person.magicTimeMs = now;
      for (const effect of effects) {
        const until = Math.min(now, effect.expiresAt);
        const ticks = Math.max(0, Math.floor((until - effect.lastTickAt) / 1000));
        if (ticks && person.alive && MAGIC_EFFECTS[effect.id]?.periodic) {
          effect.lastTickAt += ticks * 1000;
          const amount = Math.min(100, effect.intensity * ticks * 100);
          const applied = changePersonHealth(world, person,
            effect.id === 'poison' ? -amount : amount,
            effect.id === 'poison' ? 'magic-poison' : 'cleric-regeneration');
          metrics(world)[effect.id === 'poison' ? 'poisonDamage' : 'healing'] += Math.abs(applied) * (person.maxCombatHealth || 100) / 100;
          const source = world.people.find(caster => caster.id === effect.sourceId);
          if (source) {
            const field = effect.id === 'poison' ? 'combatDamageDealt' : 'magicHealingDone';
            source[field] = (source[field] || 0) + Math.abs(applied) * (person.maxCombatHealth || 100) / 100;
          }
          if (effect.id === 'poison' && applied < 0) {
            person.lastAttackedById = effect.sourceId; person.lastAttackedDay = world.day;
          }
          if (person.health <= 0) killPerson(world, person, 'combat');
          changed.add(person);
        }
      }
      if (!person.alive || effects.some(effect => effect.expiresAt <= now)) {
        person.magicEffects = person.alive ? effects.filter(effect => effect.expiresAt > now) : [];
        changed.add(person);
      }
    }
    if (person.playerHealing && !person.magicCast) {
      const candidates = world.people.filter(ally => usable(ally) && sameSide(person, ally) && ally.health < 99.999
        && distance(person, ally) <= 6).sort((a, b) => a.health - b.health || a.id - b.id);
      const target = candidates.find(ally => ally.id === person.playerHealingTargetId) || candidates[0];
      if (!target || magicIncapacitated(person, world.day, world.magicTimeMs || 0)) person.playerHealing = false;
      else beginSpell(world, person, equippedSpells(person)[0], { targetId: target.id });
      if (!person.playerHealing || person.magicCast) changed.add(person);
    }
    if (!person.alive) { person.magicCast = null; person.playerHealing = false; }
  }
}

export function advanceMagic(world, elapsedMs) {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs > 60000) throw new Error('Invalid magic time step');
  const changed = new Set();
  let remaining = elapsedMs;
  // Keep ordering consistent for fast-forward, periodic effects and interrupted casts.
  do {
    const step = Math.min(100, remaining);
    advanceMagicStep(world, step, changed);
    remaining -= step;
  } while (remaining > 0);
  return [...changed];
}
