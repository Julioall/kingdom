import test from 'node:test';
import assert from 'node:assert/strict';
import { nextCommunityStructure as fromExecution }
  from '../src/simulation/settlements/construction.js';
import { nextCommunityStructure as fromPlanner }
  from '../src/simulation/settlements/building-plan.js';

test('existing public import remains the same pure planning function', () => {
  assert.equal(fromExecution, fromPlanner);
  const world = {};
  const community = { id: 8, isKingdomGroup: true };
  const before = structuredClone(community);
  const plan = fromPlanner(world, community, 6, []);
  assert.deepEqual(plan, { type: 'roça', woodCost: 16, stoneCost: 6,
    foodCost: 0, seedMass: 8, required: 34 });
  assert.deepEqual(community, before);
});

test('project proposal is blocked by an already pending construction', () => {
  const pending = [{ type: 'abrigo', complete: false }];
  assert.deepEqual(fromPlanner({}, { id: 8, isKingdomGroup: true }, 6, pending),
    { type: 'ongoing', woodCost: 0, stoneCost: 0, foodCost: 0 });
});

test('construction priority remains farm, shelter, pen and collection post', () => {
  const world = {}, c = { id: 8, isKingdomGroup: false };
  const shelter = { type: 'abrigo', complete: true };
  const farm = { type: 'roça', complete: true };
  const pen = { type: 'curral', complete: true };
  assert.equal(fromPlanner(world, c, 3, []).type, 'abrigo');
  assert.equal(fromPlanner(world, c, 6, [shelter]).type, 'roça');
  assert.equal(fromPlanner(world, c, 6, [shelter, farm]).type, 'curral');
  // The herd service is consulted only after the basic farm/pen priorities.
  assert.equal(fromPlanner(world, c, 6, [shelter, farm]).required, 34);
});
