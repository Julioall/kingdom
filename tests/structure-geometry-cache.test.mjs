import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../src/simulation/engine.js';
import { structureCollisionIndex } from '../src/simulation/physics/hitboxes.js';

test('structure geometry cache detects in-place footprint, polygon, position and destruction changes', () => {
  const world = Sim.createWorld(42);
  const structure = { id: 999999, type: 'casa', complete: true, x: 20, y: 20,
    hitbox: { halfWidth: .6, halfDepth: .4 } };
  world.structures = [structure];
  let previous = structureCollisionIndex(world);
  assert.equal(structureCollisionIndex(world), previous);
  for (const change of [
    () => { structure.x++; },
    () => { structure.hitbox.halfWidth = .9; },
    () => { structure.hitbox.points = [[0, 0], [1, 0], [0, 1]]; },
    () => { structure.hitbox.points[1][0] = 2; },
    () => { structure.destroyedDay = 1; }
  ]) {
    change();
    const next = structureCollisionIndex(world);
    assert.notEqual(next.signature, previous.signature);
    assert.notEqual(next, previous);
    assert.equal(structureCollisionIndex(world), next);
    previous = next;
  }
});

test('structure geometry cache preserves list order and rebuilds spatial dimensions', () => {
  const world = Sim.createWorld(42);
  world.structures = [
    { id: 999991, type: 'casa', complete: true, x: 20, y: 20 },
    { id: 999992, type: 'casa', complete: true, x: 30, y: 30 }
  ];
  const original = structureCollisionIndex(world);
  world.structures.reverse();
  const reordered = structureCollisionIndex(world);
  assert.notEqual(reordered.signature, original.signature);
  assert.deepEqual(reordered.hitboxes.map(box => box.structureId), [999992, 999991]);
  world.width++;
  const resized = structureCollisionIndex(world);
  assert.notEqual(resized, reordered);
  assert.equal(resized.width, world.width);
  assert.equal(resized.signature, reordered.signature);
  world.structures.pop();
  const removed = structureCollisionIndex(world);
  assert.equal(removed.hitboxes.length, 1);
  assert.notEqual(removed.signature, resized.signature);
});
