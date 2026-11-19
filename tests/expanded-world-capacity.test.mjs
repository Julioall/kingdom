import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/simulation/world/generation.js';
import { WIDTH, HEIGHT, MAX_SUPPORTED_POPULATION } from '../src/config/ecosystem.js';

test('expanded terrain retains integral regional tiling and two valid settlements', () => {
  assert.equal(WIDTH, 160);
  assert.equal(HEIGHT, 160);
  assert.equal(WIDTH % 8, 0);
  const world = createWorld(42);
  assert.equal(world.width * world.height, 25600);
  assert.equal(world.people.length, 96,
    'tests and baseline simulations keep their historical controlled scale');
  assert.equal(world.initialPopulationTarget, 96);
  assert.equal(world.kingdoms.length, 2);
});

test('initial population is bounded to the tested 5k stress ceiling', () => {
  assert.equal(MAX_SUPPORTED_POPULATION, 5000);
  assert.throws(() => createWorld(42, { initialPopulation: 5002 }), RangeError);
  assert.throws(() => createWorld(42, { initialPopulation: 97 }), RangeError);
  assert.throws(() => createWorld(42, { initialPopulation: 95 }), RangeError);
  assert.throws(() => createWorld(42, { initialPopulation: NaN }), RangeError);
});
