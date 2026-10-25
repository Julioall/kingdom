import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../../src/simulation/engine.js';

test('opt-in phase profiling leaves the full seeded world and RNG replay unchanged', () => {
  const plain = Sim.createWorld(42);
  const profiled = Sim.createWorld(42);
  const records = [];
  let now = 0;
  const profile = {
    now: () => ++now,
    record: (phase, elapsedMs) => records.push({ phase, elapsedMs })
  };

  for (let day = 0; day < 31; day++) {
    Sim.stepDay(plain);
    Sim.stepDay(profiled, profile);
  }

  assert.deepEqual(profiled, plain);
  assert.ok(records.some(record => record.phase === 'climate'));
  assert.ok(records.some(record => record.phase === 'soilWater'));
  assert.ok(records.some(record => record.phase === 'people'));
  assert.ok(records.some(record => record.phase === 'territoryBeforeActions'));
  assert.ok(records.some(record => record.phase === 'campaignResolve'));
  assert.ok(records.some(record => record.phase === 'worldReport'));
  assert.ok(records.some(record => record.phase === 'simulationSnapshot'));
  assert.ok(records.every(record => record.elapsedMs >= 0));
});

test('skipping an unused daily result snapshot preserves the world and weather', () => {
  const standard = Sim.createWorld(987);
  const workerPath = Sim.createWorld(987);

  for (let day = 0; day < 5; day++) {
    const standardResult = Sim.stepDay(standard);
    const workerResult = Sim.stepDay(workerPath, null, { includeSnapshot: false });
    assert.equal(workerResult.snapshot, null);
    assert.deepEqual(workerResult.weather, standardResult.weather);
    assert.deepEqual(workerPath, standard);
  }
});
