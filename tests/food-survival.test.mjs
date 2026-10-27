import test from 'node:test';
import assert from 'node:assert/strict';
import engine from '../src/simulation/engine.js';
import { bestPeopleFoodCell, collectFoodForCommunity } from '../src/simulation/individuals/actions.js';
import { distance } from '../src/simulation/core/math.js';
import { PLANTS } from '../src/config/ecosystem.js';
import { cellAt } from '../src/simulation/world/spatial.js';
import Senses from '../src/simulation/individuals/perception.js';

function starvingPeacetimeSoldierFixture(garrisonFood = 0) {
  const world = engine.createWorld(42);
  const soldier = world.people.find(person => person.alive && person.role === 'soldier');
  assert.ok(soldier, 'seed 42 includes a peacetime soldier');
  soldier.perception = Senses.observe(world, soldier, 'person', PLANTS);
  const foodTile = bestPeopleFoodCell(world, soldier, 8);
  assert.ok(foodTile, 'a reachable food target is visible nearby');

  const community = world.communities.find(item => item.id === soldier.communityId);
  const kingdom = world.kingdoms.find(item => item.id === soldier.kingdomId);
  community.memberIds = [soldier.id];
  community.stores.food = garrisonFood;
  kingdom.treasury.stock.food = 0;
  kingdom.communityId = community.id;
  world.people = [soldier];
  world.day = 1;
  Object.assign(soldier, {
    foodReserve: 0,
    health: 30,
    energy: 60,
    hydration: 80,
    injury: 0,
    campaignId: null,
    tacticalRecovering: false,
    restingStructureId: null,
    militaryRestTargetId: null,
    homeRestTargetId: null,
    carriedFood: 0,
    carriedFruit: 0,
    carriedMeat: 0
  });
  return { world, soldier, foodTile };
}

test('peacetime soldiers do not forage under critical food pressure even when food is visible', () => {
  const { world, soldier, foodTile } = starvingPeacetimeSoldierFixture();
  const biomassBefore = foodTile.plants.slice();
  for (let day = 1; day <= 2; day++) {
    world.day = day;
    engine.modules.SocietyExperiment.updatePeople(world);
  }

  assert.notEqual(soldier.lastDecision.action, 'forage');
  assert.equal(soldier.foodReserve, 0, 'empty garrison and community stores do not create a ration');
  assert.deepEqual(foodTile.plants, biomassBefore, 'the soldier leaves civilian food sources untouched');
});

test('a peacetime soldier buys a finite garrison ration with salary when shared supply is empty', () => {
  const { world, soldier, foodTile } = starvingPeacetimeSoldierFixture();
  const kingdom = world.kingdoms.find(item => item.id === soldier.kingdomId);
  const walletGold = 5;
  soldier.militaryWallet ||= { stock: { gold: 0 } };
  soldier.militaryWallet.stock.gold = walletGold;
  kingdom.market.stock.food = 100;
  kingdom.market.prices.food = 1;
  soldier.health = 100;
  soldier.energy = 100;
  const marketFoodBefore = kingdom.market.stock.food;
  const biomassBefore = foodTile.plants.slice();

  engine.modules.SocietyExperiment.updatePeople(world);

  const foodPurchased = marketFoodBefore - kingdom.market.stock.food;
  assert.ok(foodPurchased > 0, 'salary buys food from the kingdom market');
  assert.ok(foodPurchased <= walletGold / kingdom.market.prices.food, 'the purchase cannot exceed the real wallet');
  assert.ok(soldier.militaryWallet.stock.gold < walletGold, 'the market debits the soldier wallet');
  assert.ok(soldier.foodReserve > 0, 'the purchased ration reaches the soldier after daily consumption');
  assert.equal(kingdom.market.transactions, 1);
  assert.equal(kingdom.treasury.stock.food, 0);
  assert.equal(world.communities.find(item => item.id === soldier.communityId).stores.food, 0);
  assert.notEqual(soldier.lastDecision.action, 'forage');
  assert.deepEqual(foodTile.plants, biomassBefore, 'the soldier still leaves civilian food sources untouched');
});

test('a hungry peacetime soldier returns to a stocked garrison before foraging', () => {
  const { world, soldier } = starvingPeacetimeSoldierFixture(20);
  const center = world.structures.find(structure => structure.id === soldier.militaryCenterId);
  assert.ok(center, 'seed 42 gives the soldier a valid military center');
  soldier.health = 100;
  soldier.energy = 100;
  const before = distance(soldier, center);

  engine.modules.SocietyExperiment.updatePeople(world);

  assert.equal(soldier.lastDecision.action, 'return_garrison');
  assert.ok(distance(soldier, center) < before, 'the soldier moves toward the actual ration source');
});

test('cultivated food delivered at the field is attributed to that field and community stock', () => {
  const { world, soldier: worker } = starvingPeacetimeSoldierFixture();
  worker.role = 'resident';
  const community = world.communities.find(item => item.id === worker.communityId);
  community.stores.food = 0;
  const cropIndex = PLANTS.findIndex(plant => plant.id === 'cultivated-root');
  const crop = cellAt(world, Math.round(worker.x), Math.round(worker.y));
  const field = { id: 99003, type: 'roça', communityId: community.id, complete: true, fieldTileIndices: [crop.i] };
  crop.cropFieldId = field.id;
  crop.plants.fill(0);
  crop.plants[cropIndex] = 100;
  world.structures.push(field);

  const collected = collectFoodForCommunity(world, worker, crop);

  assert.equal(collected, 24, 'one farm collection fills the defined communal load');
  assert.equal(worker.carriedFood, 0, 'harvest next to its field is transferred without a redundant return trip');
  assert.equal(community.stores.food, 24, 'the harvested units reach the accessible community inventory');
  assert.equal(field.cropHarvested, 24, 'standing crop is debited by the real harvested amount');
  assert.equal(field.foodDelivered, 24, 'delivered production is separately attributed to its source field');
});

test('a starving resident assigned to harvest a ready field deposits food into shared stock', () => {
  const { world, soldier: worker } = starvingPeacetimeSoldierFixture();
  worker.role = 'resident';
  worker.militaryCenterId = null;
  worker.militaryDutyCenterId = null;
  worker.foodReserve = 0;
  worker.hydration = 100;
  worker.energy = 100;
  worker.health = 100;
  const community = world.communities.find(item => item.id === worker.communityId);
  community.stores.food = 0;
  const cropIndex = PLANTS.findIndex(plant => plant.id === 'cultivated-root');
  const crop = cellAt(world, Math.round(worker.x), Math.round(worker.y));
  crop.terrain = 'land';
  crop.cropFieldId = 99004;
  crop.plants.fill(0);
  crop.plants[cropIndex] = 100;
  crop.plantResourceMask |= 1 << cropIndex;
  worker.perception.resources = [{ x: crop.x, y: crop.y, distance: 0, terrain: 'land', slope: 0,
    biomass: { 'cultivated-root': 100 }, harvestableBiomass: { 'cultivated-root': 100 } }];
  const field = { id: 99004, type: 'roça', communityId: community.id, complete: true,
    cropCycleState: 'ready', cropYieldTarget: 100, fieldTileIndices: [crop.i] };
  world.structures.push(field);
  worker.assignment = { action: 'forage', goal: 'secure-shared-food', source: 'kingdom-strategy',
    communityId: community.id, foodFieldId: field.id, expiresDay: world.day + 10 };

  engine.modules.SocietyExperiment.updatePeople(world);

  assert.ok(community.stores.food > 0, 'assigned harvest replenishes the shared stock despite empty personal reserves');
  assert.equal(worker.carriedFood, 0, 'the harvest is stored at the field without a cargo detour');
  assert.equal(field.foodDelivered, community.stores.food, 'field output is attributed to the matching shared-stock deposit');
});

test('an adult with critical hunger harvests nearby food while critical water remains out of reach', () => {
  const { world, soldier } = starvingPeacetimeSoldierFixture();
  soldier.role = 'resident';
  soldier.militaryCenterId = null;
  soldier.militaryDutyCenterId = null;
  const cropIndex = PLANTS.findIndex(plant => plant.id === 'cultivated-root');
  const crop = cellAt(world, Math.round(soldier.x), Math.round(soldier.y));
  crop.terrain = 'land';
  crop.cropFieldId = 99001;
  crop.plants[cropIndex] = 100;
  soldier.perception.resources = [{ x: crop.x, y: crop.y, distance: 0, terrain: 'land', slope: 0,
    biomass: { 'cultivated-root': 100 }, harvestableBiomass: { 'cultivated-root': 100 } }];
  const water = cellAt(world, crop.x + 3, crop.y);
  water.terrain = 'water';
  water.waterKind = 'lake';
  water.surfaceWaterMm = 20;
  soldier.perception.knownWater = [{ x: water.x, y: water.y, distance: 3, confidence: 1 }];
  soldier.foodReserve = 1.1;
  soldier.hydration = 8;
  soldier.health = 50;
  const biomassBefore = crop.plants[cropIndex];

  engine.modules.SocietyExperiment.updatePeople(world);

  assert.equal(soldier.lastDecision.action, 'forage',
    'a food deficit that cannot cover the next ration is handled before walking farther for water');
  assert.ok(crop.plants[cropIndex] < biomassBefore, 'the finite crop paid for the meal');
  assert.ok(soldier.foodReserve > 0, 'the action restored food from the harvested crop');
  assert.ok(soldier.hydration < 8, 'the decision does not invent water while food is harvested');
});

test('critical thirst takes priority over food that is close by but separated by an impassable route', () => {
  const { world, soldier } = starvingPeacetimeSoldierFixture();
  soldier.role = 'resident';
  soldier.militaryCenterId = null;
  soldier.militaryDutyCenterId = null;
  soldier.foodReserve = .5;
  soldier.hydration = 8;
  soldier.health = 50;
  soldier.energy = 100;

  const x = Math.round(soldier.x), y = Math.round(soldier.y);
  const crop = cellAt(world, x + 2, y);
  const cropIndex = PLANTS.findIndex(plant => plant.id === 'cultivated-root');
  crop.terrain = 'land';
  crop.cropFieldId = 99002;
  crop.plants[cropIndex] = 100;
  for (const tile of world.tiles) if (tile.x === x + 1) tile.terrain = 'water';

  const water = cellAt(world, x, y + 3);
  water.terrain = 'water';
  water.waterKind = 'lake';
  water.surfaceWaterMm = 20;
  soldier.perception.knownWater = [{ x: water.x, y: water.y, distance: 3, confidence: 1 }];
  soldier.perception.resources = [{ x: crop.x, y: crop.y, distance: 2, terrain: 'land', slope: 0,
    biomass: { 'cultivated-root': 100 }, harvestableBiomass: { 'cultivated-root': 100 } }];
  const beforeWaterDistance = distance(soldier, water);

  assert.equal(bestPeopleFoodCell(world, soldier, 8), crop,
    'the food patch has a reachable interaction edge on its own side of the water barrier');

  engine.modules.SocietyExperiment.updatePeople(world);

  assert.equal(soldier.lastDecision.action, 'drink',
    'an emergency meal must not suppress critical hydration when there is no route to the patch');
  assert.ok(distance(soldier, water) < beforeWaterDistance, 'the agent makes progress toward the reachable water source');
});
