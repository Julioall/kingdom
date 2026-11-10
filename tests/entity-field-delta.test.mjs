import test from 'node:test';
import assert from 'node:assert/strict';
import {
  captureEntityFieldCache, createEntityFieldPatch, prepareEntityFieldPatch
} from '../src/simulation/entity-field-delta.js';
import { createSimulationWorkerRuntime } from '../src/simulation/worker-runtime.js';
import { SIMULATION_PROTOCOL_VERSION } from '../src/simulation/protocol-version.js';
import { applyWorldSnapshot, applyWorldTileDelta } from '../src/simulation/render-snapshot.js';

const initial = () => ({
  day: 0,
  people: [
    { id: 1, energy: 20, name: 'a', brain: { weights: [1, 2] },
      optional: undefined, signed: -0 },
    { id: 2, energy: 40, name: 'b', baggage: { reserve: 4 } }
  ],
  animals: [{ id: 10, energy: 15, herd: 'wild' }],
  structures: [{ id: 20, construction: 50 }, { id: 21, construction: 100 }]
});

test('entity field patches handle nested mutation, deletion, spawn/despawn, and ordering', () => {
  const before = initial(), cache = captureEntityFieldCache(before);
  const next = structuredClone(before);
  next.day = 1;
  next.people = [
    { id: 2, energy: 41, name: 'b', baggage: { reserve: 3 } },
    { id: 3, name: 'newborn', energy: 10 }
  ];
  next.animals[0].energy = 16;
  next.structures[1].construction = 101;
  const { patch } = createEntityFieldPatch(next, cache, { force: true });
  assert.equal(patch.schemaVersion, 1);
  assert.deepEqual(patch.collections.people.removed, [1]);
  assert.deepEqual(patch.collections.people.added.map(p => p.id), [3]);
  assert.deepEqual(patch.collections.people.order, [2, 3]);
  const updated = patch.collections.people.updated[0];
  assert.equal(updated.id, 2);
  assert.equal(updated.set.energy, 41);
  assert.deepEqual(updated.set.baggage, { reserve: 3 });
  const output = prepareEntityFieldPatch(before, structuredClone(patch));
  assert.deepEqual(output.people, next.people);
  assert.deepEqual(output.animals, next.animals);
  assert.deepEqual(output.structures, next.structures);
  assert.deepEqual(before.people[1].baggage, { reserve: 4 }, 'preflight must not mutate prior actors');
});

test('entity field patches distinguish undefined, missing keys, and signed zero', () => {
  const before = initial(), prev = captureEntityFieldCache(before);
  const next = structuredClone(before);
  delete next.people[0].optional;
  next.people[0].signed = 0;
  const { patch } = createEntityFieldPatch(next, prev, { force: true });
  assert.ok(patch);
  assert.deepEqual(patch.collections.people.updated[0].unset, ['optional']);
  assert.ok(Object.is(patch.collections.people.updated[0].set.signed, 0));
  const result = prepareEntityFieldPatch(before, patch);
  assert.equal(Object.prototype.hasOwnProperty.call(result.people[0], 'optional'), false);
  assert.equal(Object.is(result.people[0].signed, 0), true);
  assert.equal(Object.is(before.people[0].signed, -0), true);
});

test('invalid entity packets reject atomically without touching original state', () => {
  const before = initial(), cache = captureEntityFieldCache(before);
  const next = structuredClone(before);
  next.people[0].energy++;
  const { patch } = createEntityFieldPatch(next, cache, { force: true });
  const bad = structuredClone(patch);
  bad.collections.people.updated[0].id = 999;
  const snapshot = structuredClone(before);
  assert.throws(() => prepareEntityFieldPatch(before, bad), /entity/i);
  assert.deepEqual(before, snapshot);
  const doubleRemove = structuredClone(patch);
  doubleRemove.collections.people.removed = [1, 1];
  assert.throws(() => prepareEntityFieldPatch(before, doubleRemove), /entity/i);
  const illegalSet = structuredClone(patch);
  illegalSet.collections.people.updated[0].set.id = 123;
  assert.throws(() => prepareEntityFieldPatch(before, illegalSet), /entity/i);
  assert.deepEqual(before, snapshot);
});

test('non-plain structures fail closed instead of corrupting the entity diff', () => {
  const before = initial();
  before.people[0].privateMemory = new Map([['source', 1]]);
  assert.throws(() => captureEntityFieldCache(before), /snapshot/i);
});

test('real Worker opt-in entity patches preserve two full-world days, reset and resync', () => {
  const legacy = createSimulationWorkerRuntime(), experimental = createSimulationWorkerRuntime();
  let id = 1;
  const send = (runtime, type, body = {}, epoch = 1) => structuredClone(runtime.handle({
    protocolVersion: SIMULATION_PROTOCOL_VERSION, requestId: id++, epoch, type, ...body
  }));
  const oldInit = send(legacy, 'initialize', { seed: 42, config: { scenario: 'kingdom' } });
  const newInit = send(experimental, 'initialize', {
    seed: 42, config: { scenario: 'kingdom' }, transport: 'entity-field-delta'
  });
  assert.equal(oldInit.type, 'snapshot');
  assert.equal(newInit.type, 'snapshot');
  let view = applyWorldSnapshot(newInit.snapshot);
  let lastRevision = newInit.revision;
  for (const day of [1, 2]) {
    const oldPacket = send(legacy, 'advance', { days: 1, source: 'manual' });
    const current = send(experimental, 'advance', { days: 1, source: 'manual' });
    assert.equal(current.type, 'world-delta',
      'opt-in must send field patch rather than full snapshot at day ' + day);
    assert.equal(current.delta.baseRevision, lastRevision);
    assert.equal(current.delta.entityPatches.schemaVersion, 1);
    assert.equal(Object.hasOwn(current.delta.base, 'people'), false);
    assert.equal(Object.hasOwn(current.delta.base, 'animals'), false);
    assert.equal(Object.hasOwn(current.delta.base, 'structures'), false);
    view = applyWorldTileDelta(current.delta, view);
    lastRevision = current.revision;
    const expected = applyWorldSnapshot(oldPacket.snapshot);
    assert.deepEqual(view.people, expected.people, 'people must match at day ' + day);
    assert.deepEqual(view.animals, expected.animals, 'animals must match at day ' + day);
    assert.deepEqual(view.structures, expected.structures, 'structures must match at day ' + day);
    assert.deepEqual(view.tiles, expected.tiles, 'tile projection must match at day ' + day);
    assert.deepEqual(view.stats, expected.stats, 'stats must match at day ' + day);
  }
  const resync = send(experimental, 'resync');
  assert.equal(resync.type, 'snapshot');
  assert.equal(resync.snapshot.reset, true);
  assert.deepEqual(applyWorldSnapshot(resync.snapshot).people, view.people);
  const reset = send(experimental, 'reset', {
    seed: 21, kingdomAiEnabled: false, transport: 'entity-field-delta'
  }, 2);
  assert.equal(reset.type, 'snapshot');
  assert.equal(reset.snapshot.base.day, 0);
  const update = send(experimental, 'advance', { days: 1, source: 'manual' }, 2);
  assert.equal(update.type, 'world-delta');
});

test('malformed entity patch never applies base or any sparse tiles', () => {
  const runtime = createSimulationWorkerRuntime();
  let requestId = 1;
  const send = (type, more = {}) => structuredClone(runtime.handle({
    type, ...more, epoch: 1, protocolVersion: SIMULATION_PROTOCOL_VERSION,
    requestId: requestId++
  }));
  const full = send('initialize', { seed: 42, config: { scenario: 'kingdom' },
    transport: 'entity-field-delta' });
  const view = applyWorldSnapshot(full.snapshot);
  const beforeDay = view.day, firstTile = view.tiles[0].soilWaterMm;
  const sparse = send('advance', { days: 1, source: 'manual' });
  assert.equal(sparse.type, 'world-delta');
  sparse.delta.entityPatches.collections.people.updated[0].id = 987654321;
  assert.throws(() => applyWorldTileDelta(sparse.delta, view), /entity/i);
  assert.equal(view.day, beforeDay);
  assert.equal(view.tiles[0].soilWaterMm, firstTile);
});

test('nested volatile perception and navigation patches preserve exact data with key reordering', () => {
  const before = initial();
  before.people[0].perception = { day: 1, resources: [
    { tileIndex: 10, x: 1, biomass: { oak: 100, fern: 20 }, water: 20 },
    { tileIndex: 20, x: 2, biomass: { oak: 30, fern: 60 }, water: 25 }
  ], knownWater: [{ x: 5, y: 8, source: 'lake' }] };
  before.people[0].navigationRoute = [11, 12, 13, 14];
  const cache = captureEntityFieldCache(before);
  const after = structuredClone(before);
  after.people[0].perception.day++;
  after.people[0].perception.resources = [
    { tileIndex: 20, x: 2, biomass: { oak: 31, fern: 60 }, water: 25 },
    { tileIndex: 10, x: 1, biomass: { oak: 100, fern: 20 }, water: 20 },
    { tileIndex: 30, x: 3, biomass: { oak: 4 }, water: 15 }
  ];
  after.people[0].navigationRoute = [12, 13, 14];
  const { patch } = createEntityFieldPatch(after, cache, { force: true });
  assert.ok(patch);
  const update = patch.collections.people.updated.find(item => item.id === 1);
  assert.ok(update);
  assert.ok(update.nested?.length, 'nested changes must be used instead of full fields');
  assert.equal(Object.hasOwn(update.set, 'perception'), false);
  const projected = prepareEntityFieldPatch(before, structuredClone(patch));
  assert.deepEqual(projected.people, after.people);
  assert.deepEqual(before.people[0].perception.resources[0].biomass, { oak: 100, fern: 20 });
});

test('corrupt nested keyed patch rejects without touching prior world', () => {
  const before = initial();
  before.people[0].perception = { day: 1, resources: Array.from({ length: 15 }, (_, i) =>
    ({ tileIndex: i, x: i, y: i, soil: i / 15 })) };
  const cache = captureEntityFieldCache(before);
  const after = structuredClone(before);
  after.people[0].perception.resources[2].soil += 1;
  const { patch } = createEntityFieldPatch(after, cache, { force: true });
  const corrupted = structuredClone(patch);
  const update = corrupted.collections.people.updated.find(x => x.id === 1);
  const p = update.nested?.find(x => x.key === 'perception')?.patch;
  assert.ok(p);
  // Invalid nested shape should throw during preflight, before mutating any
  // old perception or other entity.
  p.t = 'bad-format';
  const snapshot = structuredClone(before);
  assert.throws(() => prepareEntityFieldPatch(before, corrupted), /entity|nested/i);
  assert.deepEqual(before, snapshot);
});
