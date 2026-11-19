import { HUMAN_ADULT_AGE_DAYS, HUMAN_RECRUIT_AGE_DAYS } from '../individuals/human-age.js';
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
import { enlistSoldier } from '../kingdoms/service.js';
import { generateIslandTerrain } from './island-terrain.js';
import { seedAdditionalMinerals, relocateSettlementMinerals, reduceInitialMineralSites } from './mineral-distribution.js';
import { clearWildVegetationNearCorrals } from '../ecology/corral-clearance.js';

const MIN_INITIAL_ADULT_WORKERS_PER_KINGDOM = 9;
// The additional starting regiments are a founding garrison, not ongoing recruitment.
// Future recruitment still uses the treasury, training sources and center vacancies.
const FOUNDING_GARRISON_CLASSES = Object.freeze([
  'guerreiro', 'lanceiro', 'guerreiro', 'lanceiro', 'arqueiro',
  'guerreiro', 'lanceiro', 'arqueiro', 'guerreiro', 'monge'
]);

function mobilizeFoundingGarrison(world, kingdom, targetSoldiers) {
  const allMembers = kingdom.memberIds.map(id => world.people.find(p => p.id === id && p.alive)).filter(Boolean);
  const currentSoldiers = allMembers.filter(p => p.role === 'soldier').length;
  const additional = targetSoldiers - currentSoldiers;
  if (additional <= 0) return;
  const center = world.structures.find(structure => kingdom.militaryCenterIds.includes(structure.id)
    && structure.type === 'centro_militar' && structure.complete && structure.destroyedDay == null);
  if (!center) throw new Error('Guarnição fundadora sem centro militar em ' + kingdom.name);
  const candidates = allMembers.filter(p => p.role === 'resident')
    .sort((a, b) => (Number(b.ageDays >= HUMAN_RECRUIT_AGE_DAYS) - Number(a.ageDays >= HUMAN_RECRUIT_AGE_DAYS))
      || (b.physicalStrength || 0) - (a.physicalStrength || 0)
      || a.id - b.id);
  if (candidates.length < additional)
    throw new Error('Guarnição fundadora excede os residentes disponíveis em ' + kingdom.name);
  // Initial service capacity is explicit for this center. It does not create
  // resources or waive the costs of any future recruitment.
  center.capacity = Math.max(center.capacity || 0, targetSoldiers);
  center.foundingGarrisonCapacity = targetSoldiers;
  for (let index = 0; index < additional; index++) {
    const person = candidates[index];
    // A founding regiment must not enlist children. Mature the selected
    // generated characters if the original demographic mix lacks adults.
    if (person.ageDays < HUMAN_RECRUIT_AGE_DAYS) {
      person.ageDays = HUMAN_ADULT_AGE_DAYS;
      person.guardianId = null;
    }
    enlistSoldier(world, person, center, world.day,
      FOUNDING_GARRISON_CLASSES[index % FOUNDING_GARRISON_CLASSES.length]);
  }
}


function ensureInitialMilitaryRecruitmentPool(world) {
  // Reserve adult workers in addition to the ruler and the starting military roster.
  const minimumAdultCount = INITIAL_SOLDIERS_PER_KINGDOM + 1 + MIN_INITIAL_ADULT_WORKERS_PER_KINGDOM;
  for (const kingdom of world.kingdoms) {
    const members = kingdom.memberIds.map(id => world.people.find(person => person.id === id && person.alive)).filter(Boolean);
    const adultCount = members.filter(person => person.ageDays >= HUMAN_RECRUIT_AGE_DAYS).length;
    if (adultCount >= minimumAdultCount) continue;
    const toPromote = members.filter(person => person.role === 'resident' && person.ageDays < HUMAN_RECRUIT_AGE_DAYS)
      .sort((a, b) => b.ageDays - a.ageDays || a.id - b.id)
      .slice(0, minimumAdultCount - adultCount);
    for (const person of toPromote) {
      person.ageDays = HUMAN_RECRUIT_AGE_DAYS + hash01(world.seed + person.id * 97, person.id, kingdom.id) * 100;
      person.guardianId = null;
    }
  }
}

export function createWorld(seed, options = {}) {
    const cleanSeed = (Number(seed) >>> 0) || 1;
    // Benchmark-confirmed stress population. Direct createWorld(seed) keeps
    // its small deterministic seed for unit tests and explicit simulations.
    const requestedPopulation = options.initialPopulation == null
      ? INITIAL_POPULATION_PER_KINGDOM * 2 : Number(options.initialPopulation);
    if (!Number.isSafeInteger(requestedPopulation)
      || requestedPopulation < INITIAL_POPULATION_PER_KINGDOM * 2
      || requestedPopulation > 5000) {
      throw new RangeError('População inicial deve estar entre 96 e 5000.');
    }
    const initialMilitaryShare = options.initialMilitaryShare == null ? null
      : Number(options.initialMilitaryShare);
    if (initialMilitaryShare != null && initialMilitaryShare !== 0.8)
      throw new RangeError('A divisão inicial aceita 80% de militares e 20% de civis.');
    const w = {
      seed: cleanSeed, width: WIDTH, height: HEIGHT, day: 0, year: 1, season: 0, rngState: cleanSeed,
      ...(initialMilitaryShare == null ? {} : { initialMilitaryShare }),
      nextId: 1, tiles: [], regions: [], animals: [], people: [], communities: [], kingdoms: [], structures: [], settlements: [], logs: [], loot: [], lake: null, lakes: [],
      trainingDummyStates: {},
      market: { gold: 240, food: 110, feed: 64, wood: 90, stone: 72, sheep: 4, transactions: 0 },
      socialLinks: {}, communityRelations: {}, events: [], deaths: 0, births: 0, rainEvents: 0,
      strategicAI: { enabled: false, requests: [], pendingByKingdom: {}, nextDecisionDays: {}, nextRequestSequence: 1, enqueuedDay: -1, enqueuedToday: 0, decisions: 0, failures: 0 },
      // A/B modes: legacy (original campaign slots), commanders (moving anchors),
      // hierarchical (adds bounded utility, threat influence and group morale).
      tacticalCombat: { mode: ['legacy', 'commanders', 'hierarchical'].includes(options.tacticalCombat)
        ? options.tacticalCombat : 'hierarchical' },
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
    // Explicit world-creation rollback. Default is the shared policy; passing
    // legacy retains the original individually trained dense controllers.
    if (options.neuralController === 'legacy') {
      w.neuralOverrides = { neuralController: 'legacy' };
    }
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
        // Allocated after trees are seeded; the distribution pass creates sparse,
        // richer veins relative to gold sites and tree-site abundance.
        copperOre: 0, silverOre: 0, ironOre: 0,
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
    reduceInitialMineralSites(w);
    seedAnimals(w, { sheep: 24 });
    initializeKingdoms(w);
    clearWildVegetationNearCorrals(w);
    seedAdditionalMinerals(w);
    relocateSettlementMinerals(w);
    addIndividuals(w, requestedPopulation, true);
    ensureInitialMilitaryRecruitmentPool(w);
    for (const kingdom of w.kingdoms) {
      for (const { militaryClass, count } of INITIAL_MILITARY_ROSTER) {
        for (let index = 0; index < count; index++) {
          const recruitment = recruitKingdomSoldier(w, kingdom.id, { immediate: true, militaryClass });
          if (!recruitment.ok) throw new Error('Não foi possível formar a guarnição inicial de ' + kingdom.name + ': ' + recruitment.reason);
        }
      }
    }
    if (initialMilitaryShare != null) {
      // Round the 80% quota against the ENTIRE population, not separately
      // for each kingdom: 96 inhabitants yield 77 soldiers and 19 civilians.
      // Cumulative rounding preserves equal treatment over both kingdoms.
      let seen = 0, allocated = 0;
      for (const kingdom of w.kingdoms) {
        seen += kingdom.memberIds.length;
        const nextAllocated = Math.round(seen * initialMilitaryShare);
        mobilizeFoundingGarrison(w, kingdom, nextAllocated - allocated);
        allocated = nextAllocated;
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
    const initialPopulation = requestedPopulation;
    const rosterDescription = INITIAL_MILITARY_ROSTER.map(({ count, militaryClass }) => count + ' ' + militaryClass + (count === 1 ? '' : 's')).join(', ');
    if (initialMilitaryShare == null) {
      // Preserve the exact log of legacy simulations for authoritative
      // benchmark parity and replay checksums.
      const initialNonMilitaryPerKingdom = initialPopulation / w.kingdoms.length - INITIAL_SOLDIERS_PER_KINGDOM;
      log(w, initialPopulation + ' habitantes começaram em ' + w.kingdoms.length + ' reinos, com '
        + initialNonMilitaryPerKingdom + ' habitantes não militares e ' + INITIAL_SOLDIERS_PER_KINGDOM
        + ' militares por reino (' + rosterDescription + '). As tropas patrulham antes das campanhas de fronteira. '
        + 'As terras além desses domínios permanecem comuns.');
    } else {
      const militaryByKingdom = w.kingdoms.map(kingdom => w.people.filter(p => p.alive
        && p.kingdomId === kingdom.id && p.role === 'soldier').length);
      const civilianByKingdom = w.kingdoms.map((kingdom, index) =>
        kingdom.memberIds.length - militaryByKingdom[index]);
      log(w, initialPopulation + ' habitantes começaram em ' + w.kingdoms.length + ' reinos, com '
        + civilianByKingdom.join('/') + ' civis (incluindo governantes) e '
        + militaryByKingdom.join('/') + ' militares por reino. Guarnição básica: (' + rosterDescription
        + '). As tropas patrulham antes das campanhas de fronteira. '
        + 'As terras além desses domínios permanecem comuns.');
    }
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
