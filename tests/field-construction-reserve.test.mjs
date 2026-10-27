import test from 'node:test';
import assert from 'node:assert/strict';
import engine from '../src/simulation/engine.js';
import { assignCommunityTasks, taskForCommunity } from '../src/simulation/society/governance.js';
import {
  canWorkOnFoodFieldWithReserve, hasConstructionFoodReserve
} from '../src/simulation/settlements/construction.js';

test('a funded field project can keep one builder working above the critical food floor', () => {
  const world = engine.createWorld(42);
  const community = world.communities[0];
  const members = world.people.filter(person => person.alive && person.communityId === community.id);
  const leader = members[0];
  const worker = members.find(person => person.id !== leader.id && person.role !== 'soldier' && person.ageDays >= 12 * 365);
  assert.ok(worker);

  const field = { id: 99502, type: 'roça', communityId: community.id, complete: false,
    x: worker.x, y: worker.y, radius: 2, progress: 33, required: 34, lastProgressDay: world.day - 1 };
  world.structures.push(field);
  community.stores.food = 0;
  community.stores.wood = 100;
  community.stores.stone = 100;
  for (const person of members) {
    person.assignment = null;
    person.foodReserve = 0;
  }
  Object.assign(worker, { foodReserve: 9, hydration: 80, energy: 90, health: 100, buildCooldown: 0 });

  const task = taskForCommunity(world, community, members);
  assert.equal(task?.goal, 'invest-in-cultivated-food');
  assignCommunityTasks(world, community, leader, members, task, false);

  assert.equal(worker.assignment?.action, 'build', 'the builder stays assigned while other residents handle urgent food');
  assert.equal(canWorkOnFoodFieldWithReserve(worker, worker.assignment, world), true);
  assert.equal(hasConstructionFoodReserve(worker, field), true);
  worker.foodReserve = 8;
  assert.equal(canWorkOnFoodFieldWithReserve(worker, worker.assignment, world), false,
    'critical hunger still interrupts construction for immediate survival');
  assert.equal(hasConstructionFoodReserve(worker, field), false);
});

test('the low-reserve construction exception does not apply to other buildings', () => {
  const tower = { id: 99503, type: 'torre', complete: false };
  const person = { foodReserve: 23 };
  assert.equal(hasConstructionFoodReserve(person, tower), false);
  assert.equal(hasConstructionFoodReserve({ foodReserve: 24 }, tower), true);
  assert.equal(canWorkOnFoodFieldWithReserve(person, { action: 'build', goal: 'complete-funded-project', structureId: tower.id },
    { structures: [tower] }), false);
});
