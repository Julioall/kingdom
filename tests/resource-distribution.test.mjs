import test from 'node:test';
import assert from 'node:assert/strict';
import { PLANTS } from '../src/config/ecosystem.js';
import { updatePlants } from '../src/simulation/ecology/plants.js';
import { resourceUsePressure, updateRoadWear } from '../src/simulation/world/roads.js';

function ecologyWorld(seed = 42) {
  const width = 128, height = 128;
  const tiles = Array.from({ length: width * height }, (_, i) => ({
    i,
    x: i % width,
    y: Math.floor(i / width),
    terrain: 'land',
    soilType: 'loam',
    soilWaterMm: 50,
    soilCapacityMm: 100,
    temperatureC: 18,
    slope: 0,
    roadWear: 0,
    peoplePresence: 0,
    civilizationPressure: 0,
    plantResourceMask: 0,
    plants: new Float32Array(PLANTS.length)
  }));
  return { seed, width, height, day: 0, tiles, people: [], structures: [], ecologyFlows: {} };
}

function tileAt(world, x, y) {
  return world.tiles[y * world.width + x];
}

test('footpaths, residents, buildings, and active construction create resource-use pressure', () => {
  const world = ecologyWorld();
  tileAt(world, 20, 20).roadWear = 20;
  world.people.push({ alive: true, x: 40, y: 40 });
  world.structures.push(
    { type: 'abrigo', x: 80, y: 80, complete: true },
    { type: 'roça', x: 60, y: 60, complete: false }
  );

  updateRoadWear(world);

  assert.ok(resourceUsePressure(tileAt(world, 20, 20)) > .75, 'a worn path should count as a high-use area');
  assert.ok(resourceUsePressure(tileAt(world, 40, 40)) > .25, 'recent character movement should affect nearby tiles');
  assert.ok(resourceUsePressure(tileAt(world, 60, 60)) > .5, 'an active construction site should affect its surroundings');
  assert.ok(resourceUsePressure(tileAt(world, 80, 80)) > .7, 'a completed settlement should retain its use zone');
  assert.equal(resourceUsePressure(tileAt(world, 110, 110)), 0, 'remote tiles should remain low-use');
});

test('wild food regrows faster and spreads into suitable low-use land', () => {
  const world = ecologyWorld();
  const berryIndex = PLANTS.findIndex(plant => plant.id === 'berry');
  const sourceMask = 1 << berryIndex;
  const busy = tileAt(world, 30, 30), remote = tileAt(world, 90, 90);
  for (const tile of [busy, remote]) {
    tile.plants[berryIndex] = 50;
    tile.plantResourceMask = sourceMask;
  }
  busy.civilizationPressure = 1;

  updatePlants(world, 7);

  assert.ok(remote.plants[berryIndex] - 50 > busy.plants[berryIndex] - 50,
    'low-use land should receive a stronger natural recovery rate');
  const dispersed = world.tiles.filter(tile => tile !== busy && tile !== remote
    && (tile.plantResourceMask & sourceMask) && tile.plants[berryIndex] >= 16);
  assert.ok(dispersed.length > 0, 'wild berry plants should disperse into vacant patches');
  assert.ok(dispersed.every(tile => resourceUsePressure(tile) <= .28),
    'new patches should appear only in lightly visited areas');
});

