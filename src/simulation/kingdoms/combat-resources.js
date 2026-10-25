export const COMBAT_RESOURCES = Object.freeze({ stamina: 100, mana: 100, healingCost: 30,
  attackCost: { guerreiro: 14, lanceiro: 12, arqueiro: 16 } });

export function initializeCombatResources(person) {
  person.maxStamina = 100;
  person.stamina ??= 100;
  if (person.militaryClass === 'monge') { person.maxMana = 100; person.mana ??= 100; }
}

export function spendAttackStamina(person, day) {
  initializeCombatResources(person);
  const cost = COMBAT_RESOURCES.attackCost[person.militaryClass];
  if (!cost || person.stamina < cost || day - (person.lastMilitaryAttackDay ?? -Infinity) < 2) return false;
  person.stamina -= cost;
  return true;
}

export function recordArrow(person, target, day, action = null) {
  if (person.militaryClass !== 'arqueiro') return;
  person.lastArrowSequence = (person.lastArrowSequence || 0) + 1;
  person.lastArrow = { day, x: person.x, y: person.y, targetX: target.x, targetY: target.y,
    elevation: person.towerMounted ? 3 : 0, targetElevation: target.towerMounted ? 3 : 0,
    actionId: action?.id, releaseMs: action?.windupMs ?? 500, flightMs: action?.flightMs };
}

export function updateCombatResources(world, day) {
  for (const person of world.people) {
    if (!person.alive || person.role !== 'soldier') continue;
    initializeCombatResources(person);
    const resting = person.brain?.lastAction === 'rest' || person.towerRecovering;
    const fighting = day - (person.lastMilitaryAttackDay ?? -Infinity) <= 3;
    person.stamina = Math.min(100, person.stamina + (resting ? 8 : fighting ? 1 : 4));
    if (person.militaryClass === 'monge') person.mana = Math.min(100, person.mana + (resting ? 3 : 1));
  }
}
