import { PLANTS, REGION_SIDE } from '../src/config/ecosystem.js';
import { seasonIndex, updateClimate } from '../src/simulation/ecology/climate.js';
import { updatePlants } from '../src/simulation/ecology/plants.js';

const WIDTH = 128;
const HEIGHT = 128;

function climateWorld() {
  const tiles = Array.from({ length: WIDTH * HEIGHT }, (_, i) => {
    const x = i % WIDTH;
    const y = Math.floor(i / WIDTH);
    return {
      i, x, y,
      regionId: Math.floor(y / REGION_SIDE) * (WIDTH / REGION_SIDE) + Math.floor(x / REGION_SIDE),
      terrain: 'land', heightM: 0, temperatureC: 20, rainfallMm: 0,
    };
  });
  const regions = Array.from({ length: (WIDTH / REGION_SIDE) ** 2 }, (_, id) => ({
    id, meanMoisture: 0.4, dryDays: 0, temperatureC: 20,
    rainfallMm: 0, humidity: 0.55, weather: 'stable',
  }));
  return {
    seed: 42, rngState: 93241, width: WIDTH, height: HEIGHT, tiles, regions,
    day: 0, lastWeatherEvent: Number.MAX_SAFE_INTEGER, rainEvents: 0, droughtUntil: 0,
  };
}

function plantWorld() {
  const width = 16;
  const height = 16;
  const tiles = Array.from({ length: width * height }, (_, i) => ({
    i, x: i % width, y: Math.floor(i / width), terrain: 'land', soilType: 'loam',
    soilWaterMm: 50, soilCapacityMm: 100, temperatureC: 20, slope: 0,
    roadWear: 0, peoplePresence: 0, civilizationPressure: 0,
    plantResourceMask: 0, plants: new Float32Array(PLANTS.length), cropFieldId: null,
  }));
  return { seed: 42, width, height, tiles, people: [], structures: [], ecologyFlows: {} };
}

const springWorld = climateWorld();
const summerWorld = structuredClone(springWorld);
const springWeather = updateClimate(springWorld, 91);
const summerWeather = updateClimate(summerWorld, 92);
const climateState = region => ({
  temperatureC: region.temperatureC,
  rainfallMm: region.rainfallMm,
  humidity: region.humidity,
  weather: region.weather,
  dryDays: region.dryDays,
});
const climateMismatchCount = springWorld.regions.filter((region, i) =>
  JSON.stringify(climateState(region)) !== JSON.stringify(climateState(summerWorld.regions[i]))).length;

const rootIndex = PLANTS.findIndex(plant => plant.id === 'cultivated-root');
const browseIndex = PLANTS.findIndex(plant => plant.id === 'browse');
const earlyPlants = plantWorld();
const latePlants = plantWorld();
const earlyCrop = earlyPlants.tiles[8 * earlyPlants.width + 8];
const lateCrop = latePlants.tiles[8 * latePlants.width + 8];
for (const crop of [earlyCrop, lateCrop]) {
  crop.cropFieldId = 1;
  crop.plantResourceMask = 1 << rootIndex;
  crop.plants[rootIndex] = 30;
}
const earlyBrowse = earlyPlants.tiles[9 * earlyPlants.width + 8];
const lateBrowse = latePlants.tiles[9 * latePlants.width + 8];
for (const tile of [earlyBrowse, lateBrowse]) {
  tile.plantResourceMask |= 1 << browseIndex;
  tile.plants[browseIndex] = 30;
}
updatePlants(earlyPlants, 7);
updatePlants(latePlants, 98);

console.log(JSON.stringify({
  pairedSeed: 42,
  climate: {
    day91Season: springWeather.season,
    day92Season: summerWeather.season,
    day91MeanRain: springWeather.meanRain,
    day92MeanRain: summerWeather.meanRain,
    mismatchedRegions: climateMismatchCount,
  },
  weeklyGrowth: {
    day7Season: seasonIndex(7),
    day98Season: seasonIndex(98),
    cultivatedRootDay7: earlyCrop.plants[rootIndex] - 30,
    cultivatedRootDay98: lateCrop.plants[rootIndex] - 30,
    sheepBrowseDay7: earlyBrowse.plants[browseIndex] - 30,
    sheepBrowseDay98: lateBrowse.plants[browseIndex] - 30,
  },
}, null, 2));
