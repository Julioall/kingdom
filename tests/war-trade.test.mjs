import test from 'node:test';
import assert from 'node:assert/strict';
import { findTradePartner, performTrade } from '../src/simulation/economy/trade.js';
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
  world.structures.push({ id: 31, type: 'posto de coleta', communityId: home.id, complete: true, x: 21, y: 20 });

  assert.equal(findTradePartner(world, home, trader), null);
  assert.deepEqual(world.tradeDiagnostics.marketOpportunityBlocked, { 'no-exchange-offer': 1 });

  assert.equal(performTrade(world, trader, home, { isMarket: true, market: world.market, distance: 1 }), false);
  assert.equal(world.tradeDiagnostics.marketAttempts, 1);
  assert.deepEqual(world.tradeDiagnostics.marketBlocked, { 'no-executable-exchange': 1 });
  assert.equal(world.tradeDiagnostics.marketCompleted ?? 0, 0);
});
