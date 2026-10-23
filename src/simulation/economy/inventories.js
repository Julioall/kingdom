import { FOOD_RESERVE_PER_UNIT, MEAT_NUTRITIONAL_VALUE } from '../../config/ecosystem.js';
import { clamp, distance } from '../core/math.js';

function inventoryOf(owner) {
    if (!owner || !owner.stock || typeof owner.stock !== 'object') return null;
    return owner.stock;
  }

export function spendInventory(owner, costs) {
    const stock = inventoryOf(owner);
    if (!stock || !costs || Object.entries(costs).some(([key, amount]) => !Number.isFinite(amount) || amount < 0 || (stock[key] || 0) < amount)) return false;
    for (const [key, amount] of Object.entries(costs)) stock[key] = Math.max(0, (stock[key] || 0) - amount);
    return true;
  }

export function transferInventory(source, destination, resource, amount) {
    const from = inventoryOf(source), to = inventoryOf(destination);
    if (!from || !to || !resource || !Number.isFinite(amount) || amount <= 0) return 0;
    const moved = Math.min(Math.max(0, from[resource] || 0), amount);
    if (moved <= 0) return 0;
    from[resource] -= moved;
    to[resource] = (to[resource] || 0) + moved;
    return moved;
  }

export function addHarvestedFood(person, community, amount) {
    const needed = Math.max(0, (90 - person.foodReserve) / FOOD_RESERVE_PER_UNIT);
    const eaten = Math.min(amount, needed);
    person.foodReserve = clamp(person.foodReserve + eaten * FOOD_RESERVE_PER_UNIT, 0, 100);
    person.energy = clamp(person.energy + eaten * .12, 0, 100);
    const surplus = Math.max(0, amount - eaten);
    if (community && distance(person, community) <= 6) community.stores.food += surplus;
    else person.carriedFood = Math.min(24, person.carriedFood + surplus);
    return { eaten, surplus };
  }

export function storeCommunityFruit(w, community, shelter, amount) {
    if (!community || amount <= 0) return 0;
    const units = Math.max(0, amount);
    community.stores.food = (community.stores.food || 0) + units;
    if (shelter && shelter.complete && shelter.type === 'abrigo' && shelter.communityId === community.id) {
      shelter.fruitStored = (shelter.fruitStored || 0) + units;
    }
    return units;
  }

export function removeStoredFruit(w, community, amount) {
    if (!community || amount <= 0) return 0;
    let remaining = amount;
    let removed = 0;
    for (const shelter of w.structures.filter(s => s.complete && s.type === 'abrigo' && s.communityId === community.id)) {
      const take = Math.min(shelter.fruitStored || 0, remaining);
      shelter.fruitStored = Math.max(0, (shelter.fruitStored || 0) - take);
      remaining -= take;
      removed += take;
      if (remaining <= .001) break;
    }
    return removed;
  }

export function communityFoodStock(community) {
    return community ? (community.stores.food || 0) + (community.stores.meat || 0) * MEAT_NUTRITIONAL_VALUE : 0;
  }

export function communityMaterialStock(community) {
    return community ? (community.stores.wood || 0) + (community.stores.stone || 0) : 0;
  }

export function carriedResources(person) {
    return (person.carriedMeat || 0) + (person.carriedFeed || 0) + (person.carriedWood || 0)
      + (person.carriedStone || 0) + (person.carriedGold || 0) + (person.carriedFood || 0) + (person.carriedFruit || 0) + (person.carriedMaterial || 0);
  }

export function withdrawCommunityFood(w, community, amount) {
    if (!community || amount <= 0) return { meat: 0, fruit: 0, nutrition: 0 };
    let remainingNutrition = amount;
    const meat = Math.min(community.stores.meat || 0, remainingNutrition / MEAT_NUTRITIONAL_VALUE);
    community.stores.meat = Math.max(0, (community.stores.meat || 0) - meat);
    remainingNutrition -= meat * MEAT_NUTRITIONAL_VALUE;
    let storedMeat = meat;
    for (const shelter of w.structures.filter(s => s.complete && s.type === 'abrigo' && s.communityId === community.id)) {
      const take = Math.min(shelter.meatStored || 0, storedMeat);
      shelter.meatStored = Math.max(0, (shelter.meatStored || 0) - take);
      storedMeat -= take;
      if (storedMeat <= .001) break;
    }
    const plantFood = Math.min(community.stores.food || 0, remainingNutrition);
    community.stores.food = Math.max(0, (community.stores.food || 0) - plantFood);
    removeStoredFruit(w, community, plantFood);
    return { meat, fruit: plantFood, nutrition: meat * MEAT_NUTRITIONAL_VALUE + plantFood };
  }

export function stockSurplus(store, resource) {
    const reserve = resource === 'food' ? 12 : 16;
    return Math.max(0, (store[resource] || 0) - reserve);
  }

export function transferCommunityFood(w, community, person, amount) {
    const need = Math.max(0, 78 - person.foodReserve);
    const units = Math.min(amount, communityFoodStock(community), need / FOOD_RESERVE_PER_UNIT);
    if (units <= .02) return 0;
    withdrawCommunityFood(w, community, units);
    person.foodReserve = clamp(person.foodReserve + units * FOOD_RESERVE_PER_UNIT, 0, 100);
    return units;
  }
