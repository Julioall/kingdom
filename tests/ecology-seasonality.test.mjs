import test from 'node:test';
import assert from 'node:assert/strict';
import engine from '../src/simulation/engine.js';
import { PLANTS } from '../src/config/ecosystem.js';
import { calendarDate, updateClimate } from '../src/simulation/ecology/climate.js';
import { updatePlants } from '../src/simulation/ecology/plants.js';

const seasonDays = [7, 98, 196, 287];

test('regional climate is identical across seasons while the presentation calendar changes', () => {
  const snapshots = seasonDays.map(day => {
    const world = engine.createWorld(42);
    const result = updateClimate(world, day);
    return {
      season: result.season,
      regions: world.regions.map(region => ({
        temperatureC: region.temperatureC,
        rainfallMm: region.rainfallMm,
        humidity: region.humidity,
        weather: region.weather,
        dryDays: region.dryDays
      }))
    };
  });

  assert.deepEqual(snapshots.map(snapshot => snapshot.season), [0, 1, 2, 3]);
  for (const snapshot of snapshots.slice(1)) assert.deepEqual(snapshot.regions, snapshots[0].regions);
  assert.deepEqual(seasonDays.map(day => calendarDate(day).season), [0, 1, 2, 3]);
});

function regrowthAt(day) {
  const world = engine.createWorld(42);
  const rootIndex = PLANTS.findIndex(plant => plant.id === 'cultivated-root');
  const browseIndex = PLANTS.findIndex(plant => plant.id === 'browse');
  const land = world.tiles.filter(tile => tile.terrain === 'land');
  const rootTile = land[0];
  const browseTile = land[land.length - 1];

  rootTile.cropFieldId = 91001;
  rootTile.plants.fill(0);
  rootTile.plants[rootIndex] = 50;
  rootTile.plantResourceMask = 1 << rootIndex;
  browseTile.plants.fill(0);
  browseTile.plants[browseIndex] = 40;
  browseTile.plantResourceMask = 1 << browseIndex;

  updatePlants(world, day);
  return [rootTile.plants[rootIndex], browseTile.plants[browseIndex]];
}

test('root and sheep-browse regrowth use annual mean rates in every season', () => {
  const results = seasonDays.map(regrowthAt);
  for (const result of results.slice(1)) assert.deepEqual(result, results[0]);

  assert.equal(PLANTS.find(plant => plant.id === 'cultivated-root').growth, 5.625);
  assert.equal(PLANTS.find(plant => plant.id === 'browse').growth, .1215);
  assert.equal('seasonalGrowth' in PLANTS.find(plant => plant.id === 'cultivated-root'), false);
  assert.equal('seasonalGrowth' in PLANTS.find(plant => plant.id === 'browse'), false);
});
