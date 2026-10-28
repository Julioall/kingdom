import test from 'node:test';
import assert from 'node:assert/strict';
import engine from '../src/simulation/engine.js';
import { findTradePartner, marketHasTradeOpportunity, performTrade } from '../src/simulation/economy/trade.js';
import { PLANTS } from '../src/config/ecosystem.js';
import { chooseBuildSite, workOnCommunityStructure } from '../src/simulation/settlements/construction.js';

function setup() {
  const world = engine.createWorld(42);
  const kingdom = world.kingdoms[0];
  const community = world.communities.find(item => item.id === kingdom.communityId);
  const station = world.structures.find(item => item.type === 'mercado'
    && item.kingdomId === kingdom.id && item.communityId === community.id);
  const trader = world.people.find(item => item.alive && item.communityId === community.id && item.role !== 'soldier');
  assert.ok(community && station && trader);
  trader.x = station.x;
  trader.y = station.y;
  trader.foodReserve = 100;
  trader.carriedWood = 0;
  trader.carriedStone = 0;
  trader.carriedIron = 0;
  trader.personalWallet = { stock: { gold: 0 } };
  return { world, kingdom, community, station, trader, market: kingdom.market.stock };
}

test('seed endowment is finite, transferred from kingdom treasury to its local market', () => {
  const { world } = setup();
  for (const kingdom of world.kingdoms) {
    const community = world.communities.find(item => item.id === kingdom.communityId);
    assert.equal(kingdom.treasury.stock.seeds, 8);
    assert.equal(kingdom.market.stock.seeds, 24);
    assert.equal(community.stores.seeds, 0);
    assert.equal(kingdom.market.stock.seeds + kingdom.treasury.stock.seeds + community.stores.seeds, 32);
  }
});

test('resident visits the local market, buys an exact seed batch from finite royal coins and records ownership', () => {
  const { world, kingdom, community, trader, market } = setup();
  const totalSeeds = kingdom.treasury.stock.seeds + market.seeds + community.stores.seeds;
  const totalGold = kingdom.treasury.stock.gold + market.gold + community.stores.gold;
  assert.equal(marketHasTradeOpportunity(world, community), true);
  const offer = findTradePartner(world, community, trader);
  assert.equal(offer?.isMarket, true);
  assert.equal(performTrade(world, trader, community, offer), true);
  assert.equal(community.stores.seeds, 8);
  assert.equal(market.seeds, 16);
  assert.equal(kingdom.treasury.stock.seeds, 8);
  assert.equal(kingdom.treasury.stock.gold + 4 + market.gold - 4, totalGold);
  assert.equal(kingdom.treasury.stock.seeds + market.seeds + community.stores.seeds, totalSeeds);
  assert.equal(kingdom.treasury.stock.gold + market.gold + community.stores.gold, totalGold);
  const record = community.tradeLedger.history.at(-1);
  assert.equal(record.action, 'comprou sementes para a roça');
  assert.equal(record.participants[0].delta.seeds, 8);
  assert.equal(record.participants[1].kingdomId, kingdom.id);
  assert.equal(record.participants[1].delta.gold, -4);
  assert.equal(record.market.delta.seeds, -8);
  assert.equal(record.market.delta.gold, 4);
  assert.equal(record.coinPayment.priceCopper, 400);
  assert.equal(marketHasTradeOpportunity(world, community), false,
    'one full stored seed batch prevents a duplicate order while the farm is not yet built');
});

test('empty seed stock or an insolvent treasury cannot create market seed purchases', () => {
  for (const missing of ['seeds', 'gold']) {
    const { world, kingdom, community, station, trader, market } = setup();
    if (missing === 'seeds') market.seeds = 0;
    else kingdom.treasury.stock.gold = 0;
    // Disable every unrelated market exchange to isolate the seed contract.
    community.stores.food = 60;
    community.stores.wood = 30;
    community.stores.stone = 30;
    community.stores.feed = 30;
    market.food = 0;
    market.wood = 0;
    market.stone = 0;
    market.feed = 0;
    market.gold = 0;
    const before = structuredClone({ market, treasury: kingdom.treasury.stock, store: community.stores });
    assert.equal(marketHasTradeOpportunity(world, community), false);
    assert.equal(performTrade(world, trader, community,
      { isMarket: true, station, market: kingdom.market, distance: 0 }), false);
    assert.deepEqual({ market, treasury: kingdom.treasury.stock, store: community.stores }, before);
    assert.equal(world.trades ?? 0, 0);
  }
});

test('blocking the route to a market never moves royal coins or seeds', () => {
  const { world, kingdom, community, station, trader, market } = setup();
  trader.x = station.x + 5;
  trader.y = station.y + 5;
  world.tiles = [];
  const before = structuredClone({ treasury: kingdom.treasury.stock, store: community.stores, market });
  const partner = { isMarket: true, station, market: kingdom.market, distance: 7 };
  assert.equal(performTrade(world, trader, community, partner), false);
  assert.equal(world.tradeDiagnostics.marketBlocked['route-blocked'], 1);
  assert.deepEqual({ treasury: kingdom.treasury.stock, store: community.stores, market }, before);
});

test('farm construction no longer consumes wild berries as seed currency', () => {
  const { world, community } = setup();
  const berryIndex = PLANTS.findIndex(item => item.id === 'berry');
  const wildBerriesBefore = world.tiles.reduce((sum, tile) => sum + (tile.plants[berryIndex] || 0), 0);
  const structures = world.structures.filter(s => s.communityId === community.id);
  const site = chooseBuildSite(world, community, structures);
  // The first proposed structure is a farm in kingdom villages.
  assert.equal(site?.type, 'roça');
  assert.equal(site.seedMass, 8);
  assert.equal(community.stores.seeds, 0);
  const wildBerriesAfter = world.tiles.reduce((sum, tile) => sum + (tile.plants[berryIndex] || 0), 0);
  assert.equal(wildBerriesAfter, wildBerriesBefore, 'planning cannot harvest any natural berry');
});
