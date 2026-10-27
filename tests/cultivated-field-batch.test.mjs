import test from 'node:test';
import assert from 'node:assert/strict';
import engine from '../src/simulation/engine.js';
import { PLANTS } from '../src/config/ecosystem.js';
import { collectFoodForCommunity } from '../src/simulation/individuals/actions.js';
import { cultivatedFieldStandingBiomass, cultivatedFieldYieldTarget, sowCommunityField, updatePlants } from '../src/simulation/ecology/plants.js';
import { workOnReplantingField } from '../src/simulation/settlements/construction.js';
import { completeCommunityTask } from '../src/simulation/society/governance.js';

test('a field batch is bounded by both planted seed mass and occupied area', () => {
  assert.equal(cultivatedFieldYieldTarget(8, 24), 10_000);
  assert.equal(cultivatedFieldYieldTarget(8, 10), 4_200, 'a smaller planted area yields less');
  assert.equal(cultivatedFieldYieldTarget(4, 24), 5_000, 'half the seed mass yields half the batch');
  assert.equal(cultivatedFieldYieldTarget(12, 24), 10_080, 'more seed cannot exceed the occupied tile capacity');
  assert.equal(cultivatedFieldYieldTarget(0, 24), 0);
});

test('a mature field can be collected as one finite batch and stays visually empty afterward', () => {
  const world = engine.createWorld(42);
  const community = world.communities[0];
  community.stores.food = 0;
  community.stores.meat = 0;
  const workers = world.people.filter(person => person.alive && person.communityId === community.id && person.role !== 'soldier').slice(0, 4);
  assert.equal(workers.length, 4);
  const cropIndex = PLANTS.findIndex(plant => plant.id === 'cultivated-root');
  const tiles = world.tiles.filter(tile => tile.terrain === 'land' && tile.cropFieldId == null).slice(0, 24);
  assert.equal(tiles.length, 24);
  const field = { id: 99501, type: 'roça', communityId: community.id, complete: true,
    fieldTileIndices: tiles.map(tile => tile.i), seedMass: 8, cropSeedStored: 8 };
  world.structures.push(field);
  field.cropSeedStored = 8;
  assert.equal(sowCommunityField(world, field), 8);
  assert.equal(field.cropYieldTarget, 10_000);

  for (let day = 7; day <= 140 && field.cropCycleState === 'growing'; day += 7) updatePlants(world, day);
  assert.equal(field.cropCycleState, 'ready');
  assert.ok(field.cropGrowthGenerated <= field.cropYieldTarget + .01);
  assert.ok(Math.abs(cultivatedFieldStandingBiomass(world, field) - field.cropYieldTarget) < .05);
  const fieldTile = world.tiles[field.fieldTileIndices[0]];
  for (const worker of workers) {
    worker.x = fieldTile.x;
    worker.y = fieldTile.y;
    worker.carriedFood = 0;
  }

  const collected = workers.reduce((sum, worker) => sum + collectFoodForCommunity(world, worker, fieldTile), 0);

  assert.ok(Math.abs(collected - field.cropYieldTarget) < .05, 'the four-person harvest team delivers the entire standard batch');
  assert.ok(Math.abs(community.stores.food - (field.cropYieldTarget - 8)) < .05,
    'the shared store receives the harvest after reserving the next lot of seeds');
  assert.ok(Math.abs(field.foodDelivered - (field.cropYieldTarget - 8)) < .05);
  assert.equal(community.stores.seeds, 8);
  assert.equal(field.cropSeedsRetainedThisCycle, 8);
  assert.equal(field.cropCycleState, 'spent');
  assert.ok(field.fieldTileIndices.every(index => world.tiles[index].plants[cropIndex] <= .01));
  assert.ok(cultivatedFieldStandingBiomass(world, field) <= .01);

  updatePlants(world, 147);
  assert.ok(field.fieldTileIndices.every(index => world.tiles[index].plants[cropIndex] <= .01),
    'a spent field does not regrow before a new sowing');

  community.stores.seeds = 4;
  workers[0].assignment = { source: 'kingdom-strategy', action: 'build', goal: 'replant-cultivated-food',
    communityId: community.id, expiresDay: world.day + 10, foodFieldId: field.id };
  assert.equal(workOnReplantingField(world, workers[0], community, field.id), true,
    'a resident can replant the spent field from the reserved community seed stock');
  assert.equal(community.stores.seeds, 0, 'planting debits the exact seed mass from shared stock');
  assert.equal(field.cropYieldTarget, 5_000, 'the next crop scales down with the smaller seed lot');
  assert.equal(field.cropCycleState, 'growing');
  assert.equal(completeCommunityTask(world, workers[0], 'build', { buildProgress: 34 }, { buildProgress: 34 }), true,
    'the assigned replant task completes only after sowing the field');
});
