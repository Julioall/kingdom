import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../src/simulation/engine.js';

test('kingdom communities start and advance a roça despite food-priority assignments', () => {
  const world = Sim.createWorld(42);
  for (let day = 0; day < 120; day++) Sim.stepDay(world, { includeSnapshot: false });

  const farms = world.structures.filter(structure => structure.type === 'roça'
    && structure.communityId != null && structure.destroyedDay == null);
  assert.ok(farms.length > 0, 'the deterministic kingdom simulation should create a roça');
  assert.ok(farms.some(farm => farm.progress > 0), 'at least one roça should receive construction work');
});
