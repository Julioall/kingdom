// JUL-271: A/B of seeded shared vs legacy policies. Different controllers
// legitimately produce different worlds: do NOT compare state digests as equal.
import { performance } from 'node:perf_hooks';
import { cpus, platform } from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import Sim from '../src/simulation/engine.js';
import { getSharedPolicy } from '../src/ai/policy/shared-policy.js';

const flags = Object.fromEntries(process.argv.slice(2).filter(x => x.startsWith('--'))
  .map(x => x.slice(2).split('=')));
const seeds = (flags.seeds || '1,42,2026').split(',').map(Number);
const days = Number(flags.days || 12), warmup = Number(flags.warmup || 3);
const results = [];
for (const seed of seeds) {
  for (const mode of ['legacy', 'shared']) {
    const world = Sim.createWorld(seed, { neuralController: mode });
    const peopleAtStart = world.people.length;
    const animalsAtStart = world.animals.length;
    const rngStart = world.rngState;
    for (let j = 0; j < warmup; j++) Sim.stepDay(world);
    const timings = [];
    const cpu = process.cpuUsage();
    for (let j = 0; j < days; j++) {
      const start = performance.now();
      Sim.stepDay(world);
      timings.push(performance.now() - start);
    }
    const usedCpu = process.cpuUsage(cpu);
    const brains = [...world.people.map(p => p.brain), ...world.animals.map(a => a.brain),
      ...world.people.map(p => p.militaryBrain).filter(Boolean)];
    const denseBytes = brains.reduce((sum, brain) =>
      sum + (brain?.inputWeights?.length || 0) * 8 + (brain?.outputWeights?.length || 0) * 8, 0);
    const compact = brains.filter(b => b?.mode === 'shared').length;
    const globalBytes = mode === 'shared'
      ? getSharedPolicy(world, 'human').spec.weights.byteLength
        + getSharedPolicy(world, 'human').spec.biases.byteLength
        + getSharedPolicy(world, 'animal', 'sheep').spec.weights.byteLength
        + getSharedPolicy(world, 'animal', 'sheep').spec.biases.byteLength : 0;
    if (timings.some(t => !Number.isFinite(t) || t < 0) || world.people.some(p => !Number.isFinite(p.health))) {
      throw new Error('Nonfinite measured value at ' + seed + '/' + mode);
    }
    const sorted = timings.slice().sort((a, b) => a - b);
    const mean = timings.reduce((a, b) => a + b, 0) / timings.length;
    results.push({
      seed, mode, peopleAtStart, animalsAtStart, peopleAlive: world.people.filter(p => p.alive).length,
      animalsAlive: world.animals.filter(a => a.alive).length,
      worldDay: world.day, rngStart, humanDeaths: world.deaths,
      meanDayMs: mean, medianDayMs: sorted[Math.floor(sorted.length / 2)],
      p95DayMs: sorted[Math.ceil(sorted.length * .95) - 1],
      measuredCpuMs: (usedCpu.user + usedCpu.system) / 1000,
      storedBrains: brains.length, sharedBrains: compact, perActorDenseWeightBytes: denseBytes,
      sharedGlobalWeightBytes: globalBytes,
      totalSerializedBrainBytes: brains.reduce((sum, brain) =>
        sum + Buffer.byteLength(JSON.stringify(brain || null)), 0),
      timings
    });
  }
}
const comparisons = seeds.map(seed => {
  const legacy = results.find(r => r.seed === seed && r.mode === 'legacy');
  const shared = results.find(r => r.seed === seed && r.mode === 'shared');
  return {
    seed,
    legacyMeanMs: legacy.meanDayMs,
    sharedMeanMs: shared.meanDayMs,
    changePercent: +(100 * (shared.meanDayMs - legacy.meanDayMs) / legacy.meanDayMs).toFixed(2),
    legacyDenseMiB: +(legacy.perActorDenseWeightBytes / 1048576).toFixed(3),
    sharedDenseMiB: +(shared.perActorDenseWeightBytes / 1048576).toFixed(3),
    sharedModelKiB: +(shared.sharedGlobalWeightBytes / 1024).toFixed(1),
    legacyAlive: legacy.peopleAlive, sharedAlive: shared.peopleAlive
  };
});
const report = { schema:1, sourceCommit: process.env.GITHUB_SHA || 'unknown',
  environment:{node:process.version,platform:platform(),cpu:cpus()[0]?.model},
  methodology:'Fresh seeded worlds created directly in each mode, warmup plus measured simulated days; distinct trajectories are expected. CPU-only Github runners. No FPS, no 100k claims.',
  seeds, warmup, days, results, comparisons };
const output = resolve(flags.output || 'out/jul271-policy-ab.json');
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({commit:report.sourceCommit,environment:report.environment,comparisons}, null, 2));
