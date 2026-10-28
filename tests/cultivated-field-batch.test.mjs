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

test('a field with no seed reserve stays unplanted and creates no food', () => {
  const world = engine.createWorld(42);
  const community = world.communities[0];
  community.stores.food = 0;
  const tiles = world.tiles.filter(tile => tile.terrain === 'land' && tile.cropFieldId == null).slice(0, 24);
  const tileStateBefore = tiles.map(tile => ({ cropFieldId: tile.cropFieldId, plants: Array.from(tile.plants) }));
  const field = { id: 99500, type: 'roça', communityId: community.id, complete: true,
    fieldTileIndices: tiles.map(tile => tile.i), seedMass: 8, cropSeedStored: 0, cropCycleState: 'spent' };
  world.structures.push(field);

  assert.equal(sowCommunityField(world, field), 0);

  assert.equal(community.stores.food, 0);
  assert.equal(field.cropCycleState, 'spent');
  assert.equal(field.cropYieldTarget, undefined);
  assert.equal(field.cropGrowthGenerated, undefined);
  assert.deepEqual(tiles.map(tile => ({ cropFieldId: tile.cropFieldId, plants: Array.from(tile.plants) })), tileStateBefore);
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
  assert.equal(workOnReplantingField(world, workers[0], community, field.id), false,
    'the farmer cannot withdraw seeds remotely while standing at the field');
  assert.equal(community.stores.seeds, 4, 'stock remains at storage until physical pickup');
  const seedStorage = world.structures.find(s => s.complete && s.communityId === community.id
    && ['vila', 'abrigo', 'posto de coleta'].includes(s.type) && s.destroyedDay == null);
  assert.ok(seedStorage);
  workers[0].x = seedStorage.x;
  workers[0].y = seedStorage.y;
  assert.equal(workOnReplantingField(world, workers[0], community, field.id), false,
    'pickup creates an owned courier load, not an instant crop');
  assert.equal(community.stores.seeds, 0, 'the exact seed mass leaves shared stock at the storage building');
  assert.equal(workers[0].carriedCommunitySeeds, 4);
  assert.equal(workers[0].seedCargoFieldId, field.id);
  workers[0].x = fieldTile.x;
  workers[0].y = fieldTile.y;
  assert.equal(workOnReplantingField(world, workers[0], community, field.id), true,
    'sowing begins only after the worker physically delivers the reserved lot to the field');
  assert.equal(workers[0].carriedCommunitySeeds, 0);
  assert.equal(field.cropYieldTarget, 5_000, 'the next crop scales down with the smaller seed lot');
  assert.equal(field.cropCycleState, 'growing');
  assert.equal(completeCommunityTask(world, workers[0], 'build', { buildProgress: 34 }, { buildProgress: 34 }), true,
    'the assigned replant task completes only after sowing the field');
});
