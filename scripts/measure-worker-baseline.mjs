import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { memoryUsage } from 'node:process';
import { serialize } from 'node:v8';
import { applyWorldSnapshot, transferablesForSnapshot } from '../src/simulation/render-snapshot.js';
import { createSimulationWorkerRuntime } from '../src/simulation/worker-runtime.js';
import { SIMULATION_PROTOCOL_VERSION } from '../src/simulation/protocol-version.js';
import { HEIGHT, WIDTH } from '../src/config/ecosystem.js';

const seed = Number(process.env.BASELINE_SEED || 42);
const days = Math.max(1, Math.floor(Number(process.env.BASELINE_DAYS || 90)));
const measuredDays = days;
const batchDays = Math.max(1, Math.min(12, Math.floor(Number(process.env.BASELINE_BATCH_DAYS || 3))));
const repeats = Math.max(1, Math.floor(Number(process.env.BASELINE_REPEATS || 3)));
const includeDailySnapshots = process.env.WORKER_DAILY_SNAPSHOTS === '1';
const warmupDays = 5;
const mbytes = value => Number((value / 1024 / 1024).toFixed(2));
const round = value => Number(value.toFixed(2));
const message = (type, requestId, fields = {}) => ({
  protocolVersion: SIMULATION_PROTOCOL_VERSION,
  requestId,
  epoch: 1,
  type,
  ...fields
});

function memory() {
  const state = memoryUsage();
  return Object.fromEntries(['rss', 'heapTotal', 'heapUsed', 'external', 'arrayBuffers'].map(key => [key, state[key]]));
}

function forceGc() { if (globalThis.gc) globalThis.gc(); }
function toMiB(record) { return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, mbytes(value)])); }

function sendToView(runtime, request, previousView, stageTimes = null) {
  const runtimeStart = performance.now();
  const workerResponse = runtime.handle(request);
  if (stageTimes) stageTimes.runtimeAndProjectionMs += performance.now() - runtimeStart;
  assert.notEqual(workerResponse.type, 'error', workerResponse.message);
  const transferStart = performance.now();
  const transferred = structuredClone(workerResponse, {
    transfer: transferablesForSnapshot(workerResponse.snapshot)
  });
  if (stageTimes) stageTimes.transferCloneMs += performance.now() - transferStart;
  const hydrationStart = performance.now();
  const view = transferred.type === 'snapshot'
    ? applyWorldSnapshot(transferred.snapshot, transferred.snapshot.reset ? null : previousView)
    : previousView;
  if (stageTimes && transferred.type === 'snapshot') stageTimes.snapshotHydrationMs += performance.now() - hydrationStart;
  return { response: transferred, view };
}

const runs = [];
let firstRun = null;
for (let repeat = 0; repeat < repeats; repeat++) {
  forceGc();
  const beforeCreate = memory();
  const runtime = createSimulationWorkerRuntime({ includeDailySnapshots });
  let { response: initialized, view } = sendToView(runtime, message('initialize', 1, {
    config: { scenario: 'kingdom' }, seed
  }), null);
  forceGc();
  const afterCreate = memory();
  const tileSnapshotBytes = Object.values(initialized.snapshot.tileColumns)
    .filter(ArrayBuffer.isView).reduce((sum, column) => sum + column.byteLength, 0);
  const serializedBaseBytes = serialize(initialized.snapshot.base).byteLength;
  const serializedSnapshotBytes = serialize(initialized.snapshot).byteLength;

  for (let day = 0; day < warmupDays; day++) {
    const result = sendToView(runtime, message('advance', day + 2, { days: 1 }), view);
    view = result.view;
  }
  const start = performance.now();
  let remaining = days, requestId = warmupDays + 2;
  const stageTimes = { runtimeAndProjectionMs: 0, transferCloneMs: 0, snapshotHydrationMs: 0, batches: 0 };
  while (remaining > 0) {
    const batch = Math.min(batchDays, remaining);
    const result = sendToView(runtime, message('advance', requestId++, { days: batch }), view, stageTimes);
    view = result.view;
    remaining -= batch;
    stageTimes.batches++;
  }
  const elapsedMs = performance.now() - start;
  forceGc();
  const afterSimulation = memory();
  const stats = view.stats;
  const sample = {
    elapsedMs: round(elapsedMs),
    daysPerSecond: round(days / (elapsedMs / 1000)),
    lastResponseBytes: serializedSnapshotBytes,
    stageTimesMs: Object.fromEntries(Object.entries(stageTimes).map(([key, value]) => [key, key === 'batches' ? value : round(value)]))
  };
  runs.push(sample);
  if (!firstRun) {
    firstRun = {
      configuration: {
        width: view.width, height: view.height, cells: view.tiles.length,
        kingdoms: view.kingdoms.length, residents: view.people.length,
        animals: view.animals.length, structures: view.structures.length,
      warmupDays, measuredDays, snapshotBatchDays: batchDays, includeDailySnapshots, repeats
      },
      observations: { day: view.day, aliveResidents: stats.peopleCount, logs: view.logs.length, events: view.events.length },
      snapshot: { tileColumnBytes: tileSnapshotBytes, serializedEntityBaseBytes: serializedBaseBytes, v8SerializedSnapshotBytes: serializedSnapshotBytes },
      memory: {
        beforeCreateMiB: toMiB(beforeCreate),
        afterCreateMiB: toMiB(afterCreate),
        afterWarmupAndSimulationMiB: toMiB(afterSimulation)
      }
    };
  }
}

const sortedRates = runs.map(run => run.daysPerSecond).sort((a, b) => a - b);
const median = values => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];
const medianStages = Object.fromEntries(['runtimeAndProjectionMs', 'transferCloneMs', 'snapshotHydrationMs', 'batches']
  .map(key => [key, median(runs.map(run => run.stageTimesMs[key]))]));
assert.ok(firstRun.configuration.width === WIDTH && firstRun.configuration.height === HEIGHT,
  'benchmark must use the default map size');
console.log(JSON.stringify({
  runtime: process.version,
  seed,
  measurement: 'Node worker-runtime + structuredClone transfer + main-thread snapshot hydration; render cost excluded',
  configuration: firstRun.configuration,
  observationsAfterMeasuredRun: firstRun.observations,
  snapshotPayload: firstRun.snapshot,
  throughput: { samples: runs, medianDaysPerSecond: sortedRates[Math.floor(sortedRates.length / 2)] },
  stageBreakdown: { medianPerMeasuredRunMs: medianStages, samples: runs.map(run => run.stageTimesMs) },
  memory: firstRun.memory
}, null, 2));
