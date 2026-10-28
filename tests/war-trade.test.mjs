import test from 'node:test';
import assert from 'node:assert/strict';
import { findTradePartner, marketHasTradeOpportunity, performTrade } from '../src/simulation/economy/trade.js';
import { summarizeTradeActivity } from '../scripts/food-audit-metrics.mjs';

function tradeFixture(status = 'peace', borderClosed = false) {
  const home = { id: 1, name: 'Valedouro', stores: { food: 34, wood: 0, stone: 0 }, history: [], tradeCount: 0 };
  const foreign = { id: 2, name: 'Riacho', stores: { food: 0, wood: 24, stone: 0 }, history: [], tradeCount: 0 };
  const trader = { id: 10, alive: true, x: 20, y: 20, communityId: home.id, energy: 80,
    skills: { diplomacy: 0 }, perception: { people: [{ id: 20, visible: true }] } };
  const witness = { id: 20, alive: true, x: 21, y: 20, communityId: foreign.id };
  const world = {
    day: 7, nextId: 1, people: [trader, witness], animals: [], communities: [home, foreign], structures: [],
    kingdoms: [{ id: 1, communityId: home.id }, { id: 2, communityId: foreign.id }],
    kingdomRelations: { '1:2': { status, borderClosed } }, communityRelations: {
      '1:2': { a: 1, b: 2, trust: .6, tension: 0, trades: 0, conflicts: 0 }
    },
    events: [], tradeLedger: []
  };
  return { world, home, foreign, trader };
}

test('visible communities can barter during peace when trust and complementary surplus permit', () => {
  const { world, home, foreign, trader } = tradeFixture();

  const partner = findTradePartner(world, home, trader);

  assert.equal(partner.community.id, foreign.id);
  assert.equal(performTrade(world, trader, home, partner), true);
  assert.equal(home.stores.food, 29);
  assert.equal(foreign.stores.food, 5);
  assert.equal(foreign.stores.wood, 19);
  assert.equal(home.tradeCount, 1);
  assert.equal(foreign.tradeCount, 1);
  assert.equal(world.tradeDiagnostics, undefined, 'runtime trade counters remain disabled outside an audit');
});

test('an explicitly closed border blocks direct barter and rejects a stale partner safely', () => {
  const { world, home, foreign, trader } = tradeFixture('peace', true);
  const beforeHome = structuredClone(home.stores);
  const beforeForeign = structuredClone(foreign.stores);
  const stalePartner = { community: foreign, person: world.people[1], relation: world.communityRelations['1:2'], distance: 1 };

  assert.equal(findTradePartner(world, home, trader), null);
  assert.equal(performTrade(world, trader, home, stalePartner), false);
  assert.deepEqual(home.stores, beforeHome);
  assert.deepEqual(foreign.stores, beforeForeign);
  assert.equal(home.tradeCount, 0);
  assert.equal(foreign.tradeCount, 0);
});

test('active war does not imply a trade embargo when the border remains open', () => {
  const { world, home, foreign, trader } = tradeFixture('at-war');

  const partner = findTradePartner(world, home, trader);

  assert.equal(partner.community.id, foreign.id);
  assert.equal(performTrade(world, trader, home, partner), true);
  assert.equal(home.stores.food, 29);
  assert.equal(foreign.stores.wood, 19);
});

test('market audit records the person who buys food and counts completed transactions', async () => {
  const { world, home, trader } = tradeFixture();
  world.tradeDiagnostics = {};
  home.stores = { food: 20, meat: 0, wood: 0, stone: 0, gold: 10, feed: 0 };
  const market = { ownerType: 'kingdom-market', ownerId: 1, transactions: 0,
    stock: { food: 40, wood: 20, stone: 20, gold: 100, feed: 20, sheep: 0 } };
  world.market = market;
  world.kingdoms[0].market = market;
  world.structures.push({ id: 30, type: 'posto de coleta', communityId: home.id, complete: true, x: 21, y: 20 });

  const partner = findTradePartner(world, home, trader);
  assert.equal(partner.isMarket, true);
  assert.equal(performTrade(world, trader, home, partner), true);

  const summary = summarizeTradeActivity(world);
  assert.equal(summary.marketTransactions, 1);
  assert.equal(summary.marketTransactionsRecorded, 1);
  assert.deepEqual(summary.byActor, [{ actorType: 'person', actorId: trader.id, role: null,
    communityId: home.id, count: 1, marketDelta: { food: -12, gold: 6 } }]);
  assert.equal(summary.diagnostics.marketOpportunityChecks, 1);
  assert.equal(summary.diagnostics.marketOpportunities, 1);
  assert.equal(summary.diagnostics.marketAttempts, 1);
  assert.equal(summary.diagnostics.marketCompleted, 1);
  assert.deepEqual(summary.diagnostics.marketBlocked, {});
});

test('market opportunity and failed attempt expose why no trade happened', () => {
  const { world, home, trader } = tradeFixture();
  world.tradeDiagnostics = {};
  home.stores = { food: 40, meat: 0, wood: 0, stone: 0, gold: 0, feed: 0 };
  trader.perception.people = [];
  world.market = { transactions: 0, stock: { food: 0, wood: 0, stone: 0, gold: 0, feed: 0, sheep: 0 } };
  world.kingdoms[0].market = world.market;
  world.structures.push({ id: 31, type: 'posto de coleta', communityId: home.id, complete: true, x: 21, y: 20 });

  assert.equal(findTradePartner(world, home, trader), null);
  assert.deepEqual(world.tradeDiagnostics.marketOpportunityBlocked, { 'no-exchange-offer': 1 });

  assert.equal(performTrade(world, trader, home, {
    isMarket: true, market: world.market, station: world.structures[0], distance: 1
  }), false);
  assert.equal(world.tradeDiagnostics.marketAttempts, 1);
  assert.deepEqual(world.tradeDiagnostics.marketBlocked, { 'no-executable-exchange': 1 });
  assert.equal(world.tradeDiagnostics.marketCompleted ?? 0, 0);
});

test('market opportunity requires the full purchasable lot for each resource', () => {
  const cases = [
    { resource: 'food', gold: 6, below: 11, enough: 12 },
    { resource: 'wood', gold: 6, below: 9, enough: 10 },
    { resource: 'stone', gold: 7, below: 7, enough: 8 }
  ];

  for (const { resource, gold, below, enough } of cases) {
    const { world, home } = tradeFixture();
    home.stores = { food: 0, meat: 0, wood: 0, stone: 0, gold, feed: 0 };
    world.market = { stock: { food: 0, wood: 0, stone: 0, feed: 0, sheep: 0 } };
    world.kingdoms[0].market = world.market;
    world.market.stock[resource] = below;

    assert.equal(marketHasTradeOpportunity(world, home), false,
      resource + ' is not an offer while the market has only ' + below + ' units');
    world.market.stock[resource] = enough;
    assert.equal(marketHasTradeOpportunity(world, home), true,
      resource + ' becomes an offer at the exact purchasable lot of ' + enough);
  }
});

test('market opportunity preserves protected household stock before selling', () => {
  const cases = [
    { resource: 'food', reserve: 44, amount: 10 },
    { resource: 'wood', reserve: 28, amount: 8 },
    { resource: 'stone', reserve: 24, amount: 6 },
    { resource: 'feed', reserve: 30, amount: 10 }
  ];

  for (const { resource, reserve, amount } of cases) {
    const { world, home } = tradeFixture();
    home.stores = { food: 0, meat: 0, wood: 0, stone: 0, gold: 0, feed: 0 };
    world.market = { stock: { food: 0, wood: 0, stone: 0, feed: 0, sheep: 0 } };
    world.kingdoms[0].market = world.market;
    home.stores[resource] = reserve + amount - 1;

    assert.equal(marketHasTradeOpportunity(world, home), false,
      resource + ' cannot be sold until the reserve plus lot is available');
    home.stores[resource]++;
    assert.equal(marketHasTradeOpportunity(world, home), true,
      resource + ' becomes a sale at its exact reserve plus lot');
  }
});

test('a pawn is not sent to a market for an offer smaller than its food purchase lot', () => {
  const { world, home, trader } = tradeFixture();
  world.tradeDiagnostics = {};
  home.stores = { food: 0, meat: 0, wood: 0, stone: 0, gold: 6, feed: 0 };
  world.market = { stock: { food: 11, wood: 0, stone: 0, feed: 0, sheep: 0 } };
  world.kingdoms[0].market = world.market;
  trader.perception.people = [];
  world.structures.push({ id: 31, type: 'posto de coleta', communityId: home.id, complete: true, x: 21, y: 20 });

  assert.equal(findTradePartner(world, home, trader), null);
  assert.deepEqual(world.tradeDiagnostics.marketOpportunityBlocked, { 'no-exchange-offer': 1 });

  world.market.stock.food = 12;
  const partner = findTradePartner(world, home, trader);
  assert.equal(partner?.isMarket, true);
  assert.equal(performTrade(world, trader, home, partner), true);
  assert.equal(home.stores.food, 12);
  assert.equal(home.stores.gold, 0);
  assert.equal(world.market.stock.food, 0);
});


function operationalMarketFixture() {
  const { world, home, trader } = tradeFixture();
  trader.perception.people = [];
  world.tradeDiagnostics = {};
  home.stores = { food: 20, meat: 0, wood: 0, stone: 0, gold: 10, feed: 0 };
  const kingdomMarket = { ownerType: 'kingdom-market', ownerId: 1, transactions: 0,
    stock: { food: 40, wood: 20, stone: 20, gold: 100, feed: 20, sheep: 0 } };
  const unassignedMarket = { transactions: 0,
    stock: { food: 500, wood: 500, stone: 500, gold: 500, feed: 500, sheep: 0 } };
  const station = { id: 30, type: 'posto de coleta', communityId: home.id,
    complete: true, destroyedDay: null, integrity: 1, health: 1, x: 21, y: 20 };
  world.kingdoms[0].market = kingdomMarket;
  world.market = unassignedMarket;
  world.structures.push(station);
  return { world, home, trader, station, kingdomMarket, unassignedMarket };
}

test('a destroyed or zero-health market station cannot advertise trades', () => {
  const { world, home, trader, station } = operationalMarketFixture();
  assert.equal(findTradePartner(world, home, trader)?.isMarket, true);

  station.health = 0;
  assert.equal(findTradePartner(world, home, trader), null, 'health zero blocks trading');
  station.health = 1;
  station.integrity = 0;
  assert.equal(findTradePartner(world, home, trader), null, 'integrity zero blocks trading');
  station.integrity = 1;
  station.destroyedDay = world.day;
  assert.equal(findTradePartner(world, home, trader), null, 'ruins cannot offer transactions');
  station.destroyedDay = null;
  station.complete = false;
  assert.equal(findTradePartner(world, home, trader), null, 'unfinished stations cannot serve trade');
  station.complete = true;
  station.communityId = 99;
  assert.equal(findTradePartner(world, home, trader), null, 'a foreign station cannot serve the community');
  station.communityId = home.id;
  assert.equal(findTradePartner(world, home, trader)?.isMarket, true,
    'repairing a valid station restores the original real offer');
});

test('a stale station or replaced market cannot debit food or gold', () => {
  const { world, home, trader, station, kingdomMarket, unassignedMarket } = operationalMarketFixture();
  const cached = findTradePartner(world, home, trader);
  assert.equal(cached?.isMarket, true);
  const beforeStore = structuredClone(home.stores);
  const beforeKingdomMarket = structuredClone(kingdomMarket.stock);
  const beforeGlobal = structuredClone(unassignedMarket.stock);

  station.destroyedDay = world.day;
  assert.equal(performTrade(world, trader, home, cached), false);
  station.destroyedDay = null;
  world.structures = [{ ...station }];
  assert.equal(performTrade(world, trader, home, cached), false,
    'a removed center cannot be reused via a cached object with identical fields');

  world.structures = [station];
  world.kingdoms[0].market = { ...kingdomMarket, stock: { ...kingdomMarket.stock } };
  assert.equal(performTrade(world, trader, home, cached), false,
    'a replaced market account cannot silently receive transactions through stale pointers');
  assert.deepEqual(home.stores, beforeStore);
  assert.deepEqual(kingdomMarket.stock, beforeKingdomMarket);
  assert.deepEqual(unassignedMarket.stock, beforeGlobal, 'the unassigned market is not a fallback account');
  assert.equal(world.tradeDiagnostics.marketBlocked['stale-station-or-market'], 3);
  assert.equal(summarizeTradeActivity(world).marketTransactionsRecorded, 0);

  const fresh = findTradePartner(world, home, trader);
  assert.equal(fresh?.isMarket, true);
  fresh.distance = 999; // Distance from observation may become stale before execution.
  assert.equal(performTrade(world, trader, home, fresh), true,
    'live location, station and market are authoritative rather than cached distance');
  assert.equal(home.stores.food, 32);
  assert.equal(home.stores.gold, 4);
  assert.equal(world.kingdoms[0].market.stock.food, 28);
  assert.equal(world.kingdoms[0].market.stock.gold, 106);
  assert.deepEqual(unassignedMarket.stock, beforeGlobal);
  assert.equal(summarizeTradeActivity(world).marketTransactionsRecorded, 1);
});

test('cached barter rejects departed witnesses, stale communities and replaced relations without transferring resources', () => {
  const { world, home, foreign, trader } = tradeFixture();
  world.tradeDiagnostics = {};
  const offer = findTradePartner(world, home, trader);
  const witness = offer.person;
  const relation = offer.relation;
  const beforeHome = structuredClone(home.stores);
  const beforeForeign = structuredClone(foreign.stores);
  const reject = reason => {
    assert.equal(performTrade(world, trader, home, offer), false, reason);
    assert.deepEqual(home.stores, beforeHome);
    assert.deepEqual(foreign.stores, beforeForeign);
    assert.equal(world.trades || 0, 0);
    assert.equal(home.tradeCount, 0);
    assert.equal(foreign.tradeCount, 0);
  };

  witness.alive = false;
  reject('a dead counterparty cannot complete a cached offer');
  witness.alive = true;
  witness.communityId = home.id;
  reject('a counterparty reassigned to another community cannot barter for the old owner');
  witness.communityId = foreign.id;
  world.people[1] = { ...witness };
  reject('an unregistered object cannot act as a current witness');
  world.people[1] = witness;
  world.communities[1] = { ...foreign };
  reject('a replaced community object cannot receive resources through a stale offer');
  world.communities[1] = foreign;
  world.communityRelations['1:2'] = { ...relation };
  reject('a replaced relation cannot be modified through an old pointer');
  world.communityRelations['1:2'] = relation;
  relation.trust = .1;
  reject('withdrawn trust must be respected at execution time');
  relation.trust = .6;

  assert.deepEqual(world.tradeDiagnostics.communityBarterBlocked, {
    'stale-partner-or-community': 6
  });
  assert.equal(performTrade(world, trader, home, offer), true,
    'a still-valid offer can execute once live authority is restored');
  assert.equal(home.stores.food, beforeHome.food - 5);
  assert.equal(foreign.stores.food, beforeForeign.food + 5);
  assert.equal(world.trades || 0, 1);
  assert.equal(home.tradeLedger.count, 1);
  assert.equal(foreign.tradeLedger.count, 1);
});

test('barter uses live distance rather than a cached proximity estimate', () => {
  const { world, home, foreign, trader } = tradeFixture();
  world.tradeDiagnostics = {};
  world.tiles = [];
  const offer = findTradePartner(world, home, trader);
  const originalX = offer.person.x;
  offer.distance = 0;
  offer.person.x = originalX + 8;
  assert.equal(performTrade(world, trader, home, offer), false,
    'a distant witness must be approached rather than triggering instant barter');
  assert.deepEqual(world.tradeDiagnostics.communityBarterBlocked, { 'route-blocked': 1 });
  assert.equal(home.stores.food, 34);
  assert.equal(foreign.stores.wood, 24);
  assert.equal(world.trades || 0, 0);

  offer.person.x = originalX;
  assert.equal(performTrade(world, trader, home, offer), true);
  assert.equal(home.stores.food, 29);
  assert.equal(foreign.stores.wood, 19);
});
