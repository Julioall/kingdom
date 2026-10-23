import { HEIGHT, PLANTS, REGION_SIDE, WIDTH } from '../../config/ecosystem.js';
import { idx } from './spatial.js';
import { hash01 } from '../core/math.js';
import { plantBiomass, seedPlants } from '../ecology/plants.js';
import { seedAnimals } from '../ecology/animals.js';
import { addIndividuals } from '../individuals/lifecycle.js';
import { refreshHarvestSuitability } from './queries.js';
import { log } from '../core/events.js';
import { rand } from '../core/random.js';
import { initializeKingdoms, INITIAL_SOLDIERS_PER_KINGDOM, updateKingdomMarkets } from '../kingdoms/initialization.js';
import { recruitKingdomSoldier } from '../kingdoms/commands.js';

export function createWorld(seed) {
    const cleanSeed = (Number(seed) >>> 0) || 1;
    const w = {
      seed: cleanSeed, width: WIDTH, height: HEIGHT, day: 0, year: 1, season: 0, rngState: cleanSeed,
      nextId: 1, tiles: [], regions: [], animals: [], people: [], communities: [], kingdoms: [], structures: [], settlements: [], logs: [], lake: null, lakes: [],
      market: { gold: 240, food: 110, feed: 64, wood: 90, stone: 72, sheep: 4, transactions: 0 },
      socialLinks: {}, communityRelations: {}, events: [], deaths: 0, births: 0, rainEvents: 0,
      strategicAI: { enabled: false, requests: [], enqueuedDay: -1, enqueuedToday: 0, decisions: 0, failures: 0 },
      conflicts: 0, trades: 0, splits: 0, raidAttempts: 0, successfulRaids: 0,
      kingdomRelations: {}, borderIncidents: 0, wars: [],
      deathsByCause: { starvation: 0, dehydration: 0, age: 0, injury: 0, predation: 0, harvest: 0, invasion: 0 },
      birthsByKind: { people: 0, animals: 0 },
      harvests: { hunting: 0, fishing: 0 },
      lastWeatherEvent: -999, selectedLayer: 'ecosystem'
    };
    const scale = WIDTH / 192;
    const lakes = [
      { x: 48 * scale, y: 96 * scale, r: 7.2 * scale }, { x: 144 * scale, y: 96 * scale, r: 7.2 * scale },
      { x: 96 * scale, y: 48 * scale, r: 7.2 * scale }, { x: 96 * scale, y: 144 * scale, r: 7.2 * scale }
    ];
    w.lakes = lakes.map(lake => ({ ...lake }));
    w.lake = w.lakes[0];
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
      const i = idx(x, y);
      const nearestLake = lakes.reduce((best, lake) => {
        const distance = Math.hypot(x - lake.x, y - lake.y);
        return !best || distance < best.distance ? { lake, distance } : best;
      }, null);
      const lakeDistance = nearestLake.distance;
      const edgeVariation = (hash01(cleanSeed + 337, x, y) - .5) * .38;
      const inLake = lakes.some(lake => Math.hypot(x - lake.x, y - lake.y) < lake.r + edgeVariation);
      const water = inLake;
      const shoreDistance = Math.max(0, lakeDistance - nearestLake.lake.r);
      const soilType = water ? 'water' : shoreDistance < 2.1 ? 'riparian' : hash01(cleanSeed + 7, x, y) < .16 ? 'sandy' : 'loam';
      const capacity = soilType === 'riparian' ? 158 : soilType === 'shallow' ? 72 : soilType === 'sandy' ? 88 : 132;
      const plants = new Float32Array(PLANTS.length);
      const seedBank = new Float32Array(PLANTS.length);
      const t = {
        x, y, i, regionId: Math.floor(y / REGION_SIDE) * (WIDTH / REGION_SIDE) + Math.floor(x / REGION_SIDE), kingdomId: null,
        waterKind: inLake ? 'lake' : null,
        heightM: 0, slope: 0, terrain: water ? 'water' : 'land',
        soilType, soilCapacityMm: capacity, soilWaterMm: water ? capacity : 18 + hash01(cleanSeed + 11, x, y) * 48,
        roadWear: 0, peoplePresence: 0, civilizationPressure: 0,
        mineralNitrogenGPerM2: soilType === 'riparian' ? 3 + hash01(cleanSeed + 17, x, y) * 4 : 1.2 + hash01(cleanSeed + 19, x, y) * 4,
        organicMatterGPerM2: 1200 + hash01(cleanSeed + 23, x, y) * 5200,
        detritusGPerM2: 10 + hash01(cleanSeed + 29, x, y) * 22,
        seedBank, stoneDeposit: soilType === 'sandy' && hash01(cleanSeed + 43, x, y) < .16 ? 3 + hash01(cleanSeed + 47, x, y) * 8 : 0,
        goldOre: hash01(cleanSeed + 53, x, y) < .0045 ? 1 + hash01(cleanSeed + 59, x, y) * 2.5 : 0,
        surfaceWaterMm: water ? 24 : 0, plants, shade: 0, temperatureC: 18,
        rainfallMm: 0, waterDist: water ? 0 : lakeDistance, lakeId: inLake ? lakes.findIndex(lake => Math.hypot(x - lake.x, y - lake.y) < lake.r + edgeVariation) : null, stump: null
      };
      w.tiles.push(t);
    }
    w.waterTiles = w.tiles.filter(t => t.terrain === 'water');
    const regionCount = WIDTH / REGION_SIDE * (HEIGHT / REGION_SIDE);
    w.regions = Array.from({ length: regionCount }, (_, id) => ({
      id, temperatureC: 18, rainfallMm: 0, humidity: .55, weather: 'stable', dryDays: 0, meanMoisture: .4
    }));
    seedPlants(w);
    seedAnimals(w, { sheep: 24 });
    initializeKingdoms(w);
    addIndividuals(w, 50, true);
    for (const kingdom of w.kingdoms) {
      for (let index = 0; index < INITIAL_SOLDIERS_PER_KINGDOM; index++) {
        const recruitment = recruitKingdomSoldier(w, kingdom.id);
        if (!recruitment.ok) throw new Error('Não foi possível formar a guarnição inicial de ' + kingdom.name + ': ' + recruitment.reason);
      }
    }
    updateKingdomMarkets(w);
    refreshHarvestSuitability(w);
    log(w, 'Cinquenta moradores começaram em dois reinos, cada um com quatro torres e dois soldados. As terras além desses domínios permanecem comuns.');
    return w;
  }

export function randomHabitatCell(w, aquatic) {
    let best = null, bestScore = -Infinity;
    for (let tries = 0; tries < 100; tries++) {
      const t = w.tiles[Math.floor(rand(w) * w.tiles.length)];
      if (aquatic ? t.terrain !== 'water' : t.terrain === 'water' || t.terrain === 'rock') continue;
      const green = plantBiomass(t, aquatic ? ['algae'] : ['grass', 'berry', 'browse']);
      const score = green + rand(w) * 80 - t.slope * 20;
      if (score > bestScore) { best = t; bestScore = score; }
    }
    return best || w.tiles[Math.floor(rand(w) * w.tiles.length)];
  }
