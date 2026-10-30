import test from 'node:test';
import assert from 'node:assert/strict';
import { PLANTS } from '../src/config/ecosystem.js';
import { dominantMetalKind } from '../src/config/mineral-deposits.js';
import { mineralHitbox, resourceCollisionIndex, collidesWithWorldPositionAt } from '../src/simulation/physics/hitboxes.js';
import { applyManualMovement } from '../src/simulation/individuals/manual-movement.js';
import { workMineralDeposit } from '../src/simulation/economy/mining.js';

function fixture() {
  const person = { id: 1, alive: true, x: 38, y: 39.75 };
  const world = { width: 128, height: 128, seed: 42, day: 0, nextId: 2, people: [person], structures: [], loot: [],
    tiles: Array.from({ length: 128 * 128 }, (_, i) => ({ i, x: i % 128, y: Math.floor(i / 128),
      terrain: 'land', elevationLevel: 0, slope: 0, plants: new Float32Array(PLANTS.length) })) };
  const tile = world.tiles[40 * 128 + 40];
  const step = (x = 1, y = 0) => applyManualMovement(world, person, { moveX: x, moveY: y, dt: .1 });
  return { world, person, tile, step };
}

test('mixed veins use the visible metal for collision instead of hidden traces of gold', () => {
  const { world, tile, person, step } = fixture();
  Object.assign(tile, { goldOre: .2, copperOre: 40, stoneDeposit: 10 });
  assert.equal(dominantMetalKind({ gold: .2, copper: 40 }), 'copper');
  assert.equal(mineralHitbox(tile).resourceKind, 'copper');
  assert.equal(resourceCollisionIndex(world).hitboxes.length, 0);
  for (let i = 0; i < 10; i++) step();
  assert.ok(person.x > 41);
});

test('visible gold still blocks entry, but an already overlapping character can move out', () => {
  const { world, tile, person, step } = fixture();
  tile.goldOre = 2;
  for (let i = 0; i < 10; i++) step();
  assert.ok(person.x < 40);
  Object.assign(person, { x: 40, y: 39.75 });
  assert.equal(collidesWithWorldPositionAt(world, person, person.x, person.y), true);
  step(); step();
  assert.ok(person.x > 40.5);
  assert.equal(collidesWithWorldPositionAt(world, person, person.x, person.y), false);
});

test('escaping one overlap cannot cross a second obstacle', () => {
  const { world, tile, person, step } = fixture();
  tile.goldOre = 2;
  world.tiles[40 * 128 + 41].goldOre = 2;
  Object.assign(person, { x: 40, y: 39.75 });
  for (let i = 0; i < 6; i++) step();
  assert.ok(person.x > 40 && person.x < 40.6);
});

test('sheltered and tower-mounted people do not create invisible ground collisions', () => {
  for (const hiddenState of [{ restingStructureId: 3 }, { towerMounted: true }]) {
    const { world, person, step } = fixture();
    world.people.push({ id: 2, alive: true, x: 38.4, y: person.y, ...hiddenState });
    step();
    assert.ok(person.x > 38.3);
  }
});

test('visible people block new overlaps while allowing an existing overlap to separate', () => {
  const { world, person, step } = fixture();
  world.people.push({ id: 2, alive: true, x: 38.4, y: person.y });
  step();
  assert.equal(person.x, 38);
  step(-1);
  assert.ok(person.x < 38);
});

test('an exhausted vein immediately releases its cached collision', () => {
  const { world, tile, person, step } = fixture();
  tile.goldOre = 2;
  assert.equal(resourceCollisionIndex(world).hitboxes.length, 1);
  workMineralDeposit(world, tile, 'gold', 2);
  assert.equal(resourceCollisionIndex(world).hitboxes.length, 0);
  for (let i = 0; i < 10; i++) step();
  assert.ok(person.x > 41);
});
