import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../src/simulation/engine.js';
import { resourceCollisionIndex, structureCollisionIndex } from '../src/simulation/physics/hitboxes.js';
import { invalidateNavigation } from '../src/simulation/individuals/navigation-cache.js';

// Original implementation: preserve the text exactly, including empty slots.
function previousSignature(hitboxes) {
  return hitboxes.map(hitbox => [hitbox.structureId, hitbox.x, hitbox.y,
    hitbox.shape, hitbox.halfWidth, hitbox.halfDepth, hitbox.radius, hitbox.resourceKind,
    hitbox.entityId, hitbox.trainingDummyId,
    hitbox.points?.map(point => point.x + ',' + point.y).join(';')].join(':')).join('|');
}

test('optimized signatures match legacy byte-for-byte for three complete seeded worlds', () => {
  for (const seed of [1, 42, 2026]) {
    const world = Sim.createWorld(seed);
    for (let day = 0; day < 3; day++) {
      const resource = resourceCollisionIndex(world);
      const structures = structureCollisionIndex(world);
      assert.equal(resource.signature,
        'resources:' + (world.navigationRevision || 0) + ':' + previousSignature(resource.hitboxes));
      assert.equal(structures.signature, previousSignature(structures.hitboxes));
      Sim.stepDay(world, {includeSnapshot: false});
    }
  }
});

test('geometry-change invalidation retains original signature semantics', () => {
  const world = Sim.createWorld(42);
  const before = resourceCollisionIndex(world);
  const tile = world.tiles.find(t => t.terrain === 'land' && t.cropFieldId == null);
  assert.ok(tile);
  tile.stoneDeposit = 50;
  invalidateNavigation(world);
  const after = resourceCollisionIndex(world);
  assert.notStrictEqual(before, after);
  assert.equal(after.signature,
    'resources:' + (world.navigationRevision || 0) + ':' + previousSignature(after.hitboxes));
});

test('legacy delimiter semantics for null, undefined, NaN, zero and polygon points', () => {
  const fixtures = [
    {structureId:null,x:0,y:-0,shape:'circle',radius:.4,entityId:undefined},
    {structureId:17,x:NaN,y:undefined,shape:'polygon',
      points:[{x:1,y:2},{x:-3,y:4}]},
    {structureId:undefined,x:null,y:0,shape:'rectangle',halfWidth:0,halfDepth:.25}
  ];
  // The index construction signature must retain empty fields rather than
  // producing literal "undefined"/"null" strings in navigation cache keys.
  const old = previousSignature(fixtures);
  assert.ok(old.includes('NaN'));
  assert.ok(old.includes('1,2;-3,4'));
  assert.ok(!old.includes('undefined'));
  assert.ok(!old.includes('null'));
});
