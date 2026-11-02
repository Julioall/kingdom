import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../src/simulation/engine.js';
import { authoritativeSnapshotDigest } from '../scripts/support/jul274-snapshot-digest.mjs';

test('JUL-274 snapshot digest is deterministic for same-seed full worlds', () => {
  const a = Sim.createWorld(42), b = Sim.createWorld(42);
  assert.equal(authoritativeSnapshotDigest(a), authoritativeSnapshotDigest(b));
  Sim.stepDay(a, { includeSnapshot: false });
  Sim.stepDay(b, { includeSnapshot: false });
  assert.equal(authoritativeSnapshotDigest(a), authoritativeSnapshotDigest(b));
});

test('JUL-274 digest detects actor-state divergence invisible to alive-count metrics', () => {
  const a = Sim.createWorld(42), b = Sim.createWorld(42);
  assert.equal(a.people.filter(p => p.alive).length, b.people.filter(p => p.alive).length);
  a.people[0].foodReserve += 1;
  assert.notEqual(authoritativeSnapshotDigest(a), authoritativeSnapshotDigest(b));
});

test('JUL-274 digest detects tile-state divergence omitted by aggregate counters', () => {
  const a = Sim.createWorld(42), b = Sim.createWorld(42);
  a.tiles[0].plants[0] += 1;
  assert.notEqual(authoritativeSnapshotDigest(a), authoritativeSnapshotDigest(b));
});
