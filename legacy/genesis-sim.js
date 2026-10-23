(function(root, factory) {
  const senses = typeof module === 'object' && module.exports ? require('./genesis-senses.js') : root.GenesisSenses;
  const api = factory(senses);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GenesisSim = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function(Senses) {
  'use strict';

  const WIDTH = 64, HEIGHT = 64, CELL_AREA_M2 = 100, REGION_SIDE = 8;
  const SEASONS = ['Primavera', 'Verão', 'Outono', 'Inverno'];
  const COLORS = ['#d47c51', '#718c56', '#647ca1', '#b2934f', '#8a6b91', '#4f8b85', '#a85b62', '#71806e'];
  const PLANTS = [
    { id: 'grass', name: 'Gramíneas', guild: 'Herbácea', color: '#91a74e', water: [.12, .82], temp: [-4, 39], max: 140, growth: .24, edible: 1, canopy: 0, habitat: 'land' },
    { id: 'berry', name: 'Arbusto de frutos', guild: 'Lenhosa baixa', color: '#76854a', water: [.28, .92], temp: [2, 36], max: 180, growth: .22, edible: .78, canopy: .12, habitat: 'land', foodFor: 'people' },
    { id: 'browse', name: 'Arbusto de brotos', guild: 'Lenhosa baixa', color: '#667d45', water: [.2, .86], temp: [-2, 38], max: 160, growth: .15, edible: .62, canopy: .16, habitat: 'land', foodFor: 'sheep', seasonalGrowth: [1.08, .22, .72, 1.22] },
    { id: 'broadleaf', name: 'Árvore de folhas largas', guild: 'Lenhosa', color: '#557543', water: [.32, .88], temp: [1, 35], max: 1200, growth: .42, edible: .08, canopy: .52, habitat: 'land' },
    { id: 'conifer', name: 'Conífera', guild: 'Lenhosa', color: '#355f4c', water: [.18, .76], temp: [-9, 27], max: 1100, growth: .34, edible: .03, canopy: .46, habitat: 'land' },
    { id: 'reed', name: 'Juncos', guild: 'Herbácea', color: '#a4a24f', water: [.74, 1], temp: [4, 39], max: 360, growth: 1.3, edible: .18, canopy: .04, habitat: 'shore' },
    { id: 'algae', name: 'Algas de água doce', guild: 'Aquática', color: '#4a8c80', water: [.9, 1], temp: [2, 34], max: 180, growth: .9, edible: .65, canopy: 0, habitat: 'water' }
  ];
  const ANIMALS = [
    { id: 'sheep', name: 'Ovelha', role: 'Herbívoro', color: '#e7e4d9', diet: ['browse'], water: true, aquatic: false, speed: 1.0, mass: 48, life: 3900, food: 2.8, prey: [], huntable: true, catchability: .26 }
  ];
  const HUMAN_FOOD = ['berry'];
  const SHEEP_FORAGE = ['browse'];
  const HUMAN_NAMES = ['Aru', 'Bela', 'Caí', 'Dara', 'Eni', 'Iara', 'Jaci', 'Kai', 'Luma', 'Nilo', 'Oru', 'Tainá', 'Uira', 'Yara', 'Zuri', 'Ayo', 'Cora', 'Davi', 'Ema', 'Ivo', 'Lina', 'Mira', 'Noa', 'Ravi'];
  const NAME_LEFT = ['Água', 'Pedra', 'Junco', 'Serra', 'Mata', 'Vale', 'Capim', 'Vento', 'Lagoa', 'Lago'];
  const NAME_RIGHT = ['Clara', 'Alta', 'Verde', 'Manso', 'Dourada', 'Aberto', 'Fundo', 'Antigo', 'Sereno', 'Vivo'];
  const COMMUNITY_FORMS = ['Povo de ', 'Gente de ', 'Comunidade em ', 'Aliança de '];
  const PEOPLE_ACTIONS = ['forage', 'hunt', 'deliver', 'drink', 'socialize', 'rest', 'explore', 'build', 'gather', 'collect_log', 'collect_feed', 'share', 'trade', 'migrate', 'capture_sheep', 'lead_sheep', 'raid'];
  const ANIMAL_ACTIONS = ['feed', 'drink', 'hunt', 'rest', 'explore', 'flee'];
  const PEOPLE_INPUTS = 18, HIDDEN_NEURONS = 9;
  const FOOD_RESERVE_PER_UNIT = .72;
  const DAILY_FOOD_NEED = .78;
  const MEAT_NUTRITIONAL_VALUE = 2.5;

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function idx(x, y) { return y * WIDTH + x; }
  function cellAt(w, x, y) {
    // Actors and community centers can have fractional coordinates; resolve them to
    // the nearest tile before indexing the grid.
    const tileX = Math.round(x), tileY = Math.round(y);
    return tileX < 0 || tileY < 0 || tileX >= WIDTH || tileY >= HEIGHT ? null : w.tiles[idx(tileX, tileY)];
  }
  function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function rand(w) {
    w.rngState = (w.rngState + 0x6D2B79F5) >>> 0;
    let t = w.rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function hash01(seed, x, y) {
    let n = (seed ^ Math.imul(x + 1, 0x45d9f3b) ^ Math.imul(y + 1, 0x27d4eb2d)) >>> 0;
    n = Math.imul(n ^ (n >>> 16), 0x7feb352d);
    n = Math.imul(n ^ (n >>> 15), 0x846ca68b);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }
  function species(profileId, list) { return list.find(s => s.id === profileId); }
  function seasonIndex(day) { return Math.floor(((Math.max(0, day) % 365) / 365) * 4); }
  function riverX(y) { return 18 + .42 * y + 2.2 * Math.sin(y * .17); }

  function createWorld(seed) {
    const cleanSeed = (Number(seed) >>> 0) || 1;
    const w = {
      seed: cleanSeed, width: WIDTH, height: HEIGHT, day: 0, year: 1, season: 0, rngState: cleanSeed,
      nextId: 1, tiles: [], regions: [], animals: [], people: [], communities: [], structures: [], logs: [], lake: null,
      market: { gold: 240, food: 110, feed: 64, wood: 90, stone: 72, sheep: 4, transactions: 0 },
      socialLinks: {}, communityRelations: {}, events: [], deaths: 0, births: 0, rainEvents: 0,
      strategicAI: { enabled: false, requests: [], enqueuedDay: -1, enqueuedToday: 0, decisions: 0, failures: 0 },
      conflicts: 0, trades: 0, splits: 0, raidAttempts: 0, successfulRaids: 0,
      deathsByCause: { starvation: 0, dehydration: 0, age: 0, injury: 0, predation: 0, harvest: 0 },
      birthsByKind: { people: 0, animals: 0 },
      harvests: { hunting: 0, fishing: 0 },
      lastWeatherEvent: -999, selectedLayer: 'ecosystem'
    };
    const lake = { x: 36, y: 34, r: 6.2 };
    w.lake = { x: lake.x, y: lake.y, r: lake.r };
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
      const i = idx(x, y), lakeDistance = Math.hypot(x - lake.x, y - lake.y);
      const edgeVariation = (hash01(cleanSeed + 337, x, y) - .5) * .38;
      const inLake = lakeDistance < lake.r + edgeVariation;
      const water = inLake;
      const shoreDistance = Math.max(0, lakeDistance - lake.r);
      const soilType = water ? 'water' : shoreDistance < 2.1 ? 'riparian' : hash01(cleanSeed + 7, x, y) < .16 ? 'sandy' : 'loam';
      const capacity = soilType === 'riparian' ? 158 : soilType === 'shallow' ? 72 : soilType === 'sandy' ? 88 : 132;
      const plants = new Float32Array(PLANTS.length);
      const seedBank = new Float32Array(PLANTS.length);
      const t = {
        x, y, i, regionId: Math.floor(y / REGION_SIDE) * (WIDTH / REGION_SIDE) + Math.floor(x / REGION_SIDE),
        waterKind: inLake ? 'lake' : null,
        heightM: 0, slope: 0, terrain: water ? 'water' : 'land',
        soilType, soilCapacityMm: capacity, soilWaterMm: water ? capacity : 18 + hash01(cleanSeed + 11, x, y) * 48,
        mineralNitrogenGPerM2: soilType === 'riparian' ? 3 + hash01(cleanSeed + 17, x, y) * 4 : 1.2 + hash01(cleanSeed + 19, x, y) * 4,
        organicMatterGPerM2: 1200 + hash01(cleanSeed + 23, x, y) * 5200,
        detritusGPerM2: 10 + hash01(cleanSeed + 29, x, y) * 22,
        seedBank, stoneDeposit: soilType === 'sandy' && hash01(cleanSeed + 43, x, y) < .16 ? 3 + hash01(cleanSeed + 47, x, y) * 8 : 0,
        goldOre: hash01(cleanSeed + 53, x, y) < .0045 ? 1 + hash01(cleanSeed + 59, x, y) * 2.5 : 0,
        surfaceWaterMm: water ? 24 : 0, plants, shade: 0, temperatureC: 18,
        rainfallMm: 0, waterDist: water ? 0 : lakeDistance, stump: null
      };
      w.tiles.push(t);
    }
    w.waterTiles = w.tiles.filter(t => t.terrain === 'water');
    const regionCount = WIDTH / REGION_SIDE * (HEIGHT / REGION_SIDE);
    w.regions = Array.from({ length: regionCount }, (_, id) => ({
      id, temperatureC: 18, rainfallMm: 0, humidity: .55, weather: 'stable', dryDays: 0, meanMoisture: .4
    }));
    seedPlants(w);
    seedAnimals(w, { sheep: 12 });
    addIndividuals(w, 50, true);
    refreshHarvestSuitability(w);
    log(w, 'Cinquenta pessoas chegaram sem comunidades, cidades ou fronteiras. Seus vínculos, assentamentos e conflitos dependerão do que acontecer no mundo.');
    return w;
  }

  function plantSuitability(profile, tile, temperatureC, moisture) {
    if (profile.habitat === 'water' && tile.terrain !== 'water') return 0;
    if (profile.habitat === 'shore' && tile.soilType !== 'riparian') return 0;
    if (profile.habitat === 'upland' && tile.terrain === 'water') return 0;
    if (tile.terrain === 'water' && profile.habitat !== 'water') return 0;
    const temp = clamp((temperatureC - profile.temp[0]) / 5, 0, 1) * clamp((profile.temp[1] - temperatureC) / 5, 0, 1);
    const water = clamp((moisture - profile.water[0]) / .24, 0, 1) * clamp((profile.water[1] - moisture) / .24, 0, 1);
    if (profile.habitat === 'shore') return temp * clamp((moisture - .55) / .24, 0, 1);
    if (profile.habitat === 'water') return temp * clamp((moisture - .82) / .15, 0, 1);
    return temp * water;
  }

  function seedPlants(w) {
    for (const t of w.tiles) {
      const moisture = clamp(t.soilWaterMm / t.soilCapacityMm, 0, 1);
      for (let n = 0; n < PLANTS.length; n++) {
        const p = PLANTS[n], suitability = plantSuitability(p, t, 18 - t.heightM * .006, moisture);
        const patchNoise = hash01(w.seed + n * 137, t.x, t.y);
        if (p.id === 'grass' && t.terrain === 'land') t.plants[n] = (7 + patchNoise * 35) * Math.max(.12, suitability);
        else if (p.id === 'algae' && t.terrain === 'water' && patchNoise > .16) t.plants[n] = 24 + patchNoise * 90;
        else if (p.id === 'reed' && t.soilType === 'riparian' && patchNoise > .39) t.plants[n] = 35 + patchNoise * 105;
        else if (p.id === 'berry' && t.terrain === 'land' && suitability > .2 && patchNoise > .58) t.plants[n] = 16 + patchNoise * 54;
        else if (p.id === 'browse' && t.terrain === 'land' && suitability > .15 && patchNoise > .72) t.plants[n] = 12 + patchNoise * 34;
        else if (p.id === 'broadleaf' && t.terrain === 'land' && suitability > .17 && patchNoise > .71) t.plants[n] = 120 + patchNoise * 330;
        else if (p.id === 'conifer' && t.terrain === 'land' && suitability > .13 && patchNoise > .74) t.plants[n] = 130 + patchNoise * 280;
        if ((p.id === 'berry' || p.id === 'browse') && t.terrain === 'land' && suitability > .18) {
          t.seedBank[n] = .8 + hash01(w.seed + n * 619, t.x, t.y) * 4.2;
        } else if ((p.id === 'broadleaf' || p.id === 'conifer') && t.terrain === 'land' && suitability > .08) {
          // Trees keep a local seed reserve so a poor season does not erase a forest permanently.
          t.seedBank[n] = .5 + hash01(w.seed + n * 619, t.x, t.y) * 2.5;
        }
      }
    }
  }

  function randomHabitatCell(w, aquatic) {
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

  function seedAnimals(w, counts) {
    for (const p of ANIMALS) for (let i = 0; i < counts[p.id]; i++) {
      const t = randomHabitatCell(w, p.aquatic);
      w.animals.push(makeAnimal(w, p.id, t.x, t.y, false));
    }
  }

  function refreshHarvestSuitability(w) {
    const size = WIDTH * HEIGHT, huntDensity = new Float32Array(size), fishDensity = new Float32Array(size);
    for (const animal of w.animals) {
      if (!animal.alive) continue;
      const profile = species(animal.speciesId, ANIMALS);
      const fishing = !!profile.fishable, hunting = !!profile.huntable;
      if (!fishing && !hunting) continue;
      const radius = fishing ? 3.5 : 4.5, cx = Math.round(animal.x), cy = Math.round(animal.y), reach = Math.ceil(radius);
      for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
        const d = Math.hypot(dx, dy), tile = cellAt(w, cx + dx, cy + dy);
        if (!tile || d > radius || (fishing ? tile.terrain !== 'water' : tile.terrain !== 'land')) continue;
        const contribution = 1 - d / (radius + 1);
        if (fishing) fishDensity[tile.i] += contribution;
        if (hunting) huntDensity[tile.i] += contribution;
      }
    }
    for (const tile of w.tiles) {
      const greenFood = plantBiomass(tile, ['grass', 'berry', 'browse']);
      const cover = clamp(plantBiomass(tile, ['berry', 'browse', 'broadleaf', 'conifer']) / 430, 0, 1);
      const slopeSuitability = clamp(1 - tile.slope * .8, .25, 1);
      tile.nearbyHuntableAnimals = huntDensity[tile.i];
      tile.nearbyFish = fishDensity[tile.i];
      tile.huntingSuitability = tile.terrain === 'land'
        ? clamp(huntDensity[tile.i] / 1.3, 0, 1) * (.7 + cover * .2 + clamp(greenFood / 180, 0, 1) * .1) * slopeSuitability
        : 0;
      const algae = clamp(plantBiomass(tile, ['algae']) / 85, 0, 1);
      const waterBodySuitability = tile.waterKind === 'lake' ? 1 : tile.waterKind === 'river' ? .88 : .5;
      tile.fishingSuitability = tile.terrain === 'water'
        ? clamp(fishDensity[tile.i] / 1.25, 0, 1) * (.7 + algae * .18 + waterBodySuitability * .12)
        : 0;
    }
    for (const community of w.communities || []) {
      if (community.dissolved || !community.grounds) continue;
      for (const kind of ['hunting', 'fishing']) {
        const ground = community.grounds[kind];
        const tile = ground && cellAt(w, ground.x, ground.y);
        if (ground && tile) ground.score = kind === 'hunting' ? tile.huntingSuitability : tile.fishingSuitability;
      }
    }
    return { huntDensity, fishDensity };
  }

  function createBrain(w, actions, inputSize, entityId) {
    const count = inputSize || 6;
    const hiddenSize = HIDDEN_NEURONS;
    const inputWeights = Array.from({ length: count * hiddenSize }, () => (rand(w) - .5) * .36);
    const outputWeights = new Array(hiddenSize * actions.length);
    const legacyActions = Math.min(14, actions.length);
    for (let action = 0; action < actions.length; action++) for (let hidden = 0; hidden < hiddenSize; hidden++) {
      const weight = action < legacyActions ? (rand(w) - .5) * .32
        : (hash01(w.seed + (entityId || 0) * 97 + action * 31, hidden, action) - .5) * .32;
      outputWeights[action * hiddenSize + hidden] = weight;
    }
    return { inputSize: count, hiddenSize, learningRate: .027, inputWeights, outputWeights, actionCount: actions.length,
      actionValues: Array(actions.length).fill(0), actionCounts: Object.fromEntries(actions.map(action => [action, 0])), baseline: 0, rewardMean: 0,
      decisions: 0, updates: 0, lastAction: 'explore', pending: null };
  }

  function makePerson(w, x, y, newborn) {
    const id = w.nextId++;
    const first = HUMAN_NAMES[Math.floor(rand(w) * HUMAN_NAMES.length)];
    const name = newborn ? first + ' ' + ['Filho', 'Filha', 'Júnior'][Math.floor(rand(w) * 3)] : first + ' ' + String.fromCharCode(65 + Math.floor(rand(w) * 26));
    return {
      id, name, x, y, alive: true, ageDays: newborn ? 0 : 1800 + rand(w) * 11000,
      sex: rand(w) < .5 ? 'F' : 'M',
      namingForm: COMMUNITY_FORMS[Math.floor(rand(w) * COMMUNITY_FORMS.length)], namingVoice: .4 + rand(w) * .6,
      energy: newborn ? 65 : 58 + rand(w) * 38, hydration: 55 + rand(w) * 43, foodReserve: 55 + rand(w) * 40,
      socialNeed: 45 + rand(w) * 50, sociability: .25 + rand(w) * .75, trust: .2 + rand(w) * .65,
      physicalStrength: .35 + rand(w) * .65,
      communityId: null, moveCooldown: 0, buildCooldown: 0, birthCooldown: newborn ? 280 : Math.floor(rand(w) * 70),
      health: newborn ? 82 : 82 + rand(w) * 18, injury: 0, carriedFood: 0, carriedFruit: 0, carriedMeat: 0, carriedMaterial: 0,
      carriedWood: 0, carriedStone: 0, carriedFeed: 0, carriedGold: 0, headingX: (rand(w) - .5) * 2, headingY: (rand(w) - .5) * 2,
      leadingSheepId: null, prestige: 0, assignment: null, dissatisfactionDays: 0,
      sensoryMemory: { actors: {}, water: [] }, perception: null,
      personalMemory: [], strategicPlan: null, strategicRequestPending: null, nextStrategicDecisionDay: (id * 19) % 60 + 1, nextUrgentStrategicDecisionDay: 1,
      parents: newborn ? [] : null, guardianId: null, awayDays: 0, conflictRisk: 0,
      skills: { forage: .12 + rand(w) * .32, hunt: .06 + rand(w) * .24, gather: .08 + rand(w) * .3, build: .05 + rand(w) * .24, care: .08 + rand(w) * .3, diplomacy: .08 + rand(w) * .35 },
      brain: createBrain(w, PEOPLE_ACTIONS, PEOPLE_INPUTS, id), lastReward: 0,
      lastLesson: 'Ainda está aprendendo com o ambiente.', state: 'observando'
    };
  }

  function addIndividuals(w, count, initial) {
    const added = [];
    for (let n = 0; n < count; n++) {
      const t = randomHabitatCell(w, false);
      const jitterX = Math.floor((rand(w) - .5) * 5), jitterY = Math.floor((rand(w) - .5) * 5);
      let x = clamp(t.x + jitterX, 1, WIDTH - 2), y = clamp(t.y + jitterY, 1, HEIGHT - 2);
      let cell = cellAt(w, x, y);
      if (!cell || cell.terrain === 'water' || cell.terrain === 'rock') { x = t.x; y = t.y; }
      const person = makePerson(w, x, y, false);
      w.people.push(person); added.push(person.id);
    }
    if (!initial && added.length) log(w, added.length + ' indivíduos chegaram ao mundo; todos começam sem grupo.');
    return added;
  }

  function makeAnimal(w, speciesId, x, y, newborn) {
    const p = species( speciesId, ANIMALS );
    const id = w.nextId++;
    return {
      id, speciesId, x, y, alive: true, headingX: 0, headingY: 0,
      ageDays: newborn ? 0 : Math.floor(rand(w) * p.life * .62),
      energy: newborn ? 55 : 52 + rand(w) * 44, hydration: 45 + rand(w) * 50,
      massKg: p.mass * (.6 + rand(w) * .8), reproductionCooldown: newborn ? 360 : Math.floor(rand(w) * 120),
      habituation: 0, herdCommunityId: null, lastFedDay: -999, feedingEvents: 0, beingLedBy: null,
      sensoryMemory: { actors: {}, water: [] }, perception: null,
      brain: createBrain(w, ANIMAL_ACTIONS, 6, id), lastReward: 0,
      state: 'buscando alimento'
    };
  }

  function log(w, text) {
    w.events.unshift({ day: w.day, text });
    if (w.events.length > 24) w.events.length = 24;
  }

  function updateClimate(w, day) {
    const season = seasonIndex(day);
    const seasonalTemp = [19, 25, 21, 15][season];
    const rainFactor = [1.14, .72, .84, 1.26][season];
    let wetRegions = 0, dryRegions = 0, rainMean = 0;
    for (const r of w.regions) {
      const cx = (r.id % (WIDTH / REGION_SIDE)) * REGION_SIDE + 4;
      const cy = Math.floor(r.id / (WIDTH / REGION_SIDE)) * REGION_SIDE + 4;
      const altitude = cellAt(w, cx, cy).heightM;
      const lat = (cy / HEIGHT - .5) * 3.8;
      const event = rand(w);
      const baseRain = event < .19 * rainFactor ? (2 + rand(w) * 17 * rainFactor) : 0;
      const severity = day <= (w.droughtUntil || 0) ? clamp(w.droughtSeverity || 0, 0, .95) : 0;
      const rain = baseRain * (1 - severity);
      r.temperatureC = seasonalTemp - lat - altitude * .0065 + (rand(w) - .5) * 2.2;
      r.rainfallMm = rain;
      r.humidity = clamp(.32 + rain / 30 + r.meanMoisture * .5, .12, .99);
      r.weather = rain > 1 ? 'rain' : r.meanMoisture < .18 ? 'dry' : 'stable';
      r.dryDays = rain < .4 && r.meanMoisture < .24 ? r.dryDays + 1 : Math.max(0, r.dryDays - 2);
      if (rain > 1) wetRegions++;
      if (r.dryDays > 16) dryRegions++;
      rainMean += rain;
    }
    for (const t of w.tiles) {
      const r = w.regions[t.regionId];
      t.temperatureC = r.temperatureC - Math.max(0, t.heightM - 300) * .0065;
      t.rainfallMm = r.rainfallMm * (.86 + hash01(w.seed + day, t.x, t.y) * .28);
    }
    if (wetRegions >= 18 && day - w.lastWeatherEvent > 9) {
      log(w, 'Uma frente úmida alcançou ' + wetRegions + ' regiões; a água volta a infiltrar no solo.');
      w.lastWeatherEvent = day; w.rainEvents++;
    } else if (dryRegions >= 5 && day - w.lastWeatherEvent > 9) {
      log(w, 'A baixa umidade persiste em ' + dryRegions + ' regiões; plantas e animais passam a disputar água.');
      w.lastWeatherEvent = day;
    }
    return { season, wetRegions, dryRegions, meanRain: rainMean / w.regions.length };
  }

  function triggerDrought(w, durationDays, severity) {
    const duration = Math.max(1, Math.floor(durationDays || 90));
    w.droughtSeverity = clamp(severity === undefined ? .82 : severity, .1, .95);
    w.droughtUntil = Math.max(w.droughtUntil || 0, w.day + duration);
    log(w, 'Intervenção experimental: precipitação reduzida em ' + Math.round(w.droughtSeverity * 100) + '% por ' + duration + ' dias. As respostas do solo, da vegetação, das populações e das comunidades não são pré-definidas.');
    return w.droughtUntil;
  }

  function updateSoilAndWater(w) {
    const runoff = new Float32Array(w.tiles.length);
    for (const t of w.tiles) {
      if (t.terrain === 'water') { t.surfaceWaterMm = 24; t.soilWaterMm = t.soilCapacityMm; continue; }
      const canopy = canopyAt(t);
      const infiltration = t.soilType === 'sandy' ? .72 : t.soilType === 'shallow' ? .54 : .82;
      const rainToSoil = t.rainfallMm * infiltration;
      const evaporativeDemand = Math.max(.14, (.11 + Math.max(-2, t.temperatureC) * .009) * (1 - canopy * .35));
      const transpiration = canopy * .24 + plantBiomass(t, ['grass', 'berry', 'reed']) * .00055;
      const raw = t.soilWaterMm + rainToSoil;
      const overflow = Math.max(0, raw - t.soilCapacityMm) * .55 + t.rainfallMm * (1 - infiltration);
      t.soilWaterMm = clamp(raw - evaporativeDemand - transpiration, 0, t.soilCapacityMm);
      const loss = Math.max(0, raw - t.soilWaterMm - evaporativeDemand - transpiration);
      const out = overflow + loss * .16;
      if (out > .1) {
        const dest = lowestNeighbor(w, t);
        if (dest) runoff[dest.i] += out * .5;
      }
      if (t.surfaceWaterMm > 0) t.surfaceWaterMm = Math.max(0, t.surfaceWaterMm - .8);
    }
    for (const t of w.tiles) {
      if (t.terrain === 'water' || runoff[t.i] <= .01) continue;
      const accepted = Math.min(t.soilCapacityMm - t.soilWaterMm, runoff[t.i]);
      t.soilWaterMm += accepted;
      t.surfaceWaterMm = clamp(t.surfaceWaterMm + runoff[t.i] - accepted, 0, 26);
    }
    for (const r of w.regions) {
      let amount = 0, count = 0;
      const sx = (r.id % 8) * 8, sy = Math.floor(r.id / 8) * 8;
      for (let y = sy; y < sy + 8; y++) for (let x = sx; x < sx + 8; x++) {
        const t = cellAt(w, x, y);
        if (t.terrain !== 'water') { amount += t.soilWaterMm / t.soilCapacityMm; count++; }
      }
      r.meanMoisture = count ? amount / count : 0;
    }
  }

  function lowestNeighbor(w, tile) {
    let best = null;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const n = cellAt(w, tile.x + dx, tile.y + dy);
      if (n && (!best || n.heightM < best.heightM)) best = n;
    }
    return best && best.heightM <= tile.heightM + 2 ? best : null;
  }

  function canopyAt(t) {
    let sum = 0;
    for (let i = 0; i < PLANTS.length; i++) sum += t.plants[i] * PLANTS[i].canopy / PLANTS[i].max;
    return clamp(sum, 0, .95);
  }
  function plantBiomass(t, ids) {
    let sum = 0;
    for (const id of ids) { const i = PLANTS.findIndex(p => p.id === id); if (i >= 0) sum += t.plants[i]; }
    return sum;
  }

  function updatePlants(w, day) {
    const season = seasonIndex(day);
    for (const t of w.tiles) {
      const moisture = t.terrain === 'water' ? 1 : clamp(t.soilWaterMm / t.soilCapacityMm, 0, 1);
      const shade = canopyAt(t);
      for (let i = 0; i < PLANTS.length; i++) {
        const p = PLANTS[i], b = t.plants[i];
        const dormantShrub = b <= .01 && (p.id === 'berry' || p.id === 'browse');
        const dormantTree = b < 100 && (p.id === 'broadleaf' || p.id === 'conifer');
        const dormantSeed = dormantShrub || dormantTree;
        if (b <= .01 && (!dormantSeed || !t.seedBank || t.seedBank[i] <= .02)) continue;
        const tempSuit = clamp((t.temperatureC - p.temp[0]) / 7, 0, 1) * clamp((p.temp[1] - t.temperatureC) / 7, 0, 1);
        const waterSuit = clamp(moisture / Math.max(.05, p.water[0]), 0, 1) * (moisture > p.water[1] && p.habitat !== 'water' ? clamp((1 - moisture) / .2, 0, 1) : 1);
        const nSuit = clamp(t.mineralNitrogenGPerM2 / 3.5, .08, 1);
        const light = p.id === 'broadleaf' || p.id === 'conifer' ? 1 - shade * .42 : 1 - shade * .72;
        const habitatSuit = (p.habitat === 'water' && t.terrain === 'water') || (p.habitat === 'shore' && t.soilType === 'riparian')
          || (p.habitat !== 'water' && p.habitat !== 'shore' && t.terrain === 'land') ? 1 : .12;
        const seasonalGrowth = p.seasonalGrowth ? p.seasonalGrowth[season] : 1;
        const suitability = tempSuit * waterSuit * nSuit * light * habitatSuit;
        const growth = Math.max(0, p.growth * seasonalGrowth * suitability * (1 - b / p.max));
        const waterCost = growth * .012;
        const germinationSeason = dormantTree ? season === 0 : seasonalGrowth > 1;
        const germination = dormantSeed && germinationSeason && moisture > p.water[0]
          ? Math.min(dormantTree ? .28 : 1.1, t.seedBank[i] * (dormantTree ? .035 : .08)) * suitability : 0;
        const actual = dormantShrub || (dormantTree && b <= .01) ? germination
          : t.terrain === 'water' ? growth : Math.min(growth, Math.max(0, t.soilWaterMm * .12) / .012) + (dormantTree ? germination : 0);
        const stressMortality = p.id === 'broadleaf' || p.id === 'conifer' ? .00008 : .00065;
        t.plants[i] = Math.max(0, b + actual - (1 - suitability) * b * stressMortality);
        if (dormantSeed && t.seedBank) t.seedBank[i] = Math.max(0, t.seedBank[i] - actual * (dormantTree ? .08 : .16));
        if (t.terrain !== 'water') t.soilWaterMm = Math.max(0, t.soilWaterMm - Math.min(t.soilWaterMm, waterCost));
        t.mineralNitrogenGPerM2 = Math.max(.05, t.mineralNitrogenGPerM2 - actual * .0005);
        t.detritusGPerM2 += Math.max(0, b - t.plants[i]) * .14;
        if (actual > .5 && day % 9 === 0 && rand(w) < .018 + suitability * .02) {
          const dx = Math.floor(rand(w) * 5) - 2, dy = Math.floor(rand(w) * 5) - 2;
          const target = cellAt(w, t.x + dx, t.y + dy);
          if (target && target.terrain === t.terrain && target.plants[i] < p.max * .28) target.seedBank[i] = Math.min(8, (target.seedBank[i] || 0) + .45);
        }
      }
    }
  }

  function nearby(w, x, y, radius, predicate) {
    let best = null, bestScore = -Infinity;
    const r = Math.ceil(radius);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const d = Math.hypot(dx, dy);
      if (d > radius) continue;
      const t = cellAt(w, x + dx, y + dy);
      if (!t || !predicate(t)) continue;
      const score = -d;
      if (score > bestScore) { best = t; bestScore = score; }
    }
    return best;
  }

  function cellsWithin(w, x, y, radius, predicate) {
    const cells = [], r = Math.ceil(radius);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.hypot(dx, dy) > radius) continue;
      const t = cellAt(w, Math.round(x) + dx, Math.round(y) + dy);
      if (t && predicate(t)) cells.push(t);
    }
    return cells;
  }

  function moveOne(w, agent, target, aquatic) {
    if (!target) return false;
    const choices = [];
    const pen = agent.speciesId === 'sheep' && agent.herdCommunityId !== null
      ? w.structures.find(s => s.complete && s.type === 'curral' && s.communityId === agent.herdCommunityId) : null;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const t = cellAt(w, agent.x + dx, agent.y + dy);
      if (!t || (aquatic ? t.terrain !== 'water' : t.terrain === 'water' || t.terrain === 'rock')) continue;
      if (pen && distance(t, pen) > (pen.radius || 3.5)) continue;
      choices.push(t);
    }
    choices.sort((a, b) => distance(a, target) - distance(b, target) + (a.slope - b.slope) * .08);
    const next = choices[0];
    if (!next) return false;
    let boundaryCost = 0;
    if (agent.communityId !== undefined && agent.communityId !== null) {
      for (const fence of w.structures) {
        if (!fence.complete || fence.type !== 'divisa' || fence.communityId === agent.communityId) continue;
        const radius = fence.radius || 4;
        const before = distance(agent, fence) < radius, after = distance(next, fence) < radius;
        if (before !== after) boundaryCost += .58;
      }
    }
    const carryingCost = carriedResources(agent) > .01 ? Math.min(1.2, carriedResources(agent) / 24) * .14 : 0;
    const travelCost = .18 + next.slope * .12 + boundaryCost + carryingCost;
    agent.energy = Math.max(0, agent.energy - travelCost);
    agent.travelCost = (agent.travelCost || 0) + travelCost;
    agent.headingX = next.x - agent.x; agent.headingY = next.y - agent.y;
    agent.x = next.x; agent.y = next.y;
    return true;
  }

  function eatPlants(w, tile, diet, amount) {
    let left = amount, eaten = 0;
    const candidates = diet.map(id => ({ id, i: PLANTS.findIndex(p => p.id === id) })).filter(p => p.i >= 0).sort((a, b) => tile.plants[b.i] - tile.plants[a.i]);
    for (const c of candidates) {
      if (left <= .02) break;
      const take = Math.min(left, tile.plants[c.i]);
      tile.plants[c.i] -= take; left -= take; eaten += take;
      tile.detritusGPerM2 += take * .035;
      if (tile.seedBank && (c.id === 'berry' || c.id === 'browse')) tile.seedBank[c.i] = Math.min(8, tile.seedBank[c.i] + take * .0025);
    }
    return eaten;
  }

  function feedSheep(w, tile, amount) {
    const browseIndex = PLANTS.findIndex(plant => plant.id === 'browse');
    const browseBefore = tile.plants[browseIndex];
    const browseEaten = eatPlants(w, tile, ['browse'], amount);
    const largeBush = browseBefore >= 70;
    return { eaten: browseEaten, energy: browseEaten * (largeBush ? 16.2 : 12.4) };
  }

  function findFoodCell(w, agent, diet, radius) {
    const perceived = agent.perception && agent.perception.resources || [];
    const local = perceived.filter(resource => resource.distance <= radius && diet.some(id => (resource.biomass[id] || 0) > .8))
      .sort((a, b) => a.distance - b.distance);
    if (local.length) return cellAt(w, local[0].x, local[0].y);
    return nearby(w, agent.x, agent.y, radius, t => t.terrain !== 'water' && diet.some(id => {
      const i = PLANTS.findIndex(p => p.id === id); return i >= 0 && t.plants[i] > .8;
    }));
  }

  function nearestPrey(w, animal, profile) {
    return w.animals.filter(b => b.alive && profile.prey.includes(b.speciesId) && distance(animal, b) < 7)
      .sort((a, b) => distance(animal, a) - distance(animal, b))[0] || null;
  }

  function nearestThreat(w, animal, radius) {
    const animalThreat = w.animals.filter(b => b.alive && b.id !== animal.id && species(b.speciesId, ANIMALS).prey.includes(animal.speciesId) && distance(animal, b) <= radius);
    const humanThreat = animal.habituation < .68 ? (animal.perception && animal.perception.people || [])
      .filter(sighting => sighting.visible && sighting.distance <= radius)
      .map(sighting => w.people.find(p => p.id === sighting.id && p.alive && (p.brain.lastAction === 'hunt' || p.state.includes('caç'))))
      .filter(Boolean) : [];
    return animalThreat.concat(humanThreat).sort((a, b) => distance(animal, a) - distance(animal, b))[0] || null;
  }

  function chooseAnimalAction(w, animal, inputs, utility) {
    const out = brainForward(animal.brain, inputs, ANIMAL_ACTIONS);
    let best = 0, bestScore = -Infinity;
    for (let i = 0; i < ANIMAL_ACTIONS.length; i++) {
      const score = utility[i] + out.logits[i] * .18 + (animal.brain.actionValues[i] || 0) * .12;
      if (score > bestScore) { best = i; bestScore = score; }
    }
    animal.brain.pending = { hidden: out.hidden, probs: out.probs, actionIndex: best, inputs: inputs.slice() };
    animal.brain.decisions++; animal.brain.lastAction = ANIMAL_ACTIONS[best];
    animal.brain.actionCounts[animal.brain.lastAction] = (animal.brain.actionCounts[animal.brain.lastAction] || 0) + 1;
    return ANIMAL_ACTIONS[best];
  }

  function animalFoodCell(w, animal, profile) {
    const resources = animal.perception && animal.perception.resources || [];
    const candidate = resources.filter(resource => (profile.aquatic ? resource.terrain === 'water' : resource.terrain !== 'water')
      && profile.diet.some(id => (resource.biomass[id] || 0) > .5))
      .sort((a, b) => {
        const valueA = profile.diet.reduce((sum, id) => sum + (a.biomass[id] || 0), 0) - a.distance * 4;
        const valueB = profile.diet.reduce((sum, id) => sum + (b.biomass[id] || 0), 0) - b.distance * 4;
        return valueB - valueA;
      })[0];
    return candidate ? cellAt(w, candidate.x, candidate.y) : null;
  }

  function animalHabitatCell(w, animal, profile) {
    let best = null, bestScore = -Infinity;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const t = cellAt(w, animal.x + dx, animal.y + dy);
      if (!t || (profile.aquatic ? t.terrain !== 'water' : t.terrain === 'water' || t.terrain === 'rock')) continue;
      const food = plantBiomass(t, profile.aquatic ? profile.diet : SHEEP_FORAGE);
      const score = food * .004 + (t.soilWaterMm / t.soilCapacityMm) * .2 - t.slope * .12 - distance(animal, t) * .018 + rand(w) * .08;
      if (score > bestScore) { best = t; bestScore = score; }
    }
    return best;
  }

  function moveAwayFrom(w, animal, threat, aquatic) {
    if (!threat) return false;
    const choices = [];
    const pen = animal.speciesId === 'sheep' && animal.herdCommunityId !== null
      ? w.structures.find(s => s.complete && s.type === 'curral' && s.communityId === animal.herdCommunityId) : null;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const t = cellAt(w, animal.x + dx, animal.y + dy);
      if (t && (aquatic ? t.terrain === 'water' : t.terrain !== 'water' && t.terrain !== 'rock')
          && (!pen || distance(t, pen) <= (pen.radius || 3.5))) choices.push(t);
    }
    choices.sort((a, b) => distance(b, threat) - distance(a, threat) + (a.slope - b.slope) * .08);
    if (!choices.length) return false;
    const next = choices[0];
    animal.headingX = next.x - animal.x; animal.headingY = next.y - animal.y;
    animal.energy = Math.max(0, animal.energy - .2);
    animal.x = next.x; animal.y = next.y; return true;
  }

  function updateAnimals(w) {
    feedCommunalHerds(w);
    const living = w.animals.filter(a => a.alive).sort((a, b) => a.id - b.id);
    for (const a of living) {
      if (!a.alive) continue;
      const p = species(a.speciesId, ANIMALS);
      a.ageDays++; a.reproductionCooldown = Math.max(0, a.reproductionCooldown - 1);
      if (a.beingLedBy) {
        const handler = w.people.find(person => person.id === a.beingLedBy && person.alive && person.leadingSheepId === a.id);
        if (!handler) { a.beingLedBy = null; a.state = 'solta'; }
        else { a.x = handler.x + .25; a.y = handler.y + .15; a.state = 'seguindo o condutor'; continue; }
      }
      a.perception = Senses.observe(w, a, 'animal', PLANTS);
      a.energy = clamp(a.energy - (p.aquatic ? .42 : .68 + p.mass * .003), 0, 100);
      if (p.water) a.hydration = clamp(a.hydration - .48, 0, 100);
      const water = p.water ? nearestWater(w, a, 32) : null;
      const localWater = p.water ? nearestWater(w, a, 5) : null;
      const food = animalFoodCell(w, a, p);
      const prey = p.prey.length ? nearestPrey(w, a, p) : null;
      const threat = nearestThreat(w, a, 5.5);
      const waterCue = !water && a.hydration < 62 ? bestPerceivedWaterCue(w, a) : null;
      const foodSignal = food ? clamp(1 - distance(a, food) / 5, 0, 1) : 0;
      const waterSignal = localWater ? clamp(1 - distance(a, localWater) / 5, 0, 1) : 0;
      const inputs = [
        clamp((86 - a.energy) / 86, 0, 1),
        p.water ? clamp((76 - a.hydration) / 76, 0, 1) : 0,
        foodSignal, waterSignal, threat ? 1 : 0, clamp(a.ageDays / p.life, 0, 1)
      ];
      const utilities = [
        a.energy < 94 ? .12 + inputs[0] * .2 + foodSignal * .56 : -.36,
        p.water && a.hydration < 78 && water ? .12 + inputs[1] * .78 + waterSignal * .3 : -.7,
        p.prey.length && a.energy < 88 ? .2 + (prey ? .62 : -.25) : -.52,
        a.energy < 32 ? .74 : .06,
        .22 + rand(w) * .12 + (!water && p.water && a.hydration < 68 ? .52 : 0),
        threat ? .98 : -.65
      ];
      let action = chooseAnimalAction(w, a, inputs, utilities);
      const here = cellAt(w, a.x, a.y);
      if (p.aquatic && here.terrain !== 'water') action = 'explore';
      const before = a.energy + (p.water ? a.hydration * .35 : 0);
      if (action === 'drink') {
        if (water && distance(a, water) <= 1.5) { drinkWater(w, a, water, 30); a.state = 'bebendo'; }
        else if (water) { moveOne(w, a, water, false); a.state = 'procurando água'; }
        else a.state = 'buscando água';
      } else if (action === 'feed') {
        if (food && distance(a, food) <= 1.6) {
          const meal = a.speciesId === 'sheep' ? feedSheep(w, food, p.food) : { eaten: eatPlants(w, food, p.diet, p.food), energy: 0 };
          const eaten = meal.eaten;
          a.energy = clamp(a.energy + (a.speciesId === 'sheep' ? meal.energy : eaten * (p.aquatic ? 19 : 10.2)), 0, 100);
          a.state = eaten > .1 ? 'alimentando-se' : 'buscando alimento';
        } else if (food) { moveOne(w, a, food, p.aquatic); a.state = 'migrando para alimento'; }
        else a.state = 'buscando alimento';
      } else if (action === 'hunt') {
        if (prey && distance(a, prey) <= 1.4 && rand(w) < .48) {
          prey.alive = false; w.deaths++; w.deathsByCause.predation++; a.energy = clamp(a.energy + 46, 0, 100);
          const carcass = cellAt(w, prey.x, prey.y); carcass.detritusGPerM2 += species(prey.speciesId, ANIMALS).mass * 190;
          log(w, 'Uma raposa capturou uma lebre; a matéria retorna ao ciclo ecológico.');
          a.state = 'caçando';
        } else if (prey) { moveOne(w, a, prey, false); a.state = 'caçando'; }
        else a.state = 'procurando presa';
      } else if (action === 'flee') {
        moveAwayFrom(w, a, threat, p.aquatic); a.state = 'fugindo de predador';
      } else if (action === 'rest') { a.energy = clamp(a.energy + 2.1, 0, 100); a.state = 'descansando'; }
      else {
        const target = waterCue || animalHabitatCell(w, a, p);
        if (target) moveOne(w, a, target, p.aquatic);
        a.state = p.aquatic && here.terrain !== 'water' ? 'buscando água' : 'explorando';
      }
      const after = a.energy + (p.water ? a.hydration * .35 : 0);
      updateBrain(a, clamp((after - before) / 20, -.8, .8));
      if (a.energy <= .1 || (p.water && a.hydration <= .1) || a.ageDays > p.life) {
        a.alive = false; w.deaths++;
        const cause = a.ageDays > p.life ? 'age' : p.water && a.hydration <= .1 ? 'dehydration' : 'starvation';
        w.deathsByCause[cause] = (w.deathsByCause[cause] || 0) + 1;
        const remains = cellAt(w, a.x, a.y);
        if (remains) remains.detritusGPerM2 += p.mass * 170;
        if (w.deaths % 5 === 0) log(w, 'A mortalidade animal depositou biomassa no estoque de detritos.');
      }
    }
    reproduceAnimals(w);
  }

  function reproduceAnimals(w) {
    const bySpecies = {};
    for (const a of w.animals) if (a.alive) (bySpecies[a.speciesId] ||= []).push(a);
    for (const [id, group] of Object.entries(bySpecies)) {
      const p = species(id, ANIMALS);
      if (group.length > (id === 'fox' ? 14 : 68)) continue;
      for (const a of group) {
        if (a.reproductionCooldown > 0 || a.energy < 74 || a.ageDays < 200) continue;
        const mate = group.find(b => b.id !== a.id && b.reproductionCooldown <= 30 && b.energy > 68 && distance(a, b) < 2.1
          && (id !== 'sheep' || a.herdCommunityId === null || b.herdCommunityId === a.herdCommunityId));
        if (!mate) continue;
        const domesticatedPair = id === 'sheep' && a.herdCommunityId !== null && mate.herdCommunityId === a.herdCommunityId;
        const bothRecentlyFed = (a.feedingEvents || 0) > 0 && (mate.feedingEvents || 0) > 0
          && w.day - (a.lastFedDay === undefined ? -999 : a.lastFedDay) <= 28
          && w.day - (mate.lastFedDay === undefined ? -999 : mate.lastFedDay) <= 28;
        const conceptionChance = domesticatedPair && bothRecentlyFed ? .06 : .0022;
        if (rand(w) >= conceptionChance) continue;
        a.reproductionCooldown = mate.reproductionCooldown = id === 'hare' ? 95 : 190;
        a.energy -= 14; mate.energy -= 12;
        const offspring = makeAnimal(w, id, a.x, a.y, true);
        if (id === 'sheep' && a.herdCommunityId !== null && mate.herdCommunityId === a.herdCommunityId) {
          offspring.herdCommunityId = a.herdCommunityId;
          offspring.habituation = Math.min(a.habituation || 0, mate.habituation || 0);
        }
        w.animals.push(offspring); w.births++; w.birthsByKind.animals++;
        break;
      }
    }
  }

  function brainForward(brain, inputs, actions) {
    const hiddenSize = brain.hiddenSize || 6, hidden = new Array(hiddenSize);
    const inputSize = brain.inputSize || 6;
    for (let h = 0; h < hiddenSize; h++) {
      let sum = 0;
      for (let i = 0; i < inputSize; i++) sum += brain.inputWeights[h * inputSize + i] * (inputs[i] || 0);
      hidden[h] = Math.tanh(sum);
    }
    const logits = new Array(actions.length);
    for (let o = 0; o < logits.length; o++) {
      let sum = 0;
      for (let h = 0; h < hiddenSize; h++) sum += brain.outputWeights[o * hiddenSize + h] * hidden[h];
      logits[o] = sum;
    }
    const max = Math.max(...logits), exps = logits.map(v => Math.exp(v - max)), total = exps.reduce((a, b) => a + b, 0);
    return { hidden, logits, probs: exps.map(v => v / total) };
  }

  function choosePeopleAction(w, p, inputs, utility) {
    const brain = p.brain, out = brainForward(brain, inputs, PEOPLE_ACTIONS);
    const plan = p.strategicPlan && p.strategicPlan.expiresDay >= w.day + 1 ? p.strategicPlan : null;
    let best = 0, bestScore = -Infinity;
    const scores = [];
    for (let i = 0; i < PEOPLE_ACTIONS.length; i++) {
      const strategyBias = plan && plan.action === PEOPLE_ACTIONS[i] && utility[i] > -.1
        ? .12 + clamp(plan.confidence || .5, 0, 1) * .22 : 0;
      const score = utility[i] + out.logits[i] * .2 + (brain.actionValues[i] || 0) * .18 + strategyBias;
      scores.push(score);
      if (score > bestScore) { best = i; bestScore = score; }
    }
    brain.pending = { hidden: out.hidden, probs: out.probs, actionIndex: best, inputs: inputs.slice(), scores };
    brain.decisions++; brain.lastAction = PEOPLE_ACTIONS[best];
    brain.actionCounts[brain.lastAction] = (brain.actionCounts[brain.lastAction] || 0) + 1;
    p.lastDecision = { action: PEOPLE_ACTIONS[best], scores, inputs: inputs.slice(), day: w.day };
    return PEOPLE_ACTIONS[best];
  }

  function setStrategicAiEnabled(w, enabled) {
    if (!w.strategicAI) w.strategicAI = { enabled: false, requests: [], enqueuedDay: -1, enqueuedToday: 0, decisions: 0, failures: 0 };
    w.strategicAI.enabled = !!enabled;
    if (!w.strategicAI.enabled) {
      w.strategicAI.requests.length = 0;
      for (const person of w.people) { person.strategicRequestPending = null; person.strategicPlan = null; }
    }
    return w.strategicAI.enabled;
  }

  function pullStrategicAiRequests(w, limit) {
    if (!w.strategicAI || !w.strategicAI.enabled) return [];
    const ai = w.strategicAI;
    const count = Math.max(1, Math.min(3, Math.floor(limit || 1)));
    const ready = [];
    while (ready.length < count && ai.requests.length) {
      const request = ai.requests.shift();
      const person = w.people.find(item => item.id === request.personId && item.alive);
      if (!person || !person.strategicRequestPending || person.strategicRequestPending.day !== request.requestedDay) continue;
      if (w.day > request.requestedDay + 18) {
        person.strategicRequestPending = null;
        person.nextStrategicDecisionDay = Math.max(person.nextStrategicDecisionDay || 0, w.day + 10);
        ai.failures++;
        continue;
      }
      ready.push(request);
    }
    return ready;
  }

  function applyStrategicAiDecision(w, personId, requestedDay, decision) {
    const person = w.people.find(item => item.id === personId && item.alive);
    const ai = w.strategicAI;
    if (!person || !ai || !ai.enabled) return false;
    const pending = person.strategicRequestPending;
    if (!pending || pending.day !== requestedDay) return false;
    person.strategicRequestPending = null;
    if (w.day > requestedDay + 18) {
      ai.failures++;
      person.nextStrategicDecisionDay = Math.max(person.nextStrategicDecisionDay || 0, w.day + 10);
      return false;
    }
    const action = String(decision && decision.action || '').trim();
    if (!PEOPLE_ACTIONS.includes(action) || !pending.candidates.includes(action)) {
      ai.failures++;
      person.nextStrategicDecisionDay = Math.max(person.nextStrategicDecisionDay || 0, w.day + 10);
      return false;
    }
    const confidence = Number(decision.confidence);
    person.strategicPlan = {
      action,
      confidence: Number.isFinite(confidence) ? clamp(confidence, 0, 1) : .5,
      reason: String(decision.reason || '').replace(/[<>\u0000-\u001f]/g, ' ').trim().slice(0, 150),
      createdDay: w.day,
      expiresDay: requestedDay + 18
    };
    ai.decisions++;
    return true;
  }

  function failStrategicAiRequest(w, personId, requestedDay) {
    const person = w.people.find(item => item.id === personId);
    const ai = w.strategicAI;
    if (!person || !ai) return false;
    if (person.strategicRequestPending && person.strategicRequestPending.day === requestedDay) {
      person.strategicRequestPending = null;
      person.nextStrategicDecisionDay = Math.max(person.nextStrategicDecisionDay || 0, w.day + 10);
      ai.failures++;
      return true;
    }
    return false;
  }

  function recordPersonalMemory(person, day) {
    if (!person.personalMemory) person.personalMemory = [];
    const state = String(person.state || '').slice(0, 50);
    const lesson = String(person.lastLesson || '').slice(0, 135);
    const previous = person.personalMemory[person.personalMemory.length - 1];
    if (previous && previous.state === state && previous.lesson === lesson && day - previous.day < 4) return;
    person.personalMemory.push({ day, state, lesson });
    if (person.personalMemory.length > 4) person.personalMemory.shift();
  }

  function queueStrategicAiRequest(w, person, community, utility) {
    const ai = w.strategicAI;
    if (!ai || !ai.enabled || person.strategicRequestPending) return;
    const day = w.day + 1;
    const urgent = person.foodReserve < 20 || person.hydration < 20 || person.health < 32 || person.conflictRisk > .72;
    const scheduled = day >= (person.nextStrategicDecisionDay || 1);
    const urgentDue = urgent && day >= (person.nextUrgentStrategicDecisionDay || 1);
    if (!scheduled && !urgentDue) return;
    if (ai.requests.length >= 12) return;
    if (ai.enqueuedDay !== day) { ai.enqueuedDay = day; ai.enqueuedToday = 0; }
    if (ai.enqueuedToday >= 2) return;

    const candidates = PEOPLE_ACTIONS.map((action, i) => ({ action, score: utility[i] }))
      .filter(item => item.action !== 'deliver' && item.score > -.1)
      .sort((a, b) => b.score - a.score).slice(0, 8).map(item => item.action);
    if (!candidates.length) return;
    const perception = person.perception || {};
    const resources = (perception.resources || []).filter(item => item.visible);
    const fruitPatches = resources.map(item => ({
      distance: Math.round(item.distance * 10) / 10,
      berries: Math.round(item.biomass && item.biomass.berry || 0),
      grass: Math.round(item.biomass && item.biomass.grass || 0)
    })).filter(item => item.berries > 4 || item.grass > 4).sort((a, b) => a.distance - b.distance).slice(0, 3);
    const water = resources.filter(item => item.waterSource).sort((a, b) => a.distance - b.distance)[0];
    const flock = (perception.animals || []).filter(item => item.speciesId === 'sheep' && item.distance < 10)
      .slice(0, 3).map(item => ({ distance: Math.round(item.distance * 10) / 10, visible: !!item.visible }));
    const logs = (perception.logs || []).filter(item => item.amount > .05).slice(0, 3)
      .map(item => ({ distance: Math.round(item.distance * 10) / 10, amount: Math.round(item.amount * 10) / 10, confidence: Math.round(item.confidence * 100) / 100 }));
    const request = {
      personId: person.id,
      requestedDay: day,
      candidateActions: candidates,
      context: {
        person: {
          name: person.name, ageYears: Math.floor(person.ageDays / 365),
          needs: { food: Math.round(person.foodReserve), water: Math.round(person.hydration), energy: Math.round(person.energy), health: Math.round(person.health), social: Math.round(person.socialNeed) },
          traits: { sociability: Math.round(person.sociability * 100), trust: Math.round(person.trust * 100), strength: Math.round(person.physicalStrength * 100) },
          skills: Object.fromEntries(Object.entries(person.skills || {}).map(([key, value]) => [key, Math.round(value * 100)]))
        },
        community: community ? {
          size: community.memberIds.filter(id => w.people.some(item => item.id === id && item.alive)).length,
          stores: { food: Math.round(communityFoodStock(community)), wood: Math.round(community.stores.wood || 0), stone: Math.round(community.stores.stone || 0), feed: Math.round(community.stores.feed || 0), gold: Math.round(community.stores.gold || 0) },
          hasShelter: w.structures.some(item => item.complete && item.type === 'abrigo' && item.communityId === community.id),
          hasCorral: w.structures.some(item => item.complete && item.type === 'curral' && item.communityId === community.id)
        } : null,
        perceived: { fruitPatches, nearestWater: water ? Math.round(water.distance * 10) / 10 : null, sheep: flock, looseLogs: logs },
        recentExperience: (person.personalMemory || []).slice(-3),
        candidateActions: candidates
      }
    };
    person.strategicRequestPending = { day, candidates };
    if (scheduled) person.nextStrategicDecisionDay = day + 60;
    person.nextUrgentStrategicDecisionDay = day + 12;
    ai.requests.push(request);
    ai.enqueuedToday++;
  }

  function updateBrain(p, reward) {
    const b = p.brain, pending = b.pending;
    if (!pending) return;
    const advantage = clamp(reward - b.baseline, -1, 1);
    const rate = b.learningRate || .027;
    const prior = b.actionValues[pending.actionIndex] || 0;
    b.actionValues[pending.actionIndex] = clamp(prior * .79 + reward * .21, -1, 1);
    for (let o = 0; o < pending.probs.length; o++) {
      const gradient = ((o === pending.actionIndex ? 1 : 0) - pending.probs[o]) * advantage;
      for (let h = 0; h < pending.hidden.length; h++) {
        const weightIndex = o * pending.hidden.length + h;
        b.outputWeights[weightIndex] = clamp(b.outputWeights[weightIndex] + rate * gradient * pending.hidden[h], -3, 3);
      }
    }
    b.baseline = b.baseline * .94 + reward * .06;
    b.rewardMean = b.rewardMean * .91 + reward * .09;
    b.updates++; p.lastReward = reward; b.pending = null;
    if (p.lastLesson === 'Ainda está aprendendo com o ambiente.' || !p.lastLesson) {
      p.lastLesson = reward > .12 ? 'A ação trouxe um benefício observável.' : reward < -.12 ? 'A ação teve custo sem atender uma necessidade.' : 'O resultado foi pequeno; ainda precisa comparar alternativas.';
    }
  }

  function activeCommunity(w, person) {
    return person.communityId === null ? null : w.communities.find(c => c.id === person.communityId && !c.dissolved) || null;
  }

  function bestPeopleFoodCell(w, person, radius) {
    let best = null, bestScore = -Infinity;
    const resources = person.perception && person.perception.resources || [];
    for (const resource of resources) {
      const food = HUMAN_FOOD.reduce((sum, id) => sum + (resource.biomass[id] || 0), 0);
      if (resource.terrain !== 'land' || resource.distance > radius || food < .8) continue;
      const score = Math.min(food, 80) * .018 - resource.distance * .065 - resource.slope * .09;
      if (score > bestScore) { best = cellAt(w, resource.x, resource.y); bestScore = score; }
    }
    return best;
  }

  function bestSheepFeedCell(w, person, radius) {
    const resources = person.perception && person.perception.resources || [];
    return resources.filter(resource => resource.terrain === 'land' && resource.distance <= radius && (resource.biomass.browse || 0) > .8)
      .sort((a, b) => ((Math.min(b.biomass.browse || 0, 100) + (b.biomass.browse >= 70 ? 25 : 0)) - b.distance * 5)
        - ((Math.min(a.biomass.browse || 0, 100) + (a.biomass.browse >= 70 ? 25 : 0)) - a.distance * 5))
      .map(resource => cellAt(w, resource.x, resource.y))[0] || null;
  }

  function nearestHuntable(w, person, radius) {
    const observations = person.perception && person.perception.animals || [];
    return observations.filter(sighting => sighting.visible && sighting.distance <= radius
      && species(sighting.speciesId, ANIMALS)?.huntable)
      .map(sighting => w.animals.find(a => a.id === sighting.id && a.alive))
      .filter(Boolean).sort((a, b) => distance(person, a) - distance(person, b))[0] || null;
  }

  function nearestKnownHuntable(person, radius) {
    return (person.perception && person.perception.animals || [])
      .filter(sighting => sighting.speciesId && species(sighting.speciesId, ANIMALS)?.huntable && sighting.distance <= radius)
      .sort((a, b) => (b.confidence - a.confidence) || (a.distance - b.distance))[0] || null;
  }

  function nearestFish(w, person, radius) {
    const sightings = person.perception && person.perception.animals || [];
    return sightings.filter(s => s.visible && s.distance <= radius && species(s.speciesId, ANIMALS)?.fishable)
      .map(s => w.animals.find(a => a.id === s.id && a.alive))
      .filter(Boolean).sort((a, b) => distance(person, a) - distance(person, b))[0] || null;
  }

  function bestHuntingGround(w, person, radius) {
    const community = activeCommunity(w, person);
    const ground = community && community.grounds && community.grounds.hunting;
    if (ground && distance(person, ground) <= radius) return cellAt(w, ground.x, ground.y);
    const sighting = nearestKnownHuntable(person, radius);
    return sighting ? cellAt(w, sighting.x, sighting.y) : null;
  }

  function bestFishingBank(w, person, radius) {
    let best = null, bestScore = -Infinity;
    for (const bank of cellsWithin(w, person.x, person.y, radius, t => t.terrain === 'land')) {
      const water = nearby(w, bank.x, bank.y, 1.5, t => t.terrain === 'water' && t.fishingSuitability > .02);
      if (!water) continue;
      const score = water.fishingSuitability - distance(person, bank) * .014 - bank.slope * .025;
      if (score > bestScore) { best = { bank, water, score }; bestScore = score; }
    }
    return best;
  }

  function markCommunityGround(w, person, kind, tile) {
    const community = activeCommunity(w, person);
    const livingMembers = community ? community.memberIds.filter(id => w.people.some(p => p.id === id && p.alive)).length : 0;
    if (!community || livingMembers < 3 || !tile) return null;
    if (!community.grounds) community.grounds = { hunting: null, fishing: null };
    const score = kind === 'hunting' ? tile.huntingSuitability : tile.fishingSuitability;
    const current = community.grounds[kind];
    if (current && distance(current, tile) <= 2) {
      current.lastUsed = w.day; current.visits = (current.visits || 0) + 1; current.score = score;
      return current;
    }
    if (current && current.boundaryStructureId) return current;
    if (current && w.day - (current.lastUsed || 0) < 28 && score < current.score * 1.25) return current;
    const ground = { x: tile.x, y: tile.y, radius: 4, score, visits: 1, lastUsed: w.day, markedDay: w.day, feature: localNameFeature(w, tile.x, tile.y), boundaryStructureId: null };
    community.grounds[kind] = ground;
    community.history.push('Demarcou uma área de ' + (kind === 'hunting' ? 'caça' : 'pesca') + ' perto de ' + ground.feature + '.');
    log(w, community.name + ' demarcou uma área de ' + (kind === 'hunting' ? 'caça' : 'pesca') + ' perto de ' + ground.feature + ', onde encontrou recursos disponíveis.');
    return ground;
  }

  function addHarvestedFood(person, community, amount) {
    const needed = Math.max(0, (90 - person.foodReserve) / FOOD_RESERVE_PER_UNIT);
    const eaten = Math.min(amount, needed);
    person.foodReserve = clamp(person.foodReserve + eaten * FOOD_RESERVE_PER_UNIT, 0, 100);
    person.energy = clamp(person.energy + eaten * .12, 0, 100);
    const surplus = Math.max(0, amount - eaten);
    if (community && distance(person, community) <= 6) community.stores.food += surplus;
    else person.carriedFood = Math.min(24, person.carriedFood + surplus);
    return { eaten, surplus };
  }

  function storeCommunityFruit(w, community, shelter, amount) {
    if (!community || amount <= 0) return 0;
    const units = Math.max(0, amount);
    community.stores.food = (community.stores.food || 0) + units;
    if (shelter && shelter.complete && shelter.type === 'abrigo' && shelter.communityId === community.id) {
      shelter.fruitStored = (shelter.fruitStored || 0) + units;
    }
    return units;
  }

  function removeStoredFruit(w, community, amount) {
    if (!community || amount <= 0) return 0;
    let remaining = amount;
    let removed = 0;
    for (const shelter of w.structures.filter(s => s.complete && s.type === 'abrigo' && s.communityId === community.id)) {
      const take = Math.min(shelter.fruitStored || 0, remaining);
      shelter.fruitStored = Math.max(0, (shelter.fruitStored || 0) - take);
      remaining -= take;
      removed += take;
      if (remaining <= .001) break;
    }
    return removed;
  }

  function humanHarvestSupport(w, person, community) {
    if (!community) return 0;
    return clamp(w.people.filter(p => p.alive && p.communityId === community.id && distance(p, person) <= 3.5).length - 1, 0, 4) / 4;
  }

  function nearestShelterFor(w, person) {
    return w.structures.filter(s => s.complete && s.type === 'abrigo' && s.communityId === person.communityId)
      .sort((a, b) => distance(person, a) - distance(person, b))[0] || null;
  }

  function nearestKnownStorage(w, person, community) {
    if (community) {
      const shelter = nearestShelterFor(w, person);
      return { community, shelter, pen: nearestPenFor(w, person), destination: shelter || community };
    }
    const sightings = person.perception && person.perception.knownStorages || [];
    for (const sighting of sightings.slice().sort((a, b) => a.distance - b.distance)) {
      const owner = w.communities.find(c => c.id === sighting.communityId && !c.dissolved);
      if (!owner) continue;
      const shelter = sighting.kind === 'shelter'
        ? w.structures.find(s => s.id === sighting.id && s.complete && s.type === 'abrigo') || null
        : null;
      return { community: owner, shelter, pen: null, destination: shelter || owner };
    }
    return { community: null, shelter: null, pen: null, destination: null };
  }

  function communityFoodStock(community) {
    return community ? (community.stores.food || 0) + (community.stores.meat || 0) * MEAT_NUTRITIONAL_VALUE : 0;
  }

  function communityMaterialStock(community) {
    return community ? (community.stores.wood || 0) + (community.stores.stone || 0) : 0;
  }

  function nearestKnownLog(person, radius) {
    return (person.perception && person.perception.logs || [])
      .filter(item => item.amount > .01 && item.distance <= radius)
      .sort((a, b) => (b.confidence - a.confidence) || (a.distance - b.distance))[0] || null;
  }

  function bestPerceivedWaterCue(w, agent) {
    const resources = agent.perception && agent.perception.resources || [];
    const candidates = resources.filter(r => r.visible && r.terrain === 'land' && r.distance > .8)
      .sort((a, b) => ((b.soilMoisture || 0) - b.distance * .012) - ((a.soilMoisture || 0) - a.distance * .012));
    return candidates.length ? cellAt(w, candidates[0].x, candidates[0].y) : null;
  }

  function nearestPenFor(w, person) {
    return w.structures.filter(s => s.complete && s.type === 'curral' && s.communityId === person.communityId)
      .sort((a, b) => distance(person, a) - distance(person, b))[0] || null;
  }

  function carriedResources(person) {
    return (person.carriedMeat || 0) + (person.carriedFeed || 0) + (person.carriedWood || 0)
      + (person.carriedStone || 0) + (person.carriedGold || 0) + (person.carriedFood || 0) + (person.carriedFruit || 0) + (person.carriedMaterial || 0);
  }

  function communityHerd(w, community) {
    if (!community) return [];
    const pen = w.structures.find(s => s.communityId === community.id && s.complete && s.type === 'curral');
    return w.animals.filter(a => a.alive && a.speciesId === 'sheep' &&
      (a.herdCommunityId === community.id || (pen && distance(a, pen) <= (pen.radius || 5)) || (!pen && distance(a, community) <= 5)));
  }

  function communityBuildingNeed(w, community, size) {
    if (!community) return 0;
    const plan = nextCommunityStructure(w, community, size || community.memberIds.length, communityStructures(w, community));
    if (!plan) return 0;
    const wood = Math.max(0, plan.woodCost - (community.stores.wood || 0));
    const stone = Math.max(0, plan.stoneCost - (community.stores.stone || 0));
    return clamp((wood + stone) / Math.max(1, plan.woodCost + plan.stoneCost), 0, 1);
  }

  function feedCommunalHerds(w) {
    for (const community of w.communities) {
      if (community.dissolved || (community.stores.feed || 0) <= .1) continue;
      const pen = w.structures.find(s => s.communityId === community.id && s.complete && s.type === 'curral');
      if (!pen) continue;
      const flock = communityHerd(w, community).filter(a => distance(a, pen) <= (pen.radius || 5))
        .sort((a, b) => a.energy - b.energy || a.id - b.id);
      for (const animal of flock) {
        if (community.stores.feed <= .1 || animal.energy >= 94) continue;
        const ration = Math.min(11, community.stores.feed, 94 - animal.energy);
        if (ration <= .05) continue;
        community.stores.feed -= ration;
        animal.energy = clamp(animal.energy + ration * 1.25, 0, 100);
        animal.habituation = clamp((animal.habituation || 0) + .045 + (animal.lastFedDay >= w.day - 4 ? .018 : 0), 0, 1);
        animal.lastFedDay = w.day; animal.feedingEvents = (animal.feedingEvents || 0) + 1;
        if (animal.habituation >= .72 && distance(animal, pen) <= 3.5) animal.herdCommunityId = community.id;
      }
    }
  }

  function withdrawCommunityFood(w, community, amount) {
    if (!community || amount <= 0) return { meat: 0, fruit: 0, nutrition: 0 };
    let remainingNutrition = amount;
    const meat = Math.min(community.stores.meat || 0, remainingNutrition / MEAT_NUTRITIONAL_VALUE);
    community.stores.meat = Math.max(0, (community.stores.meat || 0) - meat);
    remainingNutrition -= meat * MEAT_NUTRITIONAL_VALUE;
    let storedMeat = meat;
    for (const shelter of w.structures.filter(s => s.complete && s.type === 'abrigo' && s.communityId === community.id)) {
      const take = Math.min(shelter.meatStored || 0, storedMeat);
      shelter.meatStored = Math.max(0, (shelter.meatStored || 0) - take);
      storedMeat -= take;
      if (storedMeat <= .001) break;
    }
    const plantFood = Math.min(community.stores.food || 0, remainingNutrition);
    community.stores.food = Math.max(0, (community.stores.food || 0) - plantFood);
    removeStoredFruit(w, community, plantFood);
    return { meat, fruit: plantFood, nutrition: meat * MEAT_NUTRITIONAL_VALUE + plantFood };
  }

  function attemptHumanHunt(w, person, prey, community) {
    if (!prey || !prey.alive || person.carriedMeat > .01 || !nearestShelterFor(w, person)) return false;
    const tile = cellAt(w, Math.round(prey.x), Math.round(prey.y));
    const profile = species(prey.speciesId, ANIMALS);
    const support = humanHarvestSupport(w, person, community);
    const probability = clamp(profile.catchability + person.skills.hunt * .22 + person.physicalStrength * .1
      + support * .1 + (tile ? tile.huntingSuitability : 0) * .14 - person.injury * .003, .06, .86);
    person.energy = Math.max(0, person.energy - 1.05);
    person.hydration = Math.max(0, person.hydration - .12);
    if (rand(w) >= probability) {
      person.skills.hunt = clamp(person.skills.hunt + .003, 0, 1);
      person.state = 'caça sem captura';
      person.lastLesson = 'A presa escapou; perseguir custou energia e hidratação. Uma área com mais presas ou ajuda de outros membros melhora a próxima tentativa.';
      return false;
    }
    prey.alive = false; w.deaths++; w.deathsByCause.harvest++;
    w.harvests.hunting++;
    if (tile) tile.detritusGPerM2 += prey.massKg * 8;
    const meat = clamp(prey.massKg * .48, 1.2, 28);
    person.carriedMeat = meat;
    person.skills.hunt = clamp(person.skills.hunt + .012, 0, 1);
    person.state = 'carregando carne';
    person.lastLesson = 'A captura gerou carne, mas a reserva só fica disponível depois que a carga chega a um abrigo.';
    markCommunityGround(w, person, 'hunting', tile);
    log(w, person.name + ' caçou ' + profile.name.toLowerCase() + ' e carregou ' + meat.toFixed(1) + ' unidades de carne para armazenar em um abrigo.');
    return true;
  }

  function attemptHumanFishing(w, person, fish, community) {
    if (!fish || !fish.alive) return false;
    const tile = cellAt(w, Math.round(fish.x), Math.round(fish.y));
    const support = humanHarvestSupport(w, person, community);
    const probability = clamp(.12 + person.skills.fish * .24 + support * .08 + (tile ? tile.fishingSuitability : 0) * .46, .06, .84);
    person.energy = Math.max(0, person.energy - .72);
    person.hydration = Math.max(0, person.hydration - .08);
    if (rand(w) >= probability) {
      person.skills.fish = clamp(person.skills.fish + .003, 0, 1);
      person.state = 'pesca sem captura';
      person.lastLesson = 'Os peixes escaparam; a tentativa gastou tempo e energia. A chance melhora em água com mais peixes e com prática ou ajuda.';
      return false;
    }
    fish.alive = false; w.deaths++; w.deathsByCause.harvest++;
    w.harvests.fishing++;
    if (tile) tile.detritusGPerM2 += fish.massKg * 4;
    const meat = clamp(fish.massKg * 7.5, 1.2, 4.5);
    const foodResult = addHarvestedFood(person, community, meat);
    person.skills.fish = clamp(person.skills.fish + .012, 0, 1);
    person.state = 'pescando';
    person.lastLesson = 'A captura trouxe alimento; retirar muitos peixes antes da reprodução reduz o estoque e torna este ponto pior para pescar.';
    markCommunityGround(w, person, 'fishing', tile);
    log(w, person.name + ' pescou em ' + (tile && tile.waterKind === 'lake' ? 'um lago' : 'um trecho de rio') + ' e obteve ' + meat.toFixed(1) + ' unidades de alimento.');
    return true;
  }

  function huntForFood(w, person, community) {
    const prey = nearestHuntable(w, person, 2.25);
    if (prey) return attemptHumanHunt(w, person, prey, community);
    const ground = bestHuntingGround(w, person, 13);
    if (ground) {
      moveOne(w, person, ground, false);
      person.state = 'rastreando presas';
      person.lastLesson = 'O deslocamento custa energia; a qualidade deste ponto estima presas e cobertura, mas não garante uma captura.';
    } else {
      person.state = 'sem área de caça conhecida';
      person.lastLesson = 'Não há presas detectadas por perto; procurar alimento vegetal ou migrar evita insistir em um local vazio.';
    }
    return false;
  }

  function fishForFood(w, person, community) {
    const fish = nearestFish(w, person, 2.2);
    if (fish) return attemptHumanFishing(w, person, fish, community);
    const ground = bestFishingBank(w, person, 13);
    if (ground) {
      moveOne(w, person, ground.bank, false);
      person.state = 'indo para um ponto de pesca';
      person.lastLesson = 'A margem oferece acesso a peixes detectados na água; o trajeto custa energia e o estoque pode mudar.';
    } else {
      person.state = 'sem ponto de pesca conhecido';
      person.lastLesson = 'Não há peixes detectados em água alcançável; procurar alimento em terra ou migrar evita insistir sem retorno.';
    }
    return false;
  }

  function communityRelation(w, a, b) {
    const key = Math.min(a.id, b.id) + ':' + Math.max(a.id, b.id);
    return w.communityRelations[key] || (w.communityRelations[key] = { a: Math.min(a.id, b.id), b: Math.max(a.id, b.id), trust: .12, tension: 0, trades: 0, conflicts: 0 });
  }

  function ensureCommunityGovernanceState(community) {
    community.properties = community.properties || [];
    community.assignments = community.assignments || [];
    community.satisfaction = Number.isFinite(community.satisfaction) ? community.satisfaction : .5;
    community.lastGovernanceDay = Number.isFinite(community.lastGovernanceDay) ? community.lastGovernanceDay : -999;
    community.lastPropertyDay = Number.isFinite(community.lastPropertyDay) ? community.lastPropertyDay : -999;
    community.leadershipChallenge = community.leadershipChallenge || null;
  }

  function selectCommunityLeader(w, community, members) {
    if (!members.length) return null;
    const current = members.find(person => person.id === community.leaderId);
    if (current) return current;
    const eligible = members.filter(person => person.ageDays >= 12 * 365);
    const leader = (eligible.length ? eligible : members).slice().sort((a, b) => (b.prestige || 0) + b.skills.diplomacy * 1.4 + b.sociability * .25
      - ((a.prestige || 0) + a.skills.diplomacy * 1.4 + a.sociability * .25) || a.id - b.id)[0];
    community.leaderId = leader.id;
    if (!community.leaderChosenDay) community.leaderChosenDay = w.day;
    return leader;
  }

  function communitySatisfaction(w, community) {
    const members = community.memberIds.map(id => w.people.find(person => person.id === id && person.alive)).filter(Boolean);
    if (!members.length) return 0;
    const meanFood = members.reduce((sum, person) => sum + person.foodReserve, 0) / members.length;
    const meanHealth = members.reduce((sum, person) => sum + person.health, 0) / members.length;
    const meanSocialNeed = members.reduce((sum, person) => sum + person.socialNeed, 0) / members.length;
    const foodSecurity = clamp(clamp(meanFood / 68, 0, 1) * .55
      + clamp(communityFoodStock(community) / Math.max(1, members.length * 5), 0, 1) * .45, 0, 1);
    const shelter = w.structures.some(structure => structure.complete && structure.type === 'abrigo' && structure.communityId === community.id) ? 1 : .4;
    const social = clamp(1 - meanSocialNeed / 100 * .68 + (community.cohesion || 0) * .32, 0, 1);
    return clamp(foodSecurity * .43 + social * .21 + meanHealth / 100 * .2 + shelter * .08 + (community.cohesion || 0) * .08, 0, 1);
  }

  function taskForCommunity(w, community, members) {
    const size = members.length, foodPerMember = communityFoodStock(community) / Math.max(1, size);
    const herd = communityHerd(w, community);
    const hasPen = w.structures.some(structure => structure.complete && structure.type === 'curral' && structure.communityId === community.id);
    const peopleNeedFood = members.some(person => person.foodReserve < 42);
    // Protect the people before investing labor in livestock or buildings. A common
    // reserve is a buffer; personal reserves still determine who is in immediate danger.
    if (foodPerMember < 8 || peopleNeedFood) return {
      action: 'forage', title: 'buscar alimento para a comunidade', skill: 'forage', priority: 'urgent'
    };
    if (hasPen && herd.length && (community.stores.feed || 0) < Math.max(8, herd.length * 5)) return { action: 'collect_feed', title: 'repor brotos para o rebanho', skill: 'care' };
    const taggedHerdSize = w.animals.filter(animal => animal.alive && animal.speciesId === 'sheep' && animal.herdCommunityId === community.id).length;
    const observedWildSheep = hasPen && taggedHerdSize < 4 && members.some(person => (person.perception && person.perception.animals || []).some(sighting => {
      const sheep = w.animals.find(animal => animal.id === sighting.id && animal.alive);
      return sighting.speciesId === 'sheep' && sighting.visible && sighting.distance <= 5.5 && sheep && sheep.herdCommunityId === null && !sheep.beingLedBy;
    }));
    if (observedWildSheep) return { action: 'capture_sheep', title: 'capturar e conduzir uma ovelha ao curral', skill: 'care' };
    if (canCommunityBuild(w, community, size)) return { action: 'build', title: 'construir uma estrutura comunitária', skill: 'build' };
    if (size >= 3 && communityBuildingNeed(w, community, size) > .08) return { action: 'gather', title: 'reunir materiais para a construção', skill: 'gather' };
    return null;
  }

  function assignCommunityTasks(w, community, leader, members) {
    const desired = taskForCommunity(w, community, members);
    if (!desired || members.length < 2) return;
    const capacity = desired.priority === 'urgent'
      ? Math.min(5, Math.max(1, Math.ceil(members.length / 3)))
      : Math.min(3, Math.max(1, Math.ceil(members.length / 5)));
    const active = members.filter(person => person.assignment && person.assignment.expiresDay >= w.day);
    let open = Math.max(0, capacity - active.length);
    while (open > 0) {
      const hasPen = w.structures.some(structure => structure.complete && structure.type === 'curral' && structure.communityId === community.id);
      const eligible = person => {
        if (person.ageDays < 12 * 365) return false;
        // Do not assign already depleted people to work that could be done by a
        // healthier member. If everyone is depleted, their own survival policy wins.
        if (person.hydration < 24 || person.energy < 14 || person.health < 28 || person.foodReserve < 14) return false;
        if (desired.action === 'build') return person.energy > 27 && person.hydration > 18 && person.foodReserve > 16
          && person.buildCooldown <= 0 && canCommunityBuild(w, community, members.length);
        if (desired.action === 'collect_feed') return hasPen && person.energy > 12 && (person.perception && person.perception.resources || []).some(item => item.visible && (item.biomass.browse || 0) > 1);
        if (desired.action === 'capture_sheep') return hasPen && !person.leadingSheepId && person.energy > 18
          && (person.perception && person.perception.animals || []).some(sighting => sighting.speciesId === 'sheep' && sighting.visible && sighting.distance <= 5.5
            && w.animals.some(animal => animal.id === sighting.id && animal.alive && animal.herdCommunityId === null && !animal.beingLedBy));
        if (desired.action === 'gather') return person.energy > 12 && (person.perception && person.perception.resources || []).some(item => item.visible
          && (item.stone > 0 || item.goldOre > 0 || (item.biomass.broadleaf || 0) + (item.biomass.conifer || 0) > 260));
        if (desired.action === 'forage') return person.energy > 8 && !!bestPeopleFoodCell(w, person, 5);
        return true;
      };
      const candidate = members.filter(person => person.id !== leader.id && eligible(person) && !(person.assignment && person.assignment.expiresDay >= w.day))
        .sort((a, b) => (b.skills[desired.skill] || 0) + b.energy * .003 - (a.skills[desired.skill] || 0) - a.energy * .003 || a.id - b.id)[0];
      if (!candidate) break;
      candidate.assignment = { action: desired.action, title: desired.title, skill: desired.skill, assignedBy: leader.id,
        assignedDay: w.day, expiresDay: w.day + (desired.priority === 'urgent' ? 7 : 21), communityId: community.id,
        priority: desired.priority || 'normal', pauseReason: null, lastPausedDay: null };
      community.assignments.push({ personId: candidate.id, action: desired.action, assignedDay: w.day, status: 'delegada' });
      if (community.assignments.length > 16) community.assignments.shift();
      community.history.push(leader.name + ' delegou a ' + candidate.name + ' a tarefa: ' + desired.title + '.');
      open--;
    }
  }

  function acquireCommunityProperty(w, community) {
    ensureCommunityGovernanceState(community);
    const livingMembers = community.memberIds.map(id => w.people.find(person => person.id === id && person.alive)).filter(Boolean);
    const members = livingMembers.length;
    const meanPersonalFood = members ? livingMembers.reduce((sum, person) => sum + person.foodReserve, 0) / members : 0;
    if (members < 6 || community.satisfaction < .48 || w.day - community.lastPropertyDay < 90
        || (community.stores.gold || 0) < 3 || (community.stores.wood || 0) < 20 || (community.stores.stone || 0) < 8
        || meanPersonalFood < 45) return null;
    const properties = community.properties || [];
    let best = null, bestScore = -Infinity;
    for (const tile of w.tiles) {
      const centerDistance = distance(tile, community);
      if (tile.terrain !== 'land' || tile.slope > .45 || centerDistance < 8 || centerDistance > 22) continue;
      const overlapsCommunity = w.communities.some(other => !other.dissolved && other.id !== community.id
        && (other.properties || []).some(property => distance(tile, property) < (property.radius || 5) + 2));
      if (overlapsCommunity || properties.some(property => distance(tile, property) < (property.radius || 5) + 5)) continue;
      const biomass = plantBiomass(tile, ['grass', 'berry', 'browse', 'broadleaf', 'conifer']);
      const waterAccess = Math.max(0, 8 - tile.waterDist);
      const score = Math.log1p(biomass) * .22 + waterAccess * .12 - tile.slope * .8 - centerDistance * .025
        + hash01(w.seed + community.id * 73, tile.x, tile.y) * .04;
      if (score > bestScore) { best = tile; bestScore = score; }
    }
    if (!best) return null;
    community.stores.gold -= 3; community.stores.wood -= 20; community.stores.stone -= 8;
    const property = { id: w.nextId++, communityId: community.id, x: best.x, y: best.y, radius: 5, acquiredDay: w.day,
      feature: localNameFeature(w, best.x, best.y) };
    community.properties.push(property); community.lastPropertyDay = w.day;
    const message = community.name + ' adquiriu uma nova propriedade perto de ' + property.feature + ' por 3 ouro, 20 madeira e 8 pedra.';
    community.history.push(message); log(w, message);
    return property;
  }

  function updateCommunityGovernance(w) {
    for (const community of w.communities) {
      if (community.dissolved) continue;
      ensureCommunityGovernanceState(community);
      const members = community.memberIds.map(id => w.people.find(person => person.id === id && person.alive)).filter(Boolean);
      if (!members.length) continue;
      for (const member of members) if (member.assignment && member.assignment.expiresDay < w.day) {
        const expired = (community.assignments || []).slice().reverse().find(item => item.personId === member.id && item.status === 'delegada');
        if (expired) expired.status = 'expirada';
        member.assignment = null;
      }
      const leader = selectCommunityLeader(w, community, members);
      community.satisfaction = communitySatisfaction(w, community);
      const challengers = members.filter(person => person.id !== leader.id && person.ageDays >= 12 * 365 && (person.prestige || 0) > (leader.prestige || 0))
        .sort((a, b) => (b.prestige || 0) - (a.prestige || 0) || a.id - b.id);
      const candidate = challengers[0];
      if (candidate) {
        const relations = members.filter(person => person.id !== candidate.id).map(person => w.socialLinks[candidate.id + ':' + person.id] || w.socialLinks[person.id + ':' + candidate.id]).filter(Boolean);
        const support = relations.length ? relations.filter(link => link.trust >= .25).length / (members.length - 1) : 0;
        if (support >= .34) {
          if (community.leadershipChallenge && community.leadershipChallenge.candidateId === candidate.id) community.leadershipChallenge.days++;
          else community.leadershipChallenge = { candidateId: candidate.id, days: 1 };
          if (community.leadershipChallenge.days >= 7) {
            const previous = leader;
            community.leaderId = candidate.id; community.leadershipChallenge = null;
            const message = candidate.name + ' assumiu a liderança de ' + community.name + ' após superar o prestígio de ' + previous.name + ' e obter apoio dos membros.';
            community.history.push(message); log(w, message);
          }
        } else community.leadershipChallenge = null;
      } else community.leadershipChallenge = null;
      if (w.day - community.lastGovernanceDay >= 8) {
        assignCommunityTasks(w, community, members.find(person => person.id === community.leaderId) || leader, members);
        community.lastGovernanceDay = w.day;
      }
      if (w.day % 30 === 0) acquireCommunityProperty(w, community);
    }
  }

  function completeCommunityTask(w, person, action, beforeState, afterState) {
    const task = person.assignment;
    if (!task || task.expiresDay < w.day || task.communityId !== person.communityId) return false;
    let succeeded = false;
    if (task.action === 'forage' && action === 'forage') succeeded = afterState.food > beforeState.food + .02;
    else if (task.action === 'collect_feed' && action === 'collect_feed') {
      if (afterState.carriedFeed > beforeState.carriedFeed + .02) { task.action = 'deliver'; return false; }
    } else if (task.action === 'gather' && (action === 'gather' || action === 'collect_log')) {
      if (afterState.carriedWood > beforeState.carriedWood + .02 || afterState.carriedStone > beforeState.carriedStone + .02 || afterState.carriedGold > beforeState.carriedGold + .02) {
        task.action = 'deliver'; return false;
      }
    } else if (task.action === 'capture_sheep' && action === 'capture_sheep' && person.leadingSheepId) { task.action = 'lead_sheep'; return false; }
    else if (task.action === 'build' && action === 'build') succeeded = afterState.buildProgress > beforeState.buildProgress;
    else if (task.action === 'raid' && action === 'raid' && person.lastRaidSuccess) { task.action = 'deliver'; person.lastRaidSuccess = false; return false; }
    else if (task.action === 'deliver' && action === 'deliver') succeeded = afterState.food > beforeState.food + .02 || afterState.feed > beforeState.feed + .02
      || afterState.wood > beforeState.wood + .02 || afterState.stone > beforeState.stone + .02 || afterState.gold > beforeState.gold + .02;
    else if (task.action === 'lead_sheep' && action === 'lead_sheep') succeeded = beforeState.leadingSheepId && !person.leadingSheepId;
    if (!succeeded) return false;
    const community = w.communities.find(group => group.id === person.communityId && !group.dissolved);
    const leader = community && w.people.find(member => member.id === community.leaderId && member.alive);
    person.prestige = (person.prestige || 0) + 1;
    if (leader && leader.id !== person.id) leader.prestige = (leader.prestige || 0) + .2;
    person.assignment = null; person.lastRaidSuccess = false;
    if (community) {
      community.history.push(person.name + ' concluiu a tarefa delegada (' + task.title + ') e ganhou 1 prestígio; a liderança recebeu 0,2.');
      const record = (community.assignments || []).slice().reverse().find(item => item.personId === person.id && item.status === 'delegada');
      if (record) record.status = 'concluída';
    }
    person.lastLesson = 'Concluir uma tarefa delegada aumentou o prestígio na comunidade e também reforçou a autoridade de quem organizou o trabalho.';
    return true;
  }

  function nearestPerceivedSheep(w, person, radius) {
    return (person.perception && person.perception.animals || []).filter(sighting => sighting.speciesId === 'sheep'
      && sighting.visible && sighting.distance <= radius && w.animals.some(animal => animal.id === sighting.id && animal.alive
        && animal.speciesId === 'sheep' && animal.herdCommunityId === null && !animal.beingLedBy))
      .sort((a, b) => a.distance - b.distance)[0] || null;
  }

  function captureSheep(w, person, community, sighting) {
    if (!community || !sighting || !sighting.visible) return false;
    const pen = nearestPenFor(w, person);
    const sheep = w.animals.find(animal => animal.id === sighting.id && animal.alive && animal.speciesId === 'sheep');
    if (!pen || !sheep || sheep.herdCommunityId !== null || sheep.beingLedBy || person.leadingSheepId) return false;
    const flockSize = communityHerd(w, community).filter(animal => animal.herdCommunityId === community.id).length;
    const capacity = Math.max(4, Math.floor((pen.radius || 3.5) * 1.6));
    if (flockSize >= capacity) { person.state = 'curral sem espaço'; return false; }
    if (distance(person, sheep) > 1.45) {
      moveOne(w, person, cellAt(w, Math.round(sheep.x), Math.round(sheep.y)), false);
      person.state = 'aproximando-se da ovelha';
      person.lastLesson = 'A ovelha só pode ser conduzida a partir de perto; a aproximação custa energia e ela ainda pode fugir.';
      return false;
    }
    sheep.beingLedBy = person.id; person.leadingSheepId = sheep.id;
    person.energy = Math.max(0, person.energy - .9); person.hydration = Math.max(0, person.hydration - .18);
    sheep.state = 'sendo conduzida';
    person.state = 'conduzindo ovelha';
    person.lastLesson = 'A ovelha foi alcançada. Conduzi-la até o curral exige tempo e energia; lá ela poderá consumir brotos guardados.';
    log(w, person.name + ' alcançou uma ovelha selvagem e começou a conduzi-la ao curral de ' + community.name + '.');
    return true;
  }

  function leadSheep(w, person, community) {
    const sheep = w.animals.find(animal => animal.id === person.leadingSheepId && animal.alive && animal.beingLedBy === person.id);
    const pen = community && nearestPenFor(w, person);
    if (!sheep || !pen) {
      if (sheep) { sheep.beingLedBy = null; sheep.state = 'fugiu durante a condução'; }
      person.leadingSheepId = null; person.state = 'sem ovelha para conduzir'; return false;
    }
    if (distance(person, pen) > 1.4) {
      moveOne(w, person, cellAt(w, pen.x, pen.y), false);
      person.energy = Math.max(0, person.energy - .38);
      person.hydration = Math.max(0, person.hydration - .08);
      sheep.x = person.x + .25; sheep.y = person.y + .15;
      sheep.state = 'seguindo o condutor'; person.state = 'conduzindo ovelha ao curral';
      person.lastLesson = 'A condução aproxima a ovelha do curral e consome energia; manter o trajeto curto reduz o custo.';
      return false;
    }
    sheep.x = pen.x + .2; sheep.y = pen.y + .2;
    sheep.beingLedBy = null; sheep.herdCommunityId = community.id;
    sheep.habituation = Math.max(sheep.habituation || 0, .72); sheep.lastFedDay = w.day;
    person.leadingSheepId = null; person.energy = Math.max(0, person.energy - .2);
    sheep.state = 'no curral'; person.state = 'ovelha entregue ao curral';
    person.lastLesson = 'A ovelha chegou ao curral e agora pertence ao rebanho comunitário; a ração guardada será consumida pelo rebanho.';
    community.history.push(person.name + ' conduziu uma ovelha selvagem até o curral.');
    log(w, person.name + ' entregou uma ovelha ao curral de ' + community.name + '.');
    return true;
  }

  function nearestRaidTarget(w, person, community) {
    if (!community || !person.perception) return null;
    return (person.perception.knownStorages || []).filter(sighting => sighting.kind === 'shelter' && sighting.confidence >= .28
      && sighting.communityId !== community.id && sighting.distance <= 20)
      .map(sighting => {
        const owner = w.communities.find(group => group.id === sighting.communityId && !group.dissolved);
        const shelter = w.structures.find(structure => structure.id === sighting.id && structure.complete && structure.type === 'abrigo');
        if (!owner || !shelter) return null;
        return { sighting, community: owner, shelter, distance: distance(person, shelter), relation: communityRelation(w, community, owner) };
      }).filter(Boolean).filter(target => target.relation.tension >= .28 || target.relation.trust < .06)
      .sort((a, b) => a.distance - b.distance || a.community.id - b.community.id)[0] || null;
  }

  function attemptRaid(w, person, community, target) {
    if (!community || !target || !target.community || !target.shelter || !target.shelter.complete) return false;
    if (distance(person, target.shelter) > 1.5) {
      moveOne(w, person, cellAt(w, target.shelter.x, target.shelter.y), false);
      person.state = 'indo observar o armazém rival';
      person.lastLesson = 'A comunidade só ataca um armazém que foi percebido recentemente e cuja relação já está tensa; a aproximação também consome energia.';
      return false;
    }
    const targetGroup = target.community, relation = communityRelation(w, community, targetGroup);
    const availableFood = communityFoodStock(targetGroup);
    if (availableFood <= .1 || (relation.tension < .28 && relation.trust >= .06)) {
      person.state = 'armazém sem alimento acessível'; return false;
    }
    const attackers = w.people.filter(member => member.alive && member.communityId === community.id && distance(member, person) <= 4);
    const defenders = w.people.filter(member => member.alive && member.communityId === targetGroup.id && distance(member, target.shelter) <= 4);
    const strength = group => group.reduce((sum, member) => sum + member.physicalStrength * .55 + member.energy * .006 + member.skills.diplomacy * .12, 0);
    const attackPower = strength(attackers), defensePower = strength(defenders) + (target.shelter.complete ? .45 : 0);
    person.energy = Math.max(0, person.energy - 3.8); person.hydration = Math.max(0, person.hydration - .45);
    if (defensePower >= attackPower * 1.08) {
      w.raidAttempts++;
      person.injury += 1.5 + Math.min(3, defensePower - attackPower) * .45;
      person.health = Math.max(0, person.health - person.injury * .25);
      relation.tension = clamp(relation.tension + .16, 0, 1); relation.trust = Math.max(0, relation.trust - .12); relation.conflicts++;
      person.state = 'assalto repelido'; person.lastRaidSuccess = false; w.conflicts++;
      const message = targetGroup.name + ' protegeu seu armazém; ' + person.name + ' recuou ferido e a tensão entre as comunidades aumentou.';
      community.history.push(message); targetGroup.history.push(message); log(w, message);
      return false;
    }
    const loot = Math.min(8 + attackers.length * 2, availableFood * .3, 18);
    const stolen = withdrawCommunityFood(w, targetGroup, loot);
    w.raidAttempts++; w.successfulRaids++;
    const store = target.shelter;
    store.raidLoss = (store.raidLoss || 0) + stolen.nutrition;
    person.carriedMeat = (person.carriedMeat || 0) + stolen.meat;
    person.carriedFruit = (person.carriedFruit || 0) + stolen.fruit;
    relation.tension = clamp(relation.tension + .32, 0, 1); relation.trust = Math.max(0, relation.trust - .24); relation.conflicts++;
    community.tradeCount = community.tradeCount || 0; w.conflicts++;
    person.state = 'carregando alimento saqueado'; person.lastRaidSuccess = true;
    person.lastLesson = 'O grupo tomou alimento do armazém. A carga ainda precisa chegar ao próprio abrigo; a comunidade rival perdeu estoque, as relações pioraram e a chance de retaliação cresceu.';
    const message = community.name + ' retirou ' + stolen.nutrition.toFixed(1) + ' unidades nutricionais do armazém de ' + targetGroup.name + '; o saque ainda precisa ser transportado.';
    community.history.push(message); targetGroup.history.push(message); log(w, message);
    return stolen.nutrition > .01;
  }

  function findTradePartner(w, community, person) {
    if (!community) return null;
    const post = w.structures.filter(s => s.complete && s.type === 'posto de coleta' && s.communityId === community.id)
      .sort((a, b) => distance(person, a) - distance(person, b))[0];
    if (post && distance(person, post) <= 5.5 && marketHasTradeOpportunity(w, community)) {
      return { isMarket: true, station: post, market: w.market, distance: distance(person, post) };
    }
    const visibleMembers = (person.perception && person.perception.people || []).filter(s => s.visible)
      .map(s => w.people.find(p => p.id === s.id && p.alive)).filter(Boolean);
    return w.communities.filter(c => !c.dissolved && c.id !== community.id && visibleMembers.some(p => p.communityId === c.id))
      .map(c => {
        const other = visibleMembers.filter(p => p.communityId === c.id).sort((a, b) => distance(person, a) - distance(person, b))[0];
        const relation = communityRelation(w, community, c);
        const hasExchange = ((community.stores.food || 0) > 22 && ((c.stores.wood || 0) > 12 || (c.stores.stone || 0) > 10))
          || ((c.stores.food || 0) > 22 && ((community.stores.wood || 0) > 12 || (community.stores.stone || 0) > 10));
        return { community: c, person: other, relation, hasExchange, distance: other ? distance(person, other) : Infinity };
      }).filter(x => x.person && x.hasExchange && x.relation.trust > .14)
      .sort((a, b) => a.distance - b.distance)[0] || null;
  }

  function marketHasTradeOpportunity(w, community) {
    const store = community.stores, market = w.market || {};
    const hasSurplus = (store.food || 0) > 45 || (store.wood || 0) > 28 || (store.stone || 0) > 24 || (store.feed || 0) > 30;
    const pen = w.structures.some(s => s.communityId === community.id && s.complete && s.type === 'curral');
    const herd = communityHerd(w, community).length;
    const hasDemand = (store.gold || 0) >= 4 && ((market.food || 0) >= 8 || (market.wood || 0) >= 8
      || (market.stone || 0) >= 6 || (market.feed || 0) >= 8 || (pen && herd < 6 && (market.sheep || 0) > 0));
    return hasSurplus || hasDemand;
  }

  function stockSurplus(store, resource) {
    const reserve = resource === 'food' ? 12 : 16;
    return Math.max(0, (store[resource] || 0) - reserve);
  }

  function transferCommunityFood(w, community, person, amount) {
    const need = Math.max(0, 78 - person.foodReserve);
    const units = Math.min(amount, communityFoodStock(community), need / FOOD_RESERVE_PER_UNIT);
    if (units <= .02) return 0;
    withdrawCommunityFood(w, community, units);
    person.foodReserve = clamp(person.foodReserve + units * FOOD_RESERVE_PER_UNIT, 0, 100);
    return units;
  }

  function performShare(w, person, community, target) {
    if (community && distance(person, community) <= 7) {
      const members = community.memberIds.map(id => w.people.find(p => p.id === id && p.alive))
        .filter(p => p && p.id !== person.id && p.foodReserve < 48)
        .sort((a, b) => a.foodReserve - b.foodReserve);
      if (members.length) {
        const units = transferCommunityFood(w, community, members[0], 4.2);
        if (units > .02) {
          person.energy = Math.max(0, person.energy - .22);
          const link = getSocialLink(w, person, members[0]); link.trust = clamp(link.trust + .08, 0, 1); link.sharedFood += units;
          person.skills.care = clamp(person.skills.care + .004, 0, 1);
          person.state = 'partilhando alimento';
          person.lastLesson = 'Compartilhar a reserva reduziu a fome de um membro.';
          return true;
        }
      }
    }
    if (target && person.foodReserve > 82 && distance(person, target) <= 1.6 && target.foodReserve < 40) {
      const amount = Math.min(5, (person.foodReserve - 70) / 2, (76 - target.foodReserve));
      if (amount > .5) {
        person.foodReserve -= amount * .5; target.foodReserve += amount * .5;
        person.energy = Math.max(0, person.energy - .22);
        const link = getSocialLink(w, person, target); link.trust = clamp(link.trust + .12, 0, 1); link.sharedFood += amount;
        person.skills.care = clamp(person.skills.care + .004, 0, 1);
        person.state = 'partilhando alimento';
        person.lastLesson = 'A partilha aumentou a chance de sobrevivência de alguém próximo.';
        return true;
      }
    }
    return false;
  }

  function performTrade(w, person, community, partner) {
    if (!community || !partner || partner.distance > 2.2) return false;
    if (partner.isMarket) {
      const store = community.stores, market = w.market;
      const pen = nearestPenFor(w, person);
      const herd = communityHerd(w, community).length;
      let transaction = null;
      if (pen && herd < 6 && market.sheep > 0 && store.gold >= 38) {
        const candidates = cellsWithin(w, pen.x, pen.y, (pen.radius || 4) - .7, t => t.terrain === 'land' && t.slope < .5)
          .sort((a, b) => distance(a, pen) - distance(b, pen));
        const tile = candidates.find(t => !w.animals.some(a => a.alive && distance(a, t) < 1.2));
        if (tile) {
          const sheep = makeAnimal(w, 'sheep', tile.x, tile.y, false);
          sheep.energy = 68; sheep.habituation = .82; sheep.herdCommunityId = community.id;
          w.animals.push(sheep); market.sheep--; store.gold -= 38; market.gold += 38;
          transaction = 'comprou uma ovelha';
        }
      }
      if (!transaction && (store.food + (store.meat || 0) * MEAT_NUTRITIONAL_VALUE) < 32 && market.food >= 10 && store.gold >= 6) {
        store.food += 12; market.food -= 12; store.gold -= 6; market.gold += 6; transaction = 'comprou alimento';
      }
      if (!transaction && store.wood < 18 && market.wood >= 8 && store.gold >= 6) {
        store.wood += 10; market.wood -= 10; store.gold -= 6; market.gold += 6; transaction = 'comprou madeira';
      }
      if (!transaction && store.stone < 12 && market.stone >= 6 && store.gold >= 7) {
        store.stone += 8; market.stone -= 8; store.gold -= 7; market.gold += 7; transaction = 'comprou pedra';
      }
      if (!transaction && pen && herd && store.feed < 18 && market.feed >= 8 && store.gold >= 4) {
        store.feed += 10; market.feed -= 10; store.gold -= 4; market.gold += 4; transaction = 'comprou ração';
      }
      const sales = [
        ['food', 'food', 10, 4, 44], ['wood', 'wood', 8, 4, 28],
        ['stone', 'stone', 6, 5, 24], ['feed', 'feed', 10, 3, 30]
      ];
      if (!transaction) for (const [stockKey, marketKey, amount, payment, reserve] of sales) {
        if ((store[stockKey] || 0) - reserve >= amount && market[marketKey] + amount <= 260 && market.gold >= payment) {
          store[stockKey] -= amount; market[marketKey] += amount; store.gold += payment; market.gold -= payment;
          if (stockKey === 'food') removeStoredFruit(w, community, amount);
          transaction = 'vendeu ' + (stockKey === 'food' ? 'alimento' : stockKey === 'wood' ? 'madeira' : stockKey === 'stone' ? 'pedra' : 'ração');
          break;
        }
      }
      if (!transaction) return false;
      market.transactions = (market.transactions || 0) + 1;
      community.tradeCount++; w.trades++;
      person.energy = Math.max(0, person.energy - .35);
      person.skills.diplomacy = clamp(person.skills.diplomacy + .008, 0, 1);
      person.state = 'negociando no posto';
      person.lastLesson = 'O ouro permitiu trocar reservas por um recurso escasso; o estoque do mercado também mudou.';
      community.history.push('No posto, a comunidade ' + transaction + ' no dia ' + w.day + '.');
      log(w, community.name + ' ' + transaction + ' usando ouro no posto de coleta.');
      return true;
    }
    const a = community.stores, b = partner.community.stores;
    let exchanged = false;
    const resource = stockSurplus(b, 'wood') >= 5 ? 'wood' : stockSurplus(b, 'stone') >= 5 ? 'stone' : null;
    const reverseResource = stockSurplus(a, 'wood') >= 5 ? 'wood' : stockSurplus(a, 'stone') >= 5 ? 'stone' : null;
    if (stockSurplus(a, 'food') >= 5 && resource) {
      a.food -= 5; b.food += 5; b[resource] -= 5; a[resource] += 5; exchanged = true;
      removeStoredFruit(w, community, 5);
    } else if (stockSurplus(b, 'food') >= 5 && reverseResource) {
      b.food -= 5; a.food += 5; a[reverseResource] -= 5; b[reverseResource] += 5; exchanged = true;
      removeStoredFruit(w, partner.community, 5);
    }
    if (!exchanged) return false;
    partner.relation.trust = clamp(partner.relation.trust + .13, 0, 1);
    partner.relation.tension = Math.max(0, partner.relation.tension - .18);
    partner.relation.trades++;
    partner.community.tradeCount++;
    community.tradeCount++;
    w.trades++;
    person.energy = Math.max(0, person.energy - .4);
    person.skills.diplomacy = clamp(person.skills.diplomacy + .01, 0, 1);
    person.state = 'trocando recursos';
    person.lastLesson = 'A troca converteu excedente em um recurso escasso para os dois grupos.';
    log(w, community.name + ' e ' + partner.community.name + ' trocaram alimento por ' + (resource || reverseResource || 'recursos') + '; a confiança entre os grupos aumentou.');
    return true;
  }

  function gatherMaterials(w, person, community) {
    if (carriedResources(person) > .1) return 0;
    const resources = (person.perception && person.perception.resources || []).filter(r => r.visible && r.distance <= 3.5 && r.terrain === 'land');
    const plan = community ? nextCommunityStructure(w, community, community.memberIds.length, communityStructures(w, community)) : null;
    const woodNeed = community && plan ? Math.max(0, plan.woodCost - community.stores.wood) : 8;
    const stoneNeed = community && plan ? Math.max(0, plan.stoneCost - community.stores.stone) : 0;
    const goldNeed = community && community.stores.gold < 45 ? 1 : 0;
    let best = null, bestScore = -Infinity;
    for (const resource of resources) {
      const distanceCost = resource.distance * .15;
      if (woodNeed > .1 && Math.max(resource.biomass.broadleaf || 0, resource.biomass.conifer || 0) > 260) {
        const value = Math.min(1.4, Math.max(resource.biomass.broadleaf || 0, resource.biomass.conifer || 0) / 500) + woodNeed * .025 - distanceCost;
        if (value > bestScore) { best = { kind: 'wood', x: resource.x, y: resource.y, biomass: resource.biomass }; bestScore = value; }
      }
      if (stoneNeed > .1 && resource.stone > .05) {
        const value = .42 + Math.min(1, resource.stone / 6) + stoneNeed * .035 - distanceCost;
        if (value > bestScore) { best = { kind: 'stone', x: resource.x, y: resource.y, amount: resource.stone }; bestScore = value; }
      }
      if (resource.goldOre > .05 && (goldNeed || !community)) {
        const value = .52 + Math.min(1.2, resource.goldOre / 1.7) + (goldNeed ? .5 : 0) - distanceCost;
        if (value > bestScore) { best = { kind: 'gold', x: resource.x, y: resource.y, amount: resource.goldOre }; bestScore = value; }
      }
    }
    if (!best) return 0;
    const tile = cellAt(w, best.x, best.y);
    let gathered = 0;
    if (best.kind === 'wood') {
      const id = (best.biomass.broadleaf || 0) >= (best.biomass.conifer || 0) ? 'broadleaf' : 'conifer';
      const broadIndex = PLANTS.findIndex(p => p.id === 'broadleaf'), coniferIndex = PLANTS.findIndex(p => p.id === 'conifer');
      const biomass = tile.plants[broadIndex] + tile.plants[coniferIndex];
      tile.plants[broadIndex] = Math.min(tile.plants[broadIndex], Math.max(18, tile.plants[broadIndex] * .075));
      tile.plants[coniferIndex] = Math.min(tile.plants[coniferIndex], Math.max(18, tile.plants[coniferIndex] * .075));
      tile.stump = { type: id, untilDay: w.day + 95 };
      gathered = clamp(5 + biomass * .016, 7, 24);
      w.logs.push({ id: w.nextId++, x: tile.x, y: tile.y, amount: gathered, type: 'tree', treeType: id, createdDay: w.day, available: true });
      tile.detritusGPerM2 += Math.max(0, biomass - tile.plants[broadIndex] - tile.plants[coniferIndex]) * .025;
      person.state = 'derrubando árvore';
      person.lastLesson = 'A árvore virou um tronco solto. Ele ainda precisa ser recolhido e levado ao abrigo para entrar no estoque.';
      log(w, person.name + ' derrubou uma árvore; um tronco ficou no chão para qualquer pessoa próxima recolher.');
    } else if (best.kind === 'stone') {
      gathered = Math.min(4.5, tile.stoneDeposit, 2.2 + person.skills.gather * 1.8);
      tile.stoneDeposit -= gathered; person.carriedStone += gathered;
      person.state = 'extraindo pedra'; person.lastLesson = 'A jazida diminuiu e a pedra extraída agora precisa ser transportada ao abrigo.';
    } else {
      gathered = Math.min(1.8, tile.goldOre, .5 + person.skills.gather * .7);
      tile.goldOre -= gathered; person.carriedGold += gathered;
      person.state = 'extraindo ouro'; person.lastLesson = 'A jazida de ouro é finita; o minério guardado poderá financiar compras no posto de coleta.';
    }
    if (gathered <= .01) return 0;
    person.energy = Math.max(0, person.energy - (best.kind === 'wood' ? .72 : .5));
    person.hydration = Math.max(0, person.hydration - .12);
    person.skills.gather = clamp(person.skills.gather + .006, 0, 1);
    return gathered;
  }

  function collectLooseLog(w, person, sighting) {
    const item = sighting && w.logs.find(entry => entry.id === sighting.id && entry.available && entry.amount > .01);
    if (!item) { person.state = 'tronco já recolhido'; person.lastLesson = 'O tronco deixou de estar disponível; observar de novo evita perseguir uma carga inexistente.'; return 0; }
    if (distance(person, item) > 1.45) {
      moveOne(w, person, cellAt(w, item.x, item.y), false);
      person.state = 'indo buscar um tronco';
      person.lastLesson = 'Qualquer pessoa que encontre o tronco pode recolhê-lo, mas a viagem até ele consome tempo e energia.';
      return 0;
    }
    const space = Math.max(0, 24 - (person.carriedWood || 0));
    const amount = Math.min(space, item.amount);
    if (amount <= .05) { person.state = 'sem espaço para o tronco'; return 0; }
    item.amount -= amount;
    if (item.amount <= .05) item.available = false;
    person.carriedWood = (person.carriedWood || 0) + amount;
    person.energy = Math.max(0, person.energy - .36 - amount * .018);
    person.skills.gather = clamp(person.skills.gather + .004, 0, 1);
    person.state = 'carregando madeira';
    person.lastLesson = 'O tronco foi recolhido e precisa chegar ao abrigo para virar madeira armazenada.';
    return amount;
  }

  function collectSheepFeed(w, person, community, target) {
    if (!community || !target || !nearestPenFor(w, person)) return 0;
    if (distance(person, target) > 1.45) {
      moveOne(w, person, target, false); person.state = 'buscando brotos para o rebanho';
      person.lastLesson = 'Os arbustos de brotos alimentam ovelhas, não pessoas; trazê-los ao curral custa energia e tempo.';
      return 0;
    }
    const dispute = claimForagePatch(w, person, target, 'browse');
    if (dispute && dispute.loser === person) {
      person.state = 'recuando após disputa pelo pasto';
      return 0;
    }
    const index = PLANTS.findIndex(p => p.id === 'browse');
    const before = target.plants[index];
    const take = Math.min(Math.max(0, 18 - (person.carriedFeed || 0)), 5.5 + person.skills.care * 4.5, before);
    if (take <= .05) { person.state = 'arbusto sem brotos'; return 0; }
    target.plants[index] -= take;
    target.detritusGPerM2 += take * .035;
    target.seedBank[index] = Math.min(8, (target.seedBank[index] || 0) + take * .0025);
    const sizeFactor = before >= 70 ? 1.15 : .82;
    const storedFeed = take * sizeFactor;
    person.carriedFeed = (person.carriedFeed || 0) + storedFeed;
    person.energy = Math.max(0, person.energy - .32);
    person.skills.care = clamp(person.skills.care + .004, 0, 1);
    person.state = before >= 70 ? 'recolhendo arbustos grandes' : 'recolhendo arbustos pequenos';
    person.lastLesson = before >= 70
      ? 'O arbusto grande rendeu mais alimento para o curral, mas a coleta reduziu o recurso disponível no local.'
      : 'Os brotos foram armazenados como ração; arbustos pequenos rendem menos e precisam se recuperar.';
    return storedFeed;
  }

  function getSocialLink(w, a, b) {
    const low = Math.min(a.id, b.id), high = Math.max(a.id, b.id), key = low + ':' + high;
    return w.socialLinks[key] || (w.socialLinks[key] = { a: low, b: high, meetings: 0, trust: 0, sharedFood: 0 });
  }

  function claimForagePatch(w, person, tile, resourceKind) {
    if (!w.resourceClaims) w.resourceClaims = new Map();
    const kind = resourceKind || 'berry';
    const key = kind + ':' + tile.i;
    const radius = kind === 'browse' ? 2.1 : 1.25;
    const patchValue = cellsWithin(w, tile.x, tile.y, 2.1, t => t.terrain === 'land')
      .reduce((sum, t) => sum + plantBiomass(t, [kind]), 0);
    const prior = Array.from(w.resourceClaims.values()).find(claim => claim.kind === kind && claim.person.alive
      && claim.communityId && person.communityId && claim.communityId !== person.communityId
      && distance(claim.tile, tile) <= radius);
    w.resourceClaims.set(key, { person, tile, kind, communityId: person.communityId });
    if (!prior || !activeCommunity(w, person) || !activeCommunity(w, prior.person)) return;
    if (w.contestedResources && w.contestedResources.has(key)) return;
    const other = prior.person;
    const browsePressure = kind === 'browse' && (communityHerd(w, activeCommunity(w, person)).length
      || communityHerd(w, activeCommunity(w, other)).length);
    if (kind !== 'browse' && other.foodReserve > 58 && person.foodReserve > 58) return;
    if (kind === 'browse' && !browsePressure) return;
    if (patchValue < (kind === 'browse' ? 16 : 10)) return;
    const result = resolveResourceConflict(w, person, other, tile, kind, patchValue);
    if (result && w.contestedResources) w.contestedResources.add(key);
    return result;
  }

  function resolveResourceConflict(w, a, b, tile, resourceKind, patchValue) {
    const ca = activeCommunity(w, a), cb = activeCommunity(w, b);
    if (!ca || !cb || ca.id === cb.id) return null;
    const relation = communityRelation(w, ca, cb);
    const supportA = w.people.filter(p => p.alive && p.communityId === ca.id && distance(p, a) < 3.5).length;
    const supportB = w.people.filter(p => p.alive && p.communityId === cb.id && distance(p, b) < 3.5).length;
    const strengthA = a.physicalStrength + a.energy * .025 + supportA * .32 + a.skills.diplomacy * .15;
    const strengthB = b.physicalStrength + b.energy * .025 + supportB * .32 + b.skills.diplomacy * .15;
    const winner = strengthA === strengthB ? (a.id < b.id ? a : b) : strengthA > strengthB ? a : b;
    const loser = winner === a ? b : a;
    const loserGroup = winner === a ? cb : ca;
    const margin = Math.abs(strengthA - strengthB);
    const resourcePressure = Math.min(1.6, Math.max(0, patchValue || 0) / 220);
    const injury = 1.4 + clamp(4.5 - margin * .35, .6, 4.5) + resourcePressure;
    a.energy = Math.max(0, a.energy - 3.8); b.energy = Math.max(0, b.energy - 3.8);
    a.hydration = Math.max(0, a.hydration - .8); b.hydration = Math.max(0, b.hydration - .8);
    loser.injury += injury; loser.health = Math.max(0, loser.health - injury * .55);
    winner.injury += injury * .2; winner.health = Math.max(0, winner.health - injury * .12);
    loser.conflictRisk = 1; winner.conflictRisk = .5;
    loser.state = 'recuando após disputa'; winner.state = 'defendendo recurso';
    loser.lastLesson = 'A disputa por ' + (resourceKind === 'browse' ? 'brotos para o rebanho' : 'alimento') + ' trouxe ferimento e gasto; procurar outro local ou negociar reduz esse risco.';
    winner.lastLesson = 'A disputa pelo recurso preservou o acesso, mas feriu os envolvidos e aumentou a tensão.';
    const forageIndex = PEOPLE_ACTIONS.indexOf('forage'), migrateIndex = PEOPLE_ACTIONS.indexOf('migrate'), tradeIndex = PEOPLE_ACTIONS.indexOf('trade');
    loser.brain.actionValues[forageIndex] = clamp((loser.brain.actionValues[forageIndex] || 0) * .72 - .22, -1, 1);
    loser.brain.actionValues[migrateIndex] = clamp((loser.brain.actionValues[migrateIndex] || 0) * .82 + .16, -1, 1);
    loser.brain.actionValues[tradeIndex] = clamp((loser.brain.actionValues[tradeIndex] || 0) * .9 + .08, -1, 1);
    winner.brain.actionValues[forageIndex] = clamp((winner.brain.actionValues[forageIndex] || 0) * .85 + .035, -1, 1);
    relation.tension = clamp(relation.tension + .2 + resourcePressure * .1, 0, 1);
    relation.trust = Math.max(0, relation.trust - .16);
    relation.conflicts++;
    const retreat = bestHabitatCell(w, loser);
    if (retreat) moveOne(w, loser, retreat, false);
    loser.awayDays = Math.max(loser.awayDays, 1);
    w.conflicts++;
    log(w, 'Disputa por ' + (resourceKind === 'browse' ? 'uma mancha de arbustos de pasto' : 'alimento') + ' em ' + localNameFeature(w, tile.x, tile.y) + ': ' + winner.name + ' manteve o acesso; ' + loser.name + ' recuou ferido. A tensão entre ' + ca.name + ' e ' + cb.name + ' aumentou.');
    return { winner, loser, loserGroup };
  }

  function killPerson(w, person, cause) {
    if (!person.alive) return;
    person.alive = false; w.deaths++;
    w.deathsByCause[cause] = (w.deathsByCause[cause] || 0) + 1;
    const tile = cellAt(w, person.x, person.y);
    if (tile) tile.detritusGPerM2 += 4800;
    const labels = { starvation: 'fome', dehydration: 'desidratação', age: 'idade avançada', injury: 'ferimentos' };
    log(w, person.name + ' morreu por ' + (labels[cause] || cause) + '. A perda afeta sua família e comunidade; a matéria retorna ao solo.');
  }

  function updateDependent(w, child) {
    const candidates = (child.parents || []).map(id => w.people.find(p => p.id === id && p.alive)).filter(Boolean);
    const caregiver = candidates.sort((a, b) => distance(a, child) - distance(b, child))[0]
      || (child.guardianId ? w.people.find(p => p.id === child.guardianId && p.alive) : null);
    const community = activeCommunity(w, child);
    const careFoodNeed = caregiver && distance(caregiver, child) <= 6 ? .42 : .32;
    const sharedFood = community ? Math.min(careFoodNeed, communityFoodStock(community) * FOOD_RESERVE_PER_UNIT,
      Math.max(0, 100 - child.foodReserve)) : 0;
    if (sharedFood > .001) {
      withdrawCommunityFood(w, community, sharedFood / FOOD_RESERVE_PER_UNIT);
      child.foodReserve = clamp(child.foodReserve + sharedFood, 0, 100);
      child.sharedMeals = (child.sharedMeals || 0) + sharedFood / FOOD_RESERVE_PER_UNIT;
    }
    if (caregiver && distance(caregiver, child) <= 6) {
      child.guardianId = caregiver.id;
      child.x = caregiver.x; child.y = caregiver.y;
      caregiver.energy = Math.max(0, caregiver.energy - .1);
      caregiver.foodReserve = Math.max(0, caregiver.foodReserve - Math.max(0, .42 - sharedFood));
      caregiver.skills.care = clamp(caregiver.skills.care + .0003, 0, 1);
      child.foodReserve = clamp(child.foodReserve + Math.max(0, .42 - sharedFood), 0, 100);
      child.hydration = clamp(child.hydration + .4, 0, 100);
      child.health = clamp(child.health + .035, 0, 100);
      child.state = 'recebendo cuidado';
    } else {
      child.foodReserve = Math.max(0, child.foodReserve - Math.max(0, .32 - sharedFood));
      child.hydration = Math.max(0, child.hydration - .24);
      child.health = Math.max(0, child.health - .14);
      child.state = 'sem cuidador próximo';
    }
    if (child.health <= 0 || child.foodReserve <= .1 || child.hydration <= .1) {
      killPerson(w, child, child.hydration <= .1 ? 'dehydration' : 'starvation');
    }
  }

  function updatePeople(w) {
    refreshHarvestSuitability(w);
    const living = w.people.filter(p => p.alive).sort((a, b) => a.id - b.id);
    const communityCounts = new Map();
    w.resourceClaims = new Map(); w.contestedResources = new Set();
    for (const p of living) if (p.communityId !== null) communityCounts.set(p.communityId, (communityCounts.get(p.communityId) || 0) + 1);
    for (const p of living) {
      if (!p.alive) continue;
      p.ageDays++;
      p.buildCooldown = Math.max(0, p.buildCooldown - 1);
      p.birthCooldown = Math.max(0, p.birthCooldown - 1);
      p.conflictRisk = Math.max(0, p.conflictRisk - .05);
      p.injury = Math.max(0, p.injury - .018);
      if (p.ageDays < 12 * 365) { updateDependent(w, p); continue; }
      p.perception = Senses.observe(w, p, 'person', PLANTS);

      const community = activeCommunity(w, p);
      const communitySize = community ? (communityCounts.get(community.id) || 0) : 0;
      const sheltered = w.structures.some(s => s.complete && s.type === 'abrigo' && community && p.communityId === s.communityId && distance(p, s) <= 4);
      p.energy = clamp(p.energy - (sheltered ? .58 : .7) - p.injury * .006, 0, 100);
      p.hydration = clamp(p.hydration - .46, 0, 100);
      if (community && communityFoodStock(community) > .01) {
        const personalCapacity = Math.max(0, 100 - p.foodReserve) / FOOD_RESERVE_PER_UNIT;
        const meal = Math.min(DAILY_FOOD_NEED / FOOD_RESERVE_PER_UNIT, communityFoodStock(community), personalCapacity);
        if (meal > .01) {
          withdrawCommunityFood(w, community, meal);
          p.foodReserve = clamp(p.foodReserve + meal * FOOD_RESERVE_PER_UNIT, 0, 100);
          p.sharedMeals = (p.sharedMeals || 0) + meal;
        }
      }
      p.foodReserve = clamp(p.foodReserve - DAILY_FOOD_NEED, 0, 100);
      p.socialNeed = clamp(p.socialNeed + .19, 0, 100);
      p.health = clamp(p.health + (p.foodReserve > 28 && p.hydration > 28 && p.injury < 2 ? .025 : 0), 0, 100);
      if (p.foodReserve < 10) p.health = Math.max(0, p.health - .45);
      if (p.hydration < 10) p.health = Math.max(0, p.health - .62);
      if (p.injury > 0) p.health = Math.max(0, p.health - p.injury * .012);
      const local = cellAt(w, p.x, p.y);
      const food = bestPeopleFoodCell(w, p, 5);
      const waterHere = nearestWater(w, p, 3);
      const waterTarget = waterHere || nearestWater(w, p, 100);
      const waterCue = !waterTarget && p.hydration < 62 ? bestPerceivedWaterCue(w, p) : null;
      const predatorRisk = (p.perception.animals || []).some(sighting => sighting.visible && sighting.distance < 4
        && species(sighting.speciesId, ANIMALS)?.prey.includes('person')) ? .75 : 0;
      const risk = clamp(predatorRisk + p.conflictRisk, 0, 1);
      const socialTarget = nearestPerson(w, p, 14);
      const groupFood = communityFoodStock(community);
      const groupMaterial = community ? communityMaterialStock(community) : 0;
      const browseFood = bestSheepFeedCell(w, p, 8);
      const foodAccess = food ? clamp(plantBiomass(food, HUMAN_FOOD) / 90, 0, 1) : 0;
      const waterAccess = waterTarget ? clamp(1 - distance(p, waterTarget) / 38, 0, 1) : 0;
      const localSuitability = foodAccess * .65 + waterAccess * .35;
      const huntGround = bestHuntingGround(w, p, 12);
      const preyNearby = nearestHuntable(w, p, 3.5);
      const preyTile = preyNearby && cellAt(w, Math.round(preyNearby.x), Math.round(preyNearby.y));
      const visibleCover = preyTile ? clamp(plantBiomass(preyTile, ['browse', 'berry', 'broadleaf', 'conifer']) / 500, 0, 1) : 0;
      const huntAccess = preyNearby ? .5 + visibleCover * .3 : huntGround ? .18 + clamp(1 - distance(p, huntGround) / 18, 0, 1) * .28 : 0;
      const shelter = nearestShelterFor(w, p);
      const pen = nearestPenFor(w, p);
      const sheepSighting = nearestPerceivedSheep(w, p, 5.5);
      const raidTarget = nearestRaidTarget(w, p, community);
      const storage = nearestKnownStorage(w, p, community);
      const deliveryNeed = clamp(carriedResources(p) / 24, 0, 1);
      const looseLog = nearestKnownLog(p, 7);
      const herd = community ? communityHerd(w, community) : [];
      const feedNeed = herd.length ? clamp(herd.reduce((sum, animal) => sum + (82 - animal.energy) / 82, 0) / herd.length, 0, 1) : 0;
      const browseAccess = browseFood ? clamp(plantBiomass(browseFood, ['browse']) / 90, 0, 1) : 0;
      const materialNeed = community ? communityBuildingNeed(w, community, communitySize) : 0;
      const goldNeed = community ? clamp((55 - (community.stores.gold || 0)) / 55, 0, 1) : 0;
      const inputs = [
        clamp((68 - p.foodReserve) / 68, 0, 1), clamp((70 - p.hydration) / 70, 0, 1),
        clamp((70 - p.energy) / 70, 0, 1), clamp(p.socialNeed / 100, 0, 1),
        food ? clamp(1 - distance(p, food) / 5, 0, 1) : 0, waterTarget ? clamp(1 - distance(p, waterTarget) / 32, 0, 1) : 0,
        clamp(groupFood / 45, 0, 1), clamp(groupMaterial / 90, 0, 1), risk, clamp(p.injury / 12, 0, 1), huntAccess, deliveryNeed,
        preyNearby ? clamp(1 - distance(p, preyNearby) / 8, 0, 1) : 0, browseAccess, feedNeed, materialNeed,
        looseLog ? clamp(1 - looseLog.distance / 7, 0, 1) : 0, community ? clamp((community.stores.gold || 0) / 55, 0, 1) : 0
      ];
      const canBuild = community && communitySize >= 3 && p.buildCooldown <= 0 && p.energy > 27 && p.hydration > 18 && p.foodReserve > 16
        && canCommunityBuild(w, community, communitySize);
      const canGather = p.perception.resources.some(resource => resource.visible && resource.terrain === 'land'
        && (resource.stone > 0 || resource.goldOre > 0 || ['broadleaf', 'conifer'].some(id => (resource.biomass[id] || 0) > 260)));
      const hungryMember = community && community.memberIds.some(id => { const q = w.people.find(x => x.id === id && x.alive); return q && q.foodReserve < 48; });
      const tradePartner = findTradePartner(w, community, p);
      const hasFoodPressure = p.foodReserve < 42 && !food;
      const hasWaterPressure = p.hydration < 55 && (!waterTarget || distance(p, waterTarget) > 18);
      const foodNeed = clamp((70 - p.foodReserve) / 70, 0, 1) * (groupFood > 20 ? .72 : 1);
      const hasLocalHarvest = foodNeed > .35 && (preyNearby || huntGround);
      const canMigrate = !!bestHabitatCell(w, p) && (localSuitability < .1 || p.conflictRisk > .62 || hasFoodPressure || hasWaterPressure) && !hasLocalHarvest;
      const marketTrust = tradePartner && tradePartner.relation ? tradePartner.relation.trust : .35;
      const utility = [
        food ? inputs[0] * 1.85 + .24 + inputs[4] * .2 + (community && groupFood < 8 ? .12 : 0) + p.skills.forage * .08 : -.6,
        shelter && (preyNearby || huntGround) && (p.carriedMeat || 0) <= .01 ? .1 + foodNeed * (.45 + huntAccess * .5) + p.skills.hunt * .16 + (preyNearby ? .28 : 0) : -.65,
        (p.carriedMeat || 0) > .01 && shelter ? .72 + deliveryNeed * .45 : -.7,
        waterTarget ? inputs[1] * 2.05 + .32 : -.5,
        inputs[3] * p.sociability * .82 + (socialTarget ? .12 : -.35),
        inputs[2] * .92 + p.injury * .045 + .04,
        .08 + Math.max(0, .28 - localSuitability) * .7 + risk * .16,
        canBuild ? communityBuildUtility(w, community, communitySize) : -1,
        canGather ? clamp(.17 + (community && materialNeed > .05 ? .48 + materialNeed * .25 : 0) + goldNeed * .24 + p.skills.gather * .12, .12, .82) : -.55,
        storage.destination && looseLog && !carriedResources(p) && p.carriedWood < 22
          ? clamp(.32 + inputs[16] * .3 + materialNeed * .55 + (storage.community.stores.wood < 18 ? .18 : 0), .2, .95) : -.65,
        community && pen && browseFood && herd.length && (community.stores.feed || 0) < 48
          ? clamp(.12 + browseAccess * .2 + feedNeed * .62 + p.skills.care * .15, .12, .9) : -.65,
        (community && ((groupFood > 1 && hungryMember) || (p.foodReserve > 82 && socialTarget && socialTarget.foodReserve < 40))) ? .3 + inputs[6] * .5 + p.skills.care * .16 : -.55,
        tradePartner ? .54 + p.skills.diplomacy * .15 + marketTrust * .12 : -.55,
        canMigrate ? .18 + risk * .58 + (1 - localSuitability) * .32 + (hasFoodPressure ? .64 : 0) + (hasWaterPressure ? .62 : 0) : -.7,
        community && pen && sheepSighting && sheepSighting.visible && !p.leadingSheepId
          ? .28 + (sheepSighting.distance <= 1.6 ? .72 : .24) + p.skills.care * .14 + (communityHerd(w, community).length < 3 ? .12 : 0) : -.8,
        p.leadingSheepId && pen ? 1.18 : -.8,
        raidTarget && community && communityFoodStock(community) / Math.max(1, communitySize) < 2.2
          ? .2 + clamp(.95 - communityFoodStock(community) / Math.max(1, communitySize), 0, 1) * .7 + raidTarget.relation.tension * .28 : -.85
      ];
      const assignment = p.assignment && p.assignment.communityId === p.communityId && p.assignment.expiresDay >= w.day
        ? p.assignment : null;
      const assignmentConflict = assignment && (
        (p.hydration < 22 && assignment.action !== 'drink')
        || (p.foodReserve < 24 && !['forage', 'hunt', 'deliver'].includes(assignment.action))
        || (p.energy < 9 && !['forage', 'hunt', 'drink', 'rest'].includes(assignment.action))
        || (p.health < 18 && assignment.action !== 'rest')
      );
      const assignmentPauseReason = assignmentConflict
        ? p.hydration < 22 && assignment.action !== 'drink' ? 'hidratação baixa'
          : p.foodReserve < 24 && !['forage', 'hunt', 'deliver'].includes(assignment.action) ? 'alimento baixo'
            : p.energy < 9 && !['forage', 'hunt', 'drink', 'rest'].includes(assignment.action) ? 'energia baixa'
              : 'saúde baixa'
        : null;
      const survivalAction = p.hydration <= 9
        ? (waterTarget ? 'drink' : (waterCue || bestHabitatCell(w, p) ? 'migrate' : null))
        : p.foodReserve <= 8
          ? (food ? 'forage' : (preyNearby || huntGround ? 'hunt' : (bestHabitatCell(w, p) ? 'migrate' : null)))
          : p.energy <= 2 && p.foodReserve > 12 && p.hydration > 12 ? 'rest' : null;
      if (assignment && !survivalAction && !assignmentConflict) {
        const assignedIndex = PEOPLE_ACTIONS.indexOf(p.assignment.action);
        const leader = w.people.find(person => person.id === assignment.assignedBy && person.alive);
        const relation = leader && (w.socialLinks[p.id + ':' + leader.id] || w.socialLinks[leader.id + ':' + p.id]);
        const trust = relation ? relation.trust : .2;
        const authority = clamp(.45 + trust * .42 + clamp((leader && leader.prestige || 0) / 40, 0, .13), .35, 1);
        if (assignedIndex >= 0) utility[assignedIndex] += (assignment.priority === 'urgent' ? .68 : .48) * authority;
        assignment.pauseReason = null;
        assignment.lastPausedDay = null;
      } else if (assignment && (survivalAction || assignmentConflict)) {
        assignment.pauseReason = assignmentPauseReason || (survivalAction === 'drink' || (survivalAction === 'migrate' && p.hydration <= 9)
          ? 'sede crítica' : survivalAction === 'rest' ? 'energia crítica' : 'fome crítica');
        assignment.lastPausedDay = w.day;
      }
      const carryingGoods = carriedResources(p) > .01;
      const action = survivalAction || (carryingGoods ? 'deliver' : p.leadingSheepId ? 'lead_sheep'
        : choosePeopleAction(w, p, inputs, utility));
      if (survivalAction) {
        p.brain.lastAction = action;
        if (p.lastDecision) p.lastDecision.action = action;
      }
      const before = p.energy * .28 + p.hydration * .25 + p.foodReserve * .3 + p.health * .17 + (100 - p.socialNeed) * .04;
      const taskStateBefore = {
        foodReserve: p.foodReserve, carriedFeed: p.carriedFeed || 0, carriedWood: p.carriedWood || 0,
        carriedStone: p.carriedStone || 0, carriedGold: p.carriedGold || 0,
        food: community ? community.stores.food || 0 : 0, feed: community ? community.stores.feed || 0 : 0,
        wood: community ? community.stores.wood || 0 : 0, stone: community ? community.stores.stone || 0 : 0, gold: community ? community.stores.gold || 0 : 0,
        buildProgress: w.structures.filter(structure => structure.communityId === (community && community.id)).reduce((sum, structure) => sum + (structure.progress || 0), 0),
        leadingSheepId: p.leadingSheepId
      };
      p.travelCost = 0;
      p.lastLesson = 'A ação ainda não produziu um efeito observável.';
      const target = community ? community : null;

      if (action === 'forage') {
        if (food && distance(p, food) <= 1.6) {
          const dispute = claimForagePatch(w, p, food);
          if (dispute && dispute.loser === p) {
            p.state = 'recuando após disputa';
            p.lastLesson = 'Perdeu o acesso à mancha disputada, sofreu ferimento e gastou energia; negociar ou migrar pode evitar nova perda.';
          } else {
            const harvest = eatPlants(w, food, HUMAN_FOOD, clamp(1.8 + p.skills.forage * 3.2, 1.8, 5));
            const use = Math.min(harvest, Math.max(0, (91 - p.foodReserve) / FOOD_RESERVE_PER_UNIT));
            p.foodReserve = clamp(p.foodReserve + use * FOOD_RESERVE_PER_UNIT, 0, 100);
            p.energy = clamp(p.energy + use * .18, 0, 100);
            const surplus = Math.max(0, harvest - use);
            const fruitShelter = nearestShelterFor(w, p);
            if (community && fruitShelter && distance(p, fruitShelter) <= 1.5) storeCommunityFruit(w, community, fruitShelter, surplus);
            else if (community && !fruitShelter && distance(p, community) <= 5) storeCommunityFruit(w, community, null, surplus);
            else p.carriedFruit = Math.min(24, (p.carriedFruit || 0) + surplus);
            p.energy = Math.max(0, p.energy - .22);
            p.skills.forage = clamp(p.skills.forage + .004, 0, 1);
            p.state = harvest > .1 ? 'coletando alimento' : 'recurso esgotado';
            p.lastLesson = dispute ? 'Garantiu o recurso, mas a disputa causou ferimentos, gasto e tensão entre comunidades.' : harvest > .1 ? 'Encontrar uma mancha de alimento repôs reservas; a coleta reduziu a biomassa local.' : 'A mancha estava esgotada; procurar outra área evita insistir sem retorno.';
          }
        } else if (food) { moveOne(w, p, food, false); p.state = 'procurando alimento'; p.lastLesson = 'Deslocar-se até alimento custa energia; o retorno depende de a mancha ainda existir.'; }
        else { p.state = 'sem alimento próximo'; p.lastLesson = 'Não encontrou alimento no alcance; migração ou cooperação pode abrir outras opções.'; }
      } else if (action === 'hunt') {
        huntForFood(w, p, community);
      } else if (action === 'deliver') {
        const carryingMeat = (p.carriedMeat || 0) > .01;
        const carryingFruit = (p.carriedFruit || 0) > .01;
        const carryingFeed = (p.carriedFeed || 0) > .01;
        const destination = carryingFeed && !carryingMeat && !carryingFruit && !(p.carriedFood > .01)
          ? (pen || storage.pen) : carryingMeat ? (shelter || storage.shelter) : storage.destination;
        const receivingCommunity = community || storage.community;
        const receivingShelter = shelter || storage.shelter;
        if (!destination || !receivingCommunity || (carryingMeat && !receivingShelter)) {
          p.state = carryingMeat ? 'aguardando abrigo para armazenar carne' : 'aguardando abrigo para guardar recursos';
          p.lastLesson = 'A carga continua com quem a transporta até um local comunitário adequado ficar disponível.';
        } else if (distance(p, destination) <= 1.5) {
          const fruitInShelter = carryingFruit && !!receivingShelter;
          if (p.carriedMeat > .01) {
            const amount = p.carriedMeat; p.carriedMeat = 0;
            receivingShelter.meatStored = (receivingShelter.meatStored || 0) + amount;
            receivingCommunity.stores.meat = (receivingCommunity.stores.meat || 0) + amount;
          }
          if (p.carriedFeed > .01) { receivingCommunity.stores.feed = (receivingCommunity.stores.feed || 0) + p.carriedFeed; p.carriedFeed = 0; }
          if (p.carriedFruit > .01) { storeCommunityFruit(w, receivingCommunity, receivingShelter, p.carriedFruit); p.carriedFruit = 0; }
          if (p.carriedFood > .01) { receivingCommunity.stores.food = (receivingCommunity.stores.food || 0) + p.carriedFood; p.carriedFood = 0; }
          if (p.carriedWood > .01) { receivingCommunity.stores.wood = (receivingCommunity.stores.wood || 0) + p.carriedWood; p.carriedWood = 0; }
          if (p.carriedStone > .01) { receivingCommunity.stores.stone = (receivingCommunity.stores.stone || 0) + p.carriedStone; p.carriedStone = 0; }
          if (p.carriedGold > .01) { receivingCommunity.stores.gold = (receivingCommunity.stores.gold || 0) + p.carriedGold; p.carriedGold = 0; }
          if (p.carriedMaterial > .01) { receivingCommunity.stores.wood = (receivingCommunity.stores.wood || 0) + p.carriedMaterial; p.carriedMaterial = 0; }
          p.state = carryingMeat ? 'carne armazenada no abrigo' : fruitInShelter ? 'frutos armazenados no abrigo' : carryingFruit ? 'frutos na reserva comunitária' : carryingFeed ? 'ração guardada no curral' : 'recursos armazenados no abrigo';
          p.lastLesson = carryingFeed && !carryingFruit
            ? 'Os brotos chegaram ao curral e podem alimentar as ovelhas; o estoque diminui conforme o rebanho consome.'
            : carryingFruit && receivingShelter ? 'Os frutos chegaram ao abrigo e agora integram o inventário físico e a reserva alimentar compartilhada.'
            : carryingFruit ? 'Os frutos chegaram à reserva da comunidade; um abrigo permite armazená-los fisicamente.'
            : 'A carga chegou ao abrigo e agora integra as reservas compartilhadas da comunidade.';
          if (carryingMeat) log(w, p.name + ' armazenou carne no abrigo de ' + community.name + '.');
          if (fruitInShelter) log(w, p.name + ' levou frutos ao abrigo de ' + receivingCommunity.name + '.');
        } else {
          moveOne(w, p, cellAt(w, destination.x, destination.y), false);
          p.state = carryingFeed ? 'levando ração ao curral' : 'levando recursos ao abrigo';
          p.lastLesson = 'Transportar recursos consome energia e tempo, mas torna a coleta disponível para a comunidade.';
        }
      } else if (action === 'drink') {
        if (waterHere && distance(p, waterHere) <= 1.5 && drinkWater(w, p, waterHere, 28)) { p.energy = Math.max(0, p.energy - .08); p.state = 'bebendo água'; p.lastLesson = waterHere.terrain === 'water' ? 'A água do lago recuperou hidratação.' : 'A poça formada pelo escoamento recuperou hidratação e diminuiu no solo.'; }
        else if (waterTarget) { moveOne(w, p, waterTarget, false); p.state = 'buscando água'; p.lastLesson = 'A aproximação da água custa energia e tempo.'; }
        else { p.state = 'sem água conhecida'; p.lastLesson = 'A água não foi localizada; continuar aqui mantém a desidratação.'; }
      } else if (action === 'socialize') {
        if (socialTarget && distance(p, socialTarget) <= 2.1) {
          p.socialNeed = Math.max(0, p.socialNeed - 17); p.energy = Math.max(0, p.energy - .1);
          p.state = 'conversando'; p.lastLesson = 'O encontro reduziu a necessidade social e pode fortalecer um vínculo.';
        } else if (socialTarget) { moveOne(w, p, cellAt(w, socialTarget.x, socialTarget.y), false); p.state = 'procurando companhia'; }
      } else if (action === 'rest') {
        p.energy = clamp(p.energy + 3.1, 0, 100);
        if (p.injury > 0) { p.injury = Math.max(0, p.injury - .035); p.health = clamp(p.health + .08, 0, 100); }
        p.state = 'descansando'; p.lastLesson = 'O descanso recuperou energia e ajudou a tratar ferimentos.';
      } else if (action === 'build') {
        workOnCommunityStructure(w, p, community, communitySize);
        p.skills.build = clamp(p.skills.build + .003, 0, 1);
        p.lastLesson = 'Construir consome material, alimento e energia; a estrutura passa a beneficiar a comunidade.';
      } else if (action === 'gather') gatherMaterials(w, p, community);
      else if (action === 'collect_log') collectLooseLog(w, p, looseLog);
      else if (action === 'collect_feed') collectSheepFeed(w, p, community, browseFood);
      else if (action === 'share') {
        if (!performShare(w, p, community, socialTarget)) { p.state = 'sem excedente para partilhar'; p.lastLesson = 'A partilha só ocorre quando existe reserva disponível e alguém precisa dela.'; }
      } else if (action === 'trade') {
        if (!performTrade(w, p, community, tradePartner)) { p.state = 'procurando troca'; p.lastLesson = 'Sem excedente complementar ou contato próximo, a troca não acontece.'; }
      } else if (action === 'capture_sheep') {
        if (!captureSheep(w, p, community, sheepSighting)) { if (!p.state.includes('ovelha') && p.state !== 'curral sem espaço') p.state = 'sem ovelha selvagem próxima'; }
      } else if (action === 'lead_sheep') {
        leadSheep(w, p, community);
      } else if (action === 'raid') {
        p.lastRaidSuccess = false;
        if (!attemptRaid(w, p, community, raidTarget)) { if (!raidTarget) p.state = 'sem armazém rival conhecido'; }
      } else {
        const habitat = waterTarget || waterCue || bestHabitatCell(w, p);
        if (habitat) { moveOne(w, p, habitat, false); p.state = p.conflictRisk > .45 ? 'migrando após disputa' : 'migrando para recursos'; }
        p.lastLesson = 'A migração custa energia, mas pode reduzir exposição a escassez ou disputa.';
      }

      if (p.carriedFruit > .1 && community) {
        const fruitShelter = nearestShelterFor(w, p);
        if (fruitShelter && distance(p, fruitShelter) <= 1.5) { storeCommunityFruit(w, community, fruitShelter, p.carriedFruit); p.carriedFruit = 0; }
        else if (!fruitShelter && distance(p, community) <= 5) { storeCommunityFruit(w, community, null, p.carriedFruit); p.carriedFruit = 0; }
      }
      const taskStateAfter = {
        foodReserve: p.foodReserve, carriedFeed: p.carriedFeed || 0, carriedWood: p.carriedWood || 0,
        carriedStone: p.carriedStone || 0, carriedGold: p.carriedGold || 0,
        food: community ? community.stores.food || 0 : 0, feed: community ? community.stores.feed || 0 : 0,
        wood: community ? community.stores.wood || 0 : 0, stone: community ? community.stores.stone || 0 : 0, gold: community ? community.stores.gold || 0 : 0,
        buildProgress: w.structures.filter(structure => structure.communityId === (community && community.id)).reduce((sum, structure) => sum + (structure.progress || 0), 0),
        leadingSheepId: p.leadingSheepId
      };
      completeCommunityTask(w, p, action, taskStateBefore, taskStateAfter);
      if (community) recordCommunityUse(w, p);
      const after = p.energy * .28 + p.hydration * .25 + p.foodReserve * .3 + p.health * .17 + (100 - p.socialNeed) * .04;
      updateBrain(p, clamp((after - before) / 12, -.8, .8));
      recordPersonalMemory(p, w.day + 1);
      if (!survivalAction) queueStrategicAiRequest(w, p, community, utility);
      if (community) {
        const away = distance(p, community);
        p.awayDays = away > 10 ? p.awayDays + 1 : Math.max(0, p.awayDays - 2);
        const satisfaction = community.satisfaction || 0;
        if (satisfaction < .28 && p.awayDays > 12 && (p.foodReserve < 28 || p.socialNeed > 78)) p.dissatisfactionDays = (p.dissatisfactionDays || 0) + 1;
        else p.dissatisfactionDays = Math.max(0, (p.dissatisfactionDays || 0) - 2);
        if ((p.awayDays > 45 && satisfaction < .4) || (p.dissatisfactionDays > 20 && p.awayDays > 20)) {
          p.communityId = null; p.awayDays = 0;
          community.memberIds = community.memberIds.filter(id => id !== p.id);
          p.assignment = null;
          p.lastLesson = 'A insatisfação prolongada e a separação da comunidade levaram à saída; a falta de alimento ou de vínculos pesou nessa escolha.';
          log(w, p.name + ' deixou ' + community.name + ' após um período de insatisfação e afastamento.');
        }
      }
      if (p.health <= .1 || p.ageDays >= 82 * 365) {
        const cause = p.ageDays >= 82 * 365 ? 'age' : p.injury > 4 && p.health < 15 ? 'injury' : p.hydration < 5 ? 'dehydration' : 'starvation';
        killPerson(w, p, cause);
      }
    }
    updateSocialLinks(w);
    updateCommunityStages(w);
    splitCommunities(w);
    updateCommunityGovernance(w);
    reproducePeople(w);
  }

  function nearestPerson(w, p, radius) {
    const sightings = p.perception && p.perception.people || [];
    return sightings.filter(s => s.visible && s.distance <= radius)
      .map(s => w.people.find(q => q.id === s.id && q.alive))
      .filter(Boolean).sort((a, b) => distance(p, a) - distance(p, b))[0] || null;
  }
  function nearestWater(w, p, radius) {
    const known = p.perception && p.perception.knownWater || [];
    return known.filter(point => point.distance <= (radius || Infinity))
      .sort((a, b) => (a.distance - b.distance) || (b.confidence - a.confidence))
      .map(point => cellAt(w, point.x, point.y))
      .find(tile => tile && (tile.terrain === 'water' || (tile.surfaceWaterMm || 0) >= 1.5)) || null;
  }
  function drinkWater(w, agent, tile, amount) {
    if (!tile || (tile.terrain !== 'water' && (tile.surfaceWaterMm || 0) < 1.5)) return false;
    const hydration = Math.max(1, amount || 28);
    if (tile.terrain !== 'water') {
      const usedMm = Math.min(tile.surfaceWaterMm, hydration / 12);
      tile.surfaceWaterMm = Math.max(0, tile.surfaceWaterMm - usedMm);
      agent.hydration = clamp(agent.hydration + usedMm * 12, 0, 100);
    } else agent.hydration = clamp(agent.hydration + hydration, 0, 100);
    return true;
  }
  function bestHabitatCell(w, p) {
    let best = null, score = -Infinity;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const t = cellAt(w, p.x + dx, p.y + dy);
      if (!t || t.terrain !== 'land') continue;
      const s = plantBiomass(t, ['grass', 'berry']) * .005 + (t.soilWaterMm / t.soilCapacityMm) * .3 - t.slope * .2 + rand(w) * .08;
      if (s > score) { best = t; score = s; }
    }
    return best;
  }

  function recordCommunityUse(w, person) {
    if (!person || person.communityId === null) return;
    const community = w.communities.find(c => c.id === person.communityId && !c.dissolved);
    if (!community) return;
    if (!community.usedCells) community.usedCells = {};
    community.usedCells[idx(Math.round(person.x), Math.round(person.y))] = w.day;
  }

  function communityStructures(w, community) {
    return w.structures.filter(s => s.communityId === community.id);
  }

  function canCommunityBuild(w, community, size) {
    const structures = communityStructures(w, community);
    if (structures.some(s => !s.complete)) return true;
    const limit = size >= 12 ? 5 : size >= 8 ? 4 : size >= 6 ? 3 : size >= 3 ? 1 : 0;
    const completed = structures.filter(s => s.complete).length;
    const plan = nextCommunityStructure(w, community, size, structures);
    return completed < limit && plan && (community.stores.wood || 0) >= plan.woodCost
      && (community.stores.stone || 0) >= plan.stoneCost
      && communityFoodStock(community) >= plan.foodCost && w.day - community.lastBuildDay >= 24;
  }

  function nextCommunityStructure(w, community, size, structures) {
    if (!structures.some(s => s.type === 'abrigo')) return { type: 'abrigo', woodCost: 18, stoneCost: 8, foodCost: 0, required: 28 };
    if (size >= 6 && !structures.some(s => s.type === 'curral')) return { type: 'curral', woodCost: 14, stoneCost: 5, foodCost: 0, required: 34 };
    const grounds = community.grounds || {};
    if (size >= 6) {
      const available = ['hunting', 'fishing'].filter(kind => grounds[kind]
        && !structures.some(s => s.type === 'divisa' && s.groundKind === kind))
        .sort((a, b) => (grounds[b].score || 0) - (grounds[a].score || 0));
      if (available.length) return { type: 'divisa', groundKind: available[0], woodCost: 14, stoneCost: 8, foodCost: 1, required: 42 };
    }
    if (!structures.some(s => s.type === 'posto de coleta')) return { type: 'posto de coleta', woodCost: 20, stoneCost: 12, foodCost: 1, required: 36 };
    if (size >= 12 && !structures.some(s => s.type === 'acampamento')) return { type: 'acampamento', woodCost: 24, stoneCost: 16, foodCost: 1, required: 44 };
    return null;
  }

  function communityBuildUtility(w, community, size) {
    const active = communityStructures(w, community).some(s => !s.complete);
    const hasShelter = communityStructures(w, community).some(s => s.type === 'abrigo' && s.complete);
    return clamp(.28 + size * .035 + (active ? .25 : 0) + (!hasShelter ? .44 : 0), .32, .92);
  }

  function chooseBuildSite(w, community, structures) {
    const completed = structures.filter(s => s.complete);
    const size = community.memberIds.filter(id => w.people.some(p => p.id === id && p.alive)).length;
    const plan = nextCommunityStructure(w, community, size, structures);
    if (!plan) return null;
    if (plan.type === 'divisa') {
      const ground = community.grounds && community.grounds[plan.groundKind];
      const tile = ground && cellAt(w, ground.x, ground.y);
      if (!tile) return null;
      return {
        id: w.nextId++, communityId: community.id, type: 'divisa', groundKind: plan.groundKind,
        x: tile.x, y: tile.y, radius: ground.radius || 4, feature: ground.feature,
        progress: 0, required: plan.required, woodCost: plan.woodCost, stoneCost: plan.stoneCost, foodCost: plan.foodCost,
        complete: false, createdDay: w.day, builtDay: null
      };
    }
    const nextType = plan.type;
    const worldStructures = w.structures.filter(s => s.type !== 'divisa');
    const candidateRadius = nextType === 'curral' ? 3.5 : 2.5;
    let best = null, bestScore = -Infinity;
    for (const t of w.tiles) {
      if (t.terrain !== 'land' || t.slope > .8) continue;
      const overlapsStructure = worldStructures.some(structure => {
        const existingRadius = structure.type === 'curral' ? (structure.radius || 3.5) : 2.5;
        return distance(t, structure) < candidateRadius + existingRadius + .75;
      });
      if (overlapsStructure) continue;
      const centerDistance = Math.hypot(t.x - community.x, t.y - community.y);
      const ownedProperty = (community.properties || []).find(property => distance(t, property) <= (property.radius || 5));
      if (!completed.length && centerDistance > 5) continue;
      if (completed.length) {
        const nearest = Math.min(...completed.map(s => distance(t, s)));
        if (nearest < 6 || (nearest > 17 && !ownedProperty) || (centerDistance > 22 && !ownedProperty)) continue;
      }
      const localBiomass = cellsWithin(w, t.x, t.y, 2, q => q.terrain === 'land').reduce((sum, q) => sum + plantBiomass(q, ['grass', 'berry', 'broadleaf', 'conifer']), 0);
      if (localBiomass < 160) continue;
      const waterAccess = Math.max(0, 6 - t.waterDist);
      const spacing = completed.length ? Math.min(...completed.map(s => Math.abs(distance(t, s) - 9))) : centerDistance;
      const noise = hash01(w.seed + community.id * 31, t.x, t.y) * .08;
      const nearbyBrowse = cellsWithin(w, t.x, t.y, 3.5, q => q.terrain === 'land')
        .reduce((sum, q) => sum + plantBiomass(q, ['browse']), 0);
      const flockDistance = Math.min(...w.animals.filter(a => a.alive && a.speciesId === 'sheep').map(a => distance(a, t)), 22);
      const score = Math.log1p(localBiomass) * .24 + waterAccess * .12 - t.slope * 1.4 - spacing * .045 - centerDistance * .012
        + (ownedProperty ? .42 : 0) + (nextType === 'curral' ? Math.log1p(nearbyBrowse) * .19 - flockDistance * .045 : 0) + noise;
      if (score > bestScore) { best = t; bestScore = score; }
    }
    if (!best) return null;
    return {
      id: w.nextId++, communityId: community.id, type: nextType, x: best.x, y: best.y,
      progress: 0, required: plan.required,
      woodCost: plan.woodCost, stoneCost: plan.stoneCost, foodCost: plan.foodCost,
      fruitStored: nextType === 'abrigo' ? 0 : undefined, meatStored: nextType === 'abrigo' ? 0 : undefined,
      radius: nextType === 'curral' ? 3.5 : undefined,
      complete: false, createdDay: w.day, builtDay: null
    };
  }

  function takeBuildMaterial(w, structure, amount) {
    let remaining = amount;
    const cells = cellsWithin(w, structure.x, structure.y, 2, t => t.terrain === 'land')
      .sort((a, b) => plantBiomass(b, ['grass', 'berry', 'broadleaf', 'conifer']) - plantBiomass(a, ['grass', 'berry', 'broadleaf', 'conifer']));
    const available = cells.reduce((sum, t) => sum + plantBiomass(t, ['grass', 'berry', 'broadleaf', 'conifer']), 0);
    if (available < amount) return false;
    for (const t of cells) {
      for (const id of ['grass', 'berry', 'broadleaf', 'conifer']) {
        const i = PLANTS.findIndex(p => p.id === id);
        const take = Math.min(remaining, t.plants[i]);
        t.plants[i] -= take; remaining -= take;
        if (remaining <= .01) return true;
      }
    }
    return remaining <= .01;
  }

  function workOnCommunityStructure(w, person, community, size) {
    let structures = communityStructures(w, community);
    let structure = structures.find(s => !s.complete);
    if (!structure) {
      structure = chooseBuildSite(w, community, structures);
      if (!structure) { person.state = 'procurando local para construir'; person.buildCooldown = 4; return; }
      if ((community.stores.wood || 0) < structure.woodCost || (community.stores.stone || 0) < structure.stoneCost
          || communityFoodStock(community) < structure.foodCost) {
        person.state = 'faltam recursos compartilhados'; person.buildCooldown = 8; return;
      }
      community.stores.wood -= structure.woodCost;
      community.stores.stone -= structure.stoneCost;
      withdrawCommunityFood(w, community, structure.foodCost);
      w.structures.push(structure);
      community.history.push('Começou a construção de ' + structure.type + ' perto de ' + localNameFeature(w, structure.x, structure.y) + '.');
      log(w, community.name + ' começou a construir ' + structure.type + ' em uma área de recursos próximos.');
    }
    if (distance(person, structure) > 3.5) {
      moveOne(w, person, cellAt(w, structure.x, structure.y), false);
      person.state = 'indo para a construção'; person.buildCooldown = 2; return;
    }
    structure.progress++;
    person.energy = clamp(person.energy - 1.6, 0, 100);
    person.foodReserve = clamp(person.foodReserve - .4, 0, 100);
    person.buildCooldown = 1;
    person.state = 'construindo ' + structure.type;
    if (structure.progress >= structure.required) {
      structure.complete = true; structure.builtDay = w.day; community.lastBuildDay = w.day;
      if (structure.type === 'divisa') {
        const ground = community.grounds && community.grounds[structure.groundKind];
        if (ground) ground.boundaryStructureId = structure.id;
      }
      community.history.push('Concluiu ' + structure.type + ' no dia ' + w.day + '.');
      log(w, community.name + ' concluiu ' + structure.type + (structure.type === 'divisa' ? ' ao redor de sua área de ' + (structure.groundKind === 'hunting' ? 'caça' : 'pesca') + '; cruzar o limite custa mais energia.' : '; sua área de uso alcançou novos recursos.'));
    }
  }

  function updateSocialLinks(w) {
    const people = w.people.filter(p => p.alive);
    for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) {
      const a = people[i], b = people[j], d = distance(a, b);
      if (d > 2.2) continue;
      const key = a.id + ':' + b.id;
      const link = w.socialLinks[key] || (w.socialLinks[key] = { a: a.id, b: b.id, meetings: 0, trust: 0, sharedFood: 0 });
      link.meetings++;
      const mutualHelp = (a.foodReserve > 48 && b.foodReserve > 48 ? .018 : .004);
      link.trust = clamp(link.trust + .045 * Math.min(a.sociability, b.sociability) + mutualHelp, 0, 1);
      if (a.state === 'conversando' && b.state === 'conversando') {
        a.socialNeed = Math.max(0, a.socialNeed - 3); b.socialNeed = Math.max(0, b.socialNeed - 3);
      }
      if (link.meetings < 3 || link.trust < .18) continue;
      if (!a.communityId && !b.communityId) createCommunity(w, [a, b]);
      else if (a.communityId && !b.communityId) joinCommunity(w, b, a.communityId);
      else if (!a.communityId && b.communityId) joinCommunity(w, a, b.communityId);
      else if (a.communityId !== b.communityId && link.trust > .72) mergeCommunities(w, a.communityId, b.communityId);
      if (a.communityId && b.communityId && a.communityId !== b.communityId) {
        const ca = activeCommunity(w, a), cb = activeCommunity(w, b);
        if (ca && cb) { const relation = communityRelation(w, ca, cb); relation.trust = clamp(relation.trust + link.trust * .004, 0, 1); }
      }
    }
  }

  function createCommunity(w, members) {
    const id = w.nextId++, center = { x: (members[0].x + members[1].x) / 2, y: (members[0].y + members[1].y) / 2 };
    const naming = communityName(w, members);
    const c = { id, name: naming.name, nameSource: naming.source, color: COLORS[(id + Math.floor(rand(w) * COLORS.length)) % COLORS.length], memberIds: [], stage: 'vínculo', previousStage: 'vínculo', x: center.x, y: center.y, cohesion: .2, satisfaction: .5, leaderId: null, leadershipChallenge: null, assignments: [], properties: [], lastGovernanceDay: -999, lastPropertyDay: -999, createdDay: w.day, history: [], usedCells: {}, grounds: { hunting: null, fishing: null }, lastBuildDay: -999, stores: { food: 0, meat: 0, wood: 0, stone: 0, feed: 0, gold: 0 }, tradeCount: 0, splitCooldown: 0 };
    w.communities.push(c);
    for (const p of members) { p.communityId = id; if (!c.memberIds.includes(p.id)) c.memberIds.push(p.id); recordCommunityUse(w, p); }
    selectCommunityLeader(w, c, members);
    c.history.push('Nome escolhido pelos primeiros membros a partir da paisagem próxima.');
    log(w, naming.source + ' propôs o nome ' + naming.name + ' após encontros repetidos entre os primeiros membros.');
    return c;
  }

  function joinCommunity(w, person, communityId) {
    const c = w.communities.find(g => g.id === communityId);
    if (!c || !person.alive) return;
    if (person.assignment && person.assignment.communityId !== c.id) person.assignment = null;
    person.communityId = c.id;
    if (!c.memberIds.includes(person.id)) c.memberIds.push(person.id);
    recordCommunityUse(w, person);
    log(w, person.name + ' passou a viver com ' + c.name + '.');
  }

  function mergeCommunities(w, aId, bId) {
    const a = w.communities.find(c => c.id === aId), b = w.communities.find(c => c.id === bId);
    if (!a || !b || a.id === b.id) return;
    const keep = a.createdDay <= b.createdDay ? a : b, lose = keep === a ? b : a;
    for (const p of w.people) if (p.communityId === lose.id) { p.communityId = keep.id; if (!keep.memberIds.includes(p.id)) keep.memberIds.push(p.id); }
    keep.usedCells = Object.assign(keep.usedCells || {}, lose.usedCells || {});
    keep.stores.food = (keep.stores.food || 0) + (lose.stores.food || 0);
    keep.stores.meat = (keep.stores.meat || 0) + (lose.stores.meat || 0);
    for (const key of ['wood', 'stone', 'feed', 'gold']) keep.stores[key] = (keep.stores[key] || 0) + (lose.stores[key] || 0);
    ensureCommunityGovernanceState(keep); ensureCommunityGovernanceState(lose);
    keep.properties.push(...lose.properties.map(property => Object.assign({}, property, { communityId: keep.id })));
    keep.assignments.push(...lose.assignments);
    for (const person of w.people) if (person.assignment && person.assignment.communityId === lose.id) person.assignment.communityId = keep.id;
    if (!keep.grounds) keep.grounds = { hunting: null, fishing: null };
    if (!lose.grounds) lose.grounds = { hunting: null, fishing: null };
    for (const kind of ['hunting', 'fishing']) if (!keep.grounds[kind] && lose.grounds[kind]) keep.grounds[kind] = lose.grounds[kind];
    for (const structure of w.structures) if (structure.communityId === lose.id) structure.communityId = keep.id;
    lose.memberIds = []; lose.dissolved = true;
    const naming = communityName(w, keep.memberIds.map(id => w.people.find(p => p.id === id)).filter(Boolean));
    keep.name = naming.name; keep.nameSource = naming.source;
    log(w, keep.name + ' e ' + lose.name + ' se reuniram e escolheram um novo nome comum.');
  }

  function localNameFeature(w, x, y) {
    const t = cellAt(w, Math.round(x), Math.round(y));
    if (!t) return 'Vale Vivo';
    if (t.waterDist < 3 || t.soilType === 'riparian') return 'Rio ' + (t.heightM > 380 ? 'Claro' : 'Sereno');
    if (t.heightM > 760) return 'Serra ' + (t.slope > .4 ? 'Alta' : 'Verde');
    if (plantBiomass(t, ['broadleaf', 'conifer']) > 220) return 'Mata ' + (t.heightM > 450 ? 'Alta' : 'Verde');
    if (t.soilType === 'shallow') return 'Pedra ' + (t.heightM > 450 ? 'Dourada' : 'Clara');
    return 'Vale ' + (t.soilWaterMm > 55 ? 'Vivo' : 'Aberto');
  }

  function communityName(w, members) {
    const proposals = new Map();
    for (const p of members) {
      const form = p.namingForm || COMMUNITY_FORMS[Math.floor(rand(w) * COMMUNITY_FORMS.length)];
      const proposal = form + localNameFeature(w, p.x, p.y);
      const vote = p.namingVoice || .5;
      const current = proposals.get(proposal) || { score: 0, source: p.name };
      current.score += vote;
      if (vote > (current.strongest || 0)) { current.source = p.name; current.strongest = vote; }
      proposals.set(proposal, current);
    }
    if (!proposals.size) return { name: 'Gente do Vale', source: 'A comunidade' };
    const ranked = [...proposals.entries()].sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0], 'pt-BR'));
    const [name, result] = ranked[0];
    return { name, source: result.source };
  }

  function updateCommunityStages(w) {
    for (const c of w.communities) {
      if (c.dissolved) continue;
      const members = w.people.filter(p => p.alive && p.communityId === c.id);
      c.memberIds = members.map(p => p.id);
      if (!members.length) {
        c.dissolved = true; log(w, c.name + ' deixou de existir; não restaram membros vivos.'); continue;
      }
      c.x += (members.reduce((s, p) => s + p.x, 0) / members.length - c.x) * .12;
      c.y += (members.reduce((s, p) => s + p.y, 0) / members.length - c.y) * .12;
      for (const p of members) recordCommunityUse(w, p);
      const links = Object.values(w.socialLinks).filter(l => members.some(p => p.id === l.a) && members.some(p => p.id === l.b));
      c.cohesion = links.length ? links.reduce((s, l) => s + l.trust, 0) / links.length : .1;
      const next = members.length >= 12 && c.cohesion > .24 ? 'reino'
        : members.length >= 6 ? 'tribo' : members.length >= 3 ? 'grupo' : 'vínculo';
      if (next !== c.stage) {
        const old = c.stage; c.previousStage = old; c.stage = next;
        if (next !== 'vínculo') {
          c.history.push('A comunidade passou de ' + old + ' para ' + next + '.');
          log(w, c.name + ' agora se organiza como ' + next + ' (' + members.length + ' indivíduos).');
        }
      }
      c.splitCooldown = Math.max(0, c.splitCooldown - 1);
    }
  }

  function splitCommunities(w) {
    for (const c of w.communities) {
      if (c.dissolved || c.splitCooldown > 0) continue;
      const members = c.memberIds.map(id => w.people.find(p => p.id === id && p.alive)).filter(Boolean);
      if (members.length < 8) continue;
      const distant = members.filter(p => distance(p, c) > 9.5);
      if (distant.length < 3 || distant.length >= members.length - 2) continue;
      let trustTotal = 0, pairCount = 0;
      for (let i = 0; i < distant.length; i++) for (let j = i + 1; j < distant.length; j++) {
        const link = getSocialLink(w, distant[i], distant[j]); trustTotal += link.trust || 0; pairCount++;
      }
      const trust = pairCount ? trustTotal / pairCount : 0;
      const lowFood = communityFoodStock(c) < 3;
      const tense = Object.values(w.communityRelations).some(r => (r.a === c.id || r.b === c.id) && r.tension > .5);
      if (trust < .32 || (!lowFood && !tense)) continue;
      const share = distant.length / members.length;
      const newGroup = createCommunity(w, distant.slice(0, 2));
      for (const p of distant.slice(2)) { p.communityId = newGroup.id; newGroup.memberIds.push(p.id); }
      ensureCommunityGovernanceState(c); ensureCommunityGovernanceState(newGroup);
      const distantCenter = { x: distant.reduce((sum, person) => sum + person.x, 0) / distant.length,
        y: distant.reduce((sum, person) => sum + person.y, 0) / distant.length };
      const retainedProperties = [];
      for (const property of c.properties) {
        if (distance(property, distantCenter) < distance(property, c)) {
          property.communityId = newGroup.id; newGroup.properties.push(property);
        } else retainedProperties.push(property);
      }
      c.properties = retainedProperties;
      for (const person of distant) if (person.assignment) person.assignment.communityId = newGroup.id;
      for (const key of ['food', 'wood', 'stone', 'feed', 'gold']) {
        newGroup.stores[key] = (c.stores[key] || 0) * share;
        c.stores[key] = (c.stores[key] || 0) * (1 - share);
      }
      newGroup.stores.meat = 0;
      c.memberIds = members.filter(p => !distant.includes(p)).map(p => p.id);
      c.splitCooldown = 365; newGroup.splitCooldown = 365; w.splits++;
      const cause = lowFood ? 'a reserva de alimento se esgotou' : 'a tensão por recursos afastou os membros';
      const message = distant.length + ' membros deixaram ' + c.name + ' e formaram ' + newGroup.name + ' porque ' + cause + '.';
      c.history.push(message); newGroup.history.push('Separou-se de ' + c.name + ' após ' + cause + '.');
      log(w, message + ' As reservas e os locais de uso também foram divididos.');
    }
  }

  function reproducePeople(w) {
    if ((w.day + 1) % 30 !== 0) return;
    const living = w.people.filter(p => p.alive && p.ageDays >= 18 * 365 && p.ageDays <= 45 * 365 && p.energy > 38 && p.foodReserve > 42 && p.hydration > 34 && p.health > 50 && p.birthCooldown <= 0);
    const candidates = [];
    for (const p of living) for (const q of living) {
      if (p.id >= q.id || p.sex === q.sex || distance(p, q) > 2.2) continue;
      const link = w.socialLinks[p.id + ':' + q.id] || w.socialLinks[q.id + ':' + p.id];
      if (!link || link.trust < .2) continue;
      if (p.communityId !== q.communityId && p.communityId !== null && q.communityId !== null) continue;
      const score = link.trust + Math.min(p.energy, q.energy) * .002 + Math.min(p.foodReserve, q.foodReserve) * .003;
      candidates.push({ p, q, score });
    }
    candidates.sort((a, b) => b.score - a.score || a.p.id - b.p.id);
    if (!candidates.length) return;
    const { p, q } = candidates[0];
    p.birthCooldown = q.birthCooldown = 280;
    p.energy = Math.max(0, p.energy - 11); q.energy = Math.max(0, q.energy - 8);
    p.foodReserve = Math.max(0, p.foodReserve - 7); q.foodReserve = Math.max(0, q.foodReserve - 5);
    p.hydration = Math.max(0, p.hydration - 2); q.hydration = Math.max(0, q.hydration - 2);
    const baby = makePerson(w, p.x, p.y, true);
    baby.parents = [p.id, q.id]; baby.guardianId = p.id;
    baby.communityId = p.communityId === q.communityId ? p.communityId : null;
    w.people.push(baby);
    const c = activeCommunity(w, p);
    if (c && baby.communityId === c.id) c.memberIds.push(baby.id);
    w.births++; w.birthsByKind.people++;
    const link = getSocialLink(w, p, q); link.trust = clamp(link.trust + .08, 0, 1);
    log(w, 'Nasceu ' + baby.name + '; ' + p.name + ' e ' + q.name + ' assumiram custos de cuidado e reduziram suas próprias reservas.');
  }

  function decompose(w) {
    for (const t of w.tiles) {
      const moisture = t.terrain === 'water' ? 1 : t.soilWaterMm / t.soilCapacityMm;
      const warmth = clamp((t.temperatureC + 4) / 24, .05, 1);
      const rate = .0035 * warmth * clamp(moisture * 1.3, .05, 1);
      const decayed = t.detritusGPerM2 * rate;
      t.detritusGPerM2 -= decayed;
      t.organicMatterGPerM2 += decayed * .38;
      t.mineralNitrogenGPerM2 = clamp(t.mineralNitrogenGPerM2 + decayed * .0018 - .001, .05, 18);
    }
  }

  function updateLooseLogs(w) {
    for (const item of w.logs || []) {
      if (!item.available) continue;
      if (w.day - item.createdDay <= 180 && item.amount > .05) continue;
      const tile = cellAt(w, item.x, item.y);
      if (tile) tile.detritusGPerM2 += item.amount * 22;
      item.amount = 0; item.available = false;
    }
  }

  function stepDay(w) {
    const day = w.day + 1;
    const weather = updateClimate(w, day);
    updateSoilAndWater(w);
    updatePlants(w, day);
    updateAnimals(w);
    updatePeople(w);
    updateLooseLogs(w);
    decompose(w);
    w.day = day; w.year = Math.floor((day - 1) / 365) + 1; w.season = seasonIndex(day - 1);
    if (day % 30 === 0) {
      const s = snapshot(w);
      log(w, 'Dia ' + day + ': biomassa vegetal ' + Math.round(s.plantBiomass / 1000) + ' t, ' + s.animalCount + ' animais e ' + s.independentPeople + ' indivíduos ainda dispersos.');
    }
    return { weather, snapshot: snapshot(w) };
  }

  function tick(w, days) {
    const count = Math.max(0, Math.floor(days || 1));
    let result;
    for (let i = 0; i < count; i++) result = stepDay(w);
    return result;
  }

  function snapshot(w) {
    const plantCounts = {}, animalCounts = {};
    let plantBiomass = 0, edibleBiomass = 0, plantCover = 0, soilWater = 0, cells = 0, goodHuntingCells = 0, goodFishingCells = 0;
    for (const p of PLANTS) plantCounts[p.id] = 0;
    for (const a of ANIMALS) animalCounts[a.id] = 0;
    for (const t of w.tiles) {
      let occupied = false;
      for (let i = 0; i < PLANTS.length; i++) {
        plantBiomass += t.plants[i];
        if (PLANTS[i].id === 'grass' || PLANTS[i].id === 'berry') edibleBiomass += t.plants[i];
        if (t.plants[i] > 25) { plantCounts[PLANTS[i].id]++; occupied = true; }
      }
      if (occupied) plantCover++;
      if (t.terrain !== 'water') { soilWater += t.soilWaterMm / t.soilCapacityMm; cells++; }
      if (t.huntingSuitability >= .62) goodHuntingCells++;
      if (t.fishingSuitability >= .62) goodFishingCells++;
    }
    for (const a of w.animals) if (a.alive) animalCounts[a.speciesId]++;
    const groups = w.communities.filter(c => !c.dissolved && c.memberIds.length);
    const people = w.people.filter(p => p.alive);
    const meanFoodReserve = people.length ? people.reduce((sum, p) => sum + p.foodReserve, 0) / people.length : 0;
    const foodRiskPeople = people.filter(p => p.foodReserve < 30).length;
    const criticalFoodPeople = people.filter(p => p.foodReserve < 12).length;
    const propertyCount = groups.reduce((sum, community) => sum + (community.properties || []).length, 0);
    const communityTasksCompleted = groups.reduce((sum, community) => sum + (community.assignments || []).filter(task => task.status === 'concluída').length, 0);
    const meanCommunitySatisfaction = groups.length ? groups.reduce((sum, community) => sum + (community.satisfaction || 0), 0) / groups.length : 0;
    const communityStages = { group: 0, tribe: 0, reino: 0 };
    for (const c of groups) {
      if (c.stage === 'grupo') communityStages.group++;
      if (c.stage === 'tribo') communityStages.tribe++;
      if (c.stage === 'reino') communityStages.reino++;
    }
    return {
      day: w.day, year: Math.max(1, Math.floor(Math.max(0, w.day - 1) / 365) + 1), season: seasonIndex(Math.max(0, w.day - 1)),
      animalCount: w.animals.filter(a => a.alive).length, animalCounts,
      wildSheep: w.animals.filter(a => a.alive && a.speciesId === 'sheep' && a.herdCommunityId === null).length,
      communitySheep: w.animals.filter(a => a.alive && a.speciesId === 'sheep' && a.herdCommunityId !== null).length,
      meatCarried: people.reduce((sum, p) => sum + (p.carriedMeat || 0), 0),
      meatStored: w.structures.filter(s => s.complete && s.type === 'abrigo').reduce((sum, s) => sum + (s.meatStored || 0), 0),
      fruitCarried: people.reduce((sum, p) => sum + (p.carriedFruit || 0), 0),
      fruitStored: w.structures.filter(s => s.complete && s.type === 'abrigo').reduce((sum, s) => sum + (s.fruitStored || 0), 0),
      looseWood: (w.logs || []).filter(item => item.available).reduce((sum, item) => sum + item.amount, 0),
      carriedWood: people.reduce((sum, p) => sum + (p.carriedWood || 0), 0),
      storedWood: groups.reduce((sum, c) => sum + (c.stores.wood || 0), 0),
      storedStone: groups.reduce((sum, c) => sum + (c.stores.stone || 0), 0),
      storedFeed: groups.reduce((sum, c) => sum + (c.stores.feed || 0), 0),
      storedGold: groups.reduce((sum, c) => sum + (c.stores.gold || 0), 0),
      peopleCount: people.length, independentPeople: people.filter(p => !p.communityId).length,
      communityCount: groups.length, communityStages,
      communityProperties: propertyCount, communityTasksCompleted, meanCommunitySatisfaction,
      structureCount: w.structures.filter(s => s.complete).length,
      corralCount: w.structures.filter(s => s.complete && s.type === 'curral').length,
      boundaryCount: w.structures.filter(s => s.complete && s.type === 'divisa').length,
      structuresUnderConstruction: w.structures.filter(s => !s.complete).length,
      births: w.births, deaths: w.deaths, birthsByKind: Object.assign({}, w.birthsByKind), deathsByCause: Object.assign({}, w.deathsByCause),
      conflicts: w.conflicts, trades: w.trades, splits: w.splits, raidAttempts: w.raidAttempts, successfulRaids: w.successfulRaids,
      harvests: Object.assign({}, w.harvests), goodHuntingCells, goodFishingCells,
      plantBiomass, edibleBiomass, plantCover: plantCover / w.tiles.length, plantCounts,
      meanFoodReserve, foodRiskPeople, criticalFoodPeople,
      soilMoisture: cells ? soilWater / cells : 0,
      rainfallMm: w.regions.reduce((s, r) => s + r.rainfallMm, 0) / w.regions.length,
      dryRegions: w.regions.filter(r => r.dryDays > 16).length,
      speciesPlants: Object.values(plantCounts).filter(n => n > 0).length,
      speciesAnimals: Object.values(animalCounts).filter(n => n > 0).length
    };
  }

  function inspectTile(w, x, y) {
    const t = cellAt(w, x, y);
    if (!t) return null;
    return {
      x, y, terrain: t.terrain, elevationM: Math.round(t.heightM), slope: t.slope,
      soilType: t.soilType, soilWaterMm: Math.round(t.soilWaterMm * 10) / 10,
      soilCapacityMm: t.soilCapacityMm, mineralNitrogenGPerM2: Math.round(t.mineralNitrogenGPerM2 * 100) / 100,
      stoneDeposit: Math.round((t.stoneDeposit || 0) * 10) / 10, goldOre: Math.round((t.goldOre || 0) * 10) / 10,
      stump: !!(t.stump && t.stump.untilDay >= w.day),
      looseTreeResource: Math.round((w.logs || []).filter(item => item.available && Math.round(item.x) === x && Math.round(item.y) === y).reduce((sum, item) => sum + item.amount, 0) * 10) / 10,
      huntingSuitability: Math.round((t.huntingSuitability || 0) * 100) / 100,
      nearbyHuntableAnimals: Math.round(t.nearbyHuntableAnimals || 0),
      fishingSuitability: Math.round((t.fishingSuitability || 0) * 100) / 100,
      nearbyFish: Math.round(t.nearbyFish || 0),
      plantBiomass: PLANTS.map((p, i) => ({ id: p.id, name: p.name, biomass: Math.round(t.plants[i]) })).filter(p => p.biomass > 0)
    };
  }

  return {
    width: WIDTH, height: HEIGHT, cellAreaM2: CELL_AREA_M2, seasons: SEASONS,
    plants: PLANTS, animals: ANIMALS, actions: PEOPLE_ACTIONS, animalActions: ANIMAL_ACTIONS, colors: COLORS,
    nutrition: { fruit: 1, meat: MEAT_NUTRITIONAL_VALUE },
    createWorld, tick, stepDay, snapshot, inspectTile, addIndividuals, distance,
    modules: {
      Cosmos: { seasonIndex },
      Atmosphere: { updateClimate, triggerDrought },
      Geosphere: { updateSoilAndWater, lowestNeighbor },
      Biosphere: { Botany: { updatePlants }, Zoology: { updateAnimals, feedSheep, reproduceAnimals }, Ecology: { decompose } },
      SocietyExperiment: { updatePeople, updateSocialLinks, updateCommunityStages, updateCommunityGovernance, communitySatisfaction, acquireCommunityProperty,
        assignCommunityTasks, completeCommunityTask, captureSheep, leadSheep, nearestRaidTarget, attemptRaid, claimForagePatch, resolveResourceConflict, reproducePeople,
        refreshHarvestSuitability, markCommunityGround, attemptHumanHunt, attemptHumanFishing, moveOne, canCommunityBuild, chooseBuildSite,
        workOnCommunityStructure, gatherMaterials, collectLooseLog, collectSheepFeed, feedCommunalHerds, performTrade, findTradePartner, transferCommunityFood,
        setStrategicAiEnabled, pullStrategicAiRequests, applyStrategicAiDecision, failStrategicAiRequest }
    }
  };
});
