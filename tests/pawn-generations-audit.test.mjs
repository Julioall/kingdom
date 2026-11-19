import test from 'node:test';
import assert from 'node:assert/strict';
import engine from '../src/simulation/engine.js';
import { snapshotGenerations, auditGenerations } from '../scripts/audit-pawn-generations.mjs';

test('generation summary counts real people, not a synthetic population target', () => {
  const world = engine.createWorld(11, { initialPopulation: 200, initialMilitaryShare: .8 });
  world.initialPopulationSize = 200;
  const first = snapshotGenerations(world);
  assert.equal(first.alive, 200);
  assert.equal(first.populationNetFromStart, 0);
  assert.equal(first.births, 0);
  assert.equal(first.soldiers, 160);
  assert.equal(first.civilian, 40);
  assert.equal(Object.values(first.groups).reduce((sum, n) => sum + n, 0), 200);
  assert.equal(first.civilizationEvidence.evidence.legitimateNewKingdoms, 0,
    'prebuilt governments are not evidence of institutional emergence');
});

test('small audit reproduces one simulated day without claiming civilization was founded', () => {
  const a = auditGenerations({ seed: 19, days: 1, population: 200 });
  const b = auditGenerations({ seed: 19, days: 1, population: 200 });
  assert.deepEqual(a, b, 'observational metrics must remain deterministic for the same seed');
  assert.equal(a.timeline.length, 2);
  assert.equal(a.timeline[1].day, 1);
  assert.equal(a.scenario, 'prebuilt-kingdoms');
  assert.equal(a.timeline[1].civilizationEvidence.evidence.legitimateNewKingdoms, 0);
});
