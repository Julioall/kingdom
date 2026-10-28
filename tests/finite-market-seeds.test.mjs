import test from 'node:test';
import assert from 'node:assert/strict';
import engine from '../src/simulation/engine.js';
import { findTradePartner, marketHasTradeOpportunity, performTrade, purchaseFieldSeedsForConstruction } from '../src/simulation/economy/trade.js';
import { transferResource } from '../src/simulation/economy/inventories.js';
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
  trader.carriedSeeds = 0;
  trader.personalWallet = { stock: { gold: 0 } };
  world.tradeDiagnostics = {};
  return { world, kingdom, community, station, trader, market: kingdom.market.stock };
}

function naturalStock(world) {
  return world.tiles.reduce((sum, tile) => sum + (tile.wildSeedStock || 0), 0);
}

// Isolated market-purchase fixtures must draw their supply from the real
// natural seed bank. These transfers are setup, not gameplay proof of a worker
// crossing the route; the full producer->market->field test covers that flow.
function sourceSeedLot(world, market, amount = 8) {
  const original = naturalStock(world) + market.seeds;
  let remaining = amount;
  for (const tile of world.tiles) {
    if (remaining <= 0) break;
    remaining -= transferResource(tile, market, 'wildSeedStock', remaining, 'seeds');
  }
  assert.equal(remaining, 0);
  assert.equal(naturalStock(world) + market.seeds, original);
}

test('natural propagules are generated in terrain, never gifted to market or crown', () => {
  const { world } = setup();
  assert.ok(naturalStock(world) >= 32, 'the actual seed 42 world offers natural harvestable propagules');
  for (const kingdom of world.kingdoms) {
    const community = world.communities.find(item => item.id === kingdom.communityId);
    assert.equal(kingdom.treasury.stock.seeds, 0);
    assert.equal(kingdom.market.stock.seeds, 0);
    assert.equal(community.stores.seeds, 0);
  }
  assert.ok(world.tiles.every(tile => tile.wildSeedStock === 0
    || Number.isSafeInteger(tile.wildSeedStock) && tile.wildSeedStock >= 0));
});

test('purchase of a sourced market lot debits finite royal funds, market stock and records both owners', () => {
  const { world, kingdom, community, trader, market } = setup();
  sourceSeedLot(world, market);
  const totalSeeds = naturalStock(world) + kingdom.treasury.stock.seeds + market.seeds + community.stores.seeds;
  const totalGold = kingdom.treasury.stock.gold + market.gold + community.stores.gold;
  assert.equal(marketHasTradeOpportunity(world, community), true);
  const offer = findTradePartner(world, community, trader);
  assert.equal(offer?.isMarket, true);
  assert.equal(performTrade(world, trader, community, offer), true);
  assert.equal(community.stores.seeds, 8);
  assert.equal(market.seeds, 0);
  assert.equal(kingdom.treasury.stock.seeds, 0);
  assert.equal(naturalStock(world) + kingdom.treasury.stock.seeds + market.seeds + community.stores.seeds, totalSeeds);
  assert.equal(kingdom.treasury.stock.gold + market.gold + community.stores.gold, totalGold);
  const record = community.tradeLedger.history.at(-1);
  assert.equal(record.action, 'comprou sementes para a roça');
  assert.equal(record.participants[0].delta.seeds, 8);
  assert.equal(record.participants[1].kingdomId, kingdom.id);
  assert.equal(record.participants[1].delta.gold, -4);
  assert.equal(record.market.delta.seeds, -8);
  assert.equal(record.market.delta.gold, 4);
  assert.equal(record.coinPayment.priceCopper, 400);
  assert.equal(marketHasTradeOpportunity(world, community), false, 'full seed storage blocks duplicate purchase');
});

test('missing market seeds, empty real treasury, or forged market owner cannot create a lot', () => {
  for (const missing of ['seeds', 'gold', 'owner']) {
    const { world, kingdom, community, station, trader, market } = setup();
    if (missing !== 'seeds') sourceSeedLot(world, market);
    if (missing === 'gold') for (const coin of ['gold', 'silver', 'copper']) kingdom.treasury.stock[coin] = 0;
    if (missing === 'owner') kingdom.market.ownerId = -1;
    community.stores.food = 60;
    community.stores.wood = 30;
    community.stores.stone = 30;
    community.stores.feed = 30;
    market.food = 0; market.wood = 0; market.stone = 0; market.feed = 0; market.gold = 0;
    const before = structuredClone({ market, treasury: kingdom.treasury.stock, store: community.stores });
    assert.equal(marketHasTradeOpportunity(world, community), false);
    assert.equal(performTrade(world, trader, community,
      { isMarket: true, station, market: kingdom.market, distance: 0 }), false);
    assert.deepEqual({ market, treasury: kingdom.treasury.stock, store: community.stores }, before);
    assert.equal(world.trades ?? 0, 0);
  }
});

test('route blocked before market settlement leaves source, coins, and seeds unchanged', () => {
  const { world, kingdom, community, station, trader, market } = setup();
  sourceSeedLot(world, market);
  trader.x = station.x + 6;
  trader.y = station.y + 6;
  world.tiles = [];
  const before = structuredClone({ treasury: kingdom.treasury.stock, store: community.stores, market });
  const partner = { isMarket: true, station, market: kingdom.market, distance: 8 };
  assert.equal(performTrade(world, trader, community, partner), false);
  assert.equal(world.tradeDiagnostics.marketBlocked['route-blocked'], 1);
  assert.deepEqual({ treasury: kingdom.treasury.stock, store: community.stores, market }, before);
});

test('farm planning cannot consume berries and cannot mint a starting seed batch', () => {
  const { world, community } = setup();
  const berryIndex = PLANTS.findIndex(item => item.id === 'berry');
  const wildBerriesBefore = world.tiles.reduce((sum, tile) => sum + (tile.plants[berryIndex] || 0), 0);
  const structures = world.structures.filter(s => s.communityId === community.id);
  const site = chooseBuildSite(world, community, structures);
  assert.equal(site?.type, 'roça');
  assert.equal(site.seedMass, 8);
  assert.equal(community.stores.seeds, 0);
  const wildBerriesAfter = world.tiles.reduce((sum, tile) => sum + (tile.plants[berryIndex] || 0), 0);
  assert.equal(wildBerriesAfter, wildBerriesBefore);
  assert.equal(community.stores.seeds, 0);
});

test('seed seller receives real market coins; worker then buys for kingdom and plants only delivered stock', () => {
  const { world, kingdom, community, trader, market } = setup();
  const totalNatural = naturalStock(world);
  const totalMoney = ['gold', 'silver', 'copper'].reduce((sum, coin) => sum
    + (kingdom.treasury.stock[coin] || 0) * ({ gold: 100, silver: 10, copper: 1 }[coin])
    + (market[coin] || 0) * ({ gold: 100, silver: 10, copper: 1 }[coin])
    + (trader.personalWallet.stock[coin] || 0) * ({ gold: 100, silver: 10, copper: 1 }[coin]), 0);
  let bought = false, sold = false, gathered = false;
  for (let day = 0; day < 180 && !bought; day++) {
    world.day = day;
    const state = purchaseFieldSeedsForConstruction(world, trader, community);
    if (state === 'gathered') gathered = true;
    if (state === 'sold') sold = true;
    if (state === 'purchased') bought = true;
    assert.notEqual(state, 'no-source', 'source exhausted before one lot was collected');
    assert.notEqual(state, 'invalid', 'no ownership or role errors');
  }
  assert.equal(gathered, true);
  assert.equal(sold, true);
  assert.equal(bought, true);
  assert.equal(community.stores.seeds, 8);
  assert.equal(trader.personalWallet.stock.gold, 2, 'market pays worker for a real supply lot');
  assert.equal(market.seeds, 0, 'buyer took the exact batch from market');
  assert.equal(naturalStock(world), totalNatural - 8, 'natural origin is debited once per harvested unit');
  assert.equal(world.seedProvenance.gathered, 8);
  assert.ok(world.seedProvenance.history.every(item => item.kind === 'wild-gather'));
  const postMoney = ['gold', 'silver', 'copper'].reduce((sum, coin) => sum
    + (kingdom.treasury.stock[coin] || 0) * ({ gold: 100, silver: 10, copper: 1 }[coin])
    + (market[coin] || 0) * ({ gold: 100, silver: 10, copper: 1 }[coin])
    + (trader.personalWallet.stock[coin] || 0) * ({ gold: 100, silver: 10, copper: 1 }[coin]), 0);
  assert.equal(postMoney, totalMoney);
  assert.ok(community.tradeLedger.history.some(item => item.action === 'vendeu sementes extraídas da natureza'));
  assert.ok(community.tradeLedger.history.some(item => item.action === 'comprou sementes para a roça'));
});
