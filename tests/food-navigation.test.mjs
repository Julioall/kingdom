import test from 'node:test';
import assert from 'node:assert/strict';
import { PLANTS } from '../src/config/ecosystem.js';
import { createPersonSpatialIndex } from '../src/simulation/individuals/spatial-index.js';
import { bestPeopleFoodCell, moveTowardFood } from '../src/simulation/individuals/actions.js';
import { createWorld } from '../src/simulation/world/generation.js';
import { cellAt } from '../src/simulation/world/spatial.js';
import { collidesWithWorldAt, worldCollisionIndex } from '../src/simulation/physics/hitboxes.js';

test('forager approaches the interaction edge of a berry anchor blocked by its tree trunk', () => {
  const world = createWorld(42);
  world.day = 450;
  const target = cellAt(world, 64, 64);
  const berryIndex = PLANTS.findIndex(plant => plant.id === 'berry');
  const broadleafIndex = PLANTS.findIndex(plant => plant.id === 'broadleaf');

  for (let y = 61; y <= 69; y++) for (let x = 61; x <= 69; x++) {
    const tile = cellAt(world, x, y);
    tile.terrain = 'land';
    tile.slope = 0;
    tile.elevationLevel = 0;
    tile.cropFieldId = null;
    tile.goldOre = 0;
    tile.stoneDeposit = 0;
    tile.plants.fill(0);
  }
  target.plants[berryIndex] = 100;
  target.plants[broadleafIndex] = 500;

  const person = {
    id: 900001, alive: true, name: 'Ayo J', role: 'resident', ageDays: 25 * 365,
    x: 63, y: 63, kingdomId: null, communityId: null, foodReserve: 0,
    hydration: 80, energy: 100, health: 100, injury: 0, skills: { forage: .3 },
    perception: { resources: [{ x: target.x, y: target.y, distance: Math.SQRT2, terrain: 'land', slope: 0,
      biomass: { berry: 100 }, harvestableBiomass: { berry: 100 } }] }
  };
  world.people = [person];
  world.structures = [];
  world.animals = [];
  world.peopleSpatialIndex = createPersonSpatialIndex(world.people);
  world.navigationRevision = (world.navigationRevision || 0) + 1;

  const collisionIndex = worldCollisionIndex(world);
  assert.equal(collidesWithWorldAt(world, person, target.x, target.y, collisionIndex), true,
    'the berry tile itself is obstructed by the broadleaf trunk');
  assert.deepEqual(bestPeopleFoodCell(world, person, 8), target,
    'the accessible interaction point keeps the resource eligible for foraging');

  assert.equal(moveTowardFood(world, person, target), true);
  assert.notDeepEqual({ x: person.x, y: person.y }, { x: target.x, y: target.y },
    'the forager must not route into the blocked tree tile');
  assert.ok(Math.hypot(person.x - target.x, person.y - target.y) <= 1.01,
    'the first move reaches a walkable tile that touches the bush harvest mask');

  const alternate = cellAt(world, 68, 64);
  alternate.plants[berryIndex] = 100;
  person.perception.resources.push({ x: alternate.x, y: alternate.y, distance: Math.hypot(person.x - alternate.x, person.y - alternate.y),
    terrain: 'land', slope: 0, biomass: { berry: 100 }, harvestableBiomass: { berry: 100 } });
  person.failedFoodTargets = [{ x: target.x, y: target.y, untilDay: world.day }];
  assert.deepEqual(bestPeopleFoodCell(world, person, 8), alternate,
    'an unreachable resource is skipped while its short cooldown is active');
  world.day += 1;
  assert.deepEqual(bestPeopleFoodCell(world, person, 8), target,
    'failed targets are reconsidered on the next day');

  target.cropFieldId = 77;
  world.navigationRevision++;
  person.x = target.x - 3;
  person.y = target.y;
  const cropStartDistance = Math.hypot(person.x - target.x, person.y - target.y);
  assert.equal(moveTowardFood(world, person, target), true,
    'crop fields keep their direct destination routing');
  assert.ok(Math.hypot(person.x - target.x, person.y - target.y) < cropStartDistance);
});

test('a critically hungry forager commits to a patch that covers travel and its next ration', () => {
  const world = createWorld(42);
  world.day = 450;
  const berryIndex = PLANTS.findIndex(plant => plant.id === 'berry');
  for (let y = 60; y <= 68; y++) for (let x = 58; x <= 68; x++) {
    const tile = cellAt(world, x, y);
    tile.terrain = 'land';
    tile.slope = 0;
    tile.elevationLevel = 0;
    tile.cropFieldId = null;
    tile.goldOre = 0;
    tile.stoneDeposit = 0;
    tile.plants.fill(0);
  }

  const nearbyPatch = cellAt(world, 61, 64);
  const productivePatch = cellAt(world, 65, 64);
  nearbyPatch.plants[berryIndex] = 25;
  productivePatch.plants[berryIndex] = 100;
  const person = {
    id: 900002, alive: true, name: 'Ayo K', role: 'resident', ageDays: 25 * 365,
    x: 60, y: 64, kingdomId: null, communityId: null, foodReserve: 0,
    hydration: 80, energy: 0, health: 20, injury: 0, skills: { forage: 1 },
    perception: { resources: [
      { x: nearbyPatch.x, y: nearbyPatch.y, distance: 1, terrain: 'land', slope: 0,
        biomass: { berry: 1 }, harvestableBiomass: { berry: 1 } },
      { x: productivePatch.x, y: productivePatch.y, distance: 5, terrain: 'land', slope: 0,
        biomass: { berry: 100 }, harvestableBiomass: { berry: 100 } }
    ] }
  };
  world.people = [person];
  world.structures = [];
  world.animals = [];
  world.peopleSpatialIndex = createPersonSpatialIndex(world.people);
  world.navigationRevision = (world.navigationRevision || 0) + 1;

  assert.deepEqual(bestPeopleFoodCell(world, person, 8), productivePatch,
    'a nearby harvest smaller than one ration cannot beat a patch that covers travel and food');

  person.foodTarget = { x: productivePatch.x, y: productivePatch.y };
  person.perception.resources[0].harvestableBiomass.berry = 1.5;
  person.perception.resources[0].biomass.berry = 1.5;
  assert.deepEqual(bestPeopleFoodCell(world, person, 8), productivePatch,
    'a still-productive survival target is retained while the forager approaches it');

  person.perception.resources[1].harvestableBiomass.berry = 1;
  person.perception.resources[1].biomass.berry = 1;
  assert.deepEqual(bestPeopleFoodCell(world, person, 8), nearbyPatch,
    'a target that can no longer cover the survival trip is released for a fallback harvest');
});
