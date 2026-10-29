import test from 'node:test';
import assert from 'node:assert/strict';
import engine from '../src/simulation/engine.js';
import { PLANTS } from '../src/config/ecosystem.js';
import Senses from '../src/simulation/individuals/perception.js';
import { collectLooseLog, gatherMaterials } from '../src/simulation/individuals/actions.js';
import { cellAt } from '../src/simulation/world/spatial.js';

function marketJourneyFixture() {
  const world = engine.createWorld(42);
  const kingdom = world.kingdoms[0];
  const community = world.communities.find(candidate => candidate.id === kingdom.communityId);
  const person = world.people.find(candidate => candidate.alive && candidate.role !== 'soldier'
    && candidate.kingdomId === kingdom.id);
  assert.ok(kingdom && community && person);

  const start = { x: 62, y: 64 };
  const stationPosition = { x: 70, y: 64 };
  for (let y = 57; y <= 72; y++) for (let x = 58; x <= 75; x++) {
    const tile = cellAt(world, x, y);
    tile.terrain = 'land';
    tile.slope = 0;
    tile.elevationLevel = 0;
    tile.waterDepth = 0;
    tile.cropFieldId = null;
    tile.plants.fill(0);
    tile.plantResourceMask = 0;
    tile.stoneDeposit = 0;
    tile.goldOre = 0;
    tile.copperOre = 0;
    tile.silverOre = 0;
    tile.ironOre = 0;
    tile.kingdomId = kingdom.id;
  }
  const broadleafIndex = PLANTS.findIndex(plant => plant.id === 'broadleaf');
  cellAt(world, start.x, start.y).plants[broadleafIndex] = 900;

  person.x = start.x;
  person.y = start.y;
  person.lastSafeX = start.x;
  person.lastSafeY = start.y;
  person.foodReserve = 58;
  person.hydration = 90;
  person.energy = 90;
  person.health = 100;
  person.injury = 0;
  person.assignment = null;
  person.territoryWarnings = {};
  person.territoryAwareness = null;
  person.territoryExposure = null;
  person.foodTarget = null;
  person.failedFoodTargets = [];
  person.carriedFood = 0;
  person.carriedFruit = 0;
  person.carriedMeat = 0;
  person.carriedFeed = 0;
  person.carriedWood = 0;
  person.carriedStone = 0;
  person.carriedGold = 0;
  person.carriedCopper = 0;
  person.carriedSilver = 0;
  person.carriedIron = 0;
  person.carriedSeeds = 0;
  person.carriedCommunitySeeds = 0;
  person.seedCargoPurpose = null;
  person.seedCargoFieldId = null;
  person.personalWallet = { stock: { gold: 0, silver: 0, copper: 0 } };

  community.memberIds = [person.id];
  community.x = start.x;
  community.y = start.y;
  community.stores = { food: 0, meat: 0, wood: 0, stone: 0, feed: 0, gold: 0 };
  community.tradeCount = 0;

  const market = kingdom.market;
  market.ownerType = 'kingdom-market';
  market.ownerId = kingdom.id;
  market.stock = { food: 20, wood: 0, stone: 0, iron: 0, feed: 0, sheep: 0, gold: 20, silver: 0, copper: 0 };
  market.prices = { food: 1, wood: 2, stone: 3, iron: 4 };
  market.transactions = 0;
  const station = {
    id: 99001, type: 'mercado', communityId: community.id, kingdomId: kingdom.id,
    complete: true, destroyedDay: null, health: 100, integrity: 1,
    x: stationPosition.x, y: stationPosition.y
  };

  world.people = [person];
  world.communities = [community];
  world.kingdoms = [kingdom];
  world.structures = [station];
  world.logs = [];
  world.animals = [];
  world.events = [];
  world.day = 0;
  world.navigationRevision = (world.navigationRevision || 0) + 1;
  return { world, kingdom, community, person, market, station, start, stationPosition };
}

function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

test('a resident gathers and collects real wood, walks to a reachable market, sells it, and buys food', () => {
  const { world, community, person, market, station, start } = marketJourneyFixture();

  person.perception = Senses.observe(world, person, 'person', PLANTS);
  const felled = gatherMaterials(world, person, community);
  assert.ok(felled > 12, 'the tree becomes a real loose-log resource');
  assert.ok(cellAt(world, start.x, start.y).plants[PLANTS.findIndex(plant => plant.id === 'broadleaf')] < 900,
    'harvesting removes biomass from the source tile');
  const log = world.logs.find(item => item.available && item.amount > 0);
  assert.ok(log, 'the harvested wood exists as a loose log before collection');
  person.perception = Senses.observe(world, person, 'person', PLANTS);
  const sighting = person.perception.logs.find(item => item.id === log.id);
  assert.ok(sighting, 'the resident can see the harvested log');
  const collected = collectLooseLog(world, person, sighting);
  assert.ok(collected > 12, 'the production collector transfers physical wood into cargo');
  assert.equal(log.amount, 0, 'collection removes the transferred amount from the log');

  const originalWood = person.carriedWood + market.stock.wood;
  const originalGold = person.personalWallet.stock.gold + market.stock.gold;
  const originalFood = person.foodReserve + market.stock.food;
  let reachedMarket = false;
  let soldWood = false;
  let boughtFood = false;
  let purchaseReserve = 0;
  let saleDay = null;
  const trace = [];

  for (let day = 0; day < 30 && !boughtFood; day++) {
    const before = {
      x: person.x, y: person.y, wood: person.carriedWood, marketWood: market.stock.wood,
      walletGold: person.personalWallet.stock.gold, marketGold: market.stock.gold,
      foodReserve: person.foodReserve, marketFood: market.stock.food
    };
    engine.modules.SocietyExperiment.updatePeople(world);

    assert.ok(distance(person, before) <= Math.SQRT2 + .001,
      'the pawn advances by one route step per daily update');
    assert.equal(person.kingdomId, community.kingdomId ?? world.kingdoms[0].id);
    if (distance(person, station) < distance({ ...before }, station)) reachedMarket = true;

    if (person.carriedWood < before.wood - .01 && market.stock.wood > before.marketWood + .01) {
      soldWood = true;
      saleDay = world.day;
      assert.equal(before.wood - person.carriedWood, market.stock.wood - before.marketWood,
        'the physical wood transferred to the market equals the cargo removed');
      assert.equal(person.personalWallet.stock.gold - before.walletGold,
        before.marketGold - market.stock.gold,
        'the worker receives exactly the gold debited from the market');
    }
    trace.push({ day: world.day, action: person.lastDecision?.action, state: person.state,
      x: person.x, y: person.y, wood: person.carriedWood, walletGold: person.personalWallet.stock.gold,
      marketWood: market.stock.wood, foodReserve: person.foodReserve });
    if (market.stock.food < before.marketFood - .01 && person.foodReserve > before.foodReserve - .01) {
      boughtFood = true;
      purchaseReserve = person.foodReserve;
      assert.equal(before.marketFood - market.stock.food, person.foodReserve - before.foodReserve + 1,
        'purchased food credits the daily reserve after this tick’s one-day consumption');
      assert.equal(before.walletGold - person.personalWallet.stock.gold,
        market.stock.gold - before.marketGold,
        'the market receives exactly the gold spent by the worker');
    }

    world.day++;
  }

  assert.ok(reachedMarket, 'the pawn moved toward the market along a real route');
  assert.ok(soldWood, 'the worker autonomously sold collected wood after arriving: ' + JSON.stringify(trace));
  assert.ok(boughtFood, 'the worker used its sale proceeds to buy existing market food');
  assert.ok(saleDay !== null && saleDay > 0, 'sale followed several actual movement steps');
  assert.ok(purchaseReserve > 0, 'the purchased food reached the worker’s personal reserve');
  assert.equal(person.carriedWood + market.stock.wood, originalWood);
  assert.equal(person.personalWallet.stock.gold + market.stock.gold, originalGold);
  assert.equal(person.foodReserve + market.stock.food, originalFood - world.day,
    'food transfers conserve stock and only daily consumption reduces total food');
});

test('a resident with an active assignment delivers cargo instead of diverting to a personal sale', () => {
  const { world, community, person, market } = marketJourneyFixture();
  person.carriedWood = 16;
  person.assignment = { communityId: community.id, expiresDay: 10, action: 'gather' };
  const marketBefore = structuredClone(market.stock);

  engine.modules.SocietyExperiment.updatePeople(world);

  assert.equal(person.lastDecision?.action, 'deliver');
  assert.equal(person.carriedWood, 0);
  assert.equal(community.stores.wood, 16);
  assert.deepEqual(market.stock, marketBefore, 'assigned communal cargo never enters personal trade');
});

test('a resident carrying nonmarketable feed does not take a personal food-buy trip', () => {
  const { world, community, person, market } = marketJourneyFixture();
  person.carriedFeed = 8;
  person.foodReserve = 45;
  person.personalWallet.stock.gold = 8;
  const marketBefore = structuredClone(market.stock);

  engine.modules.SocietyExperiment.updatePeople(world);

  assert.equal(person.lastDecision?.action, 'deliver');
  assert.equal(person.carriedFeed, 0);
  assert.equal(community.stores.feed, 8);
  assert.deepEqual(market.stock, marketBefore, 'feed delivery is completed before personal food shopping');
});
