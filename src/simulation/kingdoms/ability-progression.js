// Earned service levels and completed training are independent of command rank.
// Training alone reaches level 5; levels 6–7 require combat promotions.
export function abilityLevel(person) {
  const service = Number.isFinite(person?.militaryLevel) ? person.militaryLevel : 1;
  const training = Number.isFinite(person?.militaryTraining) ? person.militaryTraining : 0;
  return Math.max(1, Math.min(7, Math.max(Math.floor(service), 1 + Math.floor(Math.max(0, Math.min(1, training)) * 4))));
}

export const ABILITY_REQUIREMENTS = Object.freeze({
  combo: 2, 'shield-bash': 4, 'lance-flurry': 3, 'lance-charge': 4,
  standard: 1, cone: 3, charged: 4, rain: 5,
  heal: 1, regeneration: 2, slow: 2, fortitude: 2,
  'area-heal': 3, haste: 3, weakness: 3, purify: 3, protection: 3,
  'blessed-weapons': 4, exhaustion: 4, poison: 4, dispel: 4,
  curse: 5, 'greater-heal': 6, sanctuary: 6
});

export const canUseAbility = (person, id) => abilityLevel(person) >= (ABILITY_REQUIREMENTS[id] ?? Infinity);

// A recruit reaches at most two units; veterans grow one target per level.
export const abilityTargetLimit = (person, ceiling = 7) => Math.min(7, ceiling, abilityLevel(person) + 1);

// Ground zones keep their position, but allocate their limited slots to the
// nearest living occupants. Shared by gameplay and VFX so both agree.
export function zoneRecipients(world, zone) {
  return world.people.filter(person => person.alive && person.restingStructureId == null
    && zone.kingdomId != null && person.kingdomId === zone.kingdomId
    && Math.hypot(person.x - zone.x, person.y - zone.y) <= zone.radius)
    .sort((a, b) => Math.hypot(a.x - zone.x, a.y - zone.y) - Math.hypot(b.x - zone.x, b.y - zone.y) || a.id - b.id)
    .slice(0, zone.maxTargets ?? 2);
}
