// JUL-291: A/B of conservative distance prefiltering during animal observation.
// Full worlds are identical; the original Euclidean/FOV/LOS are still used.
// Controls are identical worlds, interleaved order, full snapshot parity.
// performance.now() reports synchronous Node wall time (CPU proxy), NOT FPS.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import Sim from '../src/simulation/engine.js';
import Senses from '../src/simulation/individuals/perception.js';
import { createWorldSnapshot } from '../src/simulation/render-snapshot.js';

const seeds = (process.env.JUL291_SEEDS || '1,42,2026').split(',').map(Number);
const days = Number(process.env.JUL291_DAYS || 14);
assert.ok(seeds.length > 0 && seeds.every(n => Number.isSafeInteger(n) && n > 0));
assert.ok(Number.isSafeInteger(days) && days >= 7 && days <= 90);

const originalObserve = Senses.observe;
const measure = (world, cache) => {
  let observations = 0, observationMs = 0, animalsMs = null;
  Senses.observe = function (w, actor, kind, profiles, options) {
    const began = performance.now();
    try {
      return originalObserve(w, actor, kind, profiles,
        kind === 'animal' ? { disableRangePrefilter: !cache } : options);
    } finally {
      if (kind === 'animal') {
        observations++;
        observationMs += performance.now() - began;
      }
    }
  };
  const began = performance.now();
  try {
    Sim.stepDay(world, {
      includeSnapshot: false,
      onEnvironmentPhase: (phase, elapsed) => {
        if (phase === 'animals') animalsMs = elapsed;
      }
    });
  } finally {
    Senses.observe = originalObserve;
  }
  return {
    stepMs: performance.now() - began,
    animalsMs,
    observations,
    observationMs
  };
};

const results = [];
const stats = data => {
  assert.ok(data.length, 'metric contains no values');
  const sorted = [...data].sort((a,b)=>a-b);
  const sum = data.reduce((a,b)=>a+b,0);
  return {
    n: data.length,
    sumMs: +sum.toFixed(4),
    meanMs: +(sum / data.length).toFixed(4),
    p95Ms: +sorted[Math.ceil(sorted.length * .95) - 1].toFixed(4)
  };
};
for (const seed of seeds) {
  const baseline = Sim.createWorld(seed), cached = Sim.createWorld(seed);
  for (let day = 1; day <= days; day++) {
    const reverse = day % 2 === 0;
    let old, optimized;
    if (reverse) {
      optimized = measure(cached, true);
      old = measure(baseline, false);
    } else {
      old = measure(baseline, false);
      optimized = measure(cached, true);
    }
    assert.equal(old.observations, optimized.observations,
      'The same number of animals must observe in each mode');
    assert.equal(baseline.day, cached.day);
    assert.equal(baseline.rngState, cached.rngState,
      'Animal LOS optimizations must not alter random decisions');
    assert.deepEqual(createWorldSnapshot(cached), createWorldSnapshot(baseline),
      'Authoritative world parity changed at seed ' + seed + ', day ' + day);
    results.push({ seed, day, order: reverse ? 'cached-first' : 'uncached-first',
      original: old, cached: optimized });
  }
  console.log('JUL291-SEED', JSON.stringify({
    seed, days, people: cached.people.length, animals: cached.animals.length,
    rngState: cached.rngState, fullSnapshotParity: true
  }));
}
const metrics = ['stepMs', 'animalsMs', 'observationMs'];
const summary = Object.fromEntries(metrics.map(metric => {
  const a = stats(results.map(row => row.original[metric]));
  const b = stats(results.map(row => row.cached[metric]));
  return [metric, {
    uncached: a, cached: b,
    differencePercent: +(100 * (b.sumMs / a.sumMs - 1)).toFixed(2)
  }];
}));
summary.observationCalls = results.reduce((sum,row)=>sum+row.cached.observations,0);
const report = {
  schema: 1, issue: 'JUL-291', sourceSha: process.env.GITHUB_SHA || 'unknown',
  seeds, days, fullWorldSnapshotParity: true,
  methodology: 'Paired real-world day loops using a per-observation canopy Map plus Euclidean-safe bounding cull versus uncached and unbounded LOS, alternating order. After every day compare complete createWorldSnapshot, daily RNG and animal observation counts. Instrumented performance.now Node wall time for animal LOS, entire animal subsystem and whole day; no GPU/browser FPS claim.',
  caveats: [
    'Node wall time is CPU proxy and includes profiler and runtime noise; repeated browser trials are required for FPS claims.',
    'Time outside animal observation can vary due scheduling, JIT, GC and changes in wall-clock conditions even though world state is identical.',
    'No persistent LOS or food score cache is created; each NPC observes current tile/animal state after earlier actions.',
    'Daily resource/animal metabolism and all ecological frequencies remain unchanged.'
  ],
  summary, samples: results
};
const out = resolve(process.argv[2] || 'out/jul291-animal-los-cache.json');
await mkdir(dirname(out),{recursive:true});
await writeFile(out,JSON.stringify(report,null,2));
console.log('JUL291-SUMMARY',JSON.stringify(summary));
console.log('PASSED JUL-291 3-seed paired animal range prefilter A/B and exact world parity');
