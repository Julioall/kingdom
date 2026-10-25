import test from 'node:test';
import assert from 'node:assert/strict';
import { createMovementInterpolator } from '../../src/ui/movement-interpolation.js';

const world = (day, x, extra = {}) => ({ day, people: [{ id: 1, alive: true, x, y: 3 }], animals: [], ...extra });
const person = { id: 1, x: 0, y: 3 };

test('consecutive daily steps keep constant speed across a tile boundary without an idle frame', () => {
  const motion = createMovementInterpolator();
  motion.observe(world(0, 0), 0, { reset: true });
  motion.observe(world(1, 1), 1000);
  const positions = [];
  for (let now = 1100; now <= 2900; now += 100) {
    if (now === 2000) motion.observe(world(2, 2), now);
    const pose = motion.pose('person', person, now);
    assert.equal(pose.moving, true, 'a continuous route must not switch to idle between cells');
    positions.push(pose.x);
  }
  for (let i = 1; i < positions.length; i++) assert.ok(Math.abs(positions[i] - positions[i - 1] - .1) < 1e-8);
});

test('a real stationary day stops the walk and never extrapolates an unobserved step', () => {
  const motion = createMovementInterpolator();
  motion.observe(world(0, 0), 0, { reset: true });
  motion.observe(world(1, 1), 1000);
  motion.observe(world(2, 1), 2000);
  const pose = motion.pose('person', person, 2500);
  assert.equal(pose.x, 1);
  assert.equal(pose.moving, false);
  assert.equal(motion.pose('person', person, 9000).x, 1);
});

test('duplicate day snapshots do not restart movement and mutable world objects are copied', () => {
  const motion = createMovementInterpolator();
  const state = world(0, 0);
  motion.observe(state, 0, { reset: true });
  state.day = 1; state.people[0].x = 1;
  motion.observe(state, 1000);
  motion.observe(state, 1500);
  assert.ok(Math.abs(motion.pose('person', person, 1560).x - .5) < 1e-8);
});

test('slow and batched fast speeds cover the whole snapshot interval', () => {
  for (const [speed, interval, step] of [[.5, 2000, 1], [8, 375, 3]]) {
    const motion = createMovementInterpolator();
    motion.observe(world(0, 0), 0, { reset: true, speed });
    motion.observe(world(step, step), interval, { speed });
    const pose = motion.pose('person', person, interval * 1.5 + 60);
    assert.ok(Math.abs(pose.x - step / 2) < 1e-8);
    assert.equal(pose.moving, true);
  }
});

test('worker responses slower than the requested simulation speed keep actors moving through the full interval', () => {
  const motion = createMovementInterpolator();
  motion.observe(world(0, 0), 0, { reset: true });
  motion.observe(world(1, 1), 10000);
  const halfway = motion.pose('person', person, 15060);
  assert.ok(Math.abs(halfway.x - .5) < 1e-8);
  assert.equal(halfway.moving, true);
});

test('new worlds clear old paths and person and animal IDs have separate trajectories', () => {
  const motion = createMovementInterpolator();
  motion.observe(world(0, 0, { animals: [{ id: 1, alive: true, x: 20, y: 4 }] }), 0, { reset: true });
  motion.observe(world(1, 1, { animals: [{ id: 1, alive: true, x: 21, y: 4 }] }), 1000);
  assert.ok(Math.abs(motion.pose('animal', { id: 1 }, 1560).x - 20.5) < 1e-8);
  motion.observe(world(0, 40), 2000, { reset: true });
  const pose = motion.pose('person', person, 2100);
  assert.equal(pose.x, 40);
  assert.equal(pose.moving, false);
});

test('resuming after a long pause starts from the stopped position instead of jumping ahead', () => {
  const motion = createMovementInterpolator();
  motion.observe(world(0, 0), 0, { reset: true });
  motion.observe(world(1, 1), 1000);
  assert.equal(motion.pose('person', person, 9000).x, 1);
  motion.markDiscontinuity();
  motion.observe(world(2, 2), 10000);
  assert.equal(motion.pose('person', person, 10000).x, 1);
  assert.ok(Math.abs(motion.pose('person', person, 10560).x - 1.5) < 1e-8);
});
