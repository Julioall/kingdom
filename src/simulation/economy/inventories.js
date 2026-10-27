import { FOOD_DAYS_PER_UNIT, MEAT_NUTRITIONAL_VALUE } from '../../config/ecosystem.js';
import { clamp, distance } from '../core/math.js';

function inventoryOf(owner) {
    if (!owner || !owner.stock || typeof owner.stock !== 'object') return null;
    return owner.stock;
  }

function storesOf(owner) {
    if (!owner || !owner.stores || typeof owner.stores !== 'object') return null;
    return owner.stores;
  }

function validCosts(costs) {
    return !!costs && Object.entries(costs).every(([key, amount]) => key && Number.isFinite(amount) && amount >= 0);
  }

function currentAmount(account, resource) {
    return account[resource] === undefined ? 0 : account[resource];
  }

function canReceive(account, incoming) {
    return Object.entries(incoming).every(([key, amount]) => {
      const current = currentAmount(account, key);
      return Number.isFinite(current) && current >= 0 && Number.isFinite(current + amount);
    });
  }

function spendFrom(account, costs) {
    if (!account || !validCosts(costs)
        || Object.entries(costs).some(([key, amount]) => !Number.isFinite(currentAmount(account, key))
          || currentAmount(account, key) < 0 || currentAmount(account, key) < amount)) return false;
    for (const [key, amount] of Object.entries(costs)) account[key] = Math.max(0, currentAmount(account, key) - amount);
    return true;
  }

export function addResource(account, resource, amount, maxAmount = Infinity) {
    if (!account || typeof account !== 'object' || !resource || !Number.isFinite(amount) || amount <= 0
        || !(maxAmount === Infinity || (Number.isFinite(maxAmount) && maxAmount >= 0))) return 0;
    const current = currentAmount(account, resource);
    if (!Number.isFinite(current) || current < 0) return 0;
    const added = Math.min(amount, Math.max(0, maxAmount - current));
    if (added <= 0 || !Number.isFinite(current + added)) return 0;
    account[resource] = current + added;
    return added;
  }

export function transferResource(source, destination, resource, amount, destinationResource = resource, maxDestinationAmount = Infinity) {
    if (!source || !destination || typeof source !== 'object' || typeof destination !== 'object'
        || source === destination || !resource || !destinationResource || !Number.isFinite(amount) || amount <= 0
        || !(maxDestinationAmount === Infinity || (Number.isFinite(maxDestinationAmount) && maxDestinationAmount >= 0))) return 0;
    const current = currentAmount(source, resource), target = currentAmount(destination, destinationResource);
    if (!Number.isFinite(current) || current < 0 || !Number.isFinite(target) || target < 0) return 0;
    const moved = Math.min(current, amount, Math.max(0, maxDestinationAmount - target));
    if (moved <= 0 || !Number.isFinite(current - moved) || !Number.isFinite(target + moved)) return 0;
    source[resource] = current - moved;
    destination[destinationResource] = target + moved;
    return moved;
  }

export function exchangeResources(first, firstGives, second, secondGives) {
    if (!first || !second || first === second || typeof first !== 'object' || typeof second !== 'object'
        || !validCosts(firstGives) || !validCosts(secondGives)
        || Object.entries(firstGives).some(([key, amount]) => !Number.isFinite(currentAmount(first, key))
          || currentAmount(first, key) < 0 || currentAmount(first, key) < amount)
        || Object.entries(secondGives).some(([key, amount]) => !Number.isFinite(currentAmount(second, key))
          || currentAmount(second, key) < 0 || currentAmount(second, key) < amount)
        || !canReceive(first, secondGives) || !canReceive(second, firstGives)) return false;
    for (const [key, amount] of Object.entries(firstGives)) first[key] = Math.max(0, currentAmount(first, key) - amount);
    for (const [key, amount] of Object.entries(secondGives)) second[key] = Math.max(0, currentAmount(second, key) - amount);
    for (const [key, amount] of Object.entries(firstGives)) addResource(second, key, amount);
    for (const [key, amount] of Object.entries(secondGives)) addResource(first, key, amount);
    return true;
  }

export function addCommunityStore(community, resource, amount, category = 'collection') {
    return addResource(storesOf(community), resource, amount);
  }

export function spendStoreInventory(community, costs, category = 'consumption') {
    return spendFrom(storesOf(community), costs);
  }

export function consumeStoreInventory(community, costs, category = 'consumption') {
    return spendStoreInventory(community, costs, category);
  }

export function transferStores(sourceCommunity, destinationCommunity, resource, amount) {
    const moved = transferResource(storesOf(sourceCommunity), storesOf(destinationCommunity), resource, amount);
    return moved;
  }

export function transferStoresToInventory(sourceCommunity, destinationInventory, resource, amount) {
    return transferResource(storesOf(sourceCommunity), inventoryOf(destinationInventory), resource, amount);
  }

export function transferStoreResourceToAccount(sourceCommunity, destinationAccount, resource, amount, category = 'community-account-transfer') {
    const destination = destinationAccount && destinationAccount.stock ? destinationAccount.stock : destinationAccount;
    const moved = transferResource(storesOf(sourceCommunity), destination, resource, amount);
    return moved;
  }

export function moveCarriedResource(person, carriedResource, community, storeResource, amount, category = 'collection') {
    const moved = transferResource(person, storesOf(community), carriedResource, amount, storeResource);
    return moved;
  }

export function spendInventory(owner, costs, category = 'inventory-spend') {
    return spendFrom(inventoryOf(owner), costs);
  }

export function spendResource(account, costs) {
    return spendFrom(account, costs);
  }

export function addFoodReserve(person, amount, category = 'other-food-inflow') {
    const added = addResource(person, 'foodReserve', amount, 100);
    return added;
  }

export function consumeFoodReserve(person, amount, category = 'other-food-consumption') {
    if (!person || !Number.isFinite(person.foodReserve) || person.foodReserve < 0
        || !Number.isFinite(amount) || amount <= 0) return 0;
    const consumed = Math.min(person.foodReserve, amount);
    const spent = consumed > 0 && spendResource(person, { foodReserve: consumed }) ? consumed : 0;
    return spent;
  }

export function consumeCarriedFood(person, amount, category = 'personal-carried-food-consumption') {
    if (!person || !Number.isFinite(person.carriedFood) || person.carriedFood < 0
        || !Number.isFinite(amount) || amount <= 0) return 0;
    const consumed = Math.min(person.carriedFood, amount);
    if (consumed <= 0) return 0;
    person.carriedFood = Math.max(0, person.carriedFood - consumed);
    return consumed;
  }

export function consumeEdibleCargo(person, nutrition, category = 'emergency-carried-food-consumption') {
    if (!person || !Number.isFinite(nutrition) || nutrition <= 0) return 0;
    let remaining = nutrition;
    for (const [field, value] of [['carriedFood', 1], ['carriedFruit', 1], ['carriedMeat', MEAT_NUTRITIONAL_VALUE]]) {
      const quantity = Math.min(Math.max(0, Number(person[field]) || 0), remaining / value);
      if (quantity <= 0 || !spendFrom(person, { [field]: quantity })) continue;
      remaining = Math.max(0, remaining - quantity * value);
      if (remaining <= 1e-9) break;
    }
    return nutrition - remaining;
  }

export function transferFoodReserve(source, destination, amount, category = 'food-reserve-transfer') {
    const moved = transferResource(source, destination, 'foodReserve', amount, 'foodReserve', 100);
    return moved;
  }

export function transferInventory(source, destination, resource, amount, category = 'inventory-transfer') {
    const moved = transferResource(inventoryOf(source), inventoryOf(destination), resource, amount);
    return moved;
  }

export function transferInventoryToStores(source, destination, resource, amount, category = 'inventory-transfer-to-stores') {
    const moved = transferResource(inventoryOf(source), storesOf(destination), resource, amount);
    return moved;
  }

export function harvestedFoodCapacity(person, community) {
    if (!person || !Number.isFinite(person.foodReserve) || person.foodReserve < 0
        || !Number.isFinite(person.carriedFood ?? 0) || (person.carriedFood ?? 0) < 0) return 0;
    const personal = Math.max(0, (90 - person.foodReserve) / FOOD_DAYS_PER_UNIT);
    if (community && distance(person, community) <= 6 && storesOf(community)
        && Number.isFinite(currentAmount(community.stores, 'food')) && currentAmount(community.stores, 'food') >= 0) return Infinity;
    return personal + Math.max(0, 24 - (person.carriedFood ?? 0));
  }

export function addHarvestedFood(person, community, amount) {
    if (!Number.isFinite(amount) || amount <= 0 || amount > harvestedFoodCapacity(person, community) + 1e-9) {
      return { eaten: 0, surplus: 0 };
    }
    const needed = Math.max(0, (90 - person.foodReserve) / FOOD_DAYS_PER_UNIT);
    const eaten = Math.min(amount, needed);
    addFoodReserve(person, eaten * FOOD_DAYS_PER_UNIT, 'personal-harvest');
    person.energy = clamp(person.energy + eaten * .12, 0, 100);
    const surplus = Math.max(0, amount - eaten);
    const stored = community && distance(person, community) <= 6 && storesOf(community)
      && Number.isFinite(currentAmount(community.stores, 'food')) && currentAmount(community.stores, 'food') >= 0
      ? addCommunityStore(community, 'food', surplus) : addResource(person, 'carriedFood', surplus, 24);
    return { eaten, surplus: stored };
  }

export function storeCommunityFruit(w, community, shelter, amount) {
    if (!community || amount <= 0) return 0;
    const units = Math.max(0, amount);
    const added = addCommunityStore(community, 'food', units);
    if (added <= 0) return 0;
    if (shelter && shelter.complete && shelter.type === 'abrigo' && shelter.communityId === community.id) {
      addResource(shelter, 'fruitStored', added);
    }
    return added;
  }

export function removeStoredFruit(w, community, amount) {
    if (!community || amount <= 0) return 0;
    let remaining = amount;
    let removed = 0;
    for (const shelter of w.structures.filter(s => s.complete && s.type === 'abrigo' && s.communityId === community.id)) {
      const take = Math.min(shelter.fruitStored || 0, remaining);
      spendFrom(shelter, { fruitStored: take });
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

export function withdrawCommunityFood(w, community, amount, category = 'resident-food-consumption',
    { meatCapacity = Infinity, fruitCapacity = Infinity } = {}) {
    if (!community || amount <= 0) return { meat: 0, fruit: 0, nutrition: 0 };
    let remainingNutrition = amount;
    const meat = Math.min(community.stores.meat || 0, remainingNutrition / MEAT_NUTRITIONAL_VALUE, Math.max(0, meatCapacity));
    consumeStoreInventory(community, { meat }, category);
    remainingNutrition -= meat * MEAT_NUTRITIONAL_VALUE;
    let storedMeat = meat;
    for (const shelter of w.structures.filter(s => s.complete && s.type === 'abrigo' && s.communityId === community.id)) {
      const take = Math.min(shelter.meatStored || 0, storedMeat);
      spendFrom(shelter, { meatStored: take });
      storedMeat -= take;
      if (storedMeat <= .001) break;
    }
    const plantFood = Math.min(community.stores.food || 0, remainingNutrition, Math.max(0, fruitCapacity));
    consumeStoreInventory(community, { food: plantFood }, category);
    removeStoredFruit(w, community, plantFood);
    return { meat, fruit: plantFood, nutrition: meat * MEAT_NUTRITIONAL_VALUE + plantFood };
  }

export function stockSurplus(store, resource) {
    const reserve = resource === 'food' ? 12 : 16;
    return Math.max(0, (store[resource] || 0) - reserve);
  }

export function transferCommunityFood(w, community, person, amount, category = 'community-sharing') {
    const need = Math.max(0, 78 - person.foodReserve);
    const units = Math.min(amount, communityFoodStock(community), need / FOOD_DAYS_PER_UNIT);
    if (units <= .02) return 0;
    withdrawCommunityFood(w, community, units, category);
    addFoodReserve(person, units * FOOD_DAYS_PER_UNIT, 'community-meal');
    return units;
  }
