import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeCampaignFoodLogistics, summarizeCultivatedFields, summarizeFoodDeaths, summarizeTradeActivity } from '../scripts/food-audit-metrics.mjs';
import { recordAnimalDeath } from '../src/simulation/ecology/animals.js';
import { recordTrade } from '../src/simulation/economy/trade-ledger.js';
import { PLANTS } from '../src/config/ecosystem.js';

test('animal death records cause and day once, including predation', () => {
  const world = { day: 17, deaths: 0, deathsByCause: {} };
  const prey = { id: 2, alive: true, herdCommunityId: null };

  assert.equal(recordAnimalDeath(world, prey, 'predation'), true);
  assert.equal(recordAnimalDeath(world, prey, 'starvation'), false);
  assert.deepEqual({ alive: prey.alive, deathDay: prey.deathDay, deathCause: prey.deathCause },
    { alive: false, deathDay: 18, deathCause: 'predation' });
  assert.equal(world.deaths, 1);
  assert.deepEqual(world.deathsByCause, { predation: 1 });
});

test('food audit separates human hunger from domesticated and wild animal mortality', () => {
  const world = {
    people: [
      { alive: false, deathCause: 'starvation' },
      { alive: false, deathCause: 'combat' },
      { alive: true }
    ],
    animals: [
      { alive: false, herdCommunityId: 7, deathCause: 'starvation' },
      { alive: false, herdCommunityId: 7, deathCause: 'age' },
      { alive: false, herdCommunityId: null, deathCause: 'starvation' },
      { alive: false, herdCommunityId: null, deathCause: 'predation' }
    ]
  };

  assert.deepEqual(summarizeFoodDeaths(world), {
    people: { total: 2, byCause: { starvation: 1, combat: 1 } },
    animals: { total: 4, byCause: { starvation: 2, age: 1, predation: 1 } },
    domesticatedAnimals: { total: 2, byCause: { starvation: 1, age: 1 } },
    wildAnimals: { total: 2, byCause: { starvation: 1, predation: 1 } }
  });
});

test('legacy animals without an explicit cause are visible as unattributed instead of disappearing', () => {
  const summary = summarizeFoodDeaths({ people: [], animals: [{ alive: false, herdCommunityId: 1 }] });
  assert.deepEqual(summary.animals.byCause, { unattributed: 1 });
  assert.deepEqual(summary.domesticatedAnimals.byCause, { unattributed: 1 });
});

test('food audit separates standing crop, stored seed, seeded mass, and cumulative harvest by field', () => {
  const rootIndex = PLANTS.findIndex(plant => plant.id === 'cultivated-root');
  const cropTile = (amount, cropFieldId) => {
    const plants = Array(PLANTS.length).fill(0);
    plants[rootIndex] = amount;
    return { cropFieldId, plants };
  };
  const summary = summarizeCultivatedFields({
    tiles: [cropTile(5.5, 10), cropTile(2.25, 10), cropTile(1.5, 11)],
    communities: [{ id: 2, stores: { seeds: 6 } }, { id: 3, stores: { seeds: 0 } }],
    structures: [
      { id: 10, communityId: 2, type: 'roça', complete: true, fieldTileIndices: [0, 1],
        progress: 34, required: 34, builtDay: 120,
        cropSeedStored: 0, cropSeededBiomass: 8, cropSeedsRetainedThisCycle: 3,
        cropSeedsRetainedTotal: 7, cropSowCount: 2, cropLastSowedDay: 180,
        cropCycleState: 'growing', cropHarvested: 1.25, foodDelivered: .75 },
      { id: 11, communityId: 3, type: 'roça', complete: false, fieldTileIndices: [2],
        progress: 5, required: 34, cropSeedStored: 2.5, cropSeededBiomass: 0, cropHarvested: 0 }
    ]
  });

  assert.deepEqual(summary, {
    fieldCount: 2, completeFieldCount: 1, totalFieldTiles: 3,
    standingBiomass: 9.25, cropSeedStored: 2.5, cropSeededBiomass: 8, cropHarvested: 1.25, foodDelivered: .75,
    seedStockByCommunity: [{ communityId: 2, seeds: 6 }, { communityId: 3, seeds: 0 }],
    fields: [
      { id: 10, communityId: 2, complete: true, destroyed: false, progress: 34, required: 34,
        builtDay: 120, fieldTileCount: 2,
        standingBiomass: 7.75, cropSeedStored: 0, cropSeededBiomass: 8,
        cropSeedsRetainedThisCycle: 3, cropSeedsRetainedTotal: 7, cropSowCount: 2,
        cropLastSowedDay: 180, cropCycleState: 'growing', cropHarvested: 1.25, foodDelivered: .75 },
      { id: 11, communityId: 3, complete: false, destroyed: false, progress: 5, required: 34,
        builtDay: null, fieldTileCount: 1,
        standingBiomass: 1.5, cropSeedStored: 2.5, cropSeededBiomass: 0,
        cropSeedsRetainedThisCycle: 0, cropSeedsRetainedTotal: 0, cropSowCount: 0,
        cropLastSowedDay: null, cropCycleState: null, cropHarvested: 0, foodDelivered: 0 }
    ]
  });
});

test('food audit reports zero field stock instead of treating missing fields as shared food', () => {
  assert.deepEqual(summarizeCultivatedFields({ structures: [], tiles: [] }), {
    fieldCount: 0, completeFieldCount: 0, totalFieldTiles: 0, standingBiomass: 0,
    cropSeedStored: 0, cropSeededBiomass: 0, cropHarvested: 0, foodDelivered: 0,
    seedStockByCommunity: [], fields: []
  });
});

test('trade audit separates actual market purchases from community barter and deduplicates shared ledgers', () => {
  const purchase = {
    id: 1, day: 9, kind: 'market', action: 'comprou alimento',
    participants: [{ personId: 11, communityId: 2, delta: { food: 12, gold: -6 } }],
    market: { ownerType: 'kingdom-market', ownerId: 4, delta: { food: -12, gold: 6 } }
  };
  const barter = {
    id: 2, day: 10, kind: 'community-barter', action: 'barter',
    participants: [{ communityId: 2, delta: { food: -5 } }, { communityId: 3, delta: { food: 5 } }],
    market: null
  };
  const community = { id: 2, tradeLedger: { count: 2, history: [purchase, barter] } };
  const partner = { id: 3, tradeLedger: { count: 1, history: [barter] } };
  const market = { ownerType: 'kingdom-market', ownerId: 4, transactions: 1,
    tradeLedger: { count: 1, history: [purchase] } };
  const summary = summarizeTradeActivity({ trades: 2, communities: [community, partner],
    people: [{ id: 11, role: 'farmer', communityId: 2 }],
    kingdoms: [{ id: 4, market }], market: { transactions: 0, tradeLedger: { count: 0, history: [] } },
    tradeDiagnostics: { marketOpportunityChecks: 4, marketOpportunities: 2,
      marketOpportunityBlocked: { 'no-exchange-offer': 2 }, marketAttempts: 2, marketCompleted: 1,
      marketBlocked: { 'route-blocked': 1 } } });

  assert.equal(summary.totalTradeRecords, 2);
  assert.equal(summary.retainedTradeRecords, 2);
  assert.equal(summary.duplicateLedgerRows, 2);
  assert.equal(summary.tradeRecordCoverageComplete, true);
  assert.equal(summary.marketTransactions, 1);
  assert.equal(summary.marketTransactionsRecorded, 1);
  assert.equal(summary.marketTransactionCoverageComplete, true);
  assert.equal(summary.otherTradeRecords, 1);
  assert.deepEqual(summary.byAction, [{ action: 'comprou alimento', count: 1, marketDelta: { food: -12, gold: 6 } }]);
  assert.deepEqual(summary.byMarket, [{ ownerType: 'kingdom-market', ownerId: 4, count: 1,
    marketDelta: { food: -12, gold: 6 } }]);
  assert.deepEqual(summary.byActor, [{ actorType: 'person', actorId: 11, role: 'farmer', communityId: 2,
    count: 1, marketDelta: { food: -12, gold: 6 } }]);
  assert.deepEqual(summary.diagnostics, {
    marketOpportunityChecks: 4, marketOpportunities: 2,
    marketOpportunityBlocked: { 'no-exchange-offer': 2 }, marketApproaches: 0,
    marketAttempts: 2, marketCompleted: 1, marketBlocked: { 'route-blocked': 1 },
    communityBarterAttempts: 0, communityBarterCompleted: 0, communityBarterBlocked: {}
  });
});

test('trade audit marks truncated ledgers and missing market transaction records', () => {
  const entry = { id: 1, kind: 'market', action: 'comprou madeira',
    market: { ownerType: 'kingdom-market', ownerId: 1, delta: { wood: -10, gold: 6 } } };
  const summary = summarizeTradeActivity({ trades: 4,
    communities: [{ tradeLedger: { count: 4, history: [entry] } }],
    kingdoms: [{ market: { ownerType: 'kingdom-market', ownerId: 1, transactions: 2,
      tradeLedger: { count: 2, history: [entry] } } }] });

  assert.equal(summary.totalTradeRecords, 4);
  assert.equal(summary.retainedTradeRecords, 1);
  assert.equal(summary.tradeRecordCoverageComplete, false);
  assert.equal(summary.marketTransactions, 2);
  assert.equal(summary.marketTransactionsRecorded, 1);
  assert.equal(summary.marketTransactionCoverageComplete, false);
});

test('trade ledger keeps its game cap but retains every entry when a full audit is requested', () => {
  const normalWorld = { day: 0, trades: 0 };
  const normalOwner = {};
  for (let index = 0; index < 121; index++) recordTrade(normalWorld, { action: 'normal' }, [normalOwner]);
  assert.equal(normalOwner.tradeLedger.count, 121);
  assert.equal(normalOwner.tradeLedger.history.length, 120);

  const auditWorld = { day: 0, trades: 0, tradeDiagnostics: { retainFullTradeHistory: true } };
  const auditOwner = {};
  for (let index = 0; index < 121; index++) recordTrade(auditWorld, { action: 'audit' }, [auditOwner]);
  assert.equal(auditOwner.tradeLedger.count, 121);
  assert.equal(auditOwner.tradeLedger.history.length, 121);
});

test('campaign food audit reconciles field stock and distinguishes treasury, community, and personal rations', () => {
  const summary = summarizeCampaignFoodLogistics({ campaigns: [{ id: 9, status: 'ended',
    attacker: { kingdomId: 1, role: 'attacker', supply: { stock: { food: 4 } }, supplyLedger: {
      deployment: { food: 6 }, resupply: { food: 4 },
      resupplySources: { food: { treasury: 3, community: 1 } }, rationConsumptionFood: 5,
      personalReserveRationDays: 20, returned: { food: 1 }
    } },
    defender: { kingdomId: 2, role: 'defender', supply: { stock: { food: 0 } } }
  }] });

  assert.equal(summary.sideCount, 2);
  assert.equal(summary.sidesWithoutLedger, 1);
  assert.equal(summary.ledgerCoverageComplete, false);
  assert.equal(summary.unbalancedSides, 0);
  assert.equal(summary.resupplySourceMismatchSides, 0);
  assert.deepEqual(summary.sides[0], {
    campaignId: 9, kingdomId: 1, role: 'attacker', status: 'ended', ledgerPresent: true,
    fieldFoodDeployed: 6, fieldFoodResupplied: 4, resupplyFromTreasury: 3, resupplyFromCommunity: 1,
    fieldFoodConsumed: 5, personalReserveRationDays: 20, fieldFoodReturned: 1,
    endingFieldFood: 4, resupplySourceDelta: 0, fieldFoodBalance: 0
  });
  assert.equal(summary.totals.fieldFoodConsumed, 5);
  assert.equal(summary.totals.personalReserveRationDays, 20);
  assert.equal(summary.totals.fieldFoodBalance, 0);
});
