import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulationWorkerRuntime } from '../src/simulation/worker-runtime.js';
import { SIMULATION_PROTOCOL_VERSION } from '../src/simulation/protocol-version.js';
import { applyWorldSnapshot, applyWorldTileDelta } from '../src/simulation/render-snapshot.js';
import { nextMaterializedWorldRevision } from '../src/app/materialized-world-revision.js';

test('ACKs do not invalidate the base revision of a real Worker world delta', () => {
  const runtime = createSimulationWorkerRuntime();
  let requestId = 0;
  const send = (type, fields = {}) => runtime.handle({
    type, ...fields, requestId: ++requestId,
    epoch: 1, protocolVersion: SIMULATION_PROTOCOL_VERSION
  });
  const init = send('initialize', {
    seed: 42, config: { scenario: 'kingdom' }, transport: 'tile-delta'
  });
  assert.equal(init.type, 'snapshot');
  let view = applyWorldSnapshot(init.snapshot);
  let materialized = nextMaterializedWorldRevision(0, init);
  assert.equal(materialized, init.revision);

  const pause = send('set-paused', { paused: true });
  const resume = send('set-paused', { paused: false });
  assert.equal(pause.type, 'ack');
  assert.equal(resume.type, 'ack');
  assert.ok(resume.revision > materialized);
  materialized = nextMaterializedWorldRevision(materialized, pause);
  materialized = nextMaterializedWorldRevision(materialized, resume);
  assert.equal(materialized, init.revision,
    'control revisions must not change the last materialized snapshot');

  const delta = send('advance', { days: 1, source: 'clock' });
  assert.equal(delta.type, 'world-delta');
  assert.equal(delta.delta.baseRevision, materialized,
    'the delta references the previous world payload, not the last ACK');
  view = applyWorldTileDelta(delta.delta, view);
  materialized = nextMaterializedWorldRevision(materialized, delta);
  assert.equal(materialized, delta.revision);
  assert.equal(view.day, 1);

  const query = send('inspect-tile', { x: 20, y: 20 });
  assert.equal(query.type, 'query');
  assert.equal(nextMaterializedWorldRevision(materialized, query), materialized);
  const subsequent = send('advance', { days: 1, source: 'clock' });
  assert.equal(subsequent.type, 'world-delta');
  assert.equal(subsequent.delta.baseRevision, materialized);
  assert.equal(applyWorldTileDelta(subsequent.delta, view).day, 2);
});

test('revision bookkeeping rejects malformed materialized envelopes without changing control state', () => {
  assert.equal(nextMaterializedWorldRevision(5, { type: 'ack', revision: 6 }), 5);
  assert.equal(nextMaterializedWorldRevision(5, { type: 'error', revision: 100 }), 5);
  assert.equal(nextMaterializedWorldRevision(5, { type: 'query', revision: 7 }), 5);
  assert.equal(nextMaterializedWorldRevision(5, { type: 'snapshot', revision: 8 }), 8);
  assert.equal(nextMaterializedWorldRevision(8, { type: 'world-delta', revision: 9 }), 9);
  assert.throws(() => nextMaterializedWorldRevision(5, { type: 'snapshot', revision: -1 }), RangeError);
  assert.throws(() => nextMaterializedWorldRevision(5, { type: 'world-delta', revision: NaN }), RangeError);
});
