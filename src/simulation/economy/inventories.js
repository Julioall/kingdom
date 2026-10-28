import { FOOD_DAYS_PER_UNIT, MEAT_NUTRITIONAL_VALUE } from '../../config/ecosystem.js';
import { clamp, distance } from '../core/math.js';
import { recordFoodAuditBlocked, withFoodAuditOperation } from './food-audit-ledger.js';

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

function spendFrom(account, costs, category = 'inventory-spend') {
    return withFoodAuditOperation({ kind: 'spend', sourceAccount: account, costs, category }, () => {
      if (!account || !validCosts(costs)) {
        recordFoodAuditBlocked(!account ? 'missing-source-account' : 'invalid-costs', { resource: Object.keys(costs || {}).find(hasFoodAuditResource) });
        return false;
      }
      const blocked = Object.entries(costs).find(([key, amount]) => !Number.isFinite(currentAmount(account, key))
        || currentAmount(account, key) < 0 || currentAmount(account, key) < amount);
      if (blocked) {
        const [key, amount] = blocked;
        recordFoodAuditBlocked(!Number.isFinite(currentAmount(account, key)) || currentAmount(account, key) < 0
          ? 'invalid-source-stock' : 'insufficient-source-stock', {
          resource: key, requested: amount, available: currentAmount(account, key)
        });
        return false;
      }
      for (const [key, amount] of Object.entries(costs)) account[key] = Math.max(0, currentAmount(account, key) - amount);
      return true;
    });
  }

function hasFoodAuditResource(resource) {
    return ['food', 'meat', 'feed', 'seeds', 'foodReserve', 'carriedFood', 'carriedFruit', 'carriedMeat',
      'carriedFeed', 'cropSeedStored', 'fruitStored', 'meatStored', 'militaryFoodPurchased'].includes(resource);
  }

export function addResource(account, resource, amount, maxAmount = Infinity, category = 'inventory-add') {
    if (amount === 0) return 0;
    return withFoodAuditOperation({ kind: 'add', destinationAccount: account, resource, destinationResource: resource,
      amount, capacity: maxAmount, category }, () => {
      if (!account || typeof account !== 'object' || !resource || !Number.isFinite(amount) || amount <= 0
          || !(maxAmount === Infinity || (Number.isFinite(maxAmount) && maxAmount >= 0))) {
        recordFoodAuditBlocked(!account ? 'missing-destination-account' : 'invalid-amount-or-capacity', {
          resource, requested: amount, capacity: maxAmount
        });
        return 0;
      }
      const current = currentAmount(account, resource);
      if (!Number.isFinite(current) || current < 0) {
        recordFoodAuditBlocked('invalid-destination-stock', { resource, available: current });
        return 0;
      }
      const added = Math.min(amount, Math.max(0, maxAmount - current));
      if (added <= 0 || !Number.isFinite(current + added)) {
        recordFoodAuditBlocked(added <= 0 ? 'destination-capacity-full' : 'invalid-destination-total', {
          resource, requested: amount, available: current, capacity: maxAmount
        });
        return 0;
      }
      account[resource] = current + added;
      return added;
    });
  }

export function transferResource(source, destination, resource, amount, destinationResource = resource,
    maxDestinationAmount = Infinity, category = 'inventory-transfer') {
    if (amount === 0) return 0;
    return withFoodAuditOperation({ kind: 'transfer', sourceAccount: source, destinationAccount: destination,
      resource, sourceResource: resource, destinationResource, amount, category }, () => {
      if (!source || !destination || typeof source !== 'object' || typeof destination !== 'object'
          || source === destination || !resource || !destinationResource || !Number.isFinite(amount) || amount <= 0
          || !(maxDestinationAmount === Infinity || (Number.isFinite(maxDestinationAmount) && maxDestinationAmount >= 0))) {
        recordFoodAuditBlocked(!source || !destination ? 'missing-transfer-account' : 'invalid-transfer-request', {
          resource, requested: amount, capacity: maxDestinationAmount
        });
        return 0;
      }
      const current = currentAmount(source, resource), target = currentAmount(destination, destinationResource);
      if (!Number.isFinite(current) || current < 0 || !Number.isFinite(target) || target < 0) {
        recordFoodAuditBlocked('invalid-transfer-stock', { resource, available: current, capacity: maxDestinationAmount });
        return 0;
      }
      const moved = Math.min(current, amount, Math.max(0, maxDestinationAmount - target));
      if (moved <= 0 || !Number.isFinite(current - moved) || !Number.isFinite(target + moved)) {
        recordFoodAuditBlocked(current <= 0 ? 'insufficient-source-stock' : 'destination-capacity-full', {
          resource, requested: amount, available: current, capacity: maxDestinationAmount
        });
        return 0;
      }
      source[resource] = current - moved;
      destination[destinationResource] = target + moved;
      return moved;
    });
  }

export function exchangeResources(first, firstGives, second, secondGives) {
    return withFoodAuditOperation({ kind: 'exchange', sourceAccount: first, destinationAccount: second,
      firstGives, secondGives, category: 'barter' }, () => {
      const firstBlocked = first && typeof first === 'object'
        ? Object.entries(firstGives || {}).find(([key, amount]) => !Number.isFinite(currentAmount(first, key))
          || currentAmount(first, key) < 0 || currentAmount(first, key) < amount)
        : null;
      const secondBlocked = second && typeof second === 'object'
        ? Object.entries(secondGives || {}).find(([key, amount]) => !Number.isFinite(currentAmount(second, key))
          || currentAmount(second, key) < 0 || currentAmount(second, key) < amount)
        : null;
      if (!first || !second || first === second || typeof first !== 'object' || typeof second !== 'object'
          || !validCosts(firstGives) || !validCosts(secondGives) || firstBlocked || secondBlocked
          || !canReceive(first, secondGives) || !canReceive(second, firstGives)) {
        const blocked = firstBlocked || secondBlocked;
        const blockedResource = blocked?.[0] || [...Object.keys(firstGives || {}), ...Object.keys(secondGives || {})]
          .find(hasFoodAuditResource);
        recordFoodAuditBlocked(blocked ? 'insufficient-exchange-stock' : 'exchange-not-available', {
          resource: blockedResource, requested: blocked?.[1], available: blocked
            ? currentAmount(firstBlocked ? first : second, blockedResource) : undefined
        });
        return false;
      }
      for (const [key, amount] of Object.entries(firstGives)) first[key] = Math.max(0, currentAmount(first, key) - amount);
      for (const [key, amount] of Object.entries(secondGives)) second[key] = Math.max(0, currentAmount(second, key) - amount);
      for (const [key, amount] of Object.entries(firstGives)) addResource(second, key, amount);
      for (const [key, amount] of Object.entries(secondGives)) addResource(first, key, amount);
      return true;
    });
  }

export function addCommunityStore(community, resource, amount, category = 'collection') {
    return addResource(storesOf(community), resource, amount, Infinity, category);
  }

export function spendStoreInventory(community, costs, category = 'consumption') {
    return spendFrom(storesOf(community), costs, category);
  }

export function consumeStoreInventory(community, costs, category = 'consumption') {
    return spendStoreInventory(community, costs, category);
  }

export function transferStores(sourceCommunity, destinationCommunity, resource, amount, category = 'community-transfer') {
    const moved = transferResource(storesOf(sourceCommunity), storesOf(destinationCommunity), resource, amount, resource, Infinity, category);
    return moved;
  }

export function transferStoresToInventory(sourceCommunity, destinationInventory, resource, amount, category = 'community-inventory-transfer') {
    return transferResource(storesOf(sourceCommunity), inventoryOf(destinationInventory), resource, amount, resource, Infinity, category);
  }

export function transferStoreResourceToAccount(sourceCommunity, destinationAccount, resource, amount, category = 'community-account-transfer') {
    const destination = destinationAccount && destinationAccount.stock ? destinationAccount.stock : destinationAccount;
    const moved = transferResource(storesOf(sourceCommunity), destination, resource, amount, resource, Infinity, category);
    return moved;
  }

export function moveCarriedResource(person, carriedResource, community, storeResource, amount, category = 'collection') {
    const moved = transferResource(person, storesOf(community), carriedResource, amount, storeResource, Infinity, category);
    return moved;
  }

export function spendInventory(owner, costs, category = 'inventory-spend') {
    return spendFrom(inventoryOf(owner), costs, category);
  }

export function spendResource(account, costs, category = 'inventory-spend') {
    return spendFrom(account, costs, category);
  }

export function addFoodReserve(person, amount, category = 'other-food-inflow') {
    const added = addResource(person, 'foodReserve', amount, 100, category);
    return added;
  }

export function consumeFoodReserve(person, amount, category = 'other-food-consumption') {
    if (!person || !Number.isFinite(person.foodReserve) || person.foodReserve < 0
        || !Number.isFinite(amount) || amount <= 0) return 0;
    const consumed = Math.min(person.foodReserve, amount);
    const spent = consumed > 0 && spendResource(person, { foodReserve: consumed }, category) ? consumed : 0;
    return spent;
  }

export function consumeCarriedFood(person, amount, category = 'personal-carried-food-consumption') {
    if (!person || !Number.isFinite(person.carriedFood) || person.carriedFood < 0
        || !Number.isFinite(amount) || amount <= 0) return 0;
    const consumed = Math.min(person.carriedFood, amount);
    if (consumed <= 0) return 0;
    return withFoodAuditOperation({ kind: 'consume-cargo', sourceAccount: person, resource: 'carriedFood',
      amount: consumed, category }, () => {
      person.carriedFood = Math.max(0, person.carriedFood - consumed);
      return consumed;
    });
  }

export function consumeEdibleCargo(person, nutrition, category = 'emergency-carried-food-consumption') {
    if (!person || !Number.isFinite(nutrition) || nutrition <= 0) return 0;
    let remaining = nutrition;
    for (const [field, value] of [['carriedFood', 1], ['carriedFruit', 1], ['carriedMeat', MEAT_NUTRITIONAL_VALUE]]) {
      const quantity = Math.min(Math.max(0, Number(person[field]) || 0), remaining / value);
      if (quantity <= 0 || !spendFrom(person, { [field]: quantity }, category)) continue;
      remaining = Math.max(0, remaining - quantity * value);
      if (remaining <= 1e-9) break;
    }
    return nutrition - remaining;
  }

export function transferFoodReserve(source, destination, amount, category = 'food-reserve-transfer') {
    const moved = transferResource(source, destination, 'foodReserve', amount, 'foodReserve', 100, category);
    return moved;
  }

export function transferInventory(source, destination, resource, amount, category = 'inventory-transfer') {
    const moved = transferResource(inventoryOf(source), inventoryOf(destination), resource, amount, resource, Infinity, category);
    return moved;
  }

export function transferInventoryToStores(source, destination, resource, amount, category = 'inventory-transfer-to-stores') {
    const moved = transferResource(inventoryOf(source), storesOf(destination), resource, amount, resource, Infinity, category);
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
      + (person.carriedStone || 0) + (person.carriedGold || 0)
      + (person.carriedCopper || 0) + (person.carriedSilver || 0) + (person.carriedIron || 0)
      + (person.carriedFood || 0) + (person.carriedFruit || 0) + (person.carriedMaterial || 0);
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

export function transferCommunityFoodToReserve(world, community, person, amount, category, reserveCategory = category) {
    if (!community || !person || !Number.isFinite(amount) || amount <= 0) return { nutrition: 0, reserveAdded: 0 };
    const shelters = (world.structures || []).filter(structure => structure.complete && structure.type === 'abrigo'
      && structure.communityId === community.id && Number(structure.meatStored) > 0);
    return withFoodAuditOperation({ kind: 'community-meal-distribution', category: reserveCategory,
      resource: 'foodReserve', destinationAccount: person, destinationResource: 'foodReserve',
      amount: amount * FOOD_DAYS_PER_UNIT, actor: person,
      source: { type: 'community-food-network', communityId: community.id, accounts: [
        { ownerType: 'community', ownerId: community.id, account: 'community-stores', properties: ['food', 'meat'] },
        ...shelters.map(shelter => ({ ownerType: 'structure', ownerId: shelter.id, account: 'shelter-meat', property: 'meatStored' }))
      ] },
      sourcePosition: Number.isFinite(community.x) && Number.isFinite(community.y)
        ? { x: community.x, y: community.y } : null,
      destinationPosition: Number.isFinite(person.x) && Number.isFinite(person.y)
        ? { x: person.x, y: person.y } : null
    }, () => {
      const meal = withdrawCommunityFood(world, community, amount, category);
      const reserveAdded = addFoodReserve(person, meal.nutrition * FOOD_DAYS_PER_UNIT, reserveCategory);
      return { nutrition: meal.nutrition, reserveAdded };
    });
  }

export function stockSurplus(store, resource) {
    const reserve = resource === 'food' ? 12 : 16;
    return Math.max(0, (store[resource] || 0) - reserve);
  }

export function transferCommunityFood(w, community, person, amount, category = 'community-sharing') {
    return withFoodAuditOperation({ kind: 'food-distribution', category, resource: 'foodReserve',
      sourceAccount: community?.stores, sourceResource: 'food', destinationAccount: person,
      destinationResource: 'foodReserve', amount, actor: person }, () => {
      const need = Math.max(0, 78 - person.foodReserve);
      const units = Math.min(amount, communityFoodStock(community), need / FOOD_DAYS_PER_UNIT);
      if (units <= .02) {
        recordFoodAuditBlocked('no-transferable-community-food-or-reserve-room', {
          resource: 'food', requested: amount, available: communityFoodStock(community)
        });
        return 0;
      }
      withdrawCommunityFood(w, community, units, category);
      addFoodReserve(person, units * FOOD_DAYS_PER_UNIT, 'community-meal');
      return units;
    });
  }
