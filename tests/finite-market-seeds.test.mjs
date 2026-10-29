import test from 'node:test';
import assert from 'node:assert/strict';
import engine from '../src/simulation/engine.js';
import { findTradePartner, marketHasTradeOpportunity, performTrade, purchaseFieldSeedsForConstruction } from '../src/simulation/economy/trade.js';
import { transferResource } from '../src/simulation/economy/inventories.js';
import { PLANTS } from '../src/config/ecosystem.js';
import { collectFoodForCommunity } from '../src/simulation/individuals/actions.js';
import { cultivatedFieldStandingBiomass, updatePlants } from '../src/simulation/ecology/plants.js';
import { chooseBuildSite, workOnCommunityStructure, workOnReplantingField } from '../src/simulation/settlements/construction.js';
import { constructionWorkPositions } from '../src/simulation/settlements/construction-workstations.js';

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
  assert.equal(world.seedProvenance.initialWildSeedStock, naturalStock(world));
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
  assert.equal(trader.carriedCommunitySeeds || 0, 0);
  const totalGold = kingdom.treasury.stock.gold + market.gold + community.stores.gold;
  assert.equal(purchaseFieldSeedsForConstruction(world, trader, community), 'purchased');
  assert.equal(trader.carriedCommunitySeeds, 8);
  assert.equal(trader.seedCargoCommunityId, community.id);
  assert.equal(community.stores.seeds, 0);
  assert.equal(market.seeds, 0);
  assert.equal(kingdom.treasury.stock.seeds, 0);
  assert.equal(naturalStock(world) + kingdom.treasury.stock.seeds + market.seeds + community.stores.seeds
    + trader.carriedCommunitySeeds, totalSeeds);
  assert.equal(kingdom.treasury.stock.gold + market.gold + community.stores.gold, totalGold);
  const record = community.tradeLedger.history.at(-1);
  assert.equal(record.action, 'comprou sementes para a roça');
  assert.equal(record.participants[0].delta.carriedCommunitySeeds, 8);
  assert.equal(record.participants[1].kingdomId, kingdom.id);
  assert.equal(record.participants[1].delta.gold, -4);
  assert.equal(record.market.delta.seeds, -8);
  assert.equal(record.market.delta.gold, 4);
  assert.equal(record.coinPayment.priceCopper, 400);
  assert.equal(purchaseFieldSeedsForConstruction(world, trader, community), 'carrying',
    'a second lot is not purchased while the courier still owns the community cargo');
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
    const attempted = purchaseFieldSeedsForConstruction(world, trader, community);
    assert.notEqual(attempted, 'purchased');
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
  assert.equal(purchaseFieldSeedsForConstruction(world, trader, community), 'route-blocked');
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
  assert.equal(community.stores.seeds, 0, 'the market sale does not teleport seeds to the common warehouse');
  assert.equal(trader.carriedCommunitySeeds, 8, 'the kingdom-financed lot is physically with the courier');
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
  // This last stage proves that the farmer cannot sow the same seed stock
  // while it is still owned by the market or carried by the trader.
  const site = chooseBuildSite(world, community,
    world.structures.filter(structure => structure.communityId === community.id));
  assert.ok(site && site.type === 'roça');
  site.required = 3; // Only accelerate construction work in the focused test.
  site.woodCost = 0;
  site.stoneCost = 0;
  site.foodCost = 0;
  world.structures.push(site);
  const positions = constructionWorkPositions(world, site, trader);
  assert.ok(positions?.length, 'farm must have a legal worker approach point');
  trader.x = positions[0].x;
  trader.y = positions[0].y;
  for (let n = 0; n < site.required && !site.complete; n++) {
    world.day++;
    workOnCommunityStructure(world, trader, community, community.memberIds.length);
    if (n === 0) {
      assert.equal(trader.carriedCommunitySeeds, 0, 'the courier personally delivered the market seed batch');
      assert.equal(trader.seedCargoCommunityId, null, 'provenance tag cleared only after real delivery');
      assert.equal(community.stores.seeds, 0, 'common stock did not receive teleported seeds');
      assert.equal(site.cropSeedStored, 8, 'the unsown lot is now owned by this field only');
    }
  }
  assert.equal(site.complete, true);
  assert.equal(site.cropSeedStored, 0, 'planting consumed the field-owned seed inventory');
  assert.equal(site.cropSeededBiomass, 8);
  assert.equal(world.seedProvenance.sown, 8);
  assert.ok(world.seedProvenance.history.some(item => item.kind === 'field-sowing'
    && item.fieldId === site.id && item.quantity === 8));
  assert.equal(naturalStock(world), totalNatural - 8);

  const cropIndex = PLANTS.findIndex(item => item.id === 'cultivated-root');
  const firstGrowthDay = Math.ceil((world.day + 1) / 7) * 7;
  const lastGrowthDay = firstGrowthDay + 140;
  for (let day = firstGrowthDay; day <= lastGrowthDay && site.cropCycleState === 'growing'; day += 7) {
    world.day = day;
    updatePlants(world, day);
  }
  assert.equal(site.cropCycleState, 'ready', 'the purchased lot grows into a finite harvestable crop');
  assert.ok(Math.abs(cultivatedFieldStandingBiomass(world, site) - site.cropYieldTarget) < .05);

  const harvesters = world.people.filter(person => person.alive && person.communityId === community.id
    && person.role !== 'soldier').slice(0, 4);
  assert.equal(harvesters.length, 4);
  const fieldTile = world.tiles[site.fieldTileIndices[0]];
  const storedFoodBeforeHarvest = community.stores.food;
  const tradeRecordsBeforeHarvest = community.tradeLedger.history.length;
  for (const person of harvesters) {
    person.x = fieldTile.x;
    person.y = fieldTile.y;
    person.carriedFood = 0;
  }
  for (const person of harvesters) collectFoodForCommunity(world, person, fieldTile);

  assert.equal(site.cropCycleState, 'spent');
  assert.equal(site.cropSeedsRetainedThisCycle, 8, 'the harvest explicitly retains the next seed lot');
  assert.equal(community.stores.seeds, 8);
  assert.ok(Math.abs(site.foodDelivered - (site.cropYieldTarget - 8)) < .05);
  assert.ok(Math.abs(community.stores.food - storedFoodBeforeHarvest - site.foodDelivered) < .05,
    'harvest reaches the community stock only after the field biomass is removed');
  assert.equal(community.tradeLedger.history.length, tradeRecordsBeforeHarvest,
    'harvesting produces no market transaction');
  assert.ok(site.fieldTileIndices.every(index => world.tiles[index].plants[cropIndex] <= .01));

  const seedStorage = world.structures.find(structure => structure.complete
    && structure.communityId === community.id && ['vila', 'abrigo', 'posto de coleta'].includes(structure.type)
    && structure.destroyedDay == null);
  assert.ok(seedStorage, 'retained seeds require a real storage source for the next field cycle');
  const farmer = harvesters[0];
  farmer.x = seedStorage.x;
  farmer.y = seedStorage.y;
  assert.equal(workOnReplantingField(world, farmer, community, site.id), false,
    'the retained seed lot is physically picked up before replanting');
  assert.equal(community.stores.seeds, 0);
  assert.equal(farmer.carriedCommunitySeeds, 8);
  farmer.x = fieldTile.x;
  farmer.y = fieldTile.y;
  assert.equal(workOnReplantingField(world, farmer, community, site.id), true,
    'the courier delivers the next seed lot to the spent field');
  assert.equal(site.cropCycleState, 'growing');
  assert.equal(site.cropSeededBiomass, 8);
  assert.equal(world.seedProvenance.sown, 16);
  assert.equal(farmer.carriedCommunitySeeds, 0);
  assert.equal(naturalStock(world), totalNatural - 8,
    'replanting the accounted harvest reserve does not debit the natural source a second time');
});
