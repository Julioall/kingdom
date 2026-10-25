import { DAILY_FOOD_NEED } from '../../config/ecosystem.js';

export const DEPENDENT_DAILY_FOOD_NEED = .42;

export function kingdomFoodDemand(world, kingdom) {
  const memberIds = new Set(kingdom?.memberIds || []);
  const members = (world?.people || []).filter(person => person.alive && memberIds.has(person.id));
  const dependents = members.filter(person => person.ageDays < 12 * 365).length;
  return {
    members,
    dependents,
    dailyFoodNeed: (members.length - dependents) * DAILY_FOOD_NEED + dependents * DEPENDENT_DAILY_FOOD_NEED
  };
}
