import test from 'node:test';
import assert from 'node:assert/strict';
import engine from '../src/simulation/engine.js';
import { createPersonSpatialIndex } from '../src/simulation/individuals/spatial-index.js';
import { localSteering, chooseSteeredTile }
  from '../src/simulation/individuals/steering-boids.js';
import { moveOne } from '../src/simulation/individuals/movement.js';
import { cellAt } from '../src/simulation/world/spatial.js';

const sheep = (id, x, y) => ({id, alive: true, speciesId: 'sheep',
  x, y, ageDays: 300, herdCommunityId: null, herdPenId: null, beingLedBy: null,
  headingX: 1, headingY: 0, energy: 90, massKg: 25, hydration: 80});

test('Boids uses a bounded local spatial index, not a world-wide all-pairs pass', () => {
  const animals = [sheep(1, 10, 10), sheep(2, 11, 10), sheep(3, 10, 11)];
  for (let id = 4; id <= 2004; id++) animals.push(sheep(id, 500 + id * 5, 500));
  const world = { animals, animalsSpatialIndex: createPersonSpatialIndex(animals) };
  const direction = localSteering(world, animals[0], {x: 20, y: 10});
  assert.equal(direction.neighbors, 2);
  assert.equal(direction.groupNeighbors, 2);
  assert.ok(Number.isFinite(direction.x) && Number.isFinite(direction.y));
  assert.ok(Math.hypot(direction.x, direction.y) <= 1.000001);
  assert.equal(localSteering(world, animals[900], {x: animals[900].x + 1, y: 500}),
    null, 'distant animal has no local neighbours');
});

test('sheep steer around a sheep-occupied next tile without breaking forward progress', () => {
  const actor = sheep(1, 10, 10), neighbor = sheep(2, 11, 10);
  const world = {animals: [actor, neighbor],
    animalsSpatialIndex: createPersonSpatialIndex([actor, neighbor])};
  const destination = {x: 16, y: 10};
  const choice = chooseSteeredTile(world, actor, actor, destination,
    [{x: 11, y: 10}, {x: 11, y: 11}, {x: 10, y: 11}]);
  assert.deepEqual(choice, {x: 11, y: 11});
  assert.equal(chooseSteeredTile(world, actor, actor, destination,
    [{x: 11, y: 10}]), null, 'no overlap when only forward option is occupied');
});

test('without neighbours steering leaves the legacy grid direction untouched', () => {
  const actor = sheep(1, 1, 1);
  const world = {animals: [actor]};
  assert.equal(localSteering(world, actor, {x: 10, y: 1}), null);
  assert.equal(chooseSteeredTile(world, actor, actor, {x: 10, y: 1},
    [{x: 2, y: 1}]), undefined);
});

test('civilian separation and soldier alignment have distinct flocking rules', () => {
  const civilian = {id: 1, x: 10, y: 10, alive: true, role: 'resident'};
  const soldier = {id: 2, x: 11, y: 10, alive: true, role: 'soldier',
    kingdomId: 1, campaignId: 7, headingX: 0, headingY: 1};
  const comrade = {id: 3, x: 10, y: 11, alive: true, role: 'soldier',
    kingdomId: 1, campaignId: 7, headingX: 0, headingY: 1};
  const world = {people: [civilian, soldier, comrade],
    peopleSpatialIndex: createPersonSpatialIndex([civilian, soldier, comrade])};
  assert.equal(localSteering(world, civilian, {x: 15, y: 10}).groupNeighbors, 0);
  assert.equal(localSteering(world, soldier, {x: 15, y: 10}).groupNeighbors, 1);
});

test('real movement uses safe grid steps, not continuous teleportation through obstacles', () => {
  const world = engine.createWorld(304);
  for (const tile of world.tiles) {
    tile.terrain = 'rock';
    tile.stoneDeposit = 0; tile.goldOre = 0;
    tile.plants.fill(0);
    tile.elevationLevel = 0; tile.rampLevel = 0; tile.slope = 0;
    tile.kingdomId = null;
  }
  for (const [x, y] of [[30, 40], [30, 39], [31, 40], [31, 39], [32, 39],
    [32, 40], [33, 40], [34, 40], [35, 40]])
    cellAt(world, x, y).terrain = 'land';
  const actor = sheep(10001, 30, 40), blocker = sheep(10002, 31, 40);
  world.people = []; world.animals = [actor, blocker]; world.structures = [];
  world.neuralOverrides = {...world.neuralOverrides, steeringBoids: true};
  world.animalsSpatialIndex = createPersonSpatialIndex(world.animals);
  const before = structuredClone({x: actor.x, y: actor.y});
  assert.equal(moveOne(world, actor, cellAt(world, 35, 40), false), true);
  assert.deepEqual({x: actor.x, y: actor.y}, {x: 31, y: 39});
  assert.ok(Math.hypot(actor.x - before.x, actor.y - before.y) <= Math.SQRT2);
  assert.notDeepEqual({x: actor.x, y: actor.y}, {x: blocker.x, y: blocker.y});
});

test('local steering never consumes RNG or mutates agent state', () => {
  const a = sheep(1, 10, 10), b = sheep(2, 10, 11);
  const world = {rngState: 99, animals: [a, b],
    animalsSpatialIndex: createPersonSpatialIndex([a, b])};
  const snapshot = structuredClone(a);
  const first = chooseSteeredTile(world, a, a, {x: 16, y: 10},
    [{x: 11, y: 10}, {x: 11, y: 11}]);
  const second = chooseSteeredTile(world, a, a, {x: 16, y: 10},
    [{x: 11, y: 10}, {x: 11, y: 11}]);
  assert.deepEqual(first, second);
  assert.deepEqual(a, snapshot);
  assert.equal(world.rngState, 99);
});
