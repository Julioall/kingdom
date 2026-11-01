import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../src/simulation/engine.js';
import {
  resourceCollisionIndex, structureCollisionIndex, worldCollisionIndex,
  collidesWithWorldAt, collidesWithWorldPositionAt
} from '../src/simulation/physics/hitboxes.js';
import { invalidateNavigation } from '../src/simulation/individuals/navigation-cache.js';

// Frozen reference implementation. This is the exact original string used
// by the navigation cache (including empty and polygon slots).
function originalHitboxSignature(hitboxes) {
  return hitboxes.map(hitbox => [hitbox.structureId, hitbox.x, hitbox.y,
    hitbox.shape, hitbox.halfWidth, hitbox.halfDepth, hitbox.radius, hitbox.resourceKind,
    hitbox.entityId, hitbox.trainingDummyId,
    hitbox.points?.map(point => point.x + ',' + point.y).join(';')].join(':')).join('|');
}
function validateExactSignatures(world) {
  const resource = resourceCollisionIndex(world);
  const structures = structureCollisionIndex(world);
  const collision = worldCollisionIndex(world);
  const expectedResources = 'resources:' + (world.navigationRevision || 0) + ':'
    + originalHitboxSignature(resource.hitboxes);
  const expectedStructures = originalHitboxSignature(structures.hitboxes);
  assert.equal(resource.signature, expectedResources);
  assert.equal(structures.signature, expectedStructures);
  assert.equal(collision.signature, expectedStructures + '|' + expectedResources);
  // Multiple consumers must see an identical stable cache key.
  assert.equal(resource.signature, expectedResources);
  assert.equal(collision.signature, expectedStructures + '|' + expectedResources);
  assert.strictEqual(worldCollisionIndex(world), collision);
  assert.strictEqual(resourceCollisionIndex(world), resource);
  assert.equal(typeof Object.getOwnPropertyDescriptor(resource, 'signature').get, 'function');
  assert.equal(typeof Object.getOwnPropertyDescriptor(collision, 'signature').get, 'function');
}
test('deferred collision signatures remain byte-identical for seeded complete worlds', () => {
  for (const seed of [1, 42, 2026]) {
    const world = Sim.createWorld(seed);
    for (let day = 0; day < 3; day++) {
      validateExactSignatures(world);
      Sim.stepDay(world, {includeSnapshot:false});
    }
  }
});
test('resource invalidation changes geometry index and route key without stale reuse', () => {
  const world = Sim.createWorld(42);
  const index = resourceCollisionIndex(world);
  const before = worldCollisionIndex(world);
  const signatureBefore = before.signature;
  const tile = world.tiles.find(t=>t.terrain === 'land' && t.cropFieldId == null);
  assert.ok(tile);
  tile.stoneDeposit = 50;
  invalidateNavigation(world);
  const next = resourceCollisionIndex(world);
  assert.notStrictEqual(index, next);
  assert.notStrictEqual(before, worldCollisionIndex(world));
  assert.notEqual(worldCollisionIndex(world).signature, signatureBefore);
  validateExactSignatures(world);
});
test('collision-only consumers may use the indexes without materializing signatures', () => {
  const world = Sim.createWorld(1);
  const resource = resourceCollisionIndex(world);
  const merged = worldCollisionIndex(world);
  assert.equal(typeof Object.getOwnPropertyDescriptor(resource,'signature').get, 'function');
  assert.equal(typeof Object.getOwnPropertyDescriptor(merged,'signature').get, 'function');
  const actor = world.people.find(p=>p.alive);
  assert.ok(actor);
  assert.equal(typeof collidesWithWorldAt(world,actor,Math.round(actor.x),Math.round(actor.y),merged),'boolean');
  assert.equal(typeof collidesWithWorldPositionAt(world,actor,actor.x,actor.y,merged),'boolean');
  validateExactSignatures(world);
});
