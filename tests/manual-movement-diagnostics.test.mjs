import test from 'node:test';
import assert from 'node:assert/strict';
import { PLANTS } from '../src/config/ecosystem.js';
import { applyManualMovement } from '../src/simulation/individuals/manual-movement.js';
import { canTraverseElevation } from '../src/simulation/world/island-terrain.js';

function makeWorld(person) {
  const tiles = Array.from({ length: 128 * 128 }, (_, i) => ({ i, x: i % 128, y: Math.floor(i / 128),
    terrain: 'land', elevationLevel: 0, slope: 0, plants: new Float32Array(PLANTS.length) }));
  return { width: 128, height: 128, tiles, people: [person], structures: [], loot: [] };
}

test('manual movement diagnostic distinguishes nearby characters from terrain elevation', () => {
  const person = { id: 1, alive: true, playerControlled: true, x: 38, y: 39.75 };
  const world = makeWorld(person);
  world.people.push({ id: 2, alive: true, x: 38.5, y: person.y });
  applyManualMovement(world, person, { moveX: 1, moveY: 0, dt: .1 });
  assert.equal(person.playerMovementBlockedReason, 'person');

  world.people.pop();
  person.x = 38.4;
  world.tiles[40 * 128 + 39].elevationLevel = 1;
  applyManualMovement(world, person, { moveX: 1, moveY: 0, dt: .1 });
  assert.equal(person.playerMovementBlockedReason, 'elevation');
});

test('both visible rows of a two-tile ramp allow crossing the elevation edge', () => {
  const lower = { x: 38, y: 41, elevationLevel: 0, rampSide: 1, rampLevel: 1, rampSegment: 2 };
  const upper = { x: 39, y: 41, elevationLevel: 1 };
  assert.equal(canTraverseElevation(upper, lower), true);
  assert.equal(canTraverseElevation(lower, upper), true);

  const person = { id: 3, alive: true, x: 38.864, y: 40.75 };
  const world = makeWorld(person);
  Object.assign(world.tiles[41 * 128 + 38], lower);
  Object.assign(world.tiles[41 * 128 + 39], upper);
  applyManualMovement(world, person, { moveX: -1, moveY: 0, dt: .12 });
  assert.ok(person.x < 38.5, 'the controlled actor should cross through the lower ramp segment');
  assert.equal(person.playerMovementBlockedReason, null);
});
