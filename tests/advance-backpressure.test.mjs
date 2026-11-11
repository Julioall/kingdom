import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdvanceBackpressureQueue } from '../src/app/advance-backpressure.js';

test('manual advances survive more than 12 queued days without loss', () => {
  const queue = createAdvanceBackpressureQueue();
  queue.enqueue(12, 'manual');
  queue.enqueue(8, 'manual');
  queue.enqueue(7, 'manual');
  assert.equal(queue.snapshot().queuedManualDays, 27);
  assert.deepEqual(queue.take(false), { source: 'manual', days: 12 });
  assert.deepEqual(queue.take(false), { source: 'manual', days: 12 });
  assert.deepEqual(queue.take(false), { source: 'manual', days: 3 });
  assert.equal(queue.take(false), null);
  assert.equal(queue.snapshot().dispatchedManualDays, 27);
});

test('manual commands retain priority while automatic clock backlog is bounded', () => {
  const queue = createAdvanceBackpressureQueue();
  queue.enqueue(12, 'clock');
  queue.enqueue(7, 'clock');
  queue.enqueue(2, 'manual');
  assert.equal(queue.snapshot().discardedClockDays, 7);
  assert.deepEqual(queue.take(false), { source: 'manual', days: 2 });
  for (let i = 0; i < 4; i++) assert.deepEqual(queue.take(false), { source: 'clock', days: 3 });
  assert.equal(queue.take(false), null);
  assert.equal(queue.snapshot().dispatchedClockDays, 12);
});

test('pause prevents automatic dispatch, but does not cancel queued manual requests', () => {
  const queue = createAdvanceBackpressureQueue();
  queue.enqueue(4, 'clock');
  queue.enqueue(5, 'manual');
  assert.deepEqual(queue.take(true), { source: 'manual', days: 5 });
  assert.equal(queue.take(true), null);
  queue.discardClock();
  assert.equal(queue.snapshot().discardedClockDays, 4);
  assert.equal(queue.take(false), null);
  queue.enqueue(1, 'manual');
  const copy = queue.snapshot();
  copy.queuedManualDays = 0;
  assert.equal(queue.snapshot().queuedManualDays, 1);
  queue.reset();
  assert.deepEqual(queue.snapshot(), {
    queuedClockDays: 0, queuedManualDays: 0, discardedClockDays: 0,
    dispatchedClockDays: 0, dispatchedManualDays: 0
  });
});

test('invalid days and sources are rejected instead of silently poisoning the queue', () => {
  const queue = createAdvanceBackpressureQueue();
  assert.throws(() => queue.enqueue(NaN, 'manual'), RangeError);
  assert.throws(() => queue.enqueue(1.5, 'manual'), RangeError);
  assert.throws(() => queue.enqueue(13, 'manual'), RangeError);
  assert.throws(() => queue.enqueue(1, 'unexpected'), TypeError);
  assert.equal(queue.take(false), null);
});
