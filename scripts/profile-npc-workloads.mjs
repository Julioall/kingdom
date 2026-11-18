// Repeated V8 samples of actual full-world NPC simulation, independent of
// Canvas and browser Worker message transfer. No gameplay instrumentation.
// Example: node scripts/profile-npc-workloads.mjs --populations=100,500
//   --seeds=1,42 --days=2 --warmup=1 --repeats=3
//   --output=out/npc-workloads/report.json --profile-dir=out/npc-workloads/profiles
import assert from 'node:assert/strict';
import inspector from 'node:inspector';
import { performance } from 'node:perf_hooks';
import { cpus, platform } from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import Sim from '../src/simulation/engine.js';
import { authoritativeSnapshotDigest } from './support/jul274-snapshot-digest.mjs';
import { summarizeCpuProfile } from '../src/simulation/observability/cpu-profile-summary.js';
import { analyzeNpcCpuHotspots } from '../src/simulation/observability/npc-hotspot-analysis.js';

const opts = Object.fromEntries(process.argv.slice(2).map(arg => {
  const at = arg.indexOf('=');
  if (!arg.startsWith('--') || at < 3) throw Error('Expected --name=value: ' + arg);
  return [arg.slice(2, at), arg.slice(at + 1)];
}));
function positive(name, fallback, max, min = 1) {
  const n = Number(opts[name] ?? fallback);
  assert.ok(Number.isSafeInteger(n) && n >= min && n <= max, 'Invalid --' + name);
  return n;
}
function numberList(name, fallback, max) {
  const values = String(opts[name] ?? fallback).split(',').map(Number);
  assert.ok(values.length > 0 && values.length <= 6
    && values.every(value => Number.isSafeInteger(value) && value > 0 && value <= max),
  'Invalid --' + name);
  return values;
}
const populations = numberList('populations', '100,500', 5000);
const seeds = numberList('seeds', '1,42', 2147483647);
const days = positive('days', 2, 10);
const repeats = positive('repeats', 3, 6);
const warmup = positive('warmup', 1, 10, 0);
const intervalUs = positive('sampling-us', 1000, 10000, 100);
const output = resolve(opts.output ?? 'out/npc-workloads/report.json');
const profileDir = opts['profile-dir'] ? resolve(opts['profile-dir']) : null;
const post = (session, method, params = {}) => new Promise((resolve, reject) => {
  session.post(method, params, (error, result) => error ? reject(error) : resolve(result));
});
function stats(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return {
    count: sorted.length,
    mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    p50: sorted[Math.ceil(sorted.length * .5) - 1],
    p95: sorted[Math.ceil(sorted.length * .95) - 1],
    max: sorted.at(-1)
  };
}
function buildWorld(seed, count) {
  const world = Sim.createWorld(seed);
  assert.ok(count >= world.people.length, 'Population below initial people count');
  if (count > world.people.length) Sim.addIndividuals(world, count - world.people.length, false);
  return world;
}
async function capture(seed, population, repeat) {
  const world = buildWorld(seed, population);
  const baseline = buildWorld(seed, population);
  for (let i = 0; i < warmup; i++) {
    Sim.stepDay(world, { includeSnapshot: false });
    Sim.stepDay(baseline, { includeSnapshot: false });
  }
  assert.equal(authoritativeSnapshotDigest(world), authoritativeSnapshotDigest(baseline),
    'Warmup mismatch seed=' + seed);
  const session = new inspector.Session();
  session.connect();
  let profile;
  const dayWallMs = [], controlWallMs = [];
  try {
    await post(session, 'Profiler.enable');
    await post(session, 'Profiler.setSamplingInterval', { interval: intervalUs });
    await post(session, 'Profiler.start');
    for (let day = 0; day < days; day++) {
      const started = performance.now();
      Sim.stepDay(world, { includeSnapshot: false });
      dayWallMs.push(performance.now() - started);
    }
    ({ profile } = await post(session, 'Profiler.stop'));
  } finally {
    session.disconnect();
  }
  for (let day = 0; day < days; day++) {
    const started = performance.now();
    Sim.stepDay(baseline, { includeSnapshot: false });
    controlWallMs.push(performance.now() - started);
  }
  const digest = authoritativeSnapshotDigest(world);
  assert.equal(digest, authoritativeSnapshotDigest(baseline),
    'V8 sampling changed the authoritative state seed=' + seed
      + ' population=' + population + ' repeat=' + repeat);
  const analyzed = analyzeNpcCpuHotspots(profile);
  const functionSummary = summarizeCpuProfile(profile, 25);
  if (profileDir) {
    await mkdir(profileDir, { recursive: true });
    await writeFile(join(profileDir, 'population-' + population + '-seed-' + seed
      + '-repeat-' + repeat + '.cpuprofile'), JSON.stringify(profile));
  }
  return {
    seed, population, repeat, warmup, days, dayWallMs, controlWallMs,
    measuredDay: world.day, alive: world.people.filter(p => p.alive).length,
    exactReplay: true, digest,
    cpuSamples: analyzed, hotspots: functionSummary.hotspots
  };
}
const rows = [];
for (const population of populations) for (const seed of seeds) {
  for (let repeat = 1; repeat <= repeats; repeat++) {
    const result = await capture(seed, population, repeat);
    rows.push(result);
    console.log('NPC-PROFILE', JSON.stringify({
      population, seed, repeat, durationMs: result.dayWallMs,
      controlMs: result.controlWallMs,
      sampleCount: result.cpuSamples.totalSamples,
      topAreas: result.cpuSamples.rankingByInclusiveSamples.slice(0, 5).map(area =>
        ({ name: area, inclusiveSharePercent: result.cpuSamples.areas[area].inclusiveSharePercent })),
      hotspots: result.hotspots.slice(0, 5), exactReplay: result.exactReplay
    }));
  }
}
const byScenario = [];
for (const population of populations) for (const seed of seeds) {
  const group = rows.filter(row => row.population === population && row.seed === seed);
  const names = Object.keys(group[0].cpuSamples.areas);
  const samples = group.reduce((n, row) => n + row.cpuSamples.totalSamples, 0);
  const areas = Object.fromEntries(names.map(name => {
    const exclusive = group.reduce((n, row) => n + row.cpuSamples.areas[name].exclusiveSamples, 0);
    const inclusive = group.reduce((n, row) => n + row.cpuSamples.areas[name].inclusiveSamples, 0);
    return [name, {
      exclusiveSamples: exclusive, inclusiveSamples: inclusive,
      exclusiveSharePercent: samples ? +(exclusive * 100 / samples).toFixed(2) : 0,
      inclusiveSharePercent: samples ? +(inclusive * 100 / samples).toFixed(2) : 0
    }];
  }));
  byScenario.push({ population, seed, runs: group.length, totalSamples: samples,
    profiledDayMs: stats(group.flatMap(row => row.dayWallMs)),
    controlDayMs: stats(group.flatMap(row => row.controlWallMs)),
    areas, allExactReplay: group.every(row => row.exactReplay) });
}
const report = {
  schemaVersion: 1, sourceCommit: process.env.GITHUB_SHA || 'local',
  node: process.version, host: { platform: platform(), cpu: cpus()[0]?.model },
  configuration: { populations, seeds, days, warmup, repeats, samplingIntervalUs: intervalUs },
  measurement: 'Node/V8 profiler during the authoritative stepDay only; initialization, warmup, snapshots and comparison are outside sampled region.',
  limitations: [
    'CPU samples are statistical evidence of exclusive and inclusive activity, not precise per-function wall-clock milliseconds.',
    'Inclusive categories overlap when one function calls another. Never add inclusive percentages.',
    'The unprofiled replay is sequential, not an A/B optimization baseline; timing differs from profiled replay.',
    'Worker snapshot creation and browser message transport are not included.',
    'GPU frame completion, frame pacing, Canvas and the 144 FPS acceptance target require separate real-browser measurements.',
    'Each seed/repeat reconstructs an identical initial world; repeated profiles sample the same deterministic scenario.'
  ],
  byScenario, rows
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2));
console.log('NPC-PROFILE-REPORT', JSON.stringify({
  output, groups: byScenario.map(row => ({ population: row.population, seed: row.seed,
    meanDayMs: row.profiledDayMs.mean, p95DayMs: row.profiledDayMs.p95,
    topAreas: Object.entries(row.areas).sort((a, b) =>
      b[1].inclusiveSamples - a[1].inclusiveSamples).slice(0, 5)
      .map(([name, value]) => ({ name, share: value.inclusiveSharePercent })) }))
}));
