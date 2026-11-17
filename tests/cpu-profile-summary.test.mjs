import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeCpuProfile } from '../src/simulation/observability/cpu-profile-summary.js';

test('aggregates exclusive V8 samples by source call site and ranks them', () => {
  const profile = {
    nodes: [
      { id: 1, callFrame: { functionName: '(root)', url: '', lineNumber: -1 } },
      { id: 2, callFrame: { functionName: 'moveOne', url: 'file:///kingdom/src/simulation/individuals/movement.js', lineNumber: 55 } },
      { id: 3, callFrame: { functionName: 'perceive', url: 'file:///kingdom/src/simulation/individuals/perception.js', lineNumber: 10 } }
    ],
    samples: [2, 3, 2, 2]
  };
  const summary = summarizeCpuProfile(profile);
  assert.equal(summary.totalSamples, 4);
  assert.equal(summary.hotspots[0].name, 'moveOne');
  assert.equal(summary.hotspots[0].file, 'src/simulation/individuals/movement.js');
  assert.equal(summary.hotspots[0].line, 56);
  assert.equal(summary.hotspots[0].samples, 3);
  assert.equal(summary.hotspots[0].sharePercent, 75);
  assert.equal(summary.hotspots[1].sharePercent, 25);
});

test('supports profiles with node hit counts but no explicit samples', () => {
  const summary = summarizeCpuProfile({
    nodes: [{ id: 1, callFrame: { functionName: 'work', url: '' }, hitCount: 5 }]
  });
  assert.equal(summary.totalSamples, 5);
  assert.equal(summary.hotspots[0].file, '<native>');
  assert.equal(summarizeCpuProfile({ nodes: [] }).totalSamples, 0);
  assert.throws(() => summarizeCpuProfile(null), TypeError);
});
