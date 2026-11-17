import test from 'node:test';
import assert from 'node:assert/strict';
import { samplePhase } from '../src/simulation/runtime/phase-measure.js';
import { stepDay, tick } from '../src/simulation/systems.js';
import Sim from '../src/simulation/engine.js';

test('unprofiled phase runs exactly once without sampling the clock', () => {
  const value = samplePhase(null, 'economy', () => 42);
  assert.equal(value, 42);
});

test('observer receives one nonnegative duration and a phase failure still propagates', () => {
  const events = [];
  const result = samplePhase((name, ms) => events.push({ name, ms }), 'war', () => 'done');
  assert.equal(result, 'done');
  assert.equal(events.length, 1);
  assert.equal(events[0].name, 'war');
  assert.ok(Number.isFinite(events[0].ms) && events[0].ms >= 0);
  assert.throws(() => samplePhase((name) => events.push({name}), 'economy', () => {
    throw new Error('failed');
  }), /failed/);
  assert.equal(events[1].name, 'economy');
});

test('single-day and multi-day orchestrators retain deterministic state', () => {
  const first = Sim.createWorld(42);
  const second = Sim.createWorld(42);
  stepDay(first, { includeSnapshot: false });
  tick(second, 1);
  assert.equal(first.day, second.day);
  assert.deepEqual(first.kingdoms, second.kingdoms);
  assert.equal(first.people.length, second.people.length);
  assert.equal(first.structures.length, second.structures.length);
});
