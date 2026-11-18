// Repeated full-world legacy/hybrid scale + long-run behavioral validation.
// No gameplay writes except explicit experimental mode initialization.
// A/B across modes may have DIFFERENT digests: compare parity WITHIN a mode.
// Examples:
// node scripts/validate-npc-hybrid-scale.mjs --populations=100,500 --seeds=1,42 --days=3 --repeats=2
// node scripts/validate-npc-hybrid-scale.mjs --populations=100 --seeds=42 --days=180 --repeats=2
// node scripts/validate-npc-hybrid-scale.mjs --populations=5000 --seeds=42 --days=1 --repeats=2 --modes=hybrid
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpus, platform } from 'node:os';
import { performance, PerformanceObserver } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import engine from '../src/simulation/engine.js';
import { authoritativeSnapshotDigest } from './support/jul274-snapshot-digest.mjs';
import { createHybridQualityTracker, sampleHybridQuality, summarizeTiming }
  from './support/npc-hybrid-quality.mjs';

const options = Object.fromEntries(process.argv.slice(2).map(arg => {
  const at = arg.indexOf('=');
  if (!arg.startsWith('--') || at < 3) throw Error('Expected --name=value, received: ' + arg);
  return [arg.slice(2, at), arg.slice(at + 1)];
}));
const integer = (name, fallback, low, high) => {
  const n = Number(options[name] ?? fallback);
  assert.ok(Number.isSafeInteger(n) && n >= low && n <= high, 'Invalid --' + name);
  return n;
};
const list = (name, fallback, maximum, count = 6) => {
  const values = String(options[name] ?? fallback).split(',').map(Number);
  assert.ok(values.length > 0 && values.length <= count &&
    values.every(value => Number.isSafeInteger(value) && value >= 1 && value <= maximum),
  'Invalid --' + name);
  return [...new Set(values)];
};
const populations = list('populations', '100,500', 5000);
const seeds = list('seeds', '1,42', 2147483647);
const days = integer('days', 3, 1, 180);
const warmupDays = integer('warmup', 0, 0, 12);
const repeats = integer('repeats', 2, 2, 6);
const checkpointEvery = integer('checkpoint-every', Math.min(10, days), 1, days);
const modes = String(options.modes || 'legacy,hybrid').split(',');
assert.ok(modes.length > 0 && modes.length <= 2 &&
  modes.every(mode => ['legacy', 'hybrid'].includes(mode)) &&
  new Set(modes).size === modes.length, 'Invalid --modes');
const output = resolve(options.output || 'out/npc-scale-longitudinal.json');
const gcEnabled = (options['observe-gc'] ?? '1') === '1';
assert.ok(['0', '1'].includes(String(options['observe-gc'] ?? '1')), 'Invalid --observe-gc');
const reportSchema = 1;

function buildWorld(population, seed, mode) {
  const world = engine.createWorld(seed);
  assert.ok(population >= world.people.length,
    'Population must not be smaller than the initial population');
  if (population > world.people.length)
    engine.addIndividuals(world, population - world.people.length, false);
  if (mode === 'hybrid') world.neuralOverrides = {
    ...world.neuralOverrides, utilityContinuity: true,
    taskWorkflow: true, steeringBoids: true
  };
  return world;
}

const gcEntries = [];
const gcObserver = gcEnabled ? new PerformanceObserver(list => {
  for (const entry of list.getEntries())
    gcEntries.push({startTime: entry.startTime, durationMs: entry.duration});
}) : null;
gcObserver?.observe({entryTypes: ['gc']});
const nextTurn = () => new Promise(done => setImmediate(done));
const firstRun = new Map();
const rows = [];

async function execute(population, seed, mode, repeat) {
  const world = buildWorld(population, seed, mode);
  for (let i = 0; i < warmupDays; i++)
    engine.stepDay(world, {includeSnapshot: false});
  const tracker = createHybridQualityTracker(world);
  const startDay = world.day;
  const dayDurations = [], trajectory = [], checkpoints = [], gcDays = [];
  let peakHeapUsedBytes = 0, peakRssBytes = 0;
  for (let day = 1; day <= days; day++) {
    // Asynchronous GC performance entries are delivered after a Node turn.
    // Count only events whose startTime falls INSIDE the timed step.
    if (gcEnabled) await nextTurn();
    gcEntries.length = 0;
    const started = performance.now();
    engine.stepDay(world, {includeSnapshot: false});
    const finished = performance.now();
    dayDurations.push(finished - started);
    if (gcEnabled) await nextTurn();
    const duringStep = gcEntries.filter(entry =>
      entry.startTime >= started && entry.startTime <= finished);
    gcDays.push({
      count: duringStep.length,
      observedDurationMs: duringStep.reduce((n, entry) => n + entry.durationMs, 0)
    });
    // No world mutations; outside the step's duration.
    trajectory.push(sampleHybridQuality(world, tracker));
    const memory = process.memoryUsage();
    peakHeapUsedBytes = Math.max(peakHeapUsedBytes, memory.heapUsed);
    peakRssBytes = Math.max(peakRssBytes, memory.rss);
    if (day % checkpointEvery === 0 || day === days)
      checkpoints.push({day: world.day, digest: authoritativeSnapshotDigest(world)});
    if (world.day !== startDay + day)
      throw Error('Day did not advance exactly once: ' + [population, seed, mode, day].join('/'));
  }
  const digest = checkpoints.at(-1).digest;
  const trajectoryDigest = createHash('sha256').update(JSON.stringify(trajectory)).digest('hex');
  const key = [population, seed, mode].join('/');
  if (firstRun.has(key)) {
    const reference = firstRun.get(key);
    assert.equal(digest, reference.digest,
      'Final authoritative replay differs for ' + key + ', repeat ' + repeat);
    assert.equal(trajectoryDigest, reference.trajectoryDigest,
      'Behavioral trajectory differs for ' + key + ', repeat ' + repeat);
    assert.deepEqual(checkpoints, reference.checkpoints,
      'Authoritative checkpoint mismatch for ' + key + ', repeat ' + repeat);
  } else firstRun.set(key, {digest, trajectoryDigest, checkpoints});
  const last = trajectory.at(-1);
  const timingsMs = summarizeTiming(dayDurations);
  return {
    population, seed, mode, repeat, days, warmupDays, startDay,
    deterministicAgainstFirstRun: true,
    digest, trajectoryDigest, checkpoints,
    timingsMs, dayDurations,
    memory: {peakHeapUsedBytes, peakRssBytes},
    gc: {
      count: gcDays.reduce((n, item) => n + item.count, 0),
      observedDurationMs: gcDays.reduce((n, item) => n + item.observedDurationMs, 0),
      days: gcDays
    },
    final: last, trajectory
  };
}

try {
  for (const population of populations) for (const seed of seeds) {
    for (let repeat = 1; repeat <= repeats; repeat++) {
      // Alternate evaluation order; the same-mode hash MUST remain equal.
      const order = repeat % 2 ? modes : modes.slice().reverse();
      for (const mode of order) {
        const row = await execute(population, seed, mode, repeat);
        rows.push(row);
        console.log('HYBRID-LONG-RUN', JSON.stringify({
          population, seed, mode, repeat, days,
          meanDayMs: +row.timingsMs.meanMs.toFixed(2),
          p95DayMs: +row.timingsMs.p95Ms.toFixed(2),
          peopleAlive: row.final.population.alive,
          completedStructures: row.final.economy.completedStructures,
          observedCompletedTasks: row.final.cumulative.observedCompletedTasks,
          blockedRouteActors: row.final.navigation.blockedRouteActors,
          stationaryRoutedDays: row.final.cumulative.stationaryWhileRoutedDays,
          actionSwitches: row.final.cumulative.actionSwitches,
          gcCount: row.gc.count, deterministic: true
        }));
      }
    }
  }
} finally {
  gcObserver?.disconnect();
}
const comparisons = [];
for (const population of populations) for (const seed of seeds) {
  const group = rows.filter(row => row.population === population && row.seed === seed);
  const summary = Object.fromEntries(modes.map(mode => {
    const runs = group.filter(row => row.mode === mode);
    const timing = summarizeTiming(runs.flatMap(row => row.dayDurations));
    return [mode, {
      repetitions: runs.length, dayTimingMs: timing,
      meanPeakHeapUsedBytes: runs.reduce((n, row) => n + row.memory.peakHeapUsedBytes, 0) / runs.length,
      final: runs[0].final, deterministic: runs.every(row => row.deterministicAgainstFirstRun)
    }];
  }));
  const legacy = summary.legacy, hybrid = summary.hybrid;
  comparisons.push({
    population, seed, days, byMode: summary,
    hybridVsLegacyMeanDayPercent: legacy && hybrid ?
      +(100 * (hybrid.dayTimingMs.meanMs - legacy.dayTimingMs.meanMs)
        / legacy.dayTimingMs.meanMs).toFixed(2) : null,
    crossModeDigestEqual: modes.length === 2
      ? group.find(row => row.mode === 'legacy').digest
        === group.find(row => row.mode === 'hybrid').digest : null
  });
}
const result = {
  schemaVersion: reportSchema, commit: process.env.GITHUB_SHA || 'local',
  host: {node: process.version, cpu: cpus()[0]?.model, platform: platform()},
  config: {populations, seeds, days, warmupDays, repeats, checkpointEvery,
    modes, gcObserved: gcEnabled},
  comparisons, rows,
  limitations: [
    'World runs are full authoritative stepDay simulations, not visual frame FPS.',
    'Only trajectories with the SAME seed/population/mode must reproduce exact hashes.',
    'Observed completed tasks use bounded community assignment history and can undercount.',
    'Stationary-while-routed is a diagnostic heuristic; it is NOT proof of actual deadlock.',
    'Action switches count consecutive sampled days, not every internal AI deliberation.',
    'GC events are sampled by Node PerformanceObserver and approximate; memory/RSS depend on process and runner.',
    'Sequential A/B cannot isolate CPU-clock, JIT, thermal or garbage-collection effects perfectly.',
    'No forced combat, famine, trade or crowding scenario is introduced: zero activity proves nothing.',
    'GPU frame completion, 144 FPS, snapshots and Worker messaging need real browser profiling.'
  ]
};
await mkdir(dirname(output), {recursive: true});
await writeFile(output, JSON.stringify(result, null, 2));
console.log('HYBRID-LONG-SUMMARY', JSON.stringify({
  output, comparisons: comparisons.map(item => ({
    population: item.population, seed: item.seed, days: item.days,
    hybridVsLegacyMeanDayPercent: item.hybridVsLegacyMeanDayPercent,
    byMode: Object.fromEntries(Object.entries(item.byMode).map(([mode, data]) =>
      [mode, {dayMeanMs: +data.dayTimingMs.meanMs.toFixed(2),
        dayP95Ms: +data.dayTimingMs.p95Ms.toFixed(2),
        completedStructures: data.final.economy.completedStructures,
        completedTasksObserved: data.final.cumulative.observedCompletedTasks}]))
  }))
}));
