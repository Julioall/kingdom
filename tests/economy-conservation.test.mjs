import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMUNITY_FOOD_CARRY_CAPACITY, FOOD_DAYS_PER_UNIT, PLANTS } from '../src/config/ecosystem.js';
import { updateDependent } from '../src/simulation/individuals/lifecycle.js';
import { collectFoodForCommunity, personalFoodHarvestLimit } from '../src/simulation/individuals/actions.js';
import { exchangeResources, transferFoodReserve } from '../src/simulation/economy/inventories.js';
import { drawCampaignRation } from '../src/simulation/kingdoms/campaigns.js';

function careFixture(caregiverFood) {
  const caregiver = {
    id: 1, alive: true, ageDays: 25 * 365, x: 0, y: 0, kingdomId: null, communityId: null,
    foodReserve: caregiverFood, energy: 100, skills: { care: 0 }
  };
  const child = {
    id: 2, alive: true, ageDays: 5 * 365, x: 0, y: 0, kingdomId: null, communityId: null,
    parents: [caregiver.id], guardianId: caregiver.id, foodReserve: 12, hydration: 80,
    health: 100, injury: 0
  };
  const world = { day: 10, events: [], deathsByCause: {}, people: [caregiver, child],
    kingdoms: [], communities: [], structures: [], tiles: [null] };
  return { world, caregiver, child };
}

test('dependent care transfers only food that the caregiver actually owns', () => {
  const { world, caregiver, child } = careFixture(0);
  updateDependent(world, child);
  assert.equal(caregiver.foodReserve, 0);
  assert.ok(Math.abs(child.foodReserve - 11) < 1e-9, 'the child consumes one day from its own reserve and receives no invented food');
});

test('partial dependent-care transfer is atomic and conserves food after daily consumption', () => {
  const { world, caregiver, child } = careFixture(0.2);
  const before = caregiver.foodReserve + child.foodReserve;
  updateDependent(world, child);
  assert.equal(caregiver.foodReserve, 0);
  assert.ok(Math.abs(child.foodReserve - 11.2) < 1e-9);
  assert.ok(Math.abs((caregiver.foodReserve + child.foodReserve) - (before - 1)) < 1e-9);
});

test('a dead caregiver and empty shared store cannot supply a dependent meal', () => {
  const { world, caregiver, child } = careFixture(20);
  caregiver.alive = false;
  child.foodReserve = 12;

  updateDependent(world, child);

  assert.equal(caregiver.foodReserve, 20, 'a dead caregiver is not a source account');
  assert.ok(Math.abs(child.foodReserve - 11) < 1e-9, 'the orphan pays the same one-day need as every other person');
  assert.equal(child.alive, true);
});

test('a dependent with one small meal does not die before actual starvation lowers health', () => {
  const { world, caregiver, child } = careFixture(20);
  caregiver.alive = false;
  child.foodReserve = 0.42;

  updateDependent(world, child);

  assert.equal(child.alive, true, 'a missed caregiver day cannot kill a healthy dependent at 0.1 reserve');
  assert.ok(Math.abs(child.foodReserve) < 1e-9, 'only the dependent\'s existing partial-day reserve was consumed');

  for (let day = 0; day < 210 && child.alive; day++) {
    world.day++;
    updateDependent(world, child);
  }

  assert.equal(child.alive, false, 'continued unmet food eventually causes a real starvation death');
  assert.equal(child.deathCause, 'starvation');
  assert.ok(child.deathDetails.health <= 0.1);
  assert.ok(child.deathDetails.recentHealth.losses.starvation > 0, 'the lethal health loss came from an uncovered food need');
});

test('market barter rejects insufficient stock atomically and settles an affordable exchange exactly', () => {
  const community = { gold: 4, food: 0 };
  const market = { gold: 0, food: 9 };
  const beforeCommunity = structuredClone(community), beforeMarket = structuredClone(market);
  assert.equal(exchangeResources(community, { gold: 4 }, market, { food: 10 }), false);
  assert.deepEqual(community, beforeCommunity);
  assert.deepEqual(market, beforeMarket);

  market.food = 10;
  assert.equal(exchangeResources(community, { gold: 4 }, market, { food: 10 }), true);
  assert.deepEqual(community, { gold: 0, food: 10 });
  assert.deepEqual(market, { gold: 4, food: 0 });
});

test('food barter never overdrafts any market balance from zero through twelve units', () => {
  for (let stock = 0; stock <= 12; stock++) {
    const buyer = { gold: 4, food: 0 };
    const market = { gold: 0, food: stock };
    const beforeBuyer = structuredClone(buyer), beforeMarket = structuredClone(market);

    const settled = exchangeResources(buyer, { gold: 4 }, market, { food: 10 });

    assert.equal(settled, stock >= 10, '10 units are required for this exchange at market balance ' + stock);
    for (const value of Object.values(buyer)) assert.ok(value >= 0);
    for (const value of Object.values(market)) assert.ok(value >= 0);
    if (!settled) {
      assert.deepEqual(buyer, beforeBuyer);
      assert.deepEqual(market, beforeMarket);
    } else {
      assert.equal(buyer.food, 10);
      assert.equal(buyer.gold, 0);
      assert.equal(market.gold, 4);
      assert.equal(market.food, stock - 10);
    }
  }
});

test('personal harvest leaves room for the reserve refill and caps surplus before removing biomass', () => {
  const person = { carriedFruit: 23.5 };
  assert.equal(personalFoodHarvestLimit(person, 5, 0), 0.5);
  assert.equal(personalFoodHarvestLimit(person, 5, 0.25), 0.75);
  assert.equal(personalFoodHarvestLimit(person, 5, 0, true), 5, 'direct community storage does not consume personal carry space');
});

test('community harvest applies remaining carry capacity before removing finite crop biomass', () => {
  const cropIndex = PLANTS.findIndex(plant => plant.id === 'cultivated-root');
  assert.ok(cropIndex >= 0);
  const tile = {
    i: 0, x: 0, y: 0, terrain: 'land', cropFieldId: 7,
    plants: new Float32Array(PLANTS.length), detritusGPerM2: 0
  };
  tile.plants[cropIndex] = 50;
  const field = { id: 7, type: 'roça', complete: true, communityId: 3, integrity: 1 };
  const community = { id: 3, name: 'Teste', dissolved: false, stores: { food: 0 } };
  const person = {
    id: 9, x: 0, y: 0, communityId: 3, carriedFood: 23.5,
    energy: 100, skills: { forage: 0 }
  };
  const world = {
    day: 12, tiles: [tile], structures: [field], communities: [community], people: [],
    harvests: {}, ecologyFlows: {}
  };
  const beforeTotal = tile.plants[cropIndex] + person.carriedFood + community.stores.food;

  assert.equal(collectFoodForCommunity(world, person, tile), 0.5);
  assert.equal(tile.plants[cropIndex], 49.5);
  assert.equal(person.carriedFood, 0);
  assert.equal(community.stores.food, 24);
  assert.equal(tile.plants[cropIndex] + person.carriedFood + community.stores.food, beforeTotal);
  assert.equal(world.harvests.plantFoodBiomass, 0.5);
});

test('a delegated field harvest delivers a full 24-unit load in one action', () => {
  const cropIndex = PLANTS.findIndex(plant => plant.id === 'cultivated-root');
  const tile = {
    i: 0, x: 0, y: 0, terrain: 'land', cropFieldId: 7,
    plants: new Float32Array(PLANTS.length), detritusGPerM2: 0
  };
  tile.plants[cropIndex] = 50;
  const field = { id: 7, type: 'roça', complete: true, communityId: 3, integrity: 1 };
  const community = { id: 3, dissolved: false, memberIds: [9], stores: { food: 0 } };
  const person = { id: 9, x: 0, y: 0, communityId: 3, carriedFood: 0,
    energy: 100, skills: { forage: 0 } };
  const world = { day: 12, tiles: [tile], structures: [field], communities: [community], people: [person],
    harvests: {}, ecologyFlows: {} };
  const initialFood = tile.plants[cropIndex] + person.carriedFood + community.stores.food;

  assert.equal(COMMUNITY_FOOD_CARRY_CAPACITY, 24);
  assert.equal(collectFoodForCommunity(world, person, tile), 24);
  assert.equal(community.stores.food, 24);
  assert.equal(person.carriedFood, 0);
  assert.equal(tile.plants[cropIndex], 26);
  assert.equal(tile.plants[cropIndex] + person.carriedFood + community.stores.food, initialFood);
  assert.equal(world.harvests.cultivatedFoodBiomass, 24);
});

test('food reserve transfer is limited by the source and destination capacity', () => {
  const source = { foodReserve: 0.2 };
  const destination = { foodReserve: 99.9 };
  assert.ok(Math.abs(transferFoodReserve(source, destination, 5) - 0.1) < 1e-9);
  assert.ok(Math.abs(source.foodReserve - 0.1) < 1e-9);
  assert.ok(Math.abs(destination.foodReserve - 100) < 1e-9);
});

test('campaign ration debits only available field food and respects personal reserve capacity', () => {
  const person = { id: 10, alive: true, role: 'soldier', kingdomId: 1, campaignId: 20, foodReserve: 96 };
  const side = {
    campaignId: 20, kingdomId: 1, role: 'attacker', troopIds: [person.id],
    supply: { stock: { food: 0.2 } }, rationsConsumed: 0,
    supplyLedger: { rationConsumptionFood: 0, personalReserveRationDays: 0 }
  };
  const campaign = { id: 20, status: 'marching', attacker: side,
    defender: { campaignId: 20, kingdomId: 2, role: 'defender', troopIds: [], supply: { stock: { food: 0 } } } };
  const world = { people: [person], campaigns: [campaign] };
  const initialFoodDays = person.foodReserve + side.supply.stock.food * FOOD_DAYS_PER_UNIT;

  const rationDays = drawCampaignRation(world, person, 12);
  assert.ok(Math.abs(rationDays - 0.2 * FOOD_DAYS_PER_UNIT) < 1e-9);
  assert.equal(side.supply.stock.food, 0);
  assert.equal(person.foodReserve, 96, 'ration drawing reports nutrition for the caller to credit exactly once');
  assert.equal(side.rationsConsumed, 0.2);
  assert.equal(side.supplyLedger.rationConsumptionFood, 0.2);
  assert.ok(Math.abs(person.foodReserve + side.supply.stock.food * FOOD_DAYS_PER_UNIT + rationDays - initialFoodDays) < 1e-9,
    'field food is reported as personal reserve days at the configured conversion rate');

  person.foodReserve = 100;
  side.supply.stock.food = 1;
  assert.equal(drawCampaignRation(world, person, 12), 0, 'a full personal reserve cannot consume another field ration');
  assert.equal(side.supply.stock.food, 1);
});
