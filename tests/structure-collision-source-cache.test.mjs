import test from 'node:test';
import assert from 'node:assert/strict';
import { captureStructureCollisionSources, sameStructureCollisionSources }
  from '../src/simulation/physics/structure-source-snapshot.js';
import { structureCollisionIndex, structureHitbox }
  from '../src/simulation/physics/hitboxes.js';

function worldWithBuildings() {
  return {
    width: 80, height: 80, kingdoms: [{ id: 1, palette: 'red' }],
    structures: [
      { id: 1, kingdomId: 1, type: 'castelo', x: 30, y: 30, complete: true },
      { id: 2, kingdomId: 1, type: 'centro_militar', x: 29, y: 32, complete: true },
      { id: 3, kingdomId: 1, type: 'arquearia', x: 28, y: 28, complete: true },
      { id: 4, kingdomId: 1, type: 'monasterio', x: 32, y: 28, complete: true }
    ]
  };
}

test('static collision lookups reuse the exact same geometry/index', () => {
  const world = worldWithBuildings();
  const initial = structureCollisionIndex(world);
  assert.equal(initial.hitboxes.length, 7, 'four structures and three training dummies');
  for (let i = 0; i < 50; i++) {
    world.structures[0].health = 100 - i;
    world.trainingDummyStates = { '-11': { health: 100 - i } };
    assert.equal(structureCollisionIndex(world), initial);
  }
  const source = captureStructureCollisionSources(world);
  assert.equal(sameStructureCollisionSources(world, source), true);
});

test('same-day construction, relocation, destruction and custom footprint changes invalidate', () => {
  const world = worldWithBuildings();
  const house = { id: 55, kingdomId: 1, type: 'abrigo', x: 20, y: 20,
    complete: false, progress: 0 };
  world.structures.push(house);
  let previous = structureCollisionIndex(world);
  assert.equal(previous.hitboxes.some(h => h.structureId === house.id), false);
  house.progress = 10;
  let current = structureCollisionIndex(world);
  assert.notEqual(current, previous);
  assert.ok(current.hitboxes.some(h => h.structureId === house.id));
  previous = current;
  house.progress = 20; // Existing hitbox remains unchanged.
  assert.equal(structureCollisionIndex(world), previous);
  house.complete = true;
  assert.equal(structureCollisionIndex(world), previous, 'same geometry after completion');
  house.x += 1;
  current = structureCollisionIndex(world);
  assert.notEqual(current, previous);
  assert.equal(current.hitboxes.find(h => h.structureId === house.id).x, structureHitbox(house).x);
  previous = current;
  house.hitbox = { offsetX: .4, halfWidth: 1.35 };
  current = structureCollisionIndex(world);
  assert.notEqual(current, previous);
  assert.equal(current.hitboxes.find(h => h.structureId === house.id).halfWidth, 1.35);
  previous = current;
  house.hitbox.offsetX = 1.2;
  current = structureCollisionIndex(world);
  assert.notEqual(current, previous);
  assert.equal(current.hitboxes.find(h => h.structureId === house.id).x,
    structureHitbox(house).x);
  previous = current;
  house.destroyedDay = 5;
  current = structureCollisionIndex(world);
  assert.notEqual(current, previous);
  assert.equal(current.hitboxes.some(h => h.structureId === house.id), false);
});

test('custom polygon mutations invalidate even without replacing hitbox object', () => {
  const world = { width: 40, height: 40, kingdoms: [], structures: [{
    id: 7, type: 'casa', x: 12, y: 12, complete: true,
    hitbox: { points: [[-1, -1], [1, -1], [0, 1]] }
  }] };
  const initial = structureCollisionIndex(world);
  const shape = initial.hitboxes[0];
  assert.equal(shape.shape, 'polygon');
  world.structures[0].hitbox.points[2][1] = 2;
  const changed = structureCollisionIndex(world);
  assert.notEqual(changed, initial);
  assert.deepEqual(changed.hitboxes[0], structureHitbox(world.structures[0]));
  assert.notDeepEqual(shape, changed.hitboxes[0]);

  const source = captureStructureCollisionSources(world);
  world.structures[0].hitbox.points = [{x: -1, y: -1}, {x: 1, y: -1}, {x: 0, y: 2}];
  assert.equal(sameStructureCollisionSources(world, source), false);
  assert.deepEqual(structureCollisionIndex(world).hitboxes[0], structureHitbox(world.structures[0]));
});

test('training dummy placement respects kingdom palette and source order', () => {
  const world = worldWithBuildings();
  const red = structureCollisionIndex(world);
  const dummyRed = red.hitboxes.find(h => h.trainingDummyId === -11);
  assert.ok(dummyRed);
  world.kingdoms[0].palette = 'blue';
  const blue = structureCollisionIndex(world);
  const dummyBlue = blue.hitboxes.find(h => h.trainingDummyId === -11);
  assert.notEqual(red, blue);
  assert.notDeepEqual({ x: dummyRed.x, y: dummyRed.y }, { x: dummyBlue.x, y: dummyBlue.y });
  assert.equal(structureCollisionIndex(world), blue);
  const temp = world.structures[0];
  world.structures[0] = world.structures[1];
  world.structures[1] = temp;
  const reordered = structureCollisionIndex(world);
  assert.deepEqual(reordered.hitboxes.filter(h => h.structureId > 0).map(h => h.structureId),
    world.structures.map(s => s.id));
});

test('source detector observes changed structure membership, IDs and kingdom identity', () => {
  const world = worldWithBuildings(), snapshot = captureStructureCollisionSources(world);
  world.kingdoms = [{ ...world.kingdoms[0] }];
  assert.equal(sameStructureCollisionSources(world, snapshot), false);
  world.kingdoms = [snapshot.kingdoms[0].ref];
  assert.equal(sameStructureCollisionSources(world, snapshot), true);
  world.structures[0].id += 1;
  assert.equal(sameStructureCollisionSources(world, snapshot), false);
  world.structures[0].id -= 1;
  world.structures.push({ id: 200, type: 'abrigo', complete: true, x: 10, y: 10 });
  assert.equal(sameStructureCollisionSources(world, snapshot), false);
});
