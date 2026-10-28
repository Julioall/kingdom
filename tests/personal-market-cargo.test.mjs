import test from 'node:test';
import assert from 'node:assert/strict';
import { findTradePartner, marketHasTradeOpportunity, performTrade } from '../src/simulation/economy/trade.js';

function fixture() {
  const community = {
    id: 11, name: 'Valedouro', dissolved: false, memberIds: [7],
    stores: { food: 30, meat: 0, wood: 0, stone: 0, feed: 0, gold: 0 },
    tradeCount: 0, history: []
  };
  const person = {
    id: 7, alive: true, role: 'resident', communityId: 11, kingdomId: 1,
    x: 20, y: 20, foodReserve: 95, carriedFood: 0, carriedWood: 16,
    carriedStone: 0, carriedGold: 0, skills: { diplomacy: 0 },
    energy: 80, perception: { people: [] }
  };
  const market = {
    ownerType: 'kingdom-market', ownerId: 1, transactions: 0,
    stock: { food: 20, wood: 0, stone: 0, feed: 0, sheep: 0, gold: 20 },
    prices: { food: 1, wood: 2, stone: 3 }
  };
  const station = { id: 28, type: 'posto de coleta', communityId: 11,
    complete: true, destroyedDay: null, health: 1, integrity: 1, x: 21, y: 20 };
  const kingdom = { id: 1, communityId: 11, market };
  const world = { day: 7, people: [person], communities: [community],
    kingdoms: [kingdom], structures: [station], animals: [], events: [], tradeDiagnostics: {},
    kingdomRelations: {}, communityRelations: {} };
  return { world, community, person, market, station };
}

test('resident sells only loaded wood to finite local market and buys actual food for personal reserve', () => {
  const { world, community, person, market } = fixture();
  const communityBefore = structuredClone(community.stores);
  const physicalFoodBefore = market.stock.food + community.stores.food + person.foodReserve;
  const physicalWoodBefore = market.stock.wood + community.stores.wood + person.carriedWood;
  const physicalGoldBefore = market.stock.gold + community.stores.gold + person.carriedGold;
  assert.equal(marketHasTradeOpportunity(world, community), false,
    'no community-funded transaction is available in the fixture');

  const sale = findTradePartner(world, community, person);
  assert.equal(sale?.isMarket, true, 'personal offer unlocks normal market action');
  assert.equal(performTrade(world, person, community, sale), true);
  assert.equal(person.carriedWood, 12, 'protected loaded reserve remains with the gatherer');
  assert.equal(person.carriedGold, 4);
  assert.equal(market.stock.wood, 4);
  assert.equal(market.stock.gold, 16);
  assert.equal(market.transactions, 1);
  assert.equal(person.tradeLedger.count, 1);
  assert.equal(person.tradeLedger.history[0].kind, 'personal-market');
  assert.deepEqual(person.tradeLedger.history[0].market.delta, { wood: 4, gold: -4 });
  assert.deepEqual(community.stores, communityBefore, 'personal sales never debit shared property');

  person.foodReserve = 45;
  const foodBeforePurchase = market.stock.food + person.foodReserve;
  const goldBeforePurchase = market.stock.gold + person.carriedGold;
  const buy = findTradePartner(world, community, person);
  assert.equal(buy?.isMarket, true);
  assert.equal(performTrade(world, person, community, buy), true);
  assert.equal(person.foodReserve, 49);
  assert.equal(person.carriedGold, 0);
  assert.equal(market.stock.food, 16);
  assert.equal(market.stock.gold, 20);
  assert.equal(market.stock.food + person.foodReserve, foodBeforePurchase);
  assert.equal(market.stock.gold + person.carriedGold, goldBeforePurchase);
  assert.equal(market.stock.wood + community.stores.wood + person.carriedWood, physicalWoodBefore);
  assert.equal(market.stock.gold + community.stores.gold + person.carriedGold, physicalGoldBefore);
  assert.equal(market.stock.food + community.stores.food + person.foodReserve,
    physicalFoodBefore - 50, 'only the test fixture change to personal hunger alters physical food');
  assert.deepEqual(community.stores, communityBefore);
  assert.equal(world.trades, 2);
  assert.equal(community.tradeCount, 2);
  assert.equal(person.tradeLedger.count, 2);
  assert.equal(market.tradeLedger.count, 2);
  assert.deepEqual(person.tradeLedger.history[1].market.delta, { food: -4, gold: 4 });
});

test('no gold, product, valid price or available carry reserve means no personal creation', () => {
  const { world, community, person, market } = fixture();
  person.carriedWood = 12;
  person.foodReserve = 40;
  assert.equal(findTradePartner(world, community, person), null,
    'a hungry resident cannot buy without gold');
  person.carriedGold = 4;
  market.stock.food = 0;
  assert.equal(findTradePartner(world, community, person), null,
    'gold does not conjure product from empty local market');
  market.stock.food = 20;
  market.prices.food = 0;
  assert.equal(findTradePartner(world, community, person), null,
    'zero price cannot mint a free exchange');
  market.prices.food = 1;
  person.foodReserve = 100;
  assert.equal(findTradePartner(world, community, person), null,
    'a full personal reserve is not a buying opportunity');
  assert.equal(world.trades, undefined);
  assert.equal(market.transactions, 0);
});

test('invalid station, foreign association and stale market authority block personal settlement', () => {
  const { world, community, person, market, station } = fixture();
  const partner = findTradePartner(world, community, person);
  const before = structuredClone({ market: market.stock, community: community.stores, person });

  station.health = 0;
  assert.equal(performTrade(world, person, community, partner), false);
  station.health = 1;
  world.structures = [{ ...station }];
  assert.equal(performTrade(world, person, community, partner), false);
  world.structures = [station];
  world.kingdoms[0].market = { ...market, stock: { ...market.stock } };
  assert.equal(performTrade(world, person, community, partner), false);
  world.kingdoms[0].market = market;
  person.kingdomId = 9;
  assert.equal(performTrade(world, person, community, partner), false,
    'a moved resident cannot sell cargo to the former kingdom');
  person.kingdomId = 1;
  assert.deepEqual(market.stock, before.market);
  assert.deepEqual(community.stores, before.community);
  assert.equal(person.carriedWood, before.person.carriedWood);
  assert.equal(person.carriedGold, before.person.carriedGold);
  assert.equal(world.trades, undefined);
  assert.equal(market.transactions, 0);
});

test('a market with insufficient gold does not buy personal stone', () => {
  const { world, community, person, market } = fixture();
  person.carriedWood = 0;
  person.carriedStone = 18;
  market.stock.gold = 0;
  assert.equal(findTradePartner(world, community, person), null);
  assert.equal(person.carriedStone, 18);
  assert.equal(person.carriedGold, 0);
});
