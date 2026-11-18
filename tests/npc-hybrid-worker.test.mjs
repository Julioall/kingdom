import test from 'node:test';
import assert from 'node:assert/strict';
import engine from '../src/simulation/engine.js';
import { createSimulationWorkerRuntime } from '../src/simulation/worker-runtime.js';
import { SIMULATION_PROTOCOL_VERSION } from '../src/simulation/protocol-version.js';
import { authoritativeSnapshotDigest }
  from '../scripts/support/jul274-snapshot-digest.mjs';

function send(runtime, type, extra = {}, requestId = 1, epoch = 1) {
  return runtime.handle({protocolVersion: SIMULATION_PROTOCOL_VERSION,
    requestId, epoch, type, ...extra});
}
test('legacy remains exactly the default Worker behavior', () => {
  const runtime = createSimulationWorkerRuntime();
  const response = send(runtime, 'initialize', {
    seed: 42, config: {scenario: 'kingdom'}
  });
  assert.equal(response.type, 'snapshot');
  for (const flag of ['utilityContinuity', 'taskWorkflow', 'steeringBoids'])
    assert.notEqual(response.snapshot.base.neuralOverrides?.[flag], true, flag);
});
test('hybrid opt-in activates all three systems and persists after reset', () => {
  const runtime = createSimulationWorkerRuntime();
  let response = send(runtime, 'initialize', {
    seed: 42, config: {scenario: 'kingdom'}, npcBehavior: 'hybrid'
  });
  assert.equal(response.type, 'snapshot');
  for (const flag of ['utilityContinuity', 'taskWorkflow', 'steeringBoids'])
    assert.equal(response.snapshot.base.neuralOverrides?.[flag], true, flag);
  response = send(runtime, 'reset', {seed: 43, kingdomAiEnabled: false,
    npcBehavior: 'hybrid'}, 2, 2);
  assert.equal(response.type, 'snapshot');
  for (const flag of ['utilityContinuity', 'taskWorkflow', 'steeringBoids'])
    assert.equal(response.snapshot.base.neuralOverrides?.[flag], true, flag);
});
test('invalid hybrid mode fails closed instead of silently altering AI', () => {
  const runtime = createSimulationWorkerRuntime();
  const response = send(runtime, 'initialize', {
    seed: 42, config: {scenario: 'kingdom'}, npcBehavior: 'everything'
  });
  assert.equal(response.type, 'error');
  assert.match(response.message, /Modo de comportamento/);
});
test('hybrid worlds replay deterministically with the same seed and assignments', () => {
  for (const seed of [1, 42]) {
    const first = engine.createWorld(seed), second = engine.createWorld(seed);
    for (const world of [first, second]) world.neuralOverrides = {
      ...world.neuralOverrides, utilityContinuity: true,
      taskWorkflow: true, steeringBoids: true
    };
    for (let day = 0; day < 3; day++) {
      engine.stepDay(first, {includeSnapshot: false});
      engine.stepDay(second, {includeSnapshot: false});
      assert.equal(authoritativeSnapshotDigest(first), authoritativeSnapshotDigest(second),
        'hybrid deterministic replay seed=' + seed + ' day=' + (day + 1));
    }
  }
});
