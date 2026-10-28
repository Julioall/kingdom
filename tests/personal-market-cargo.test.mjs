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
    carriedStone: 0, carriedGold: 0, personalWallet: { stock: { gold: 0 } }, skills: { diplomacy: 0 },
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
  const physicalGoldBefore = market.stock.gold + community.stores.gold + person.carriedGold + person.personalWallet.stock.gold;
  assert.equal(marketHasTradeOpportunity(world, community), false,
    'no community-funded transaction is available in the fixture');

  const sale = findTradePartner(world, community, person);
  assert.equal(sale?.isMarket, true, 'personal offer unlocks normal market action');
  assert.equal(performTrade(world, person, community, sale), true);
  assert.equal(person.carriedWood, 12, 'protected loaded reserve remains with the gatherer');
  assert.equal(person.personalWallet.stock.gold, 4);
  assert.equal(person.carriedGold, 0, 'mined cargo stays independent of earned money');
  assert.equal(market.stock.wood, 4);
  assert.equal(market.stock.gold, 16);
  assert.equal(market.transactions, 1);
  assert.equal(person.tradeLedger.count, 1);
  assert.equal(person.tradeLedger.history[0].kind, 'market');
  assert.equal(person.tradeLedger.history[0].scope, 'personal');
  assert.deepEqual(person.tradeLedger.history[0].pricing, {
    resource: 'wood', quantity: 4, goldPerUnit: 1, goldTransferred: 4
  });
  assert.equal(person.tradeLedger.history[0].balancesAfter.person.walletGold, 4);
  assert.equal(person.tradeLedger.history[0].balancesAfter.person.carriedGold, 0);
  assert.equal(person.tradeLedger.history[0].balancesAfter.market.gold, 16);
  assert.deepEqual(person.tradeLedger.history[0].market.delta, { wood: 4, gold: -4 });
  assert.deepEqual(community.stores, communityBefore, 'personal sales never debit shared property');

  person.foodReserve = 45;
  const foodBeforePurchase = market.stock.food + person.foodReserve;
  const goldBeforePurchase = market.stock.gold + person.personalWallet.stock.gold;
  const buy = findTradePartner(world, community, person);
  assert.equal(buy?.isMarket, true);
  assert.equal(performTrade(world, person, community, buy), true);
  assert.equal(person.foodReserve, 49);
  assert.equal(person.carriedGold, 0);
  assert.equal(person.personalWallet.stock.gold, 0);
  assert.equal(market.stock.food, 16);
  assert.equal(market.stock.gold, 20);
  assert.equal(market.stock.food + person.foodReserve, foodBeforePurchase);
  assert.equal(market.stock.gold + person.personalWallet.stock.gold, goldBeforePurchase);
  assert.equal(market.stock.wood + community.stores.wood + person.carriedWood, physicalWoodBefore);
  assert.equal(market.stock.gold + community.stores.gold + person.carriedGold + person.personalWallet.stock.gold, physicalGoldBefore);
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
  person.personalWallet.stock.gold = 4;
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


test('personal commerce never falls back to unassigned world market or another kingdom owner', () => {
  const { world, community, person, market } = fixture();
  world.market = market;
  world.kingdoms[0].market = null;
  assert.equal(findTradePartner(world, community, person), null,
    'kingdom resident cannot sell cargo through global market if local market is absent');
  world.kingdoms[0].market = market;
  market.ownerId = 2;
  assert.equal(findTradePartner(world, community, person), null,
    'wrong ownerId cannot authorize kingdom market personal sales');
  assert.equal(world.trades, undefined);
  assert.equal(market.transactions, 0);
  assert.equal(person.carriedWood, 16);
});

test('personal market trade requires a real route to the station', () => {
  const { world, community, person, market, station } = fixture();
  station.x = 27;
  world.tiles = [];
  const offer = findTradePartner(world, community, person);
  assert.equal(offer?.isMarket, true, 'the market is visible within the search radius');
  const before = structuredClone(market.stock);
  assert.equal(performTrade(world, person, community, offer), false,
    'a missing navigable destination blocks the transfer');
  assert.equal(world.tradeDiagnostics.marketBlocked['route-blocked'], 1);
  assert.deepEqual(market.stock, before);
  assert.equal(person.carriedWood, 16);
  assert.equal(person.carriedGold, 0);
  assert.equal(world.trades, undefined);
});

test('a kingdom without its own market cannot spend community gold at the global market', () => {
  const { world, community, person, market, station } = fixture();
  community.stores.food = 0;
  community.stores.gold = 12;
  person.carriedWood = 0;
  person.foodReserve = 100;
  world.market = market;
  world.kingdoms[0].market = null;
  const before = structuredClone({ community: community.stores, market: market.stock });

  assert.equal(marketHasTradeOpportunity(world, community), false,
    'the global market is not a fallback for a kingdom with no local market');
  assert.equal(findTradePartner(world, community, person), null);
  assert.equal(performTrade(world, person, community,
    { isMarket: true, station, market, distance: 1 }), false,
    'a stale or forged global-market offer cannot settle against kingdom funds');
  assert.deepEqual(community.stores, before.community);
  assert.deepEqual(market.stock, before.market);
  assert.equal(world.trades, undefined);

  world.kingdoms = [];
  person.kingdomId = null;
  assert.equal(marketHasTradeOpportunity(world, community), true,
    'a community without a kingdom retains its explicitly global market');
  const offer = findTradePartner(world, community, person);
  assert.equal(offer?.market, market);
  assert.equal(performTrade(world, person, community, offer), true);
  assert.equal(community.stores.food, 12);
  assert.equal(community.stores.gold, 6);
  assert.equal(market.stock.food, 8);
  assert.equal(market.stock.gold, 26);
});

test('mined gold in cargo is not a spendable wallet balance', () => {
  const { world, community, person, market } = fixture();
  person.carriedWood = 12;
  person.carriedGold = 15;
  person.foodReserve = 35;
  const marketBefore = structuredClone(market.stock);
  assert.equal(findTradePartner(world, community, person), null);
  assert.deepEqual(market.stock, marketBefore);
  assert.deepEqual(person.personalWallet, { stock: { gold: 0 } });
  assert.equal(person.carriedGold, 15);
});

test('legacy residents receive an empty wallet only after a real sale', () => {
  const { world, community, person, market, station } = fixture();
  delete person.personalWallet;
  person.carriedGold = 9;
  const partner = findTradePartner(world, community, person);
  assert.equal(partner?.isMarket, true);
  station.destroyedDay = world.day;
  assert.equal(performTrade(world, person, community, partner), false);
  assert.equal(person.personalWallet, undefined);
  station.destroyedDay = null;
  assert.equal(performTrade(world, person, community, partner), true);
  assert.deepEqual(person.personalWallet, { stock: { gold: 4 } });
  assert.equal(person.carriedGold, 9);
  assert.equal(market.stock.gold, 16);
});

test('malformed or aliased wallets cannot spend communal or market gold', () => {
  const { world, community, person, market } = fixture();
  for (const wallet of [market.stock, community.stores, person, { gold: NaN }, { gold: -1 }, []]) {
    person.personalWallet.stock = wallet;
    const before = structuredClone(market.stock);
    assert.equal(findTradePartner(world, community, person), null);
    assert.deepEqual(market.stock, before);
    assert.equal(person.carriedWood, 16);
  }
  person.personalWallet = { stock: null };
  assert.equal(findTradePartner(world, community, person), null);
});

test('fixed-price community sale is not offered without real market gold', () => {
  const { world, community, person, market } = fixture();
  community.stores.food = 50; // No food purchase or barter should mask the sale.
  community.stores.wood = 36; // Sale floor 28 plus the 8-unit lot.
  person.carriedWood = 0; // Exclude personal-cargo offers from this test.
  market.stock.gold = 0;

  assert.equal(marketHasTradeOpportunity(world, community), false,
    'a fixed-price sale cannot be advertised if the market cannot pay');
  assert.equal(findTradePartner(world, community, person), null,
    'the resident should not walk to a market for an unfunded sale');
  assert.equal(world.trades, undefined);
  assert.equal(community.stores.wood, 36);

  market.stock.gold = 4;
  assert.equal(marketHasTradeOpportunity(world, community), true,
    'funding the existing market stock makes the sale executable');
  const partner = findTradePartner(world, community, person);
  assert.equal(partner?.isMarket, true);
  assert.equal(performTrade(world, person, community, partner), true);
  assert.equal(community.stores.wood, 28);
  assert.equal(community.stores.gold, 4);
  assert.equal(market.stock.wood, 8);
  assert.equal(market.stock.gold, 0);
  assert.equal(marketHasTradeOpportunity(world, community), false,
    'the next sale is blocked when the finite payment account is empty');
});

test('resident buys one food with gold, receives silver and copper change, and keeps mined cargo', () => {
  const { world, community, person, market } = fixture();
  person.carriedWood = 12;
  person.foodReserve = 59;
  market.stock.food = 1;
  person.carriedGold = 3;
  person.personalWallet.stock = { gold: 1, silver: 0, copper: 1 };
  market.prices.food = .37;
  market.stock.silver = 6;
  market.stock.copper = 3;
  const moneyBefore = ['gold', 'silver', 'copper'].map((metal) =>
    (person.personalWallet.stock[metal] || 0) + (market.stock[metal] || 0));
  const partner = findTradePartner(world, community, person);
  assert.equal(partner?.isMarket, true);
  assert.equal(performTrade(world, person, community, partner), true);
  assert.equal(person.foodReserve, 60);
  assert.equal(market.stock.food, 0);
  assert.deepEqual(person.personalWallet.stock, { gold: 0, silver: 6, copper: 4 });
  assert.equal(person.carriedGold, 3, 'ore cargo must not become spendable coins');
  assert.deepEqual(['gold', 'silver', 'copper'].map((metal) =>
    (person.personalWallet.stock[metal] || 0) + (market.stock[metal] || 0)), moneyBefore);
  assert.deepEqual(person.tradeLedger.history[0].pricing.tender,
    { copper: 0, silver: 0, gold: 1 });
  assert.deepEqual(person.tradeLedger.history[0].pricing.change,
    { copper: 3, silver: 6, gold: 0 });
});

test('personal coin purchase needs exact change; it cannot fall through to fractional legacy gold', () => {
  const { world, community, person, market } = fixture();
  person.carriedWood = 12;
  person.foodReserve = 59;
  market.stock.food = 1;
  person.personalWallet.stock = { gold: 1, silver: 0, copper: 1 };
  market.prices.food = .37;
  market.stock.silver = 6;
  market.stock.copper = 2;
  const before = structuredClone({ person: person.personalWallet.stock, market: market.stock });
  assert.equal(findTradePartner(world, community, person), null);
  assert.deepEqual({ person: person.personalWallet.stock, market: market.stock }, before);
});

test('community buys real food using mined copper and records all physical coin deltas', () => {
  const { world, community, person, market } = fixture();
  community.stores.food = 0;
  community.stores.gold = 0;
  community.stores.copper = 600;
  community.stores.silver = 0;
  person.carriedWood = 12;
  person.foodReserve = 100;
  const before = market.stock.food + community.stores.food;
  assert.equal(marketHasTradeOpportunity(world, community), true);
  const partner = findTradePartner(world, community, person);
  assert.equal(partner?.isMarket, true);
  assert.equal(performTrade(world, person, community, partner), true);
  assert.equal(community.stores.food, 12);
  assert.equal(market.stock.food, 8);
  assert.equal(market.stock.food + community.stores.food, before);
  assert.equal(community.stores.copper, 0);
  assert.equal(market.stock.copper, 600);
  assert.equal(community.tradeLedger.history[0].coinPayment.priceCopper, 600);
  assert.equal(community.tradeLedger.history[0].market.delta.copper, 600);
});

test('personal sale in coin-mode is funded by existing whole market coins', () => {
  const { world, community, person, market } = fixture();
  person.foodReserve = 90;
  person.personalWallet.stock = { gold: 0, silver: 1, copper: 0 };
  const goldBefore = market.stock.gold + person.personalWallet.stock.gold;
  const offer = findTradePartner(world, community, person);
  assert.equal(offer?.isMarket, true);
  assert.equal(performTrade(world, person, community, offer), true);
  assert.equal(person.carriedWood, 12);
  assert.equal(market.stock.wood, 4);
  assert.equal(person.personalWallet.stock.gold, 4);
  assert.equal(market.stock.gold + person.personalWallet.stock.gold, goldBefore);
  assert.equal(person.personalWallet.stock.silver, 1);
  assert.equal(person.tradeLedger.history[0].pricing.priceCopper, 400);
});

test('a coin-enabled community sale receives whole pieces and cannot create fractional gold', () => {
  const { world, community, person, market } = fixture();
  person.carriedWood = 0;
  person.foodReserve = 100;
  community.stores.food = 60;
  community.stores.silver = 1;
  const total = market.stock.gold + community.stores.gold;
  const offer = findTradePartner(world, community, person);
  assert.equal(offer?.isMarket, true);
  assert.equal(performTrade(world, person, community, offer), true);
  assert.equal(community.stores.food, 50);
  assert.equal(market.stock.food, 30);
  assert.equal(market.stock.gold + community.stores.gold, total);
  assert.ok(Number.isSafeInteger(community.stores.gold));
  assert.equal(community.tradeLedger.history[0].coinPayment.priceCopper, 400);
});
