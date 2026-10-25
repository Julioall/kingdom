import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { memoryUsage } from 'node:process';
import Sim from '../src/simulation/engine.js';

const seed = Number(process.env.BASELINE_SEED || 42);
const days = Math.max(1, Math.floor(Number(process.env.BASELINE_DAYS || 90)));
const repeats = Math.max(1, Math.floor(Number(process.env.BASELINE_REPEATS || 3)));
const warmupDays = 5;

function memory() {
  const values = memoryUsage();
  return Object.fromEntries(['rss', 'heapTotal', 'heapUsed', 'external', 'arrayBuffers'].map(key => [key, values[key]]));
}

function round(value, places = 2) {
  return Number(value.toFixed(places));
}

function megabytes(bytes) {
  return round(bytes / 1024 / 1024);
}

function memoryMiB(values) {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, megabytes(value)]));
}

function difference(after, before) {
  return Object.fromEntries(Object.keys(before).map(key => [key, after[key] - before[key]]));
}

function forceGc() {
  if (globalThis.gc) globalThis.gc();
}

// Compare the complete world state, not only the visual snapshot. Checking after
// each day also pinpoints the first replay divergence if a future change adds one.
function verifyDeterminism() {
  const replayA = Sim.createWorld(seed);
  const replayB = Sim.createWorld(seed);
  assert.deepEqual(replayA, replayB, 'same seed must produce identical initial state');
  for (let day = 1; day <= 10; day++) {
    Sim.stepDay(replayA);
    Sim.stepDay(replayB);
    assert.deepEqual(replayA, replayB, `same seed diverged after day ${day}`);
  }
}

verifyDeterminism();

function bytesToMiB(value) {
  return round(value / 1024 / 1024);
}

forceGc();
const samples = [];
let memorySample = null;
let configuration = null;
let observations = null;
for (let repeat = 0; repeat < repeats; repeat++) {
  forceGc();
  const beforeCreate = memory();
  const world = Sim.createWorld(seed);
  forceGc();
  const afterCreate = memory();

  for (let day = 0; day < warmupDays; day++) Sim.stepDay(world);
  const started = performance.now();
  for (let day = 0; day < days; day++) Sim.stepDay(world);
  const elapsedMs = performance.now() - started;

  forceGc();
  const afterSimulation = memory();
  samples.push({ elapsedMs: round(elapsedMs), daysPerSecond: round(days / (elapsedMs / 1000)) });
  if (repeat === 0) {
    configuration = {
      width: world.width,
      height: world.height,
      cells: world.tiles.length,
      kingdoms: world.kingdoms.length,
      residents: world.people.length,
      animals: world.animals.length,
      structures: world.structures.length,
      warmupDays,
      measuredDaysPerRepeat: days,
      repeats
    };
    observations = {
      day: world.day,
      aliveResidents: world.people.filter(person => person.alive).length,
      logs: world.logs.length,
      events: world.events.length
    };
    memorySample = {
      beforeCreateMiB: memoryMiB(beforeCreate),
      afterCreateMiB: memoryMiB(afterCreate),
      afterWarmupAndSimulationMiB: memoryMiB(afterSimulation),
      deltasMiB: {
        heapUsedAfterCreation: bytesToMiB(afterCreate.heapUsed - beforeCreate.heapUsed),
        heapUsedAfterSimulation: bytesToMiB(afterSimulation.heapUsed - afterCreate.heapUsed),
        rssDuringSimulation: bytesToMiB(afterSimulation.rss - afterCreate.rss),
        externalDuringSimulation: bytesToMiB(afterSimulation.external - afterCreate.external)
      }
    };
  }
}

const sortedRates = samples.map(sample => sample.daysPerSecond).sort((a, b) => a - b);
console.log(JSON.stringify({
  runtime: process.version,
  seed,
  determinism: { seeds: [seed], comparedDays: 10, fullWorldState: true, passed: true },
  configuration,
  observationsAfterMeasuredRun: observations,
  throughput: {
    samples,
    medianDaysPerSecond: sortedRates[Math.floor(sortedRates.length / 2)]
  },
  memory: memorySample
}, null, 2));
