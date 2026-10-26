import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeFoodDeaths } from '../scripts/food-audit-metrics.mjs';
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
