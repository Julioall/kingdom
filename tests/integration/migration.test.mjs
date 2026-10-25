import { performFrontierWork } from '../../src/simulation/kingdoms/frontier-conflicts.js';
import { advanceKingdomProjects } from '../../src/simulation/kingdoms/projects.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../../src/simulation/engine.js';
import { addFoodReserve, addResource, consumeCarriedFood, consumeFoodReserve, exchangeResources, moveCarriedResource, spendInventory, transferFoodReserve, transferInventory, transferInventoryToStores, transferResource } from '../../src/simulation/economy/inventories.js';
import { corralGate, moveOne } from '../../src/simulation/individuals/movement.js';
import { bestPeopleFoodCell, bestPeopleMigrationCell, collectFoodForCommunity, nearestHuntable, updatePeople } from '../../src/simulation/individuals/actions.js';
import { collectCommunityFieldSeeds, eatPlants, isTreeAnchor, plantBiomass, sowCommunityField, updatePlants } from '../../src/simulation/ecology/plants.js';
import { chooseBuildSite, nextCommunityStructure, workOnCommunityStructure } from '../../src/simulation/settlements/construction.js';
import { observeKingdomStrategy, planKingdomStrategy } from '../../src/simulation/kingdoms/strategy.js';
import { makeAnimal } from '../../src/simulation/ecology/animals.js';
import Senses from '../../src/simulation/individuals/perception.js';
import { marketHasTradeOpportunity, performTrade } from '../../src/simulation/economy/trade.js';
import { addIndividuals, makePerson, reproducePeople, updateDependent } from '../../src/simulation/individuals/lifecycle.js';
import { buildKingdomStructure, recruitKingdomSoldier } from '../../src/simulation/kingdoms/commands.js';
import { INITIAL_POPULATION_PER_KINGDOM, updateKingdomMarkets } from '../../src/simulation/kingdoms/initialization.js';
import { DAILY_FOOD_NEED, FOOD_RESERVE_PER_UNIT, HUMAN_FOOD, PLANTS, SHEEP_FORAGE } from '../../src/config/ecosystem.js';
import { cellAt } from '../../src/simulation/world/spatial.js';

function movementWorld() {
  const width = Sim.width, height = Sim.height;
  return {
    width, height, seed: 1, structures: [],
    tiles: Array.from({ length: width * height }, (_, i) => ({
      i, x: i % width, y: Math.floor(i / width), terrain: 'land', slope: 0,
      plants: new Float32Array(PLANTS.length)
    }))
  };
}

function stateSummary(world) {
  return {
    snapshot: Sim.snapshot(world), rngState: world.rngState,
    kingdoms: world.kingdoms.map(kingdom => ({
      name: kingdom.name, rulerId: kingdom.rulerId, memberIds: kingdom.memberIds,
      homeIds: kingdom.homeIds, territoryTileCount: kingdom.territoryTileCount,
      treasury: kingdom.treasury.stock, market: kingdom.market
    })),
    people: world.people.map(person => [person.id, person.kingdomId, person.homeId, person.x, person.y, person.foodReserve, person.hydration]),
    structures: world.structures.map(structure => [structure.id, structure.kingdomId, structure.type, structure.x, structure.y, structure.cost])
  };
}

test('two starting kingdoms and ten simulation days reproduce for fixed seeds', () => {
  for (const seed of [1, 42, 987]) {
    const world = Sim.createWorld(seed);
    const replay = Sim.createWorld(seed);
    assert.equal(world.width, Sim.width);
    assert.equal(world.height, Sim.height);
    assert.equal(world.kingdoms.length, 2);
    assert.equal(world.tiles.length, Sim.width * Sim.height);
    assert.equal(world.lakes.length, 2);
    const ownedTileCount = world.tiles.filter(tile => tile.kingdomId !== null).length;
    assert.equal(world.kingdoms.reduce((sum, kingdom) => sum + kingdom.territoryTileCount, 0), ownedTileCount);
    assert.ok(world.kingdoms.every(kingdom => kingdom.territoryTileCount > 0));
    assert.ok(ownedTileCount < world.tiles.length, 'unclaimed land remains common');
    for (const kingdom of world.kingdoms) {
      const residents = kingdom.memberIds.map(id => world.people.find(person => person.id === id)).filter(Boolean);
      const homes = kingdom.homeIds.map(id => world.structures.find(structure => structure.id === id));
      assert.equal(residents.length, INITIAL_POPULATION_PER_KINGDOM);
      assert.equal(residents.filter(person => person.homeId !== null).length, residents.length);
      for (const child of residents.filter(person => person.ageDays < 12 * 365)) {
        const guardian = world.people.find(person => person.id === child.guardianId);
        assert.ok(guardian && guardian.alive && guardian.ageDays >= 12 * 365);
        assert.equal(guardian.kingdomId, child.kingdomId);
      }
      assert.ok(homes.every(home => home.type === 'casa' && home.complete));
      assert.ok(homes.reduce((sum, home) => sum + home.residentIds.length, 0) >= residents.length);
      assert.ok(world.people.some(person => person.id === kingdom.rulerId && person.role === 'ruler'));
      assert.ok(kingdom.structureIds.some(id => world.structures.find(structure => structure.id === id)?.type === 'castelo'));
      assert.ok(kingdom.structureIds.some(id => world.structures.find(structure => structure.id === id)?.type === 'mercado'));
    }
    assert.deepEqual(stateSummary(world), stateSummary(replay));
    for (let day = 0; day < 10; day++) {
      Sim.stepDay(world);
      Sim.stepDay(replay);
      assert.deepEqual(stateSummary(world), stateSummary(replay));
    }
  }
});

test('inventory spending is atomic and transfers conserve stock', () => {
  const treasury = { stock: { food: 10, wood: 4 } };
  const market = { stock: { food: 3, wood: 0 } };

  assert.equal(spendInventory(treasury, { food: 5, stone: 2 }), false);
  assert.deepEqual(treasury.stock, { food: 10, wood: 4 });
  assert.equal(spendInventory(treasury, { food: 4, wood: 2 }), true);
  assert.deepEqual(treasury.stock, { food: 6, wood: 2 });

  const moved = transferInventory(treasury, market, 'food', 9);
  assert.equal(moved, 6);
  assert.equal(treasury.stock.food, 0);
  assert.equal(market.stock.food, 9);
  assert.equal(transferInventory(treasury, market, 'food', -1), 0);
  assert.equal(treasury.stock.food + market.stock.food, 9);

  const reserve = { stock: { food: 7 } };
  const community = { stores: { food: 2 } };
  assert.equal(transferInventoryToStores(reserve, community, 'food', 4), 4);
  assert.equal(reserve.stock.food, 3);
  assert.equal(community.stores.food, 6);
  assert.equal(transferInventoryToStores(reserve, community, 'food', 4), 3);
  assert.equal(transferInventoryToStores(reserve, community, 'food', 1), 0);
  assert.equal(transferInventoryToStores(reserve, community, 'food', -1), 0);
  assert.equal(reserve.stock.food + community.stores.food, 9);

  const log = { amount: 5 };
  const carrier = { carriedWood: 22 };
  assert.equal(transferResource(log, carrier, 'amount', 5, 'carriedWood', 24), 2);
  assert.deepEqual([log.amount, carrier.carriedWood], [3, 24]);
  assert.equal(addResource(carrier, 'carriedWood', 2, 24), 0);
  assert.deepEqual([log.amount, carrier.carriedWood], [3, 24]);
});

test('validated inventory operations report exact treasury inflows and outflows', () => {
  const observed = [];
  const record = (category, delta) => observed.push({ category, delta: { ...delta } });
  const treasury = { stock: { food: 12, wood: 10 }, inventoryFlowRecorder: record };
  const campaignSupply = { stock: { food: 0, wood: 0 }, inventoryFlowRecorder: record };
  const community = { stores: { food: 0 } };

  assert.equal(spendInventory(treasury, { food: 3 }, 'soldier-recruitment'), true);
  assert.equal(spendInventory(treasury, { wood: 99 }, 'failed-spend'), false);
  assert.equal(transferInventory(treasury, campaignSupply, 'wood', 4, 'campaign-deployment'), 4);
  assert.equal(transferInventoryToStores(treasury, community, 'food', 2, 'community-reserve-delivery'), 2);
  assert.deepEqual(observed, [
    { category: 'soldier-recruitment', delta: { food: -3 } },
    { category: 'campaign-deployment', delta: { wood: -4 } },
    { category: 'campaign-deployment', delta: { wood: 4 } },
    { category: 'community-reserve-delivery', delta: { food: -2 } }
  ]);
});

test('tax history records the exact resource transfer while the chronicle formats it to cents', () => {
  const world = Sim.createWorld(42);
  const kingdom = world.kingdoms[0];
  const community = world.communities.find(item => item.id === kingdom.communityId);
  kingdom.policy.taxRate = .2;
  community.stores.food = 0;
  community.stores.wood = 18.3473;
  community.stores.stone = 12;
  community.stores.feed = 8;
  community.stores.gold = 4;
  const treasuryBefore = kingdom.treasury.stock.wood;
  const expectedTax = (community.stores.wood - 18) * kingdom.policy.taxRate;

  updateKingdomMarkets(world, 30);

  const taxRecord = kingdom.taxLedger.history.at(-1);
  assert.ok(Math.abs(taxRecord.tax.wood - expectedTax) < 1e-12);
  assert.ok(Math.abs(kingdom.treasury.stock.wood - treasuryBefore - expectedTax) < 1e-12);
  const message = world.events.findLast(event => event.text.includes(kingdom.name) && event.text.includes('recolheu tributos'));
  assert.match(message.text, /0\.07 wood/);
});

test('a tax assessment below the recording minimum leaves the resource in the community', () => {
  const world = Sim.createWorld(42);
  const kingdom = world.kingdoms[0];
  const community = world.communities.find(item => item.id === kingdom.communityId);
  kingdom.policy.taxRate = .2;
  Object.assign(community.stores, { food: 0, wood: 18, stone: 12.02, feed: 8, gold: 4 });
  const treasuryStoneBefore = kingdom.treasury.stock.stone;

  updateKingdomMarkets(world, 30);

  assert.equal(community.stores.stone, 12.02);
  assert.equal(kingdom.treasury.stock.stone, treasuryStoneBefore);
  assert.equal(Object.hasOwn(kingdom.taxLedger.history.at(-1).tax, 'stone'), false);
});

test('inventory exchange and market trades preserve exact account balances', () => {
  const first = { food: 9, gold: 1 };
  const second = { food: 2, gold: 5 };
  assert.equal(exchangeResources(first, { food: 4 }, second, { gold: 7 }), false);
  assert.deepEqual(first, { food: 9, gold: 1 });
  assert.deepEqual(second, { food: 2, gold: 5 });
  assert.equal(exchangeResources(first, { food: 4 }, second, { gold: 3 }), true);
  assert.deepEqual(first, { food: 5, gold: 4 });
  assert.deepEqual(second, { food: 6, gold: 2 });

  const world = Sim.createWorld(42);
  const kingdom = world.kingdoms[0];
  const community = world.communities.find(item => item.id === kingdom.communityId);
  const marketBuilding = world.structures.find(item => item.id === kingdom.marketId)
    || world.structures.find(item => item.type === 'mercado' && item.kingdomId === kingdom.id);
  const trader = world.people.find(item => item.id === kingdom.rulerId);
  trader.x = marketBuilding.x;
  trader.y = marketBuilding.y;
  community.stores.food = 60;
  community.stores.gold = 0;
  const marketFoodBefore = kingdom.market.stock.food;
  const marketGoldBefore = kingdom.market.stock.gold;
  assert.equal(marketHasTradeOpportunity(world, community), true);
  trader.x = marketBuilding.x + 4;
  trader.y = marketBuilding.y;
  assert.equal(performTrade(world, trader, community, {
    isMarket: true, market: kingdom.market, station: marketBuilding, distance: 4
  }), true);
  assert.ok(Sim.distance(trader, marketBuilding) < 4, 'trader walks to the market before transacting');
  trader.x = marketBuilding.x;
  trader.y = marketBuilding.y;
  assert.equal(performTrade(world, trader, community, {
    isMarket: true, market: kingdom.market, station: marketBuilding, distance: 1
  }), true);
  assert.equal(community.stores.food, 50);
  assert.equal(community.stores.gold, 4);
  assert.equal(kingdom.market.stock.food, marketFoodBefore + 10);
  assert.equal(kingdom.market.stock.gold, marketGoldBefore - 4);
  assert.match(world.events[0].text, /entregou 10 unidades de alimento e recebeu 4 unidades de ouro/);
  const foodSale = community.tradeLedger.history.at(-1);
  assert.equal(foodSale.day, 1);
  assert.equal(foodSale.kind, 'market');
  assert.deepEqual(foodSale.participants, [{ communityId: community.id, delta: { food: -10, gold: 4 } }]);
  assert.deepEqual(foodSale.market.delta, { food: 10, gold: -4 });
  assert.equal(kingdom.market.tradeLedger.history.at(-1).id, foodSale.id);
  assert.equal(world.events[0].day, 1);
  assert.ok(community.history.at(-1).includes('entregou 10 unidades de alimento e recebeu 4 unidades de ouro'));

  community.stores.food = 0;
  community.stores.wood = 30;
  community.stores.gold = 0;
  const barterFoodBefore = kingdom.market.stock.food;
  const barterWoodBefore = kingdom.market.stock.wood;
  assert.equal(performTrade(world, trader, community, {
    isMarket: true, market: kingdom.market, station: marketBuilding, distance: 1
  }), true);
  assert.equal(community.stores.wood, 22);
  assert.equal(community.stores.food, 12);
  assert.equal(kingdom.market.stock.food, barterFoodBefore - 12);
  assert.equal(kingdom.market.stock.wood, barterWoodBefore + 8);
  assert.match(world.events[0].text, /entregou 8 unidades de madeira e recebeu 12 unidades de alimento/);
  const resourceBarter = community.tradeLedger.history.at(-1);
  assert.deepEqual(resourceBarter.participants, [{ communityId: community.id, delta: { food: 12, wood: -8 } }]);
  assert.deepEqual(resourceBarter.market.delta, { food: -12, wood: 8 });
});

test('buying a sheep converts market stock into an animal without duplicating community inventory', () => {
  const world = Sim.createWorld(42);
  const kingdom = world.kingdoms[0];
  const community = world.communities.find(item => item.id === kingdom.communityId);
  const marketBuilding = world.structures.find(item => item.id === kingdom.marketId)
    || world.structures.find(item => item.type === 'mercado' && item.kingdomId === kingdom.id);
  const trader = world.people.find(item => item.id === kingdom.rulerId);
  const sheepBefore = world.animals.filter(item => item.alive && item.speciesId === 'sheep'
    && item.herdCommunityId === community.id).length;
  const marketSheepBefore = world.market.sheep;
  const animalsBefore = world.animals.length;
  community.stores.gold = 38;
  trader.x = marketBuilding.x;
  trader.y = marketBuilding.y;

  assert.equal(performTrade(world, trader, community, {
    isMarket: true, market: world.market, station: marketBuilding, distance: 1
  }), true);

  assert.equal(world.market.sheep, marketSheepBefore - 1);
  assert.equal(world.animals.length, animalsBefore + 1);
  assert.equal(world.animals.filter(item => item.alive && item.speciesId === 'sheep'
    && item.herdCommunityId === community.id).length, sheepBefore + 1);
  assert.equal(community.stores.sheep || 0, 0);
  const record = community.tradeLedger.history.at(-1);
  assert.equal(record.action, 'comprou uma ovelha');
  assert.deepEqual(record.participants[0].delta, { gold: -38 });
  assert.deepEqual(record.market.delta, { gold: 38, sheep: -1 });
  assert.deepEqual(record.assetsCreated.map(asset => ({ type: asset.type, speciesId: asset.speciesId, count: asset.count })), [
    { type: 'animal', speciesId: 'sheep', count: 1 }
  ]);
});

test('a direct community barter records both quantities in the chronicle', () => {
  const world = Sim.createWorld(42);
  const [kingdomA, kingdomB] = world.kingdoms;
  const communityA = world.communities.find(item => item.id === kingdomA.communityId);
  const communityB = world.communities.find(item => item.id === kingdomB.communityId);
  const trader = world.people.find(item => item.id === kingdomA.rulerId);
  communityA.stores.food = 30;
  communityB.stores.wood = 25;

  assert.equal(performTrade(world, trader, communityA, {
    community: communityB,
    person: world.people.find(item => item.id === kingdomB.rulerId),
    relation: { trust: .5, tension: .4, trades: 0 },
    distance: 1
  }), true);

  assert.match(world.events[0].text, /Valedouro trocou com Corvânia: Valedouro entregou 5 unidades de alimento e recebeu 5 unidades de madeira/);
  assert.equal(communityA.stores.food, 25);
  assert.equal(communityA.stores.wood, 5);
  assert.equal(communityB.stores.food, 5);
  assert.equal(communityB.stores.wood, 20);
  const record = communityA.tradeLedger.history.at(-1);
  assert.equal(record.kind, 'community-barter');
  assert.equal(record.day, 1);
  assert.deepEqual(record.participants, [
    { communityId: communityA.id, delta: { food: -5, wood: 5 } },
    { communityId: communityB.id, delta: { food: 5, wood: -5 } }
  ]);
  assert.equal(communityB.tradeLedger.history.at(-1).id, record.id);
});

test('personal food reserve additions, consumption, and sharing are bounded and conserved', () => {
  const giver = { foodReserve: 98 };
  const receiver = { foodReserve: 97 };
  assert.equal(addFoodReserve(giver, 10), 2);
  assert.equal(giver.foodReserve, 100);
  assert.equal(consumeFoodReserve(giver, 120), 100);
  assert.equal(giver.foodReserve, 0);
  assert.equal(consumeFoodReserve(giver, 1), 0);

  giver.foodReserve = 75;
  receiver.foodReserve = 97;
  assert.equal(transferFoodReserve(giver, receiver, 10), 3);
  assert.deepEqual([giver.foodReserve, receiver.foodReserve], [72, 100]);
  assert.equal(giver.foodReserve + receiver.foodReserve, 172);
  assert.equal(transferFoodReserve(giver, receiver, -1), 0);
  assert.deepEqual([giver.foodReserve, receiver.foodReserve], [72, 100]);
});

test('emergency carried-food consumption is bounded and recorded in inventory flows', () => {
  const flows = [];
  const person = { carriedFood: 2.5, inventoryFlowRecorder: (category, delta) => flows.push({ category, delta }) };

  assert.equal(consumeCarriedFood(person, 1.25, 'emergency-carried-food-consumption'), 1.25);
  assert.equal(person.carriedFood, 1.25);
  assert.equal(consumeCarriedFood(person, 4), 1.25);
  assert.equal(person.carriedFood, 0);
  assert.equal(consumeCarriedFood(person, 1), 0);
  assert.deepEqual(flows, [
    { category: 'emergency-carried-food-consumption', delta: { carriedFood: -1.25 } },
    { category: 'personal-carried-food-consumption', delta: { carriedFood: -1.25 } }
  ]);
});

test('emergency carried-food rations are explained in the chronicle and personal lesson', () => {
  const world = Sim.createWorld(42);
  const person = world.people[0];
  world.people = [person];
  Object.assign(person, {
    ageDays: 20 * 365, kingdomId: null, communityId: null, homeId: null, assignment: null,
    foodReserve: 0, carriedFood: 2, energy: 80, hydration: 80, health: 80, injury: 0
  });

  updatePeople(world);

  const used = DAILY_FOOD_NEED / FOOD_RESERVE_PER_UNIT;
  const event = world.events.find(entry => entry.text.includes('Ração emergencial: ' + person.name));
  assert.ok(Math.abs(person.carriedFood - (2 - used)) < .001);
  assert.equal(person.lastEmergencyRationDay, world.day);
  assert.ok(event && event.text.includes(used.toFixed(2) + ' unidades')
    && event.text.includes('estoque comunitário: 0.00 unidades'));
  assert.ok(person.lastLesson.includes('A ração de hoje consumiu ' + used.toFixed(2) + ' unidades da carga alimentar.'));
});

test('optional food reserve recorder reports exact gains, losses and transfers', () => {
  const flows = [];
  const source = { id: 11, foodReserve: 50, foodReserveFlowRecorder: entry => flows.push(entry) };
  const receiver = { id: 12, foodReserve: 40, foodReserveFlowRecorder: entry => flows.push(entry) };

  assert.equal(addFoodReserve(source, 3, 'personal-harvest'), 3);
  assert.equal(consumeFoodReserve(source, 2, 'resident-consumption'), 2);
  assert.equal(transferFoodReserve(source, receiver, 5, 'dependent-care-transfer'), 5);
  assert.deepEqual(flows.map(({ personId, category, delta }) => [personId, category, delta]), [
    [11, 'personal-harvest', 3], [11, 'resident-consumption', -2],
    [11, 'dependent-care-transfer', -5], [12, 'dependent-care-transfer', 5]
  ]);
  assert.equal(source.foodReserve + receiver.foodReserve, 91);
});

test('newborn food reserve is transferred from both parents without creating stock', () => {
  const world = Sim.createWorld(42);
  const [parentA, parentB] = world.people.slice(0, 2);
  for (const person of world.people) person.ageDays = 1000;
  Object.assign(parentA, { ageDays: 20 * 365, sex: 'F', energy: 70, foodReserve: 80, hydration: 70, health: 90, birthCooldown: 0, kingdomId: null, communityId: null });
  Object.assign(parentB, { ageDays: 22 * 365, sex: 'M', energy: 70, foodReserve: 70, hydration: 70, health: 90, birthCooldown: 0, kingdomId: null, communityId: null });
  parentA.x = parentB.x = 10;
  parentA.y = parentB.y = 10;
  world.socialLinks[`${parentA.id}:${parentB.id}`] = { trust: 0.5 };
  world.day = 29;
  const totalFoodBefore = parentA.foodReserve + parentB.foodReserve;

  reproducePeople(world);

  const baby = world.people.find(person => person.parents?.includes(parentA.id) && person.parents?.includes(parentB.id));
  assert.ok(baby);
  assert.equal(baby.foodReserve, 12);
  assert.equal(parentA.foodReserve, 73);
  assert.equal(parentB.foodReserve, 65);
  assert.equal(parentA.foodReserve + parentB.foodReserve + baby.foodReserve, totalFoodBefore);
  assert.ok(world.events[0].text.includes('transferiu 7 pontos') && world.events[0].text.includes('transferiu 5 pontos'));
  assert.equal(makePerson(world, 10, 10, true).foodReserve, 0);
});

test('arriving adults receive a bounded reserve credit that is disclosed in the chronicle', () => {
  const world = Sim.createWorld(42);
  const [personId] = addIndividuals(world, 1, false);
  const person = world.people.find(item => item.id === personId);

  assert.ok(person.foodReserve >= 55 && person.foodReserve <= 95);
  assert.ok(world.events[0].text.includes(person.foodReserve.toFixed(1) + ' pontos de reserva alimentar de fora do mapa'));
});

test('dependent care consumes food when the caregiver and community cannot provide it', () => {
  const world = Sim.createWorld(42);
  const child = world.people.find(person => person.ageDays < 12 * 365);
  const caregiver = world.people.find(person => person.id === child.guardianId);
  const community = world.communities.find(item => item.id === child.communityId);
  assert.ok(child && caregiver && community);
  child.parents = [caregiver.id];
  caregiver.x = 20; caregiver.y = 20;
  child.x = 20; child.y = 21;
  for (const person of world.people) {
    if (person.ageDays >= 12 * 365 && person.id !== caregiver.id) {
      person.x = 50;
      person.y = 50;
      person.foodReserve = 0;
    }
  }
  child.foodReserve = 10; child.health = 50; child.hydration = 50;
  caregiver.foodReserve = 0;
  community.stores.food = 0; community.stores.meat = 0;

  updateDependent(world, child);

  assert.equal(caregiver.foodReserve, 0);
  assert.equal(child.foodReserve, 9.58, 'the child reserve covers the unfunded care need');
  assert.notDeepEqual([child.x, child.y], [caregiver.x, caregiver.y], 'care does not place the child on the caregiver');
});

test('a full simulation day keeps visible living people on distinct tiles', () => {
  const world = Sim.createWorld(1);
  Sim.stepDay(world);
  const occupiedTiles = new Set();

  for (const person of world.people.filter(person => person.alive && person.restingStructureId == null)) {
    const tile = Math.round(person.x) + ':' + Math.round(person.y);
    assert.equal(occupiedTiles.has(tile), false, 'multiple people occupy tile ' + tile);
    occupiedTiles.add(tile);
  }
});

test('dependent care switches from an empty guardian to a nearby adult with food', () => {
  const world = Sim.createWorld(42);
  const child = world.people.find(person => person.ageDays < 12 * 365);
  const guardian = world.people.find(person => person.id === child.guardianId);
  const nearbyAdult = world.people.find(person => person.alive && person.ageDays >= 12 * 365
    && person.id !== guardian.id && person.kingdomId === child.kingdomId);
  const community = world.communities.find(item => item.id === child.communityId);
  assert.ok(child && guardian && nearbyAdult && community);

  child.parents = [guardian.id];
  child.guardianId = guardian.id;
  child.x = 20; child.y = 21;
  guardian.x = 20; guardian.y = 20;
  nearbyAdult.x = 21;
  nearbyAdult.y = 20;
  for (const person of world.people) {
    if (person.ageDays >= 12 * 365 && person.id !== guardian.id && person.id !== nearbyAdult.id) {
      person.x = 50;
      person.y = 50;
    }
  }
  child.foodReserve = 10;
  guardian.foodReserve = 0;
  nearbyAdult.foodReserve = 50;
  community.stores.food = 0;
  community.stores.meat = 0;

  updateDependent(world, child);

  assert.equal(child.guardianId, nearbyAdult.id);
  assert.equal(child.foodReserve, 10, 'the nearby adult replaces the dependent care food that the child consumed');
  assert.equal(nearbyAdult.foodReserve, 49.58, 'care is transferred from the adult reserve');
  assert.equal(guardian.foodReserve, 0);
  assert.ok(world.events.some(event => event.text.includes(nearbyAdult.name + ' apoiou ' + child.name)
    && event.text.includes('transferiu 0.42 pontos')));
});

test('an orphaned dependent travels toward a distant fed adult without creating food', () => {
  const world = Sim.createWorld(42);
  const child = world.people.find(person => person.ageDays < 12 * 365);
  const guardian = world.people.find(person => person.id === child.guardianId);
  const community = world.communities.find(item => item.id === child.communityId);
  const rescueAdult = world.people.find(person => person.alive && person.ageDays >= 12 * 365
    && person.id !== guardian.id && person.kingdomId === child.kingdomId);
  assert.ok(child && guardian && community && rescueAdult);

  guardian.alive = false;
  child.parents = [guardian.id];
  child.guardianId = guardian.id;
  child.x = 20; child.y = 20;
  rescueAdult.x = 34; rescueAdult.y = 20;
  rescueAdult.foodReserve = 70;
  child.foodReserve = 70;
  community.stores.food = 0; community.stores.meat = 0;
  for (const adult of world.people.filter(person => person.alive && person.ageDays >= 12 * 365
    && person.kingdomId === child.kingdomId && person.id !== rescueAdult.id)) {
    adult.x = 60; adult.y = 60;
    adult.foodReserve = 0;
  }
  for (let x = 20; x <= 34; x++) {
    const tile = cellAt(world, x, 20);
    tile.terrain = 'land';
    tile.elevationLevel = 0;
  }

  const totalFoodBefore = child.foodReserve + rescueAdult.foodReserve;
  for (let day = 0; day < 20 && child.guardianId !== rescueAdult.id; day++) updateDependent(world, child);

  assert.equal(child.guardianId, rescueAdult.id);
  assert.notDeepEqual([child.x, child.y], [rescueAdult.x, rescueAdult.y], 'the dependent must not occupy the caregiver tile');
  assert.ok(Math.abs(child.x - rescueAdult.x) <= 6 && Math.abs(child.y - rescueAdult.y) <= 6,
    'the dependent still reaches care range');
  assert.ok(rescueAdult.foodReserve < 70, 'care comes from the adult reserve');
  assert.ok(child.foodReserve + rescueAdult.foodReserve < totalFoodBefore, 'daily care consumes finite food');
  assert.equal(community.stores.food, 0);
});

test('kingdom defense construction debits resources at start and adds territory only after work days', () => {
  const world = Sim.createWorld(42);
  const kingdom = world.kingdoms[0];
  kingdom.treasury.stock = { food: 0, wood: 34, stone: 24, gold: 8 };
  const started = buildKingdomStructure(world, kingdom.id, 'torre');

  assert.equal(started.ok, true);
  assert.equal(started.pending, true);
  assert.equal(started.structure.complete, false);
  assert.equal(started.structure.progress, 0);
  assert.equal(started.structure.builtDay, null);
  assert.deepEqual(kingdom.treasury.stock, { food: 0, wood: 0, stone: 0, gold: 0 });
  assert.equal(buildKingdomStructure(world, kingdom.id, 'centro_militar').ok, false,
    'one kingdom project occupies the defense construction queue');

  const builder = world.people.find(p => p.role === 'resident' && p.kingdomId === kingdom.id && p.ageDays >= 18 * 365);
  builder.x = started.structure.x; builder.y = started.structure.y;
  started.structure.workerIds = [builder.id];
  for (let day = 1; day < started.structure.required; day++) {
    world.day = day - 1;
    performFrontierWork(world, builder, { project: started.structure });
    advanceKingdomProjects(world, day);
  }
  assert.equal(started.structure.complete, false);
  world.day = started.structure.required - 1;
  performFrontierWork(world, builder, { project: started.structure });
  advanceKingdomProjects(world, started.structure.required);
  assert.equal(started.structure.complete, true);
  assert.equal(started.structure.builtDay, started.structure.required);
});

test('kingdom recruitment debits its finite cost and enters the garrison after training days', () => {
  const world = Sim.createWorld(42);
  const kingdom = world.kingdoms[0];
  const center = world.structures.find(item => item.id === kingdom.militaryCenterIds[0]);
  kingdom.treasury.stock = { food: 10, wood: 8, gold: 3 };
  const started = recruitKingdomSoldier(world, kingdom.id);

  assert.equal(started.ok, true);
  assert.equal(started.pending, true);
  assert.equal(started.person.role, 'resident');
  assert.ok(started.person.recruitmentOrder);
  assert.deepEqual(kingdom.treasury.stock, { food: 0, wood: 0, gold: 0 });
  assert.equal(center.soldierIds.includes(started.person.id), false);

  Sim.tick(world, started.readyDay - world.day - 1);
  assert.equal(started.person.role, 'resident');
  Sim.stepDay(world);
  assert.equal(started.person.role, 'soldier');
  assert.equal(started.person.recruitmentOrder, undefined);
  assert.ok(center.soldierIds.includes(started.person.id));
});

test('parallel kingdom recruitment reserves different residents and charges each training cost once', () => {
  const world = Sim.createWorld(42);
  const kingdom = world.kingdoms[0];
  const center = world.structures.find(item => item.id === kingdom.militaryCenterIds[0]);
  kingdom.treasury.stock = { food: 20, wood: 16, gold: 6 };

  const first = recruitKingdomSoldier(world, kingdom.id);
  const second = recruitKingdomSoldier(world, kingdom.id);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.notEqual(second.person.id, first.person.id, 'a resident already in training cannot be recruited again');
  assert.equal(first.person.recruitmentOrder.readyDay, 6);
  assert.equal(second.person.recruitmentOrder.readyDay, 6);
  assert.deepEqual(kingdom.treasury.stock, { food: 0, wood: 0, gold: 0 });

  Sim.tick(world, 6);

  assert.equal(first.person.role, 'soldier');
  assert.equal(second.person.role, 'soldier');
  assert.ok(center.soldierIds.includes(first.person.id));
  assert.ok(center.soldierIds.includes(second.person.id));
});

test('domesticated sheep move and graze inside the pen when stored feed is empty', () => {
  const world = Sim.createWorld(42);
  const kingdom = world.kingdoms[0];
  const community = world.communities.find(item => item.id === kingdom.communityId);
  community.stores.feed = 0;
  const pen = world.structures.find(structure => structure.type === 'curral' && structure.communityId === community.id);
  const sheep = makeAnimal(world, 'sheep', pen.x, pen.y, false);
  sheep.herdCommunityId = community.id;
  sheep.aiEnabled = false;
  world.animals.push(sheep);
  const pasture = world.tiles.filter(tile => Sim.distance(tile, pen) <= pen.radius
      && plantBiomass(tile, SHEEP_FORAGE) > .2)
    .sort((a, b) => plantBiomass(b, SHEEP_FORAGE) - plantBiomass(a, SHEEP_FORAGE))[0];
  assert.ok(sheep && pasture, 'starting kingdom has a penned sheep and forage in the pen');
  sheep.energy = 25;
  const start = { x: sheep.x, y: sheep.y };
  const biomassBefore = world.tiles.filter(tile => Sim.distance(tile, pen) <= pen.radius)
    .reduce((sum, tile) => sum + plantBiomass(tile, SHEEP_FORAGE), 0);

  Sim.modules.Biosphere.Zoology.updateAnimals(world);

  const biomassAfter = world.tiles.filter(tile => Sim.distance(tile, pen) <= pen.radius)
    .reduce((sum, tile) => sum + plantBiomass(tile, SHEEP_FORAGE), 0);
  assert.ok(biomassAfter < biomassBefore);
  assert.ok(sheep.lastGrazeAmount > 0);
  assert.ok(sheep.energy >= 25 - .01, 'grazing replenishes the energy lost to daily upkeep');
  assert.ok(Sim.distance(sheep, start) > 0, 'sheep leave the center to reach pasture');
  assert.ok(Sim.distance(sheep, pen) <= pen.radius, 'sheep remain inside the pen');
});

test('domesticated sheep use nearby pasture when the pen has no browse', () => {
  const world = Sim.createWorld(42);
  const community = world.communities.find(item => item.id === world.kingdoms[0].communityId);
  community.stores.feed = 0;
  const pen = world.structures.find(structure => structure.type === 'curral' && structure.communityId === community.id);
  const browseIndex = PLANTS.findIndex(plant => plant.id === 'browse');
  const grassIndex = PLANTS.findIndex(plant => plant.id === 'grass');
  const grazingRadius = (pen.radius || 3.5) + 2;
  for (const tile of world.tiles) {
    if (Sim.distance(tile, pen) <= grazingRadius) {
      tile.plants[browseIndex] = 0;
      tile.plants[grassIndex] = 0;
    }
  }
  const pasture = world.tiles.filter(tile => tile.terrain === 'land'
      && Sim.distance(tile, pen) > (pen.radius || 3.5)
      && Sim.distance(tile, pen) <= grazingRadius)
    .sort((left, right) => Sim.distance(left, pen) - Sim.distance(right, pen))[0];
  assert.ok(pasture, 'the pen has land available just beyond its fence');
  pasture.plants[browseIndex] = 30;
  const sheep = makeAnimal(world, 'sheep', pen.x, pen.y, false);
  sheep.herdCommunityId = community.id;
  sheep.aiEnabled = false;
  sheep.energy = 25;
  world.animals.push(sheep);

  Sim.modules.Biosphere.Zoology.updateAnimals(world);

  assert.ok(sheep.lastGrazeAmount > 0);
  assert.ok(plantBiomass(pasture, ['browse']) < 30);
  assert.ok(sheep.energy >= 25 - .01, 'nearby grazing covers the daily energy upkeep');
  assert.equal(sheep.state, 'pastando perto do curral');
});

test('wild sheep flock together, migrate toward grass, and graze it', () => {
  const world = Sim.createWorld(42);
  const grassIndex = PLANTS.findIndex(plant => plant.id === 'grass');
  const browseIndex = PLANTS.findIndex(plant => plant.id === 'browse');
  world.animals = [];
  world.structures = [];
  for (const tile of world.tiles) {
    tile.terrain = 'land';
    tile.kingdomId = null;
    tile.elevationLevel = 0;
    tile.plants[grassIndex] = 0;
    tile.plants[browseIndex] = 0;
  }
  const pasture = cellAt(world, 64, 64);
  pasture.plants[grassIndex] = 100;
  const sheep = [
    makeAnimal(world, 'sheep', 58, 64, false),
    makeAnimal(world, 'sheep', 58, 65, false),
    makeAnimal(world, 'sheep', 59, 64, false)
  ];
  for (const animal of sheep) {
    animal.energy = 45;
    animal.hydration = 100;
    animal.ageDays = 500;
    animal.reproductionCooldown = 100;
    world.animals.push(animal);
  }
  const initialDistance = sheep.reduce((sum, animal) => sum + Sim.distance(animal, pasture), 0);

  for (let day = 0; day < 8; day++) Sim.modules.Biosphere.Zoology.updateAnimals(world);

  const finalDistance = sheep.reduce((sum, animal) => sum + Sim.distance(animal, pasture), 0);
  assert.ok(finalDistance < initialDistance, 'the flock migrates toward the nearby pasture');
  assert.ok(pasture.plants[grassIndex] < 100, 'the flock eats grass at the pasture');
  assert.ok(sheep.every(animal => animal.herdCommunityId == null), 'wild sheep remain unassigned to a community');
});

test('people do not hunt livestock assigned to a community herd', () => {
  const world = Sim.createWorld(42);
  const community = world.communities[0];
  const sheep = makeAnimal(world, 'sheep', 20, 20, false);
  sheep.herdCommunityId = community.id;
  sheep.aiEnabled = false;
  world.animals.push(sheep);
  const hunter = {
    x: 20, y: 22,
    perception: { animals: [{ id: sheep.id, speciesId: 'sheep', x: sheep.x, y: sheep.y, distance: 2, visible: true }] }
  };

  assert.equal(nearestHuntable(world, hunter, 3), null);

  sheep.herdCommunityId = null;
  assert.equal(nearestHuntable(world, hunter, 3), sheep);
});

test('delegated forage becomes a conserved carried load for the community store', () => {
  const world = Sim.createWorld(42);
  const kingdom = world.kingdoms[0];
  const community = world.communities.find(item => item.id === kingdom.communityId);
  const person = world.people.find(item => item.role === 'resident' && item.communityId === community.id);
  const tile = world.tiles.filter(item => item.terrain === 'land' && plantBiomass(item, HUMAN_FOOD) > 2)
    .sort((a, b) => plantBiomass(b, HUMAN_FOOD) - plantBiomass(a, HUMAN_FOOD))[0];
  person.foodReserve = 60;
  person.energy = 80;
  const reserveBefore = person.foodReserve;
  const energyBefore = person.energy;
  const biomassBefore = plantBiomass(tile, HUMAN_FOOD);

  const carried = collectFoodForCommunity(world, person, tile);
  assert.ok(carried > 0);
  assert.equal(person.foodReserve, reserveBefore, 'the worker keeps the harvest for shared storage');
  assert.ok(person.energy < energyBefore);
  assert.ok(plantBiomass(tile, HUMAN_FOOD) < biomassBefore);
  assert.equal(world.harvests.plantFoodBiomass, carried,
    'the diagnostic counts the berry biomass removed before transport');
  assert.equal(Sim.snapshot(world).harvests.plantFoodBiomass, carried,
    'the harvest counter remains available to replay snapshots');
  assert.equal(community.stores.food, 0);

  assert.equal(moveCarriedResource(person, 'carriedFood', community, 'food', carried), carried);
  assert.equal(person.carriedFood, 0);
  assert.equal(community.stores.food, carried);
});

test('personal foraging records biomass removed from the landscape', () => {
  const world = Sim.createWorld(42);
  const person = world.people[0];
  const berryIndex = PLANTS.findIndex(plant => plant.id === 'berry');
  const tile = world.tiles.filter(item => (item.plants[berryIndex] || 0) > 8)
    .sort((a, b) => b.plants[berryIndex] - a.plants[berryIndex])[0];
  assert.ok(tile);

  Object.assign(person, { ageDays: 20 * 365, x: tile.x, y: tile.y, communityId: null,
    kingdomId: null, homeId: null, foodReserve: 0, energy: 60, hydration: 70,
    health: 80, injury: 0, assignment: null, headingX: 0, headingY: 0 });
  world.people = [person];
  world.animals = [];
  world.communities = [];
  world.kingdoms = [];
  world.structures = [];
  const biomassBefore = tile.plants[berryIndex];

  updatePeople(world);

  assert.ok(world.harvests.plantFoodBiomass > 0);
  assert.ok(tile.plants[berryIndex] < biomassBefore);
});

test('finite plant stocks regenerate in weekly cycles and reconcile with biomass change', () => {
  const world = Sim.createWorld(42);
  const berryIndex = PLANTS.findIndex(plant => plant.id === 'berry');
  const biomassBefore = world.tiles.reduce((sum, tile) => sum + tile.plants[berryIndex], 0);

  updatePlants(world, 7);

  const biomassAfter = world.tiles.reduce((sum, tile) => sum + tile.plants[berryIndex], 0);
  assert.ok(world.ecologyFlows.humanFoodRegrowth > 0);
  assert.equal(world.ecologyFlows.humanFoodNaturalLoss, 0);
  assert.equal(world.ecologyFlows.humanFoodSettlementLoss, 0);
  assert.equal(world.ecologyFlows.humanFoodEcologicalLoss, 0);
  assert.ok(Math.abs(world.ecologyFlows.humanFoodEcologicalLoss
    - world.ecologyFlows.humanFoodNaturalLoss - world.ecologyFlows.humanFoodSettlementLoss) < .001);
  assert.ok(Math.abs((biomassAfter - biomassBefore) - world.ecologyFlows.humanFoodRegrowth) < .1,
  'measured resource regeneration should equal the change in human food stocks');
  assert.deepEqual(Sim.snapshot(world).ecologyFlows, world.ecologyFlows);
});

test('non-seasonal berry regeneration ignores local climate and soil chemistry and waits for its interval', () => {
  const ordinary = Sim.createWorld(2026);
  const altered = Sim.createWorld(2026);
  const berryIndex = PLANTS.findIndex(plant => plant.id === 'berry');
  const tileIndex = ordinary.tiles.findIndex(tile => tile.plants[berryIndex] > 1);
  assert.ok(tileIndex >= 0);
  const ordinaryTile = ordinary.tiles[tileIndex];
  const alteredTile = altered.tiles[tileIndex];
  const before = ordinaryTile.plants[berryIndex];
  assert.equal(ordinaryTile.seedBank, undefined, 'natural seed banks are no longer allocated per tile');

  updatePlants(ordinary, 6);
  assert.equal(ordinaryTile.plants[berryIndex], before, 'stocks wait until the seven-day regeneration interval');
  alteredTile.temperatureC = -50;
  alteredTile.soilWaterMm = 0;
  alteredTile.mineralNitrogenGPerM2 = 0;
  alteredTile.detritusGPerM2 = 0;
  updatePlants(ordinary, 7);
  updatePlants(altered, 7);

  assert.equal(alteredTile.plants[berryIndex], ordinaryTile.plants[berryIndex]);
  assert.equal(altered.ecologyFlows.humanFoodRegrowth, ordinary.ecologyFlows.humanFoodRegrowth);
});

test('configured seasonal growth changes cultivated roots and browse but not berries', () => {
  const spring = Sim.createWorld(2026);
  const winter = Sim.createWorld(2026);
  const cropIndex = PLANTS.findIndex(plant => plant.id === 'cultivated-root');
  const browseIndex = PLANTS.findIndex(plant => plant.id === 'browse');
  const berryIndex = PLANTS.findIndex(plant => plant.id === 'berry');
  const tileIndex = spring.tiles.findIndex(tile => tile.terrain === 'land');
  const springTile = spring.tiles[tileIndex];
  const winterTile = winter.tiles[tileIndex];
  const wildIndex = spring.tiles.findIndex((tile, index) => index !== tileIndex && tile.terrain === 'land');
  const springWild = spring.tiles[wildIndex], winterWild = winter.tiles[wildIndex];
  for (const tile of [springTile, winterTile]) {
    tile.cropFieldId = 700;
    tile.plants[cropIndex] = 20;
    tile.plantResourceMask |= 1 << cropIndex;
  }
  // Wild plants do not regrow inside a cultivated plot.
  for (const tile of [springWild, winterWild]) {
    tile.cropFieldId = null;
    tile.plants[browseIndex] = 20;
    tile.plants[berryIndex] = 20;
    tile.plantResourceMask |= (1 << browseIndex) | (1 << berryIndex);
  }

  updatePlants(spring, 7);
  updatePlants(winter, 280);

  assert.ok(springTile.plants[cropIndex] > winterTile.plants[cropIndex], 'root crops grow faster in spring than winter');
  assert.ok(winterWild.plants[browseIndex] > springWild.plants[browseIndex], 'browse follows its larger winter multiplier');
  assert.equal(springWild.plants[berryIndex], winterWild.plants[berryIndex], 'berries without seasonal data keep their weekly rate');
  assert.ok(spring.ecologyFlows.humanFoodCultivatedRegrowth > winter.ecologyFlows.humanFoodCultivatedRegrowth);
});

test('community roots need a finite seed investment, grow only in their field, and regrow above a protected root reserve', () => {
  const world = Sim.createWorld(42);
  const cropIndex = PLANTS.findIndex(plant => plant.id === 'cultivated-root');
  const berryIndex = PLANTS.findIndex(plant => plant.id === 'berry');
  const grassIndex = PLANTS.findIndex(plant => plant.id === 'grass');
  const treeIndex = PLANTS.findIndex(plant => plant.id === 'broadleaf');
  const seedTile = world.tiles.filter(tile => tile.terrain === 'land' && tile.slope <= .65
      && tile.soilType !== 'sandy' && tile.waterDist <= 9 && tile.plants[berryIndex] >= 8)
    .sort((a, b) => b.plants[berryIndex] - a.plants[berryIndex])[0];
  const fieldTiles = [seedTile, ...world.tiles.filter(tile => tile.terrain === 'land' && tile.slope <= .65
      && tile.soilType !== 'sandy' && tile.waterDist <= 9 && tile !== seedTile).slice(0, 1)];
  for (const tile of fieldTiles) {
    tile.plants[grassIndex] = 50;
    tile.plants[treeIndex] = 220;
    tile.plantResourceMask |= (1 << grassIndex) | (1 << treeIndex);
    tile.stoneDeposit = 4;
    tile.goldOre = .5;
    tile.stump = { type: 'broadleaf', untilDay: 90 };
    tile.roadWear = 9;
  }
  const outsideField = world.tiles.find(tile => tile.terrain === 'land' && !fieldTiles.includes(tile));
  const field = { id: world.nextId++, type: 'roça', seedMass: 8, fieldTileIndices: fieldTiles.map(tile => tile.i), cropHarvested: 0 };
  world.structures.push(field);

  const wildSeedBiomassBefore = seedTile.plants[berryIndex];
  assert.equal(collectCommunityFieldSeeds(world, field), 8, 'the field consumes nearby wild fruit as finite seed stock');
  assert.equal(seedTile.plants[berryIndex], wildSeedBiomassBefore - 8);
  assert.equal(field.cropSeedStored, 8);
  assert.equal(world.ecologyFlows.humanFoodCultivationSeeded, 8);
  assert.equal(sowCommunityField(world, field), 8, 'the field receives only the seed biomass paid for by the community');
  assert.equal(fieldTiles.reduce((sum, tile) => sum + tile.plants[cropIndex], 0), 8);
  assert.ok(fieldTiles.every(tile => tile.cropFieldId === field.id));
  assert.ok(fieldTiles.every(tile => tile.plants[grassIndex] === 0 && tile.plants[treeIndex] === 0),
    'sowing clears wild vegetation from every cultivated tile');
  assert.ok(fieldTiles.every(tile => tile.plantResourceMask === (1 << cropIndex)),
    'only the cultivated root remains enabled for regrowth on field tiles');
  assert.ok(fieldTiles.every(tile => tile.stoneDeposit === 0 && tile.goldOre === 0 && tile.stump == null && tile.roadWear === 0),
    'sowing clears mineral, stump, and road marks from the crop overlay');
  assert.equal(outsideField.plants[cropIndex], 0);

  const cropTile = fieldTiles[0];
  cropTile.plants[grassIndex] = 50;
  cropTile.plantResourceMask |= 1 << grassIndex;
  cropTile.plants[treeIndex] = 220;
  cropTile.plantResourceMask |= 1 << treeIndex;
  assert.equal(isTreeAnchor(world, cropTile), false, 'field tiles can never anchor visible trees');
  cropTile.temperatureC = 18;
  cropTile.soilWaterMm = cropTile.soilCapacityMm * .6;
  cropTile.mineralNitrogenGPerM2 = 3.5;
  const beforeGrowth = cropTile.plants[cropIndex];
  updatePlants(world, 7);
  assert.ok(cropTile.plants[cropIndex] > beforeGrowth, 'a paid, planted field grows during its resource cycle');
  assert.equal(cropTile.plants[grassIndex], 50, 'wild plants do not regrow on field tiles, even with an old resource mask');
  assert.equal(cropTile.plants[treeIndex], 220, 'tree biomass remains hidden on field tiles');
  assert.equal(outsideField.plants[cropIndex], 0, 'the crop does not spread into uncultivated land');
  assert.ok(world.ecologyFlows.humanFoodCultivatedRegrowth > 0);

  const biomassBeforeHarvest = cropTile.plants[cropIndex];
  const harvested = eatPlants(world, cropTile, ['cultivated-root'], 100);
  assert.ok(harvested > 0);
  assert.ok(Math.abs(cropTile.plants[cropIndex] - PLANTS[cropIndex].rootReserve) < .001,
    'harvest leaves the planted root stock in the field');
  assert.ok(biomassBeforeHarvest - cropTile.plants[cropIndex] - harvested < .001);
});

test('perception distinguishes standing crop biomass from the amount harvest can remove', () => {
  const world = movementWorld();
  world.day = 1;
  world.regions = [{}];
  world.people = [];
  world.animals = [];
  const cropIndex = PLANTS.findIndex(plant => plant.id === 'cultivated-root');
  const fieldCrop = world.tiles[20 * world.width + 21];
  const wildCrop = world.tiles[20 * world.width + 22];
  fieldCrop.cropFieldId = 901;
  fieldCrop.regionId = 0;
  wildCrop.regionId = 0;
  fieldCrop.plants[cropIndex] = 1.26;
  wildCrop.plants[cropIndex] = 1.26;
  const observer = { id: 1, x: 20, y: 20, headingX: 0, headingY: 0,
    sensoryMemory: { actors: {}, water: [], logs: {}, storages: {} } };
  world.people.push(observer);

  const perception = Senses.observe(world, observer, 'person', PLANTS);
  const fieldResource = perception.resources.find(resource => resource.x === fieldCrop.x && resource.y === fieldCrop.y);
  const wildResource = perception.resources.find(resource => resource.x === wildCrop.x && resource.y === wildCrop.y);

  assert.ok(Math.abs(fieldResource.biomass['cultivated-root'] - 1.26) < .001);
  assert.ok(Math.abs(fieldResource.harvestableBiomass['cultivated-root'] - .06) < .001);
  assert.ok(Math.abs(wildResource.biomass['cultivated-root'] - 1.26) < .001);
  assert.ok(Math.abs(wildResource.harvestableBiomass['cultivated-root'] - 1.26) < .001);
});

test('kingdom build plan places a seed-funded roça after its shelter', () => {
  const world = Sim.createWorld(42);
  const community = world.communities[0];
  const plan = nextCommunityStructure(world, community, community.memberIds.length, [
    { type: 'abrigo', complete: true, communityId: community.id }
  ]);

  assert.deepEqual(plan, { type: 'roça', woodCost: 16, stoneCost: 6, foodCost: 0, seedMass: 8, required: 34 });
});

test('a funded roça can outrank low shared food and turns nearby fruit into a completed rebudding plot', () => {
  const world = Sim.createWorld(42);
  const kingdom = world.kingdoms[0];
  const community = world.communities.find(item => item.id === kingdom.communityId);
  const worker = world.people.find(person => person.communityId === community.id && person.role === 'resident');
  Object.assign(worker, { energy: 80, hydration: 80, health: 80, foodReserve: 70 });
  const shelter = { id: world.nextId++, type: 'abrigo', kingdomId: kingdom.id, communityId: community.id,
    x: community.x, y: community.y, complete: true, builtDay: 0, fruitStored: 0, meatStored: 0 };
  world.structures.push(shelter);
  community.stores.wood = 16;
  community.stores.stone = 6;
  community.stores.food = 0;

  const report = observeKingdomStrategy(world, kingdom.id);
  assert.equal(report.community.buildPlan.type, 'roça');
  assert.equal(report.community.constructionReady, true);
  assert.equal(planKingdomStrategy(report).goal, 'invest-in-cultivated-food',
    'a safe builder can establish agriculture before the shared reserve reaches eight per resident');

  const site = chooseBuildSite(world, community, [shelter]);
  assert.ok(site && site.fieldTileIndices.length >= 25,
    'the first crop plot uses a wider footprint without requiring another full building project');
  assert.ok(Math.hypot(site.x - community.x, site.y - community.y) <= 12,
    'a community field stays close enough for residents to perceive and harvest its crops');
  const edibleBefore = Sim.snapshot(world).humanFoodBiomass;
  workOnCommunityStructure(world, worker, community, community.memberIds.length);
  const field = world.structures.find(structure => structure.type === 'roça' && structure.communityId === community.id);
  assert.ok(field && !field.complete);
  assert.ok(kingdom.structureIds.includes(field.id), 'the settlement inspector can discover community-built fields');
  assert.equal(field.cropSeedStored, 8);
  assert.equal(world.ecologyFlows.humanFoodCultivationSeeded, 8);
  assert.equal(community.stores.wood, 0);
  assert.equal(community.stores.stone, 0);
  assert.ok(Math.abs(Sim.snapshot(world).humanFoodBiomass - edibleBefore) < .001,
    'seed collection transfers existing fruit biomass into the project instead of creating food');

  worker.x = field.x;
  worker.y = field.y;
  for (let day = 1; day <= field.required && !field.complete; day++) {
    world.day = day;
    workOnCommunityStructure(world, worker, community, community.memberIds.length);
  }
  const cropIndex = PLANTS.findIndex(plant => plant.id === 'cultivated-root');
  assert.equal(field.complete, true);
  assert.equal(field.cropSeedStored, 0);
  assert.equal(field.cropSeededBiomass, 8);
  assert.ok(field.fieldTileIndices.every(index => world.tiles[index].cropFieldId === field.id));
  assert.ok(Math.abs(field.fieldTileIndices.reduce((sum, index) => sum + world.tiles[index].plants[cropIndex], 0) - 8) < .01);
  assert.equal(Sim.snapshot(world).cultivatedFieldCount, 1);
});

test('monthly world chronicle explains human food biomass change by ecological flows', () => {
  const world = Sim.createWorld(42);
  const initial = Sim.snapshot(world);

  Sim.tick(world, 30);

  const current = Sim.snapshot(world);
  const report = world.events.find(event => event.day === 30 && event.text.includes('Alimento vegetal humano (30 dias)'));
  const quantity = value => Math.round(value).toLocaleString('pt-BR');
  const signed = value => (value > 0 ? '+' : value < 0 ? '−' : '') + quantity(Math.abs(value));
  assert.ok(report, 'the monthly report should retain its reporting period and current biomass');
  assert.ok(report.text.includes('biomassa ' + quantity(current.humanFoodBiomass) + ' unidades ('
    + signed(current.humanFoodBiomass - initial.humanFoodBiomass) + ')'));
  assert.ok(report.text.includes('regeneração ' + quantity(current.ecologyFlows.humanFoodRegrowth)));
  assert.ok(report.text.includes('(cultivo ' + quantity(current.ecologyFlows.humanFoodCultivatedRegrowth) + ')'));
  assert.ok(report.text.includes('sementes ' + quantity(current.ecologyFlows.humanFoodCultivationSeeded)));
  assert.ok(report.text.includes('colheita ' + quantity(current.harvests.plantFoodBiomass)));
  assert.ok(report.text.includes('(cultivo ' + quantity(current.harvests.cultivatedFoodBiomass) + ')'));
  assert.ok(report.text.includes('perda natural ' + quantity(current.ecologyFlows.humanFoodNaturalLoss)));
  assert.ok(report.text.includes('perda por assentamentos/trilhas '
    + quantity(current.ecologyFlows.humanFoodSettlementLoss)));
  assert.equal(world.ecologyReportCursor.day, 30);
  assert.equal(world.ecologyReportCursor.humanFoodBiomass, current.humanFoodBiomass);
});

test('people prefer a nearby patch that can fill a forage action over a larger distant patch', () => {
  const world = movementWorld();
  const person = {
    x: 20, y: 20, skills: { forage: .6 },
    perception: { resources: [
      { x: 21, y: 20, distance: 1, slope: 0, terrain: 'land', biomass: { berry: 4 } },
      { x: 23, y: 20, distance: 3, slope: 0, terrain: 'land', biomass: { berry: 80 } }
    ] }
  };

  const target = bestPeopleFoodCell(world, person, 5);

  assert.deepEqual([target.x, target.y], [21, 20]);
});

test('people ignore a crop field that only contains its protected root reserve', () => {
  const world = movementWorld();
  const person = {
    x: 20, y: 20, skills: { forage: .6 },
    perception: { resources: [
      { x: 20, y: 20, distance: 0, slope: 0, terrain: 'land',
        biomass: { 'cultivated-root': 1.2 }, harvestableBiomass: { 'cultivated-root': 0 } },
      { x: 21, y: 20, distance: 1, slope: 0, terrain: 'land', biomass: { berry: 2 } }
    ] }
  };

  const target = bestPeopleFoodCell(world, person, 5);

  assert.deepEqual([target.x, target.y], [21, 20]);
  person.perception.resources.pop();
  assert.equal(bestPeopleFoodCell(world, person, 5), null);
});

test('people can forage a visible food patch beyond five tiles', () => {
  const world = movementWorld();
  const person = {
    x: 20, y: 20, skills: { forage: .6 },
    perception: { resources: [
      { x: 26, y: 24, distance: Math.hypot(6, 4), slope: 0, terrain: 'land', biomass: { berry: 2.2 } }
    ] }
  };

  assert.equal(bestPeopleFoodCell(world, person, 5), null);
  const target = bestPeopleFoodCell(world, person, 8);

  assert.deepEqual([target.x, target.y], [26, 24]);
});

test('food migration does not keep a hungry person targeting the water tile they already occupy', () => {
  const world = movementWorld();
  for (const tile of world.tiles) { tile.soilWaterMm = 0; tile.soilCapacityMm = 1; }
  const current = world.tiles[20 * world.width + 20];
  current.slope = 10;
  const person = { x: 20, y: 20, hydration: 18 };

  const target = bestPeopleMigrationCell(world, person, current, null);

  assert.ok(target);
  assert.notDeepEqual([target.x, target.y], [person.x, person.y]);
});

test('a low-health resident uses known nearby water before thirst reaches the terminal threshold', () => {
  const world = Sim.createWorld(42);
  const lake = world.tiles.find(tile => tile.terrain === 'water' && tile.waterKind === 'lake');
  assert.ok(lake, 'the seeded world must contain a freshwater lake');
  const land = [
    cellAt(world, lake.x + 1, lake.y), cellAt(world, lake.x - 1, lake.y),
    cellAt(world, lake.x, lake.y + 1), cellAt(world, lake.x, lake.y - 1)
  ].find(tile => tile && tile.terrain === 'land');
  assert.ok(land, 'the lake needs an adjacent walkable tile');

  const person = world.people[0];
  Object.assign(person, {
    x: land.x, y: land.y, ageDays: 20 * 365, role: 'resident',
    kingdomId: null, communityId: null, homeId: null, assignment: null,
    health: 4, hydration: 13.4, foodReserve: 40, energy: 40, injury: 0
  });
  world.people = [person];
  world.kingdoms = [];
  world.communities = [];
  world.structures = [];

  updatePeople(world);

  assert.equal(person.brain.lastAction, 'drink');
  assert.equal(person.lastDecision.scores, null, 'the health-related water emergency must override an action that was not forced by survival policy');
  assert.ok(person.hydration > 30, 'the known permanent water source should restore hydration immediately');
  assert.equal(person.state, 'bebendo água');
});

test('movement cannot cut diagonally through tree or fence corners', () => {
  const forest = movementWorld();
  const broadleafIndex = PLANTS.findIndex(plant => plant.id === 'broadleaf');
  forest.tiles[1].plants[broadleafIndex] = 500;
  forest.tiles[forest.width].terrain = 'rock';
  const walker = { x: 0, y: 0, energy: 100, travelCost: 0, communityId: null };
  assert.equal(moveOne(forest, walker, { x: 1, y: 1 }, false), false);
  assert.deepEqual([walker.x, walker.y], [0, 0]);

  const fenced = movementWorld();
  fenced.structures.push({ id: 1, type: 'curral', complete: true, x: 2, y: 2, radius: 2, communityId: null });
  const entrant = { x: 1, y: 5, energy: 100, travelCost: 0, communityId: null };
  assert.equal(moveOne(fenced, entrant, { x: 2, y: 2 }, false), true);
  assert.deepEqual([entrant.x, entrant.y], [2, 5]);

  const leaver = { x: 2, y: 3, energy: 100, travelCost: 0, communityId: null };
  assert.equal(moveOne(fenced, leaver, { x: 5, y: 2 }, false), true);
  assert.deepEqual([leaver.x, leaver.y], [2, 4]);
  assert.equal(moveOne(fenced, leaver, { x: 5, y: 2 }, false), true);
  assert.deepEqual([leaver.x, leaver.y], [2, 5]);
});

test('people can reach a harvest patch on a corral fence without oscillating at its gate', () => {
  const world = movementWorld();
  const pen = { id: 1, type: 'curral', complete: true, x: 59, y: 74, radius: 3.5, communityId: 1 };
  world.structures.push(pen);
  const person = { x: 59, y: 79, energy: 80, travelCost: 0, communityId: 1 };
  const harvestTarget = { x: 55, y: 74 };

  for (let day = 0; day < 6 && Sim.distance(person, harvestTarget) > 1.5; day++) {
    assert.equal(moveOne(world, person, harvestTarget, false), true);
  }

  assert.ok(Sim.distance(person, harvestTarget) <= 1.5,
    'the route must enter the corral through its gate and approach the fence-side patch');
});

test('corral gate selection leaves walkable access on both sides of the opening', () => {
  const world = movementWorld();
  const pen = { id: 1, type: 'curral', complete: true, x: 59, y: 74, radius: 3.5, communityId: 1 };
  const conifer = PLANTS.findIndex(plant => plant.id === 'conifer');
  world.tiles[79 * world.width + 59].plants[conifer] = 500;
  world.tiles[79 * world.width + 58].plants[conifer] = 450;
  world.structures.push(pen);
  const gate = corralGate(world, pen);
  const person = { x: 64, y: 78, energy: 80, travelCost: 0, communityId: 1 };
  const harvestTarget = { x: 62, y: 78 };

  assert.deepEqual([gate.x, gate.y], [58, 78], 'the centered opening is blocked by a mature tree outside it');
  for (let day = 0; day < 20 && Sim.distance(person, harvestTarget) > 1.5; day++) {
    assert.equal(moveOne(world, person, harvestTarget, false), true);
  }

  assert.ok(Sim.distance(person, harvestTarget) <= 1.5,
    'people should use an opening with a clear approach instead of retrying an inaccessible gate');
});

test('initial households keep dependent residents cared for through day 253', () => {
  const world = Sim.createWorld(42);
  for (let day = 0; day < 253; day++) Sim.stepDay(world);

  assert.equal(world.kingdoms.length, 2);
  assert.equal(world.deathsByCause.starvation, 0);
  assert.equal(world.deathsByCause.dehydration, 0);
  for (const person of world.people.filter(person => person.alive && person.kingdomId !== null)) {
    const home = world.structures.find(structure => structure.id === person.homeId && structure.type === 'casa');
    assert.ok(home, person.name + ' ficou sem casa');
    assert.ok(home.residentIds.includes(person.id), person.name + ' não consta na ocupação da casa');
  }
});

test('a fully provided daily meal does not cause starvation damage when the reserve ends at zero', () => {
  const world = Sim.createWorld(42);
  const person = world.people[0];
  person.ageDays = 20 * 365;
  person.kingdomId = null;
  person.communityId = null;
  person.homeId = null;
  person.foodReserve = DAILY_FOOD_NEED;
  person.energy = 60;
  person.hydration = 60;
  person.health = 50;
  person.injury = 0;
  person.assignment = null;

  updatePeople(world);

  assert.equal(person.health, 50, 'consuming exactly one full daily need is not a food deficit');
});

test('a resident leaving after prolonged absence records the threshold and food state', () => {
  const world = Sim.createWorld(42);
  const kingdom = world.kingdoms[0];
  const community = world.communities.find(item => item.id === kingdom.communityId);
  const person = world.people.find(item => item.kingdomId === kingdom.id && item.communityId === community.id && item.role === 'resident');
  community.satisfaction = .3;
  community.stores.food = 0;
  person.ageDays = 20 * 365;
  const remote = world.tiles.find(tile => tile.terrain === 'land' && tile.kingdomId == null
    && Sim.distance(tile, community) > 30);
  person.x = remote.x;
  person.y = remote.y;
  person.awayDays = 46;
  person.dissatisfactionDays = 0;
  person.foodReserve = 24;
  person.hydration = 50;
  person.energy = 40;
  person.health = 80;
  person.injury = 0;
  person.assignment = null;

  updatePeople(world);

  assert.equal(person.kingdomId, null);
  assert.equal(person.awayDays, 0);
  assert.match(person.lastLesson, /ausência de 47 dias com satisfação abaixo de 0,400 \(valor 0\.300000\)/);
  assert.match(person.lastLesson, /reserva pessoal de alimento: \d+\.\d+ pontos; estoque comunitário: 0\.0 unidades/);
  assert.ok(world.events.some(event => event.text.includes(person.name + ' deixou ' + community.name)
    && event.text.includes('ausência de 47 dias') && event.text.includes('reserva pessoal ' + person.foodReserve.toFixed(1) + ' pontos')
    && event.text.includes('estoque comum 0.0 unidades')));
});
