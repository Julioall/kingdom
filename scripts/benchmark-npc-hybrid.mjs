// Repeatable legacy-vs-hybrid benchmark. Different gameplay choices are
// EXPECTED; compare CPU and outcomes, and demand determinism within each mode.
// Usage: node scripts/benchmark-npc-hybrid.mjs --populations=100,500
//   --seeds=1,42 --days=2 --warmup=0 --repeats=2 --output=out/hybrid.json
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import engine from '../src/simulation/engine.js';
import { authoritativeSnapshotDigest } from './support/jul274-snapshot-digest.mjs';

const options = Object.fromEntries(process.argv.slice(2).map(arg => {
  const at = arg.indexOf('=');
  if (!arg.startsWith('--') || at < 3) throw Error('Expected --name=value');
  return [arg.slice(2, at), arg.slice(at + 1)];
}));
const integer = (name, fallback, min, max) => {
  const n = Number(options[name] ?? fallback);
  assert.ok(Number.isSafeInteger(n) && n >= min && n <= max, 'Invalid --' + name);
  return n;
};
const list = (name, fallback, max) => {
  const values = String(options[name] ?? fallback).split(',').map(Number);
  assert.ok(values.length > 0 && values.length <= 5
    && values.every(v => Number.isSafeInteger(v) && v >= 1 && v <= max), 'Invalid --' + name);
  return values;
};
const populations = list('populations', '100,500', 5000);
const seeds = list('seeds', '1,42', 2147483647);
const days = integer('days', 2, 1, 15);
const warmup = integer('warmup', 0, 0, 10);
const repeats = integer('repeats', 2, 2, 6);
const output = resolve(options.output || 'out/npc-hybrid-ab.json');

function create(seed, population, hybrid) {
  const world = engine.createWorld(seed);
  assert.ok(population >= world.people.length, 'Population too low for seeded kingdom');
  if (population > world.people.length)
    engine.addIndividuals(world, population - world.people.length, false);
  if (hybrid) world.neuralOverrides = {
    ...world.neuralOverrides,
    utilityContinuity: true, taskWorkflow: true, steeringBoids: true
  };
  return world;
}
function metrics(world) {
  const living = world.people.filter(person => person.alive);
  const total = living.length || 1;
  const mean = key => living.reduce((sum, p) => sum + (Number(p[key]) || 0), 0) / total;
  const actionCounts = {};
  const workflowStages = {};
  for (const person of living) {
    const action = person.brain?.lastAction || 'none';
    actionCounts[action] = (actionCounts[action] || 0) + 1;
    const flow = person.activityWorkflow;
    if (flow) {
      const label = flow.mode + '/' + flow.stage;
      workflowStages[label] = (workflowStages[label] || 0) + 1;
    }
  }
  return {
    day: world.day, peopleAlive: living.length, animalsAlive: world.animals.filter(a => a.alive).length,
    averageEnergy: mean('energy'), averageHydration: mean('hydration'),
    averageFoodReserve: mean('foodReserve'), averageHealth: mean('health'),
    activeAssignments: living.filter(p => p.assignment && p.assignment.expiresDay >= world.day).length,
    workflows: Object.keys(workflowStages).length,
    workflowStages, actionCounts,
    completedStructures: world.structures.filter(s => s.complete && s.destroyedDay == null).length,
    communities: world.communities.length,
    totalFoodStores: world.communities.reduce((sum, c) => sum + (c.stores?.food || 0), 0)
  };
}
function execute(seed, population, hybrid) {
  const world = create(seed, population, hybrid);
  for (let i = 0; i < warmup; i++) engine.stepDay(world, {includeSnapshot: false});
  const elapsedMs = [];
  for (let i = 0; i < days; i++) {
    const started = performance.now();
    engine.stepDay(world, {includeSnapshot: false});
    elapsedMs.push(performance.now() - started);
  }
  return {seed, population, mode: hybrid ? 'hybrid' : 'legacy', elapsedMs,
    meanDayMs: elapsedMs.reduce((a, b) => a + b, 0) / elapsedMs.length,
    digest: authoritativeSnapshotDigest(world), ...metrics(world)};
}
const rows = [];
const previous = new Map();
for (const population of populations) for (const seed of seeds) {
  for (let repeat = 0; repeat < repeats; repeat++) {
    // Alternate ordering to reduce systematic CPU clock/JIT/GC bias.
    for (const hybrid of repeat % 2 ? [true, false] : [false, true]) {
      const row = execute(seed, population, hybrid);
      const key = [population, seed, row.mode].join('/');
      if (previous.has(key)) assert.equal(row.digest, previous.get(key),
        'Nondeterministic replay in ' + key + ', repeat=' + (repeat + 1));
      else previous.set(key, row.digest);
      rows.push({repeat: repeat + 1, ...row});
      console.log('NPC-HYBRID', JSON.stringify({
        population, seed, repeat: repeat + 1, mode: row.mode,
        meanDayMs: row.meanDayMs, peopleAlive: row.peopleAlive,
        completedStructures: row.completedStructures, assignments: row.activeAssignments,
        totalFoodStores: row.totalFoodStores, digest: row.digest
      }));
    }
  }
}
const comparisons = [];
for (const population of populations) for (const seed of seeds) {
  const group = rows.filter(row => row.population === population && row.seed === seed);
  const baseline = group.filter(row => row.mode === 'legacy');
  const candidate = group.filter(row => row.mode === 'hybrid');
  const mean = rows => rows.reduce((sum, row) => sum + row.meanDayMs, 0) / rows.length;
  const baselineMs = mean(baseline), hybridMs = mean(candidate);
  comparisons.push({population, seed, repeats, baselineMs, hybridMs,
    relativeCpuPercent: 100 * (hybridMs - baselineMs) / baselineMs,
    legacyOutcomes: baseline[0], hybridOutcomes: candidate[0],
    exactWithinMode: true,
    sameAcrossModes: baseline[0].digest === candidate[0].digest});
}
const report = {
  schemaVersion: 1, commit: process.env.GITHUB_SHA || 'local',
  node: process.version, cpu: cpus()[0]?.model,
  config: {populations, seeds, days, warmup, repeats},
  rows, comparisons,
  caveats: [
    'Hybrid intentionally changes some NPC decisions; equality across legacy/hybrid is NOT required.',
    'Each mode MUST replay with identical digest for the same seed, population and elapsed days.',
    'CPU timings use alternating sequential runs on one host. Use confidence intervals before claiming a win.',
    'No browser RAF, Canvas, GPU, frame p95, snapshot transfer or physical 144 FPS validation.',
    'Food/structure/assignment outcomes are diagnostics, not automatic proof of realistic behavior.'
  ]
};
await mkdir(dirname(output), {recursive: true});
await writeFile(output, JSON.stringify(report, null, 2));
console.log('NPC-HYBRID-SUMMARY', JSON.stringify(comparisons.map(
  ({population, seed, baselineMs, hybridMs, relativeCpuPercent, sameAcrossModes}) =>
    ({population, seed, baselineMs, hybridMs, relativeCpuPercent, sameAcrossModes}))));
