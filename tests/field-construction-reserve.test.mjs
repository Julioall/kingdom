import test from 'node:test';
import assert from 'node:assert/strict';
import engine from '../src/simulation/engine.js';
import { assignCommunityTasks, assignKingdomFieldPreparationTasks, taskForCommunity } from '../src/simulation/society/governance.js';
import {
  canGatherFoodFieldMaterialsWithReserve, canWorkOnFoodFieldWithReserve, hasConstructionFoodReserve,
  nextCommunityStructure, communityStructures
} from '../src/simulation/settlements/construction.js';
import { kingdomStrategyChoices, observeKingdomStrategy, planKingdomStrategy } from '../src/simulation/kingdoms/strategy.js';

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
  Object.assign(worker, { foodReserve: 9, hydration: 80, energy: 25, health: 100, buildCooldown: 0 });

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
  worker.foodReserve = 9;
  worker.energy = 24;
  assert.equal(taskForCommunity(world, community, members)?.action, 'forage',
    'the policy lets the builder rest once energy reaches the recovery threshold');
});

test('the low-reserve construction exception does not apply to other buildings', () => {
  const tower = { id: 99503, type: 'torre', complete: false };
  const person = { foodReserve: 23 };
  assert.equal(hasConstructionFoodReserve(person, tower), false);
  assert.equal(hasConstructionFoodReserve({ foodReserve: 24 }, tower), true);
  assert.equal(canWorkOnFoodFieldWithReserve(person, { action: 'build', goal: 'complete-funded-project', structureId: tower.id },
    { structures: [tower] }), false);
  assert.equal(canGatherFoodFieldMaterialsWithReserve(person, { action: 'gather', goal: 'gather-construction-materials' }), false);
  assert.equal(canGatherFoodFieldMaterialsWithReserve({ foodReserve: 9 }, { action: 'gather', goal: 'prepare-cultivated-field' }), true);
});

test('a kingdom prioritizes its first field and reserves one gatherer while food is low', () => {
  const world = engine.createWorld(42);
  const community = world.communities[0];
  const kingdom = world.kingdoms.find(item => item.id === community.kingdomId);
  const members = world.people.filter(person => person.alive && person.communityId === community.id);
  const leader = members.find(person => person.id === kingdom.rulerId) || members[0];
  const worker = members.find(person => person.id !== leader.id && person.role !== 'soldier' && person.ageDays >= 12 * 365);

  assert.equal(nextCommunityStructure(world, community, members.length, communityStructures(world, community)).type, 'roça');
  const report = observeKingdomStrategy(world, kingdom.id);
  assert.equal(report.community.buildPlan.type, 'roça');
  assert.equal(planKingdomStrategy(report).goal, 'prepare-cultivated-field');
  assert.ok(kingdomStrategyChoices(report).some(choice => choice.goal === 'prepare-cultivated-field'));

  for (const person of members) person.assignment = null;
  Object.assign(worker, {
    foodReserve: 9, energy: 20, hydration: 35, health: 100, buildCooldown: 0,
    perception: { ...(worker.perception || {}), resources: [{ visible: true, terrain: 'land', stone: 10,
      goldOre: 0, biomass: { broadleaf: 500, conifer: 0 } }] }
  });
  assert.equal(assignKingdomFieldPreparationTasks(world, community, leader, members), 1);
  assert.equal(worker.assignment.action, 'gather');
  assert.equal(worker.assignment.goal, 'prepare-cultivated-field');
  assert.equal(canGatherFoodFieldMaterialsWithReserve(worker, worker.assignment), true);
});

test('a kingdom with no eligible civilian worker cannot assign field preparation or spend materials', () => {
  const world = engine.createWorld(42);
  const community = world.communities[0];
  const members = world.people.filter(person => person.alive && person.communityId === community.id);
  const leader = members[0];
  assert.ok(members.length >= 2);
  for (const person of members) {
    person.role = 'soldier';
    person.assignment = null;
  }
  Object.assign(community.stores, { wood: 0, stone: 0, food: 0, seeds: 0 });
  assert.equal(nextCommunityStructure(world, community, members.length, communityStructures(world, community)).type, 'roça');
  const stocksBefore = structuredClone(community.stores);
  const structuresBefore = world.structures.length;

  const assigned = assignKingdomFieldPreparationTasks(world, community, leader, members);

  assert.equal(assigned, 0);
  assert.equal(world.structures.length, structuresBefore);
  assert.deepEqual(community.stores, stocksBefore);
  assert.ok(members.every(person => person.assignment?.goal !== 'prepare-cultivated-field'));
});
