import test from 'node:test';
import assert from 'node:assert/strict';
import engine from '../src/simulation/engine.js';

test('crowded passage requests cannot recurse indefinitely during movement', () => {
  const world = engine.createWorld(1);

  assert.doesNotThrow(() => {
    for (let day = 1; day <= 125; day++) engine.stepDay(world, { includeSnapshot: false });
  });
  assert.equal(world.day, 125);
});
