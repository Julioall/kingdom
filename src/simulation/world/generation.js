import { HEIGHT, PLANTS, REGION_SIDE, WIDTH } from '../../config/ecosystem.js';
import { idx } from './spatial.js';
import { hash01, spatialNoise } from '../core/math.js';
import { plantBiomass, seedPlants } from '../ecology/plants.js';
import { seedAnimals } from '../ecology/animals.js';
import { addIndividuals } from '../individuals/lifecycle.js';
import { refreshHarvestSuitability } from './queries.js';
import { log } from '../core/events.js';
import { rand } from '../core/random.js';
import { initializeKingdoms, INITIAL_MILITARY_ROSTER, INITIAL_POPULATION_PER_KINGDOM, INITIAL_SOLDIERS_PER_KINGDOM, updateKingdomMarkets } from '../kingdoms/initialization.js';
import { recruitKingdomSoldier } from '../kingdoms/commands.js';
import { updateMilitaryCommand } from '../kingdoms/military.js';
import { generateIslandTerrain } from './island-terrain.js';

const MIN_INITIAL_ADULT_WORKERS_PER_KINGDOM = 9;

function ensureInitialMilitaryRecruitmentPool(world) {
  // Reserve adult workers in addition to the ruler and the starting military roster.
  const minimumAdultCount = INITIAL_SOLDIERS_PER_KINGDOM + 1 + MIN_INITIAL_ADULT_WORKERS_PER_KINGDOM;
  for (const kingdom of world.kingdoms) {
    const members = kingdom.memberIds.map(id => world.people.find(person => person.id === id && person.alive)).filter(Boolean);
    const adultCount = members.filter(person => person.ageDays >= 15 * 365).length;
    if (adultCount >= minimumAdultCount) continue;
    const toPromote = members.filter(person => person.role === 'resident' && person.ageDays < 15 * 365)
      .sort((a, b) => b.ageDays - a.ageDays || a.id - b.id)
      .slice(0, minimumAdultCount - adultCount);
    for (const person of toPromote) {
      person.ageDays = 15 * 365 + hash01(world.seed + person.id * 97, person.id, kingdom.id) * 8 * 365;
      person.guardianId = null;
    }
  }
}

export function createWorld(seed) {
    const cleanSeed = (Number(seed) >>> 0) || 1;
    const w = {
      seed: cleanSeed, width: WIDTH, height: HEIGHT, day: 0, year: 1, season: 0, rngState: cleanSeed,
      nextId: 1, tiles: [], regions: [], animals: [], people: [], communities: [], kingdoms: [], structures: [], settlements: [], logs: [], loot: [], lake: null, lakes: [],
      market: { gold: 240, food: 110, feed: 64, wood: 90, stone: 72, sheep: 4, transactions: 0 },
      socialLinks: {}, communityRelations: {}, events: [], deaths: 0, births: 0, rainEvents: 0,
      strategicAI: { enabled: false, requests: [], pendingByKingdom: {}, nextDecisionDays: {}, nextRequestSequence: 1, enqueuedDay: -1, enqueuedToday: 0, decisions: 0, failures: 0 },
      conflicts: 0, trades: 0, splits: 0, raidAttempts: 0, successfulRaids: 0,
      kingdomRelations: {}, borderIncidents: 0, wars: [], campaigns: [], territoryClaims: [], treaties: [],
      deathsByCause: { starvation: 0, dehydration: 0, age: 0, injury: 0, combat: 0, predation: 0, harvest: 0, invasion: 0 },
      birthsByKind: { people: 0, animals: 0 },
      harvests: { hunting: 0, fishing: 0, livestock: 0, livestockMeat: 0, plantFoodBiomass: 0, cultivatedFoodBiomass: 0 },
      ecologyFlows: {
        humanFoodRegrowth: 0, humanFoodNaturalLoss: 0,
        humanFoodSettlementLoss: 0, humanFoodEcologicalLoss: 0,
        humanFoodCultivatedRegrowth: 0, humanFoodCultivationSeeded: 0,
        livestockFeedConsumed: 0
      },
      lastWeatherEvent: -999
    };
    const generatedTerrain = generateIslandTerrain(WIDTH, HEIGHT, cleanSeed);
    const lakes = generatedTerrain.freshwaterLakes;
    w.lakes = lakes.map(lake => ({ ...lake }));
    w.lake = w.lakes[0];
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
      const i = idx(x, y);
      const waterKind = generatedTerrain.waterKind[i] || null;
      const water = waterKind !== null;
      const waterDist = generatedTerrain.waterDistance[i];
      const soilType = water ? 'water' : waterDist < 2.1 ? 'riparian' : hash01(cleanSeed + 7, x, y) < .16 ? 'sandy' : 'loam';
      const capacity = soilType === 'riparian' ? 158 : soilType === 'shallow' ? 72 : soilType === 'sandy' ? 88 : 132;
      const plants = new Float32Array(PLANTS.length);
      const t = {
        x, y, i, regionId: Math.floor(y / REGION_SIDE) * (WIDTH / REGION_SIDE) + Math.floor(x / REGION_SIDE), kingdomId: null,
        waterKind,
        heightM: generatedTerrain.heightM[i], slope: generatedTerrain.slope[i], terrain: water ? 'water' : 'land',
        elevationLevel: generatedTerrain.elevationLevel[i], autoTileVariant: generatedTerrain.autoTileVariant[i],
        rampSide: generatedTerrain.rampSide[i], rampLevel: generatedTerrain.rampLevel[i], rampSegment: generatedTerrain.rampSegment[i],
        soilType, soilCapacityMm: capacity, soilWaterMm: water ? capacity : 18 + hash01(cleanSeed + 11, x, y) * 48,
        roadWear: 0, peoplePresence: 0, civilizationPressure: 0,
        mineralNitrogenGPerM2: soilType === 'riparian' ? 3 + hash01(cleanSeed + 17, x, y) * 4 : 1.2 + hash01(cleanSeed + 19, x, y) * 4,
        organicMatterGPerM2: 1200 + hash01(cleanSeed + 23, x, y) * 5200,
        detritusGPerM2: 10 + hash01(cleanSeed + 29, x, y) * 22,
        plantResourceMask: 0,
        stoneDeposit: !water && hash01(cleanSeed + 43, x, y)
          < (spatialNoise(cleanSeed + 61, x, y, 12) > .62 ? .065 : .004)
          ? 3 + hash01(cleanSeed + 47, x, y) * 8 : 0,
        goldOre: !water && hash01(cleanSeed + 53, x, y)
          < (spatialNoise(cleanSeed + 67, x, y, 12) > .66 ? .025 : .0005)
          ? 1 + hash01(cleanSeed + 59, x, y) * 2.5 : 0,
        // New finite deposits use independent seeded hashes, without consuming
        // the simulation RNG or changing historic gold/stone generation.
        copperOre: !water && hash01(cleanSeed + 173, x, y)
          < (spatialNoise(cleanSeed + 179, x, y, 12) > .60 ? .052 : .003)
          ? 2 + hash01(cleanSeed + 181, x, y) * 6 : 0,
        silverOre: !water && hash01(cleanSeed + 191, x, y)
          < (spatialNoise(cleanSeed + 193, x, y, 12) > .65 ? .016 : .0007)
          ? 1 + hash01(cleanSeed + 197, x, y) * 3 : 0,
        ironOre: !water && hash01(cleanSeed + 211, x, y)
          < (spatialNoise(cleanSeed + 223, x, y, 12) > .58 ? .062 : .004)
          ? 3 + hash01(cleanSeed + 227, x, y) * 9 : 0,
        surfaceWaterMm: water ? 24 : 0, plants, shade: 0, temperatureC: 18,
        rainfallMm: 0, waterDist, lakeId: waterKind === 'lake' ? lakes.reduce((best, lake, lakeId) =>
          Math.hypot(x - lake.x, y - lake.y) < best.distance ? { distance: Math.hypot(x - lake.x, y - lake.y), lakeId } : best,
        { distance: Infinity, lakeId: -1 }).lakeId : null, stump: null
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
    addIndividuals(w, INITIAL_POPULATION_PER_KINGDOM * w.kingdoms.length, true);
    ensureInitialMilitaryRecruitmentPool(w);
    for (const kingdom of w.kingdoms) {
      for (const { militaryClass, count } of INITIAL_MILITARY_ROSTER) {
        for (let index = 0; index < count; index++) {
          const recruitment = recruitKingdomSoldier(w, kingdom.id, { immediate: true, militaryClass });
          if (!recruitment.ok) throw new Error('Não foi possível formar a guarnição inicial de ' + kingdom.name + ': ' + recruitment.reason);
        }
      }
    }
    updateMilitaryCommand(w, 0);
    updateKingdomMarkets(w);
    refreshHarvestSuitability(w);
    const humanFoodBiomass = w.tiles.reduce((sum, tile) => {
      for (let index = 0; index < PLANTS.length; index++) {
        if (PLANTS[index].foodFor === 'people') sum += tile.plants[index];
      }
      return sum;
    }, 0);
    w.ecologyReportCursor = {
      day: w.day,
      humanFoodBiomass,
      plantFoodHarvested: w.harvests.plantFoodBiomass,
      humanFoodRegrowth: w.ecologyFlows.humanFoodRegrowth,
      humanFoodNaturalLoss: w.ecologyFlows.humanFoodNaturalLoss,
      humanFoodSettlementLoss: w.ecologyFlows.humanFoodSettlementLoss,
      humanFoodCultivatedRegrowth: w.ecologyFlows.humanFoodCultivatedRegrowth,
      humanFoodCultivationSeeded: w.ecologyFlows.humanFoodCultivationSeeded,
      cultivatedFoodHarvested: w.harvests.cultivatedFoodBiomass
    };
    const initialPopulation = INITIAL_POPULATION_PER_KINGDOM * w.kingdoms.length;
    const initialNonMilitaryPerKingdom = INITIAL_POPULATION_PER_KINGDOM - INITIAL_SOLDIERS_PER_KINGDOM;
    const rosterDescription = INITIAL_MILITARY_ROSTER.map(({ count, militaryClass }) => count + ' ' + militaryClass + (count === 1 ? '' : 's')).join(', ');
    log(w, initialPopulation + ' habitantes começaram em ' + w.kingdoms.length + ' reinos, com '
      + initialNonMilitaryPerKingdom + ' habitantes não militares e ' + INITIAL_SOLDIERS_PER_KINGDOM
      + ' militares por reino (' + rosterDescription + '). As tropas patrulham antes das campanhas de fronteira. '
      + 'As terras além desses domínios permanecem comuns.');
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
