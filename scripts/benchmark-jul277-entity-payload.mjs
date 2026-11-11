// JUL-277 — measure why sparse tile deltas are not yet a complete Worker
// transport optimization. This is an offline, full-world benchmark. JSON byte
// counts are diagnostic proxies, NOT actual structuredClone bytes or FPS.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createSimulationWorkerRuntime } from '../src/simulation/worker-runtime.js';
import { SIMULATION_PROTOCOL_VERSION } from '../src/simulation/protocol-version.js';
import { applyWorldSnapshot, applyWorldTileDelta } from '../src/simulation/render-snapshot.js';
import { tileTransportBytes } from '../src/app/worker-transport-diagnostics.js';

const textEncoder = new TextEncoder();
const jsonBytes = object => textEncoder.encode(JSON.stringify(object)).byteLength;
let requestId = 0;
function request(runtime, type, extra = {}) {
  return runtime.handle({
    protocolVersion: SIMULATION_PROTOCOL_VERSION,
    requestId: ++requestId, epoch: 1, type, ...extra
  });
}
function changedRecords(before, after) {
  const prior = new Map(before.map(item => [item.id, JSON.stringify(item)]));
  const current = new Set(after.map(item => item.id));
  let inserted = 0, updated = 0;
  for (const item of after) {
    const previous = prior.get(item.id);
    if (previous === undefined) inserted++;
    else if (previous !== JSON.stringify(item)) updated++;
  }
  const deleted = [...prior.keys()].filter(id => !current.has(id)).length;
  return { before: before.length, after: after.length, inserted, updated,
    deleted, unchanged: after.length - inserted - updated };
}
const seeds = [1, 42, 2026];
const results = [];
for (const seed of seeds) {
  const baseline = createSimulationWorkerRuntime();
  const delta = createSimulationWorkerRuntime();
  const firstFull = request(baseline, 'initialize', { seed, config: { scenario: 'kingdom' } });
  const firstDelta = request(delta, 'initialize', {
    seed, config: { scenario: 'kingdom' }, transport: 'tile-delta'
  });
  assert.equal(firstFull.type, 'snapshot');
  assert.equal(firstDelta.type, 'snapshot');
  // Snapshot base shares live references within the test runtime: copy the
  // initial entity rows BEFORE running a day, otherwise mutation hides changes.
  const baselinePeople = structuredClone(firstDelta.snapshot.base.people);
  const baselineAnimals = structuredClone(firstDelta.snapshot.base.animals);
  const baselineStructures = structuredClone(firstDelta.snapshot.base.structures);
  const oldView = applyWorldSnapshot(firstDelta.snapshot);
  const fullAfter = request(baseline, 'advance', { days: 1, source: 'manual' });
  const sparseAfter = request(delta, 'advance', { days: 1, source: 'manual' });
  assert.equal(fullAfter.type, 'snapshot');
  assert.equal(sparseAfter.type, 'world-delta');
  assert.equal(sparseAfter.delta.baseRevision, firstDelta.revision);
  const nextView = applyWorldTileDelta(sparseAfter.delta, oldView);
  const expectedView = applyWorldSnapshot(fullAfter.snapshot);
  assert.deepEqual(nextView.tiles, expectedView.tiles, 'tile projection mismatch for seed '+seed);
  assert.deepEqual(nextView.people, expectedView.people, 'people base mismatch for seed '+seed);
  assert.deepEqual(nextView.animals, expectedView.animals, 'animal base mismatch for seed '+seed);
  assert.deepEqual(nextView.structures, expectedView.structures, 'structure base mismatch for seed '+seed);
  const fullPayload = fullAfter.snapshot;
  const sparsePayload = sparseAfter.delta;
  const entityColumns = base => ({
    people: base.people, animals: base.animals, structures: base.structures
  });
  const entityBytes = jsonBytes(entityColumns(sparsePayload.base));
  const baseJsonBytes = jsonBytes(sparsePayload.base);
  const otherJsonBytes = jsonBytes({
    base: sparsePayload.base, stats: sparsePayload.stats,
    events: sparsePayload.events, logs: sparsePayload.logs
  });
  const fullTileBytes = tileTransportBytes(fullAfter);
  const sparseTileBytes = tileTransportBytes(sparseAfter);
  // JSON proxy + binary tile bytes; metadata/envelope/clone representation
  // vary by browser and runtime. This is NOT a measured network payload.
  const fullProxyBytes = otherJsonBytes + fullTileBytes;
  const sparseProxyBytes = otherJsonBytes + sparseTileBytes;
  results.push({
    seed, population: { people: sparsePayload.base.people.length,
      animals: sparsePayload.base.animals.length, structures: sparsePayload.base.structures.length },
    changed: {
      people: changedRecords(baselinePeople, sparsePayload.base.people),
      animals: changedRecords(baselineAnimals, sparsePayload.base.animals),
      structures: changedRecords(baselineStructures, sparsePayload.base.structures)
    },
    byteProxy: {
      entityJsonBytes: entityBytes, baseJsonBytes, otherJsonBytes,
      entityShareOfBasePercent: 100 * entityBytes / Math.max(1, baseJsonBytes),
      fullTileTypedBytes: fullTileBytes, deltaTileTypedBytes: sparseTileBytes,
      tileTypedReductionPercent: 100 * (1 - sparseTileBytes / fullTileBytes),
      fullJsonPlusTileProxyBytes: fullProxyBytes,
      deltaJsonPlusTileProxyBytes: sparseProxyBytes,
      estimatedTotalProxyReductionPercent: 100 * (1 - sparseProxyBytes / fullProxyBytes)
    }
  });
  console.log('ENTITY-PAYLOAD', JSON.stringify(results.at(-1)));
}
const report = {
  schema: 1, issue: 'JUL-277', sourceSha: process.env.GITHUB_SHA || 'unknown',
  seeds, days: 1, method: 'Three real full-world initializations; compare default full snapshot versus opt-in tile-delta after one day, plus exact projected people/animals/structures/tiles. Count serializable actor differences outside timed steps. Approximate JSON bytes for non-tile objects plus actual typed-array byteLength for tiles.',
  caveats: [
    'JSON size is not structuredClone/transfer wire size, memory, GC, GPU work or FPS.',
    'NPC state changes include nested fields, and entity arrays remain entirely present in every delta.base.',
    'Counts identify per-entity patch potential; per-field deltas might still help even when all actors change.',
    'One simulated day and three seeds do not prove scaling to 5000 or 100000 NPCs.'
  ], results
};
const output = resolve(process.argv[2] || 'out/jul277-entity-payload.json');
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2));
console.log('PASSED causal projection parity, entity change counts and payload proxies', seeds.length);
