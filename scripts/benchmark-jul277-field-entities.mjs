// JUL-277 — paired full-world payload and wall time A/B for opt-in entity fields.
// This is a CPU/projection experiment, never a browser FPS or structuredClone
// wire-byte measurement. Avoid claiming speedups from these proxies alone.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createSimulationWorkerRuntime } from '../src/simulation/worker-runtime.js';
import { SIMULATION_PROTOCOL_VERSION } from '../src/simulation/protocol-version.js';
import { applyWorldSnapshot, applyWorldTileDelta } from '../src/simulation/render-snapshot.js';
import { tileTransportBytes } from '../src/app/worker-transport-diagnostics.js';

const encoder = new TextEncoder();
const bytes = value => encoder.encode(JSON.stringify(value)).byteLength;
const names = ['people', 'animals', 'structures'];
const records = [];
let requestId = 0;
function send(runtime, type, fields = {}) {
  const before = performance.now();
  const response = structuredClone(runtime.handle({
    type, protocolVersion: SIMULATION_PROTOCOL_VERSION,
    requestId: ++requestId, epoch: 1, ...fields
  }));
  return { response, elapsedMs: performance.now() - before };
}
function payloadProxy(packet) {
  const full = packet.type === 'snapshot';
  const body = full ? packet.snapshot : packet.delta;
  return {
    entityJsonBytes: bytes(Object.fromEntries(names.map(n => [n,
      full ? body.base[n] : body.entityPatches ? body.entityPatches.collections[n] : body.base[n]]))),
    baseJsonBytes: bytes(body.base),
    patchJsonBytes: body.entityPatches ? bytes(body.entityPatches) : 0,
    fullProxyBytes: bytes({ base: body.base, entityPatches: body.entityPatches,
      stats: body.stats, events: body.events, logs: body.logs })
      + tileTransportBytes(packet),
    tileTypedBytes: tileTransportBytes(packet)
  };
}
for (const seed of [1, 42, 2026]) {
  const baseline = createSimulationWorkerRuntime();
  const optimized = createSimulationWorkerRuntime();
  const initBase = send(baseline, 'initialize', {
    seed, config: { scenario: 'kingdom' }, transport: 'tile-delta'
  }).response;
  const initOptimized = send(optimized, 'initialize', {
    seed, config: { scenario: 'kingdom' }, transport: 'entity-field-delta'
  }).response;
  assert.equal(initBase.type, 'snapshot');
  assert.equal(initOptimized.type, 'snapshot');
  let baseView = applyWorldSnapshot(initBase.snapshot);
  let optimizedView = applyWorldSnapshot(initOptimized.snapshot);
  for (let day = 1; day <= 2; day++) {
    const old = send(baseline, 'advance', { days: 1, source: 'manual' });
    const candidate = send(optimized, 'advance', { days: 1, source: 'manual' });
    assert.equal(old.response.type, 'world-delta');
    assert.equal(candidate.response.type, 'world-delta',
      'entity-field optimization fell back to a full snapshot (day ' + day + ')');
    assert.ok(candidate.response.delta.entityPatches,
      'no real field patch was emitted at day ' + day);
    baseView = applyWorldTileDelta(old.response.delta, baseView);
    optimizedView = applyWorldTileDelta(candidate.response.delta, optimizedView);
    for (const name of names)
      assert.deepEqual(optimizedView[name], baseView[name], name + ' projection mismatch');
    assert.deepEqual(optimizedView.tiles, baseView.tiles, 'tiles projection mismatch');
    assert.deepEqual(optimizedView.stats, baseView.stats, 'stats projection mismatch');
    const before = payloadProxy(old.response), after = payloadProxy(candidate.response);
    records.push({
      seed, day, counts: Object.fromEntries(names.map(n => [n, optimizedView[n].length])),
      baselineWallMs: old.elapsedMs, fieldDeltaWallMs: candidate.elapsedMs,
      changeWallPercent: 100 * (candidate.elapsedMs / old.elapsedMs - 1),
      before, after, jsonPlusTypedProxyReductionPercent:
        100 * (1 - after.fullProxyBytes / before.fullProxyBytes)
    });
    console.log('JUL277-FIELD-AB', JSON.stringify(records.at(-1)));
  }
}
const output = resolve(process.argv[2] || 'out/jul277-field-entity-ab.json');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify({
  schema: 1, issue: 'JUL-277', sourceSha: process.env.GITHUB_SHA || 'unknown',
  methodology: 'Three seeds, two sequential full-simulation days. Compare existing opt-in tile-only delta against opt-in tile+entity-field delta. Exact parity of all people/animals/structures/tiles/stats. Wall time includes simulation, diff, and structuredClone in the Node process. JSON bytes + typed-array byteLength are transport proxies, not actual Worker wire bytes. No GPU evidence.',
  caution: 'Do not enable by default without CPU and heap A/B in real browser. A field-signature walk may offset bytes saved.',
  records
}, null, 2));
console.log('PASSED 3 seeds x 2 days real world entity-field parity and payload A/B');
