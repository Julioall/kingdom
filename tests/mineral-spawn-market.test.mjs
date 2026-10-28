import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/simulation/world/generation.js';
import { PLANTS } from '../src/config/ecosystem.js';
import { updateKingdomMarkets } from '../src/simulation/kingdoms/initialization.js';
import { findTradePartner, marketHasTradeOpportunity, performTrade } from '../src/simulation/economy/trade.js';

test('gold, silver and copper use exact 1:10:100 mineral-site spawn counts on seeded maps', () => {
  for (const seed of [42, 2026]) {
    const world = createWorld(seed);
    const land = world.tiles.filter(tile => tile.terrain === 'land');
    const count = field => land.filter(tile => tile[field] > .05).length;
    const gold = count('goldOre');
    assert.ok(gold > 0, 'legacy gold sites remain present for seed ' + seed);
    assert.equal(count('silverOre'), gold * 10, 'one silver deposit for each ten copper sites');
    assert.equal(count('copperOre'), gold * 100, 'one gold deposit for each hundred copper sites');
    const trees = PLANTS.map((plant, i) => ['broadleaf', 'conifer'].includes(plant.id) ? i : -1).filter(i => i >= 0);
    const treeSites = land.filter(tile => trees.some(i => (tile.plants[i] || 0) > .01)).length;
    assert.ok(treeSites > 0);
    assert.equal(count('ironOre'), treeSites, 'iron deposit frequency is comparable to tree sites');
    assert.ok(land.every(tile => tile.copperOre >= 0 && tile.silverOre >= 0 && tile.ironOre >= 0));
    const again = createWorld(seed);
    assert.deepEqual(land.map(t => [t.goldOre, t.silverOre, t.copperOre, t.ironOre]),
      again.tiles.filter(t => t.terrain === 'land').map(t => [t.goldOre, t.silverOre, t.copperOre, t.ironOre]),
      'mineral map stays bitwise deterministic for each seed');
  }
});

test('iron price increases on scarcity and decreases as market inventory fills', () => {
  const world = createWorld(42);
  const kingdom = world.kingdoms[0];
  const market = kingdom.market;
  assert.equal(market.stock.iron, 0, 'initial iron market stock must not be minted');
  assert.ok(market.prices.iron > 0);
  const scarcePrice = market.prices.iron;
  market.stock.iron = 500; // Controlled stock fixture; no transaction or mint in the engine.
  updateKingdomMarkets(world, 1);
  const abundantPrice = market.prices.iron;
  assert.ok(abundantPrice > 0 && abundantPrice < scarcePrice,
    'daily quote must respond to available stock rather than a fixed iron value');
  assert.equal(market.supply.iron, 500);
  assert.ok(market.demand.iron > 0);
});

function tradeFixture(ironPrice = 2) {
  const person = {
    id: 5, x: 10, y: 10, alive: true, role: 'resident', communityId: 6, kingdomId: 1,
    carriedGold: 0, carriedIron: 8, carriedWood: 0, carriedStone: 0,
    personalWallet: { stock: { gold: 0 } },
    foodReserve: 100, skills: { diplomacy: 0 }, energy: 90, perception: { people: [] }
  };
  const community = {
    id: 6, kingdomId: 1, dissolved: false, memberIds: [5], tradeCount: 0, history: [],
    stores: { gold: 0, iron: 0, food: 0, meat: 0, wood: 0, stone: 0, feed: 0 }
  };
  const market = {
    ownerType: 'kingdom-market', ownerId: 1, transactions: 0,
    stock: { iron: 0, gold: 20, food: 0, wood: 0, stone: 0, feed: 0, sheep: 0 },
    prices: { food: 1, wood: 1, stone: 1, iron: ironPrice }
  };
  const station = { id: 7, type: 'posto de coleta', x: 11, y: 10,
    communityId: 6, complete: true, health: 1, integrity: 1, destroyedDay: null };
  const world = { day: 9, people: [person], communities: [community], kingdoms: [{ id: 1, communityId: 6, market }],
    structures: [station], animals: [], events: [], trades: 0, tradeDiagnostics: {},
    communityRelations: {}, kingdomRelations: {} };
  return { world, person, community, market };
}

test('iron can be sold at the current market quote without converting ore to coins', () => {
  const low = tradeFixture(1);
  const high = tradeFixture(2);
  for (const { world, person, community, market } of [low, high]) {
    const totalIron = person.carriedIron + market.stock.iron + community.stores.iron;
    const totalGold = market.stock.gold + person.personalWallet.stock.gold;
    const partner = findTradePartner(world, community, person);
    assert.equal(partner?.isMarket, true);
    assert.equal(performTrade(world, person, community, partner), true);
    assert.equal(person.carriedIron, 4);
    assert.equal(market.stock.iron, 4);
    assert.equal(market.stock.iron + person.carriedIron + community.stores.iron, totalIron);
    assert.equal(market.stock.gold + person.personalWallet.stock.gold, totalGold);
    assert.equal(person.carriedGold, 0);
    assert.equal(person.tradeLedger.history[0].market.delta.iron, 4);
  }
  assert.equal(low.person.personalWallet.stock.gold, 2);
  assert.equal(high.person.personalWallet.stock.gold, 4);
});

test('shared iron only sells from actual community stores with finite market gold', () => {
  const { world, person, community, market } = tradeFixture(1.5);
  person.carriedIron = 0;
  community.stores.iron = 14;
  assert.equal(marketHasTradeOpportunity(world, community), true);
  const offer = findTradePartner(world, community, person);
  assert.equal(offer?.isMarket, true);
  assert.equal(performTrade(world, person, community, offer), true);
  assert.equal(community.stores.iron, 10);
  assert.equal(market.stock.iron, 4);
  assert.equal(market.stock.gold, 17);
  assert.equal(community.stores.gold, 3);
  market.stock.gold = 0;
  community.stores.iron = 14;
  assert.equal(marketHasTradeOpportunity(world, community), false,
    'an empty market account cannot pay for iron or create money');
});
