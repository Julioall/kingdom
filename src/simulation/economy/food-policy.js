import { DAILY_FOOD_NEED, FOOD_DAYS_PER_UNIT } from '../../config/ecosystem.js';

export const DEPENDENT_DAILY_FOOD_NEED = DAILY_FOOD_NEED;
export const COMMUNITY_FOOD_BUFFER_DAYS = 180;
export const MILITARY_CIVILIAN_RESERVE_DAYS = 2;
export const CULTIVATED_FOOD_PER_SEED_UNIT = 1250;
export const CULTIVATED_FIELD_HARVEST_PER_WORKER = 2500;

export function dailyFoodNeedForMembers(members = []) {
  const dependents = members.filter(person => person.ageDays < 12 * 365).length;
  return {
    dependents,
    dailyFoodNeed: (members.length - dependents) * DAILY_FOOD_NEED + dependents * DEPENDENT_DAILY_FOOD_NEED
  };
}

export function foodUnitsPerDay(dailyFoodNeed) {
  return Math.max(0, Number.isFinite(dailyFoodNeed) ? dailyFoodNeed : 0) / FOOD_DAYS_PER_UNIT;
}

export function communityFoodBufferTarget(dailyFoodNeed, days = COMMUNITY_FOOD_BUFFER_DAYS) {
  if (!Number.isFinite(days) || days < 0) return 0;
  return foodUnitsPerDay(dailyFoodNeed) * days;
}

export function communityFoodBufferDays(foodStock, dailyFoodNeed) {
  const dailyFoodUnits = foodUnitsPerDay(dailyFoodNeed);
  if (dailyFoodUnits <= 0) return Infinity;
  return Math.max(0, Number.isFinite(foodStock) ? foodStock : 0) / dailyFoodUnits;
}

export function kingdomFoodDemand(world, kingdom) {
  const community = (world?.communities || []).find(item => item.id === kingdom?.communityId && !item.dissolved);
  const kingdomMembers = kingdom?.memberIds?.length ? kingdom.memberIds : community?.memberIds || [];
  const memberIds = new Set(kingdomMembers);
  const members = (world?.people || []).filter(person => person.alive && memberIds.has(person.id));
  return { members, ...dailyFoodNeedForMembers(members) };
}

export function militaryCivilianFoodFloor(world, kingdom) {
  const civilians = kingdomFoodDemand(world, kingdom).members.filter(person => person.role !== 'soldier');
  return communityFoodBufferTarget(dailyFoodNeedForMembers(civilians).dailyFoodNeed, MILITARY_CIVILIAN_RESERVE_DAYS);
}
