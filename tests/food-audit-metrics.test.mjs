import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeCampaignFoodLogistics, summarizeFoodDeaths } from '../scripts/food-audit-metrics.mjs';
import { recordAnimalDeath } from '../src/simulation/ecology/animals.js';

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

test('campaign food audit reconciles field stock and distinguishes treasury, community, and personal rations', () => {
  const summary = summarizeCampaignFoodLogistics({ campaigns: [{ id: 9, status: 'ended',
    attacker: { kingdomId: 1, role: 'attacker', supply: { stock: { food: 4 } }, supplyLedger: {
      deployment: { food: 6 }, resupply: { food: 4 },
      resupplySources: { food: { treasury: 3, community: 1 } }, rationConsumptionFood: 5,
      personalReserveRationPoints: 20, returned: { food: 1 }
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
    fieldFoodConsumed: 5, personalReserveRationPoints: 20, fieldFoodReturned: 1,
    endingFieldFood: 4, resupplySourceDelta: 0, fieldFoodBalance: 0
  });
  assert.equal(summary.totals.fieldFoodConsumed, 5);
  assert.equal(summary.totals.personalReserveRationPoints, 20);
  assert.equal(summary.totals.fieldFoodBalance, 0);
});
