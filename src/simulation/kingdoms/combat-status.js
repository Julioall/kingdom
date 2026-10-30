export function isCombatStunned(person, day, nowMs) {
  if (Number.isFinite(nowMs) && Number.isFinite(person?.combatStunnedUntilMs))
    return nowMs < person.combatStunnedUntilMs;
  return Number.isFinite(person?.combatDisarmedUntilDay) && day < person.combatDisarmedUntilDay;
}

export function stunCombatPerson(world, person, sourceId, durationMs = 3000) {
  person.combatStunnedUntilMs = Math.max(person.combatStunnedUntilMs || 0, (world.magicTimeMs || 0) + durationMs);
  person.combatDisarmedUntilDay = Math.max(person.combatDisarmedUntilDay || 0, world.day + 2);
  person.combatDisarmedById = sourceId;
  person.combatCombo = null; person.combatOpening = null;
  person.playerCommand = null; person.playerCommandQueue = [];
  person.playerFlurryUntil = 0; person.playerMovementLockedUntil = 0;
  person.playerDefending = false; person.playerHealing = false;
  person.combatDefense = null;
  person.militaryAnimation = 'defend'; person.militaryAnimationDay = world.day;
}
