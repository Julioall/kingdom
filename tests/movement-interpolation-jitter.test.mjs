import test from 'node:test';
import assert from 'node:assert/strict';
import { createMovementInterpolator, SNAPSHOT_JITTER_BUFFER_MS } from '../src/ui/movement-interpolation.js';

function world(day, peopleX) {
  return { day, people: peopleX.map((x, id) => ({ id: id + 1, alive: true, x, y: id })),
    animals: [{ id: 20, alive: true, x: peopleX[0], y: 4 }] };
}
function position(interpolator, day, xs, receivedAt, now = receivedAt) {
  const snapshot = world(day, xs);
  interpolator.observe(snapshot, receivedAt);
  return snapshot.people.map(person => interpolator.pose('person', person, now).x);
}

test('a short Worker gap cannot compress all actors into a jump and synchronized idle', () => {
  const stabilized = createMovementInterpolator();
  const legacy = createMovementInterpolator({ stabilizeCadence: false });
  const first = world(0, [0, 10, 20]);
  for (const interp of [stabilized, legacy]) interp.observe(first, 0, { reset: true });
  position(stabilized, 1, [1, 11, 21], 1000);
  position(legacy, 1, [1, 11, 21], 1000);
  const newXs = position(stabilized, 2, [2, 12, 22], 1100);
  const oldXs = position(legacy, 2, [2, 12, 22], 1100);
  assert.equal(stabilized.stats(1100).cadenceMs, 1000);
  assert.equal(legacy.stats(1100).cadenceMs, 100);
  assert.equal(stabilized.stats(1100).shortSnapshots, 1);
  assert.ok(oldXs[0] - newXs[0] > .8, 'old cadence jumps several tiles ahead when snapshots cluster');
  assert.ok(oldXs[1] - newXs[1] > .8);
  assert.ok(oldXs[2] - newXs[2] > .8);

  const third = world(2, [2, 12, 22]);
  assert.ok(stabilized.pose('person', third.people[0], 1500).x < 1);
  assert.equal(legacy.pose('person', third.people[0], 1500).x, 2);
  assert.ok(stabilized.pose('animal', third.animals[0], 1500).x < 1);
  const newer = world(3, [3, 13, 23]);
  stabilized.observe(newer, 2100);
  assert.equal(stabilized.stats(2100).cadenceMs, 1000);
  assert.ok(stabilized.pose('person', newer.people[0], 2300).x > .1);
});

test('jitter cushion hides 160ms snapshot delay without extrapolating future positions', () => {
  const stabilized = createMovementInterpolator();
  const legacy = createMovementInterpolator({ stabilizeCadence: false });
  const first = world(0, [0, 10]);
  for (const interp of [stabilized, legacy]) interp.observe(first, 0, { reset: true });
  const second = world(1, [1, 11]);
  for (const interp of [stabilized, legacy]) interp.observe(second, 1000);
  const at = 2160;
  const smooth = stabilized.pose('person', second.people[0], at);
  const stalled = legacy.pose('person', second.people[0], at);
  assert.ok(smooth.x > .9 && smooth.x < 1);
  assert.equal(smooth.moving, true);
  assert.equal(stalled.x, 1);
  assert.equal(stalled.moving, false);
  assert.equal(stabilized.stats(at).waitingForSnapshotMs, 0);
  assert.ok(legacy.stats(at).waitingForSnapshotMs > 50);
  const delayed = world(2, [2, 12]);
  stabilized.observe(delayed, at);
  const after = stabilized.pose('person', delayed.people[0], at);
  assert.equal(after.x, smooth.x, 'Worker response cannot teleport actors');
  assert.ok(stabilized.pose('person', delayed.people[0], at + 250).x > after.x);
  assert.equal(SNAPSHOT_JITTER_BUFFER_MS, 180);
});

test('slow Worker and explicit pause do not advance the authoritative world or speed through pause', () => {
  const interp = createMovementInterpolator();
  const start = world(0, [0]);
  interp.observe(start, 0, { reset: true });
  const day1 = world(1, [1]);
  interp.observe(day1, 1000);
  assert.equal(interp.stats(3000).waitingForSnapshotMs, 820);
  interp.markDiscontinuity();
  const resumed = world(2, [2]);
  interp.observe(resumed, 10000);
  assert.equal(interp.stats(10000).cadenceMs, 1000);
  assert.equal(interp.stats(10000).lastGapMs, 1000, 'explicit discontinuity does not count paused time as Worker delay');
  const startPose = interp.pose('person', resumed.people[0], 10000);
  assert.equal(startPose.x, 1);
  assert.ok(interp.pose('person', resumed.people[0], 11200).x <= resumed.people[0].x);
  interp.observe(world(0, [0]), 12000, { reset: true });
  assert.equal(interp.stats(12000).shortSnapshots, 0);
  assert.equal(interp.stats(12000).lateSnapshots, 0);
  assert.equal(interp.stats(12000).waitingForSnapshotMs, 0);
});
