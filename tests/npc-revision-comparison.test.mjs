import test from 'node:test';
import assert from 'node:assert/strict';
import { compareNpcRevisions } from '../scripts/compare-npc-revisions.mjs';

function report(ms, digest = 'same', trajectoryDigest = 'diagnostic-one') {
  return {
    config: {populations: [100], seeds: [42], days: 2, warmupDays: 0,
      repeats: 2, checkpointEvery: 1, modes: ['hybrid']},
    host: {node: 'v24.0.0', platform: 'linux'},
    rows: [1, 2].map(repeat => ({
      population: 100, seed: 42, mode: 'hybrid', repeat,
      digest, trajectoryDigest,
      checkpoints: [{day: 1, digest: 'state-day-one'}, {day: 2, digest}],
      timingsMs: {meanMs: ms}
    }))
  };
}
test('cross-commit gate checks exact world state, not changing diagnostic schema', () => {
  const baseline = report(120, 'digest-42', 'old-diags');
  const optimized = report(100, 'digest-42', 'added-congestion-metrics');
  const comparison = compareNpcRevisions(baseline, optimized);
  assert.equal(comparison.exactAll, true);
  assert.equal(comparison.scenarios.length, 1);
  assert.equal(comparison.scenarios[0].reductionPercent, 100 * (1 - 100 / 120));
});
test('rejects divergent simulation days, snapshots and missing repeated runs', () => {
  const original = report(120, 'digest-42');
  assert.throws(() => compareNpcRevisions(original, report(100, 'different')), /divergence/);
  const checkpointDrift = report(100, 'digest-42');
  checkpointDrift.rows[0].checkpoints[0].digest = 'changed';
  assert.throws(() => compareNpcRevisions(original, checkpointDrift), /checkpoint divergence/);
  const missing = report(100, 'digest-42');
  missing.rows.pop();
  assert.throws(() => compareNpcRevisions(original, missing), /Missing candidate observations/);
  const differentDays = report(100, 'digest-42');
  differentDays.config.days = 3;
  assert.throws(() => compareNpcRevisions(original, differentDays), /configuration/);
});
