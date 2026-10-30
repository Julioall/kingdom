import { magicModifiers } from '../magic/effects.js';
import { isCombatStunned } from './combat-status.js';
export const COMBAT_RESOURCES = Object.freeze({ stamina: 400, mana: 200, healingCost: 30,
  attackCost: { guerreiro: 14, lanceiro: 12, arqueiro: 8 },
  guardCost: { guerreiro: 6, lanceiro: 5 },
  parryCost: { guerreiro: 10, lanceiro: 8 } });

export function initializeCombatResources(person) {
  const previousStaminaMax = person.maxStamina;
  if ([100, 200].includes(previousStaminaMax) && Number.isFinite(person.stamina))
    person.stamina = Math.min(COMBAT_RESOURCES.stamina, person.stamina * COMBAT_RESOURCES.stamina / previousStaminaMax);
  person.maxStamina = COMBAT_RESOURCES.stamina;
  person.stamina ??= person.maxStamina;
  if (person.militaryClass === 'monge') {
    if (person.maxMana === 100 && Number.isFinite(person.mana)) person.mana = Math.min(200, person.mana * 2);
    person.maxMana = COMBAT_RESOURCES.mana;
    person.mana ??= person.maxMana;
  }
}

export function spendAttackStamina(person, day, { combo = false, cost: requestedCost, nowMs } = {}) {
  initializeCombatResources(person);
  const cost = (requestedCost ?? COMBAT_RESOURCES.attackCost[person.militaryClass]) * magicModifiers(person).stamina;
  if (!Number.isFinite(cost) || cost <= 0 || person.stamina < cost || isCombatDisarmed(person, day, nowMs)
      || !person.playerControlled && day - (person.lastMilitaryAttackDay ?? -Infinity) < (combo ? 1 : 2)) return false;
  person.stamina -= cost;
  person.combatStaminaSpent = (person.combatStaminaSpent || 0) + cost;
  return true;
}

export function isCombatDisarmed(person, day, nowMs) {
  return isCombatStunned(person, day, nowMs);
}

export function canSpendDefenseStamina(person, parry = false) {
  initializeCombatResources(person);
  const cost = (parry ? COMBAT_RESOURCES.parryCost : COMBAT_RESOURCES.guardCost)[person.militaryClass] * magicModifiers(person).stamina;
  return Number.isFinite(cost) && person.stamina >= cost;
}

export function spendDefenseStamina(person, parry = false) {
  if (!canSpendDefenseStamina(person, parry)) return false;
  const cost = (parry ? COMBAT_RESOURCES.parryCost : COMBAT_RESOURCES.guardCost)[person.militaryClass] * magicModifiers(person).stamina;
  person.stamina -= cost;
  person.combatStaminaSpent = (person.combatStaminaSpent || 0) + cost;
  return true;
}

export function recordArrow(person, target, day, action = null) {
  if (person.militaryClass !== 'arqueiro') return;
  person.lastArrowSequence = (person.lastArrowSequence || 0) + 1;
  person.lastArrow = { day, x: person.x, y: person.y,
    targetX: action?.aim?.x ?? target.x, targetY: action?.aim?.y ?? target.y,
    elevation: person.towerMounted ? 3 : 0, targetElevation: target.towerMounted ? 3 : 0,
    actionId: action?.id, releaseMs: action?.windupMs ?? 500, flightMs: action?.flightMs,
    arcHeight: action?.arcHeight };
}

export function updateCombatResources(world, day) {
  for (const person of world.people) {
    if (!person.alive || person.role !== 'soldier') continue;
    initializeCombatResources(person);
    const resting = person.brain?.lastAction === 'rest' || person.towerRecovering;
    const fighting = day - (person.lastMilitaryAttackDay ?? -Infinity) <= 3;
    person.stamina = Math.min(person.maxStamina, person.stamina + (resting ? 12 : fighting ? 2 : 6));
    if (person.militaryClass === 'monge') person.mana = Math.min(person.maxMana, person.mana + (resting ? 30 : 10));
  }
}
