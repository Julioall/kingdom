import { zoneRecipients } from '../kingdoms/ability-progression.js';
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
export const MAGIC_EFFECTS = Object.freeze({
  regeneration: { category: 'buff', dispellable: true, periodic: true },
  fortitude: { category: 'buff', dispellable: true },
  haste: { category: 'buff', dispellable: true },
  'blessed-weapons': { category: 'buff', dispellable: true },
  protection: { category: 'buff', dispellable: true },
  weakness: { category: 'debuff', cleansable: true },
  slow: { category: 'debuff', cleansable: true },
  exhaustion: { category: 'debuff', cleansable: true },
  curse: { category: 'debuff', cleansable: true },
  poison: { category: 'debuff', cleansable: true, periodic: true }
});

export function applyMagicEffect(target, id, { now, durationMs, intensity, sourceId, spellId, color }) {
  if (!MAGIC_EFFECTS[id] || !target.alive || !Number.isFinite(now) || !Number.isFinite(durationMs)
      || !Number.isFinite(intensity) || intensity < 0 || !(durationMs > 0)) return false;
  const effects = target.magicEffects ||= [];
  const prior = effects.find(effect => effect.id === id && effect.expiresAt > now);
  target.magicTimeMs = now;
  if (prior) {
    // Refresh, never sum. The stronger application survives; periodic cadence is preserved.
    prior.intensity = Math.max(prior.intensity, clamp(intensity, 0, .8));
    prior.expiresAt = Math.max(prior.expiresAt, now + durationMs);
    prior.sourceId = sourceId; prior.spellId = spellId; prior.color = color;
  } else {
    target.magicEffects = effects.filter(effect => effect.id !== id);
    target.magicEffects.push({ id, sourceId, spellId, color, intensity: clamp(intensity, 0, .8),
      startedAt: now, expiresAt: now + durationMs, lastTickAt: now });
  }
  return true;
}

export function removeMagicEffects(person, category) {
  if (!['buff', 'debuff'].includes(category)) return 0;
  const before = person.magicEffects || [];
  person.magicEffects = before.filter(effect => category === 'debuff'
    ? !MAGIC_EFFECTS[effect.id]?.cleansable : !MAGIC_EFFECTS[effect.id]?.dispellable);
  return before.length - person.magicEffects.length;
}

export function magicModifiers(person, world = null) {
  let stamina = 1, speed = 1, damage = 1, incoming = 1, healing = 1;
  const now = world?.magicTimeMs ?? person?.magicTimeMs ?? 0;
  for (const effect of person?.magicEffects || []) {
    if (effect.expiresAt <= now) continue;
    const value = clamp(effect.intensity, 0, .8);
    switch (effect.id) {
      case 'fortitude': stamina *= 1 - value; break;
      case 'exhaustion': stamina *= 1 + value; break;
      case 'haste': speed *= 1 + value; break;
      case 'slow': speed *= 1 - value; break;
      case 'blessed-weapons': damage *= 1 + value; break;
      case 'weakness': damage *= 1 - value; break;
      case 'protection': incoming *= 1 - value; break;
      case 'curse': healing *= 1 - value; break;
    }
  }
  let sanctuary = 0;
  for (const zone of world?.magicZones || []) {
    if (zone.expiresAt > now && zone.kingdomId === person.kingdomId
      && Math.hypot(person.x - zone.x, person.y - zone.y) <= zone.radius
      && zoneRecipients(world, zone).some(occupant => occupant.id === person.id))
      sanctuary = Math.max(sanctuary, zone.intensity);
  }
  return { stamina: clamp(stamina, .25, 2), speed: clamp(speed, .35, 1.5),
    damage: clamp(damage, .4, 1.6), incoming: clamp(incoming * (1 - sanctuary), .5, 1.5),
    healing: clamp(healing, .1, 1.5) };
}

export function magicIncapacitated(person, day, nowMs) {
  return !person?.alive || person.restingStructureId != null
    || (Number.isFinite(nowMs) && Number.isFinite(person.combatStunnedUntilMs)
      ? nowMs < person.combatStunnedUntilMs
      : Number.isFinite(person.combatDisarmedUntilDay) && day < person.combatDisarmedUntilDay)
    || person.magicSilenced === true;
}
