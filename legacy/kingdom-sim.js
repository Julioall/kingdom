/* Realm simulation: deterministic world generation plus layered autonomous AI. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.KingdomSim = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const W = 160, H = 100, SIZE = W * H, REGION_COLS = 8, REGION_ROWS = 5;
  const BASE_SIZE = 64 * 40, TERRAIN_SCALE = SIZE / BASE_SIZE;
  const MAP_SCALE = W / 320;
  const CITY_GOLD_INCOME = .08, WAR_GOLD_PER_SOLDIER = .002, WAR_GOLD_PER_MARCHING_SOLDIER = .003;
  const REGION_W = W / REGION_COLS, REGION_H = H / REGION_ROWS;
  const BASE_PRICES = { food: .35, wood: .65, stone: .8, iron: 1.15, gold: 2 };
  const BRAIN_INPUTS = 6, BRAIN_HIDDEN = 6, BRAIN_LEARNING_RATE = .018;
  const BRAIN_PROFILES = {
    king: { actions: ['sustain', 'expand', 'fortify', 'recruit', 'treaty', 'campaign'], interval: 20 },
    worker: { actions: ['gather', 'deliver', 'build'], interval: 4 },
    soldier: { actions: ['follow', 'engage', 'retreat'], interval: 2 },
    lieutenant: { actions: ['regroup', 'advance', 'hold'], interval: 6 },
    general: { actions: ['defend', 'attack', 'patrol'], interval: 12 }
  };
  const RESOURCE_PROFESSION = { food: 'farmer', wood: 'forester', stone: 'mason', iron: 'miner', gold: 'miner' };
  const PROFESSION_LABEL = { farmer: 'agricultor', forester: 'silvicultor', mason: 'pedreiro', miner: 'mineiro', builder: 'construtor', merchant: 'mercador', guard: 'guarda', soldier: 'soldado' };
  const BUILD_WORK = { farm: 14, sawmill: 16, quarry: 18, mine: 20, wall: 22, barracks: 20, well: 16, cistern: 16, irrigation: 18, watchtower: 24, outpost: 24, village: 42 };
  const TYPES = {
    food: { name: 'alimento', color: '#edc66b' }, wood: { name: 'madeira', color: '#8db878' },
    stone: { name: 'pedra', color: '#b4bcb1' }, iron: { name: 'ferro', color: '#c18c70' },
    gold: { name: 'ouro', color: '#f1d779' }
  };
  const START_X = Math.round(W * .08), START_Y = Math.round(H * .125);
  const NATIONS = [
    { name: 'Valedouro', short: 'VAL', color: '#4da4a2', light: '#91dbca', dark: '#275a61', x: START_X, y: START_Y, nature: 'pragmático', traits: { prudence: .82, ambition: .46, diplomacy: .68, logistics: .76 } },
    { name: 'Corvânia', short: 'COR', color: '#cb6655', light: '#f4a27f', dark: '#713c45', x: W - START_X, y: START_Y, nature: 'ambicioso', traits: { prudence: .42, ambition: .88, diplomacy: .38, logistics: .64 } },
    { name: 'Albruma', short: 'ALB', color: '#d3aa50', light: '#f2d88b', dark: '#765b31', x: START_X, y: H - START_Y, nature: 'cauteloso', traits: { prudence: .91, ambition: .38, diplomacy: .82, logistics: .72 } },
    { name: 'Eryndor', short: 'ERY', color: '#8a79c4', light: '#c1b5ec', dark: '#4d467b', x: W - START_X, y: H - START_Y, nature: 'expansivo', traits: { prudence: .5, ambition: .75, diplomacy: .54, logistics: .81 } }
  ];
  const STRATEGIES = { sustain: 'Abastecer o reino', expand: 'Expandir cidades', fortify: 'Reforçar defesas', recruit: 'Reunir o exército', treaty: 'Buscar alianças', campaign: 'Campanha militar' };
  const TACTICS = { flank: 'Manobra de flanco', ambush: 'Emboscada em terreno favorável', siege: 'Cerco coordenado', hold: 'Defesa e economia de forças' };
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const key = (x, y) => y * W + x;
  const coords = (n) => ({ x: n % W, y: Math.floor(n / W) });
  const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

  function random(seed) {
    let s = (Number(seed) >>> 0) || 0x4f1bbcdc;
    return function () { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  }
  function pick(rng, list) { return list[Math.floor(rng() * list.length)]; }
  function createBrain(world, kind) {
    const profile = BRAIN_PROFILES[kind] || { actions: ['act'], interval: 4 };
    return {
      version: 1, profile: kind, actions: profile.actions.slice(), interval: profile.interval,
      inputWeights: Array.from({ length: BRAIN_INPUTS * BRAIN_HIDDEN }, () => (world.rng() - .5) * .24),
      hiddenBias: Array(BRAIN_HIDDEN).fill(0),
      outputWeights: Array.from({ length: profile.actions.length * BRAIN_HIDDEN }, () => (world.rng() - .5) * .16),
      outputBias: Array(profile.actions.length).fill(0),
      rngState: (Math.floor(world.rng() * 0xffffffff) >>> 0) || 0x6d2b79f5,
      decisionCount: 0, learningSteps: 0, rewardMean: 0, cumulativeReward: 0,
      lastAction: null, lastOutcome: 'aguardando primeira decisão', lastDecisionTick: -1,
      nextDecisionTick: 0, pending: null, lastInputs: Array(BRAIN_INPUTS).fill(0)
    };
  }
  function brainRandom(brain) {
    let state = brain.rngState >>> 0; state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    brain.rngState = state >>> 0; return brain.rngState / 4294967296;
  }
  function inferBrain(brain, inputs) {
    const hidden = new Array(BRAIN_HIDDEN);
    for (let h = 0; h < BRAIN_HIDDEN; h++) {
      let sum = brain.hiddenBias[h];
      for (let i = 0; i < BRAIN_INPUTS; i++) sum += brain.inputWeights[h * BRAIN_INPUTS + i] * inputs[i];
      hidden[h] = Math.tanh(sum);
    }
    const logits = brain.actions.map((_, action) => {
      let sum = brain.outputBias[action];
      for (let h = 0; h < BRAIN_HIDDEN; h++) sum += brain.outputWeights[action * BRAIN_HIDDEN + h] * hidden[h];
      return sum;
    });
    return { hidden, logits };
  }
  function chooseBrainAction(world, unit, actions, inputs, utilities) {
    const profile = BRAIN_PROFILES[unit.kind] || { actions: ['act'], interval: 4 };
    if (!unit.brain || unit.brain.profile !== unit.kind) unit.brain = createBrain(world, unit.kind);
    const brain = unit.brain, legal = actions.filter(action => brain.actions.includes(action));
    if (!legal.length) return actions[0] || null;
    if (world.tick < brain.nextDecisionTick && legal.includes(brain.lastAction)) return brain.lastAction;
    const normalized = Array.from({ length: BRAIN_INPUTS }, (_, i) => clamp(Number(inputs[i]) || 0, -1, 1));
    const { hidden, logits } = inferBrain(brain, normalized), legalIndices = legal.map(action => brain.actions.indexOf(action));
    const scores = legalIndices.map((index, i) => (Number(utilities[legal[i]]) || 0) + logits[index]);
    let selected = 0;
    for (let i = 1; i < scores.length; i++) if (scores[i] > scores[selected]) selected = i;
    if (legal.length > 1 && brainRandom(brain) < .025) selected = Math.floor(brainRandom(brain) * legal.length);
    brain.pending = { inputs: normalized, hidden, actions: legal.slice(), indices: legalIndices, scores, selected };
    brain.lastInputs = normalized.slice(); brain.lastAction = legal[selected];
    brain.lastDecisionTick = world.tick; brain.nextDecisionTick = world.tick + profile.interval; brain.decisionCount++;
    return brain.lastAction;
  }
  function recordBrainOutcome(unit, reward, outcome) {
    const brain = unit.brain, pending = brain && brain.pending;
    if (!pending) return;
    const max = Math.max(...pending.scores), weights = pending.scores.map(score => Math.exp(clamp(score - max, -12, 0)));
    const total = weights.reduce((sum, value) => sum + value, 0) || 1, probabilities = weights.map(value => value / total);
    const advantage = clamp(reward - brain.rewardMean, -1, 1), rate = BRAIN_LEARNING_RATE * advantage;
    const oldOutputWeights = brain.outputWeights.slice();
    for (let j = 0; j < pending.actions.length; j++) {
      const index = pending.indices[j], gradient = (j === pending.selected ? 1 : 0) - probabilities[j];
      brain.outputBias[index] = clamp(brain.outputBias[index] + rate * gradient, -3, 3);
      for (let h = 0; h < BRAIN_HIDDEN; h++) brain.outputWeights[index * BRAIN_HIDDEN + h] = clamp(brain.outputWeights[index * BRAIN_HIDDEN + h] + rate * gradient * pending.hidden[h], -3, 3);
    }
    for (let h = 0; h < BRAIN_HIDDEN; h++) {
      let gradient = 0;
      for (let j = 0; j < pending.actions.length; j++) gradient += ((j === pending.selected ? 1 : 0) - probabilities[j]) * oldOutputWeights[pending.indices[j] * BRAIN_HIDDEN + h];
      gradient *= 1 - pending.hidden[h] * pending.hidden[h];
      brain.hiddenBias[h] = clamp(brain.hiddenBias[h] + rate * gradient, -3, 3);
      for (let i = 0; i < BRAIN_INPUTS; i++) brain.inputWeights[h * BRAIN_INPUTS + i] = clamp(brain.inputWeights[h * BRAIN_INPUTS + i] + rate * gradient * pending.inputs[i], -3, 3);
    }
    brain.rewardMean += .08 * (reward - brain.rewardMean); brain.cumulativeReward += reward;
    brain.learningSteps++; brain.lastOutcome = outcome || 'resultado observado'; brain.pending = null;
  }
  function makeWorld(seed) {
    const rng = random(seed);
    const world = { width: W, height: H, seed: Number(seed) || 1, tick: 0, year: 1, seasonIndex: 0, births: 0, deaths: 0, warDeaths: 0, warsStarted: 0, captures: 0, trades: 0, promotions: 0, completedProjects: 0, foodSpentAtWar: 0, goldSpentAtWar: 0, ironSpentAtWar: 0, droughtsStarted: 0, ecologicalGrowth: { food: 0, wood: 0 }, nextId: 1, rng, tiles: [], climateRegions: [], nodes: [], nodeBuckets: new Map(), nodeBucketsByType: new Map(), nodeBucketSize: 16, riverTiles: [], structures: [], cities: [], kingdoms: [], units: [], logs: [], paths: new Map(), localPaths: new Map(), diplomacy: {}, territoryRevision: 0, market: { globalPrices: Object.assign({}, BASE_PRICES), totalSupply: {}, totalDemand: {}, lastUpdate: -1, tradeVolume: 0 }, ended: false };
    world.climateRegions = makeClimateRegions(world);
    world.tiles = Array.from({ length: SIZE }, (_, i) => {
      const x = i % W, y = Math.floor(i / W), regionId = regionIndex(x, y), region = world.climateRegions[regionId];
      return { terrain: 0, shade: Math.floor(rng() * 5), grass: rng() > .62, i, regionId, fertility: clamp(region.fertility + (rng() - .5) * .18, .64, 1.28), forestCover: 0, flow: region.riverFlow };
    });
    generateTerrain(world);
    world.riverTiles = world.tiles.filter(t => t.terrain === 3);
    buildRiverDistances(world);
    buildNodeIndex(world);
    NATIONS.forEach((spec, index) => createKingdom(world, spec, index));
    createRelations(world);
    updateTerritories(world);
    updateMarket(world, true);
    addLog(world, 'Quatro coroas erguem seus estandartes. Cada trono terá de conquistar o próximo inverno.');
    return world;
  }
  function makeClimateRegions(world) {
    const names = ['Marchas do Poente', 'Vale das Névoas', 'Coração Verde', 'Fronteira Oriental', 'Campos Austrais', 'Baixios do Sul', 'Bosques Meridionais', 'Terras Longínquas'];
    return Array.from({ length: REGION_COLS * REGION_ROWS }, (_, id) => ({
      id, name: names[id % names.length] + (id >= names.length ? ' ' + (Math.floor(id / names.length) + 1) : ''), aridity: .16 + world.rng() * .68, fertility: .82 + world.rng() * .32,
      moisture: .44 + world.rng() * .3, weather: 'clear', weatherTicks: 12 + Math.floor(world.rng() * 16),
      droughtSeverity: 0, riverFlow: .68, resourceStock: { food: 0, wood: 0, stone: 0, iron: 0, gold: 0 }, abundance: {}, prices: {}, territoryOwner: -1
    }));
  }
  function createCabinet(world, index) {
    const names = [
      ['Edrin Voss', 'Mara do Vale', 'Othar Fen'], ['Lysa Corven', 'Breno Taal', 'Sivra Noll'],
      ['Darian Sol', 'Neris Alba', 'Ferren Vale'], ['Tomas Eryn', 'Maela Venn', 'Rovan Tir']
    ][index];
    return {
      economy: { name: names[0], skill: .58 + world.rng() * .34, taxRate: .075, experience: 0 },
      agriculture: { name: names[1], skill: .58 + world.rng() * .34, harvestBias: 0, experience: 0 },
      defense: { name: names[2], skill: .58 + world.rng() * .34, readiness: .5, experience: 0 }
    };
  }
  function regionIndex(x, y) { return Math.floor(y / (H / REGION_ROWS)) * REGION_COLS + Math.floor(x / (W / REGION_COLS)); }
  function tile(world, x, y) { return world.tiles[key(clamp(x, 0, W - 1), clamp(y, 0, H - 1))]; }
  function regionAt(world, x, y) { const t = tile(world, x, y); return world.climateRegions[t.regionId]; }
  function riverProximity(w, x, y) {
    const location = tile(w, x, y), distanceToRiver = location.riverDistance ?? 99, riverRegionId = location.riverRegionId ?? location.regionId;
    return { distance: distanceToRiver, regionId: riverRegionId, access: clamp((5 - distanceToRiver) / 4, 0, 1) };
  }
  function buildRiverDistances(w) {
    const distanceToRiver = new Uint16Array(SIZE), riverRegion = new Uint16Array(SIZE), queue = new Int32Array(SIZE);
    distanceToRiver.fill(65535);
    let head = 0, tail = 0;
    for (const river of w.riverTiles) { distanceToRiver[river.i] = 0; riverRegion[river.i] = river.regionId; queue[tail++] = river.i; }
    while (head < tail) {
      const at = queue[head++], x = at % W, y = Math.floor(at / W), next = distanceToRiver[at] + 1;
      const neighbors = [x > 0 ? at - 1 : -1, x + 1 < W ? at + 1 : -1, y > 0 ? at - W : -1, y + 1 < H ? at + W : -1];
      for (const ni of neighbors) if (ni >= 0 && distanceToRiver[ni] > next) { distanceToRiver[ni] = next; riverRegion[ni] = riverRegion[at]; queue[tail++] = ni; }
    }
    for (let i = 0; i < SIZE; i++) { w.tiles[i].riverDistance = distanceToRiver[i]; w.tiles[i].riverRegionId = riverRegion[i]; }
  }
  function buildNodeIndex(w) {
    const size = w.nodeBucketSize;
    for (const node of w.nodes) {
      const bucket = Math.floor(node.x / size) + ':' + Math.floor(node.y / size);
      if (!w.nodeBuckets.has(bucket)) w.nodeBuckets.set(bucket, []);
      w.nodeBuckets.get(bucket).push(node);
      if (!w.nodeBucketsByType.has(node.type)) w.nodeBucketsByType.set(node.type, new Map());
      const typedBuckets = w.nodeBucketsByType.get(node.type);
      if (!typedBuckets.has(bucket)) typedBuckets.set(bucket, []);
      typedBuckets.get(bucket).push(node);
    }
  }
  function generateTerrain(world) {
    const rng = world.rng;
    for (let p = 0; p < Math.round(68 * TERRAIN_SCALE); p++) {
      const cx = Math.floor(rng() * W), cy = Math.floor(rng() * H), radius = 1 + Math.floor(rng() * 4);
      const terrain = rng() < .72 ? 1 : 2;
      for (let y = Math.max(0, cy - radius); y <= Math.min(H - 1, cy + radius); y++) for (let x = Math.max(0, cx - radius); x <= Math.min(W - 1, cx + radius); x++) {
        const d = Math.abs(x - cx) + Math.abs(y - cy);
        if (d <= radius + (rng() > .45 ? 1 : 0) && rng() > .18) tile(world, x, y).terrain = terrain;
      }
    }
    let ry = Math.floor(H * .48) + Math.floor(rng() * 6), riverPath = new Int16Array(W);
    for (let x = 0; x < W; x++) {
      ry = clamp(ry + Math.floor(rng() * 5) - 2, 5, H - 6);
      riverPath[x] = ry;
      for (let y = ry - (rng() > .5 ? 1 : 0); y <= ry + (rng() > .5 ? 1 : 0); y++) tile(world, x, y).terrain = 3;
      if (x % 7 === 0 && rng() > .45) tile(world, x, ry + 1).terrain = 3;
    }
    for (let p = 0; p < Math.round(18 * TERRAIN_SCALE); p++) {
      const cx = Math.floor(rng() * W), cy = Math.floor(rng() * H), radius = 1 + Math.floor(rng() * 2);
      for (let y = Math.max(0, cy - radius); y <= Math.min(H - 1, cy + radius); y++) for (let x = Math.max(0, cx - radius); x <= Math.min(W - 1, cx + radius); x++) if (Math.abs(x - cx) + Math.abs(y - cy) <= radius) tile(world, x, y).terrain = 4;
    }
    for (const s of NATIONS) for (let y = s.y - 3; y <= s.y + 3; y++) for (let x = s.x - 3; x <= s.x + 3; x++) if (x >= 0 && x < W && y >= 0 && y < H && Math.abs(x - s.x) + Math.abs(y - s.y) < 4) tile(world, x, y).terrain = 0;
    for (const x of [.2, .4, .6, .8].map(fraction => Math.round(W * fraction))) for (let y = riverPath[x] - 2; y <= riverPath[x] + 2; y++) if (y >= 0 && y < H) tile(world, x, y).terrain = 5;
    for (let i = 0; i < SIZE; i++) {
      const t = world.tiles[i], p = coords(i), r = rng();
      if (t.terrain === 1) t.forestCover = .7 + rng() * .3;
      if (t.terrain === 1 && r > .12) { const node = { id: world.nextId++, x: p.x, y: p.y, type: 'wood', amount: 7 + Math.floor(rng() * 12), max: 18, regrow: 0 }; world.nodes.push(node); }
      if (t.terrain === 2 && r > .48) world.nodes.push({ id: world.nextId++, x: p.x, y: p.y, type: 'stone', amount: 7 + Math.floor(rng() * 9), max: 16, regrow: 0 });
      if (t.terrain === 4 && r > .6) world.nodes.push({ id: world.nextId++, x: p.x, y: p.y, type: rng() > .78 ? 'gold' : 'iron', amount: 5 + Math.floor(rng() * 7), max: 12, regrow: 0 });
      if (t.terrain === 0 && r > .984) world.nodes.push({ id: world.nextId++, x: p.x, y: p.y, type: 'food', amount: 7 + Math.floor(rng() * 10), max: 18, regrow: 0 });
    }
    for (const s of NATIONS) {
      for (let j = 0; j < 10; j++) {
        const x = clamp(s.x + Math.floor(rng() * 13) - 6, 1, W - 2), y = clamp(s.y + Math.floor(rng() * 13) - 6, 1, H - 2);
        if (tile(world, x, y).terrain !== 3 && tile(world, x, y).terrain !== 4) world.nodes.push({ id: world.nextId++, x, y, type: 'food', amount: 9 + Math.floor(rng() * 9), max: 18, regrow: 0 });
      }
    }
  }
  function createKingdom(world, spec, index) {
    const k = { id: index, name: spec.name, short: spec.short, color: spec.color, light: spec.light, dark: spec.dark, nature: spec.nature, traits: Object.assign({}, spec.traits, { ambition: clamp(spec.traits.ambition + (world.rng() - .5) * .2, .1, .98) }), stock: { food: 145, wood: 95, stone: 58, iron: 32, gold: 22 }, cityIds: [], unitIds: [], ministers: createCabinet(world, index), plan: 'sustain', planText: STRATEGIES.sustain, lastThink: -1, lastDiplomacy: -1, lastBuild: -1, lastRecruit: -1, lastGrowth: 0, lastCabinet: -1, capitalId: null, eliminated: false, prestige: 0, supply: 0, lastDanger: 0 };
    world.kingdoms.push(k);
    const x2 = spec.x < W / 2 ? spec.x + 4 : spec.x - 4, y2 = spec.y < H / 2 ? spec.y + 3 : spec.y - 3;
    const capital = addCity(world, k, spec.x, spec.y, 'capital', 2);
    const village = addCity(world, k, x2, y2, 'village', 1);
    k.capitalId = capital.id;
    const king = addUnit(world, k, 'king', capital.x, capital.y, { name: 'Rei ' + ['Aldren', 'Mireva', 'Osmund', 'Selwen'][index], title: 'soberano', hp: 100, cityId: capital.id, traits: k.traits });
    addUnit(world, k, 'general', capital.x + 1, capital.y, { name: 'General ' + ['Brann', 'Ysra', 'Teren', 'Maela'][index], title: 'marechal', hp: 100, cityId: capital.id, leaderId: king.id, attackCd: 0 });
    for (let li = 0; li < 2; li++) {
      const lieutenant = addUnit(world, k, 'lieutenant', capital.x, capital.y + (li ? 2 : -2), { name: 'Tenente ' + (li ? 'Ivo' : 'Nara'), title: li ? 'vanguarda' : 'guarda', hp: 100, cityId: capital.id, generalId: k.unitIds.find(id => world.units.find(u => u.id === id && u.kind === 'general')), squad: [], order: 'guard', attackCd: 0 });
      for (let si = 0; si < 4; si++) {
        const classes = ['spear', 'spear', 'bow', 'horse'];
        const cls = classes[si], title = cls === 'bow' ? 'arqueiro' : cls === 'horse' ? 'cavaleiro' : 'lanceiro';
        const soldier = addUnit(world, k, 'soldier', capital.x + 1 + (si % 2), capital.y + (li ? 2 : -2) + Math.floor(si / 2), { name: 'Soldado', title, class: cls, hp: 72 + world.rng() * 24, cityId: capital.id, lieutenantId: lieutenant.id, generalId: lieutenant.generalId, attackCd: Math.floor(world.rng() * 5), morale: .76 + world.rng() * .2 });
        lieutenant.squad.push(soldier.id);
      }
    }
    const jobs = ['food', 'food', 'food', 'wood', 'wood', 'stone', 'iron', 'gold'];
    for (let i = 0; i < jobs.length; i++) addUnit(world, k, 'worker', capital.x + (i % 4) - 1, capital.y + 3 + Math.floor(i / 4), { name: pick(world.rng, ['Camponês', 'Lenhador', 'Mineiro', 'Pastora']), title: 'cidadão', hp: 62 + world.rng() * 30, cityId: i === 7 ? village.id : capital.id, job: jobs[i], profession: RESOURCE_PROFESSION[jobs[i]], carry: 0, carryType: jobs[i], harvestCd: 0, moveCd: 0 });
    return k;
  }
  function addCity(world, kingdom, x, y, kind, level) {
    const river = riverProximity(world, x, y);
    const city = { id: world.nextId++, owner: kingdom.id, x, y, kind, level, name: kind === 'capital' ? ['Auren', 'Ravenhold', 'Luarte', 'Dornfell'][kingdom.id] : ['Campo Verde', 'Baixio', 'Ponte Alta', 'Bosque Longo'][kingdom.id], hp: kind === 'capital' ? 440 : 270, maxHp: kind === 'capital' ? 440 : 270, buildings: { farm: kind === 'capital' ? 2 : 1, sawmill: kind === 'capital' ? 1 : 0, quarry: 0, mine: 0, barracks: kind === 'capital' ? 1 : 0, wall: kind === 'capital' ? 1 : 0, well: kind === 'capital' ? 1 : 0, cistern: 0, irrigation: 0, watchtower: 0 }, fort: kind === 'capital' ? 1 : 0, territoryRadius: Math.round((kind === 'capital' ? 34 : 22) * MAP_SCALE), regionId: regionIndex(x, y), riverDistance: river.distance, riverRegionId: river.regionId, waterAccess: 1, waterStored: 0, waterStress: false, project: null, lastGrowth: 0, ruined: false };
    world.cities.push(city); kingdom.cityIds.push(city.id);
    world.structures.push({ id: world.nextId++, owner: kingdom.id, cityId: city.id, type: 'town', x, y, level });
    const rng = world.rng;
    for (let j = 0; j < (kind === 'capital' ? 4 : 2); j++) {
      const dx = j % 2 ? 2 : -2, dy = j < 2 ? 2 : -2;
      world.structures.push({ id: world.nextId++, owner: kingdom.id, cityId: city.id, type: j === 0 ? 'farm' : j === 1 ? 'house' : 'home', x: clamp(x + dx, 1, W - 2), y: clamp(y + dy, 1, H - 2), level: 1 });
    }
    if (city.buildings.well) {
      const p = findBuildingSpot(world, city, kingdom);
      if (p) world.structures.push({ id: world.nextId++, owner: kingdom.id, cityId: city.id, type: 'well', x: p.x, y: p.y, level: city.buildings.well });
    }
    return city;
  }
  function addUnit(world, kingdom, kind, x, y, extra) {
    const unit = Object.assign({ id: world.nextId++, kingdomId: kingdom.id, kind, x: clamp(x, 0, W - 1), y: clamp(y, 0, H - 1), hp: 100, maxHp: kind === 'soldier' ? 96 : 100, age: 0, alive: true, moveCd: 0, attackCd: 0, morale: 1, merit: 0, kills: 0, brain: createBrain(world, kind) }, extra || {});
    world.units.push(unit); kingdom.unitIds.push(unit.id); return unit;
  }
  function createRelations(world) {
    for (let i = 0; i < world.kingdoms.length; i++) for (let j = i + 1; j < world.kingdoms.length; j++) {
      world.diplomacy[i + ':' + j] = { a: i, b: j, relation: Math.round((world.rng() - .5) * 34), state: 'peace', since: 0, cooldown: 0, lastTrade: -80 };
    }
  }
  function updateTerritories(w) {
    const owners = new Int16Array(w.climateRegions.length); owners.fill(-1);
    const scores = new Float32Array(w.climateRegions.length); scores.fill(Infinity);
    for (const city of w.cities) {
      if (!city || city.ruined) continue;
      const k = kingdomById(w, city.owner); if (!k || k.eliminated) continue;
      const radius = city.territoryRadius || Math.round((city.kind === 'capital' ? 34 : 22) * MAP_SCALE);
      for (let id = 0; id < w.climateRegions.length; id++) {
        const region = w.climateRegions[id], cx = (id % REGION_COLS) * REGION_W + REGION_W / 2, cy = Math.floor(id / REGION_COLS) * REGION_H + REGION_H / 2;
        const d = Math.abs(cx - city.x) + Math.abs(cy - city.y);
        if (d <= radius && d / radius < scores[id]) { scores[id] = d / radius; owners[id] = city.owner; }
      }
    }
    for (const structure of w.structures) {
      if (structure.type !== 'watchtower' && structure.type !== 'outpost') continue;
      const k = kingdomById(w, structure.owner); if (!k || k.eliminated) continue;
      for (let id = 0; id < w.climateRegions.length; id++) {
        const region = w.climateRegions[id], cx = (id % REGION_COLS) * REGION_W + REGION_W / 2, cy = Math.floor(id / REGION_COLS) * REGION_H + REGION_H / 2;
        const d = Math.abs(cx - structure.x) + Math.abs(cy - structure.y), radius = Math.round((structure.type === 'outpost' ? 24 : 25) * MAP_SCALE), score = d / radius * (structure.type === 'outpost' ? .84 : .88);
        if (d <= radius && score < scores[id]) { scores[id] = score; owners[id] = structure.owner; }
      }
    }
    let changed = false;
    for (let i = 0; i < owners.length; i++) {
      const region = w.climateRegions[i]; if (region.territoryOwner !== owners[i]) changed = true;
      region.territoryOwner = owners[i];
    }
    for (const k of w.kingdoms) k.claimedRegions = 0;
    for (const owner of owners) if (owner >= 0) { const k = kingdomById(w, owner); if (k) k.claimedRegions++; }
    if (changed) w.territoryRevision++;
  }
  function updateMarket(w, force) {
    if (!force && w.tick - w.market.lastUpdate < 40) return;
    const supply = { food: 0, wood: 0, stone: 0, iron: 0, gold: 0 }, demand = { food: 0, wood: 0, stone: 0, iron: 0, gold: 0 };
    for (const k of w.kingdoms) if (!k.eliminated) {
      const pop = population(w, k);
      for (const type of Object.keys(supply)) supply[type] += k.stock[type] || 0;
      demand.food += pop * 2.2; demand.wood += pop * .42; demand.stone += pop * .2; demand.iron += pop * .16; demand.gold += pop * .1;
    }
    for (const node of w.nodes) supply[node.type] += node.amount;
    const supplyFactor = { food: 1, wood: .22, stone: .16, iron: .13, gold: .1 };
    const demandFactor = { food: 1, wood: 1, stone: 1, iron: 1, gold: 1 };
    for (const type of Object.keys(BASE_PRICES)) {
      const ratio = demand[type] * demandFactor[type] / Math.max(1, supply[type] * supplyFactor[type]);
      const warShare = w.kingdoms.filter(k => !k.eliminated && w.kingdoms.some(o => o.id !== k.id && atWar(w, k.id, o.id))).length / Math.max(1, w.kingdoms.length);
      w.market.globalPrices[type] = BASE_PRICES[type] * clamp(.84 + ratio * .2 + warShare * .16, .7, 1.9);
    }
    const regionalSupply = w.climateRegions.map(() => ({ food: 0, wood: 0, stone: 0, iron: 0, gold: 0 }));
    for (const node of w.nodes) regionalSupply[w.tiles[node.y * W + node.x].regionId][node.type] += node.amount;
    const totals = { food: 0, wood: 0, stone: 0, iron: 0, gold: 0 };
    for (let i = 0; i < w.climateRegions.length; i++) {
      const region = w.climateRegions[i]; region.resourceStock = regionalSupply[i];
      for (const type of Object.keys(BASE_PRICES)) totals[type] += regionalSupply[i][type];
    }
    for (const type of Object.keys(BASE_PRICES)) {
      const ranked = w.climateRegions.map(r => r.resourceStock[type]).sort((a, b) => a - b), low = ranked[Math.floor(ranked.length * .25)], high = ranked[Math.floor(ranked.length * .75)];
      for (const region of w.climateRegions) {
        const stock = region.resourceStock[type], average = totals[type] / w.climateRegions.length;
        region.abundance[type] = stock >= high && high > 0 ? 'abundante' : stock <= low ? 'escasso' : 'equilibrado';
        let factor = clamp(1.12 - (stock / Math.max(1, average) - 1) * .18, .78, 1.48);
        if (type === 'food' && region.weather === 'drought') factor *= 1 + region.droughtSeverity * .3;
        if (type === 'food' && region.weather === 'rain') factor *= .96;
        const owner = kingdomById(w, region.territoryOwner);
        if (owner) factor *= 1 + (owner.ministers.economy.taxRate || .075) * .35;
        if (owner && w.kingdoms.some(k => k.id !== owner.id && !k.eliminated && atWar(w, owner.id, k.id))) factor *= 1.1;
        region.prices[type] = clamp(w.market.globalPrices[type] * factor, BASE_PRICES[type] * .58, BASE_PRICES[type] * 2.4);
      }
    }
    w.market.totalSupply = supply; w.market.totalDemand = demand; w.market.lastUpdate = w.tick;
  }
  function pair(a, b) { return a < b ? a + ':' + b : b + ':' + a; }
  function relations(world, a, b) { return world.diplomacy[pair(a, b)]; }
  function atWar(world, a, b) { const r = relations(world, a, b); return !!r && r.state === 'war'; }
  function addLog(world, text) { world.logs.unshift({ tick: world.tick, text }); if (world.logs.length > 14) world.logs.length = 14; }
  function cityById(w, id) { return w.cities.find(c => c.id === id); }
  function kingdomById(w, id) { return w.kingdoms.find(k => k.id === id); }
  function unitsOf(w, k, kind) { return w.units.filter(u => u.alive && u.kingdomId === k.id && (!kind || u.kind === kind)); }
  function population(w, k) { return unitsOf(w, k).length; }
  function citiesWithProjects(w, k) { return k.cityIds.map(id => cityById(w, id)).filter(c => c && !c.ruined && c.project); }
  function cityPopulation(w, city) { return w.units.filter(u => u.alive && u.cityId === city.id).length; }
  function cityCapacity(w, city) {
    const homes = w.structures.filter(s => s.cityId === city.id && (s.type === 'house' || s.type === 'home')).length;
    return 12 + (city.buildings.farm || 0) * 7 + city.level * 8 + (city.buildings.well || 0) * 3 + (city.buildings.cistern || 0) * 2 + homes * 4;
  }
  function waterDemand(w, city) {
    const residents = w.units.reduce((count, u) => count + (u.alive && u.cityId === city.id ? 1 : 0), 0);
    return .32 + residents * .028 + (city.buildings.farm || 0) * .06 + (city.buildings.irrigation || 0) * .14;
  }
  function waterSupply(w, city) {
    const region = regionAt(w, city.x, city.y), drought = region.weather === 'drought';
    const ground = drought ? .24 + region.moisture * .18 : .42 + region.moisture * .24 + (region.weather === 'rain' ? .12 : 0);
    const wellLevel = city.buildings.well || 0;
    const well = wellLevel * (drought ? .2 + region.moisture * .08 : .32 + region.moisture * .08);
    const riverRegion = w.climateRegions[city.riverRegionId] || region;
    const proximity = city.riverDistance <= 4 ? clamp((5 - city.riverDistance) / 4, 0, 1) : 0;
    const river = proximity * riverRegion.riverFlow * .5;
    return ground + well + river;
  }
  function updateWater(w) {
    for (const city of w.cities) {
      if (city.ruined) continue;
      const region = regionAt(w, city.x, city.y), demand = waterDemand(w, city), source = waterSupply(w, city);
      const capacity = (city.buildings.cistern || 0) * 9;
      let delivered = source;
      if (source < demand && city.waterStored > 0) {
        const used = Math.min(city.waterStored, demand - source);
        city.waterStored -= used; delivered += used;
      }
      city.waterAccess = clamp(delivered / demand, .08, 1);
      if (capacity > 0) {
        const refill = region.weather === 'rain' ? .36 + region.moisture * .12 : source > demand ? Math.min(.16, (source - demand) * .35) : 0;
        city.waterStored = clamp(city.waterStored + refill, 0, capacity);
      } else city.waterStored = 0;
      if (!city.waterStress && city.waterAccess < .68) {
        city.waterStress = true; addLog(w, 'A água escasseia em ' + city.name + '; o conselho procura novas fontes.');
      } else if (city.waterStress && city.waterAccess > .84) {
        city.waterStress = false; addLog(w, 'As fontes de ' + city.name + ' voltam a abastecer a população.');
      }
    }
  }
  function kingdomWaterOutlook(w, k) {
    const cities = k.cityIds.map(id => cityById(w, id)).filter(c => c && !c.ruined);
    if (!cities.length) return 1;
    let value = 0, weight = 0;
    for (const city of cities) {
      const residents = Math.max(1, w.units.filter(u => u.alive && u.cityId === city.id).length);
      value += city.waterAccess * residents; weight += residents;
    }
    return value / weight;
  }
  function farmYieldFactor(w, city) {
    const region = regionAt(w, city.x, city.y), season = [1.08, 1.06, .9, .48][w.seasonIndex];
    const moisture = .72 + region.moisture * .42;
    const weather = region.weather === 'drought' ? 1 - region.droughtSeverity * .68 : region.weather === 'rain' ? 1.08 : 1;
    const water = .35 + (city.waterAccess ?? 1) * .65;
    const irrigation = 1 + Math.min(2, city.buildings.irrigation || 0) * .13 * (city.waterAccess ?? 1);
    return clamp(season * region.fertility * moisture * weather * water * irrigation, .18, 1.5);
  }
  function kingdomFoodOutlook(w, k) {
    let farms = 0, yieldTotal = 0;
    for (const id of k.cityIds) {
      const city = cityById(w, id); if (!city) continue;
      const count = city.buildings.farm || 0; farms += count; yieldTotal += count * farmYieldFactor(w, city);
    }
    return farms ? yieldTotal / farms : (w.seasonIndex === 3 ? .48 : .85);
  }
  function passable(w, x, y) { if (x < 0 || x >= W || y < 0 || y >= H) return false; const t = tile(w, x, y).terrain; return t !== 3 && t !== 4; }
  function distanceField(w, tx, ty) {
    const id = key(tx, ty); if (w.paths.has(id)) return w.paths.get(id);
    const d = new Int16Array(SIZE); d.fill(32767); const q = new Int32Array(SIZE); let head = 0, tail = 0, start = key(tx, ty);
    if (!passable(w, tx, ty)) { const p = [[tx, ty + 1], [tx + 1, ty], [tx, ty - 1], [tx - 1, ty]].find(v => passable(w, v[0], v[1])); if (!p) return d; start = key(p[0], p[1]); }
    d[start] = 0; q[tail++] = start;
    while (head < tail) { const at = q[head++], p = coords(at), next = d[at] + 1; const ns = [[p.x + 1, p.y], [p.x - 1, p.y], [p.x, p.y + 1], [p.x, p.y - 1]];
      for (const n of ns) if (passable(w, n[0], n[1])) { const ni = key(n[0], n[1]); if (d[ni] === 32767) { d[ni] = next; q[tail++] = ni; } }
    }
    if (w.paths.size >= 8) w.paths.delete(w.paths.keys().next().value);
    w.paths.set(id, d); return d;
  }
  function localDistanceField(w, tx, ty) {
    const id = key(tx, ty);
    if (w.localPaths.has(id)) { const cached = w.localPaths.get(id); w.localPaths.delete(id); w.localPaths.set(id, cached); return cached; }
    const radius = 15, minX = Math.max(0, tx - radius), maxX = Math.min(W - 1, tx + radius), minY = Math.max(0, ty - radius), maxY = Math.min(H - 1, ty + radius), width = maxX - minX + 1, height = maxY - minY + 1;
    const d = new Int16Array(width * height); d.fill(32767); const q = new Int32Array(width * height), localKey = (x, y) => (y - minY) * width + x - minX;
    let startX = tx, startY = ty;
    if (!passable(w, tx, ty)) { const p = [[tx, ty + 1], [tx + 1, ty], [tx, ty - 1], [tx - 1, ty]].find(v => v[0] >= minX && v[0] <= maxX && v[1] >= minY && v[1] <= maxY && passable(w, v[0], v[1])); if (!p) return null; [startX, startY] = p; }
    let head = 0, tail = 0, start = localKey(startX, startY); d[start] = 0; q[tail++] = start;
    while (head < tail) {
      const at = q[head++], x = minX + at % width, y = minY + Math.floor(at / width), next = d[at] + 1;
      const neighbors = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
      for (const [nx, ny] of neighbors) if (nx >= minX && nx <= maxX && ny >= minY && ny <= maxY && passable(w, nx, ny)) { const ni = localKey(nx, ny); if (d[ni] === 32767) { d[ni] = next; q[tail++] = ni; } }
    }
    const field = { minX, minY, width, height, d };
    if (w.localPaths.size >= 64) w.localPaths.delete(w.localPaths.keys().next().value);
    w.localPaths.set(id, field); return field;
  }
  function moveTowards(w, u, target) {
    if (!target) return;
    const tx = clamp(Math.round(target.x), 0, W - 1), ty = clamp(Math.round(target.y), 0, H - 1);
    let local = distance({ x: u.x, y: u.y }, { x: tx, y: ty }) <= 14 ? localDistanceField(w, tx, ty) : null;
    const localDistance = (x, y) => !local || x < local.minX || x >= local.minX + local.width || y < local.minY || y >= local.minY + local.height ? 32767 : local.d[(y - local.minY) * local.width + x - local.minX];
    if (local && localDistance(u.x, u.y) === 32767) local = null;
    const field = local ? null : distanceField(w, tx, ty), getDistance = local ? localDistance : (x, y) => field[key(x, y)];
    const n = [[u.x + 1, u.y], [u.x - 1, u.y], [u.x, u.y + 1], [u.x, u.y - 1]].filter(p => passable(w, p[0], p[1]));
    let best = null, bestD = getDistance(u.x, u.y); for (const p of n) { const d = getDistance(p[0], p[1]); if (d < bestD) { bestD = d; best = p; } }
    if (best) { u.x = best[0]; u.y = best[1]; }
  }
  function moveAway(w, u, enemy) {
    const n = [[u.x + 1, u.y], [u.x - 1, u.y], [u.x, u.y + 1], [u.x, u.y - 1]].filter(p => passable(w, p[0], p[1]));
    const best = n.sort((a, b) => Math.abs(b[0] - enemy.x) + Math.abs(b[1] - enemy.y) - (Math.abs(a[0] - enemy.x) + Math.abs(a[1] - enemy.y)))[0]; if (best) { u.x = best[0]; u.y = best[1]; }
  }
  function nearestCity(w, k, x, y) { return k.cityIds.map(id => cityById(w, id)).filter(c => c && !c.ruined).sort((a, b) => distance(a, { x, y }) - distance(b, { x, y }))[0]; }
  function nearestNode(w, u, type) {
    const size = w.nodeBucketSize || 16, bx = Math.floor(u.x / size), by = Math.floor(u.y / size), reach = Math.ceil(14 / size);
    const buckets = w.nodeBucketsByType?.get(type) || w.nodeBuckets;
    let best = null, bestDistance = 15;
    const maxBucketX = Math.floor((W - 1) / size), maxBucketY = Math.floor((H - 1) / size);
    for (let radius = 0; radius <= reach; radius++) {
      const minX = Math.max(0, bx - radius), maxX = Math.min(maxBucketX, bx + radius), minY = Math.max(0, by - radius), maxY = Math.min(maxBucketY, by + radius);
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        if (radius && x !== minX && x !== maxX && y !== minY && y !== maxY) continue;
        const bucket = buckets.get(x + ':' + y) || [];
        for (const node of bucket) { const d = distance(node, u); if (node.amount > 0 && node.type === type && d < bestDistance) { best = node; bestDistance = d; } }
      }
      const leftGap = minX > 0 ? u.x - (minX * size - 1) : Infinity, rightGap = maxX < maxBucketX ? (maxX + 1) * size - u.x : Infinity;
      const topGap = minY > 0 ? u.y - (minY * size - 1) : Infinity, bottomGap = maxY < maxBucketY ? (maxY + 1) * size - u.y : Infinity;
      if (best && bestDistance <= Math.min(leftGap, rightGap, topGap, bottomGap)) break;
    }
    return best;
  }
  function buildScore(w, k) {
    const pop = Math.max(1, population(w, k)), enemies = w.kingdoms.filter(e => e.id !== k.id && !e.eliminated).map(e => ({ k: e, city: cityById(w, e.capitalId) })).filter(e => e.city);
    const nearestEnemy = enemies.reduce((m, e) => Math.min(m, distance(e.city, cityById(w, k.capitalId))), 50);
    let warPower = 0, threat = 0;
    for (const e of enemies) { const d = distance(cityById(w, k.capitalId), cityById(w, e.k.capitalId)); if (atWar(w, k.id, e.k.id)) { warPower += unitsOf(w, e.k, 'soldier').length; threat += d < 9 ? 2 : 1; } }
    return { pop, nearestEnemy, warPower, threat };
  }
  function hasFrontierRegion(w, k) {
    for (let id = 0; id < w.climateRegions.length; id++) {
      if (w.climateRegions[id].territoryOwner >= 0) continue;
      const x = id % REGION_COLS, y = Math.floor(id / REGION_COLS), adjacent = [x > 0 ? id - 1 : -1, x + 1 < REGION_COLS ? id + 1 : -1, y > 0 ? id - REGION_COLS : -1, y + 1 < REGION_ROWS ? id + REGION_COLS : -1];
      if (adjacent.some(next => next >= 0 && w.climateRegions[next].territoryOwner === k.id)) return true;
    }
    return false;
  }
  function chooseStrategy(w, k) {
    const sc = buildScore(w, k), stock = k.stock, ownSoldiers = unitsOf(w, k, 'soldier').length;
    const cropOutlook = kingdomFoodOutlook(w, k), climatePressure = cropOutlook < .82 ? (.82 - cropOutlook) * 5 : 0;
    const waterOutlook = kingdomWaterOutlook(w, k), waterPressure = waterOutlook < .86 ? (.86 - waterOutlook) * 6 : 0;
    const activeWar = w.kingdoms.some(other => other.id !== k.id && !other.eliminated && atWar(w, k.id, other.id));
    const armyTarget = Math.min(60, Math.max(12, k.cityIds.length * 10, Math.floor(sc.pop * .42)));
    const outpostCount = w.structures.filter(s => s.owner === k.id && (s.type === 'outpost' || s.type === 'construction' && s.projectType === 'outpost')).length;
    const canBuildOutpost = outpostCount < 3 && hasFrontierRegion(w, k) && stock.food > 135 && stock.wood > 75 && stock.stone > 35;
    const scores = {
      sustain: 2 + (stock.food < sc.pop * 2.5 ? 4 : stock.food < sc.pop * 4 ? 1.4 : 0) + (stock.wood < 16 ? 1.2 : 0) + climatePressure + waterPressure,
      expand: 1.1 + (stock.food > 150 && stock.wood > 90 && k.cityIds.length < 4 ? 2.4 : 0) + (canBuildOutpost ? 2.2 : 0) + (stock.gold > 45 ? .4 : 0),
      fortify: .7 + (sc.threat ? 2 + sc.threat + k.ministers.defense.skill * .65 : 0) + (sc.nearestEnemy < 13 ? 1.2 : 0) + (cityById(w, k.capitalId)?.hp < 250 ? 3 : 0),
      recruit: .5 + ((sc.threat || ownSoldiers < 8 || activeWar && ownSoldiers < armyTarget) && stock.food > Math.max(45, sc.pop * 1.5) && stock.iron > 5 ? 2.8 : 0),
      treaty: 1.3 + (sc.warPower > ownSoldiers * 1.4 ? 2 : 0) + (k.traits.diplomacy > .7 ? .5 : 0),
      campaign: .25 + (ownSoldiers > 8 && stock.food > 90 && stock.gold > 8 ? 1.2 : 0) + (k.traits.ambition > .68 ? .8 : 0)
    };
    if (sc.threat && (stock.food < sc.pop * 1.5 || ownSoldiers < 6)) scores.treaty += 2.5;
    if (w.tick < 70) { scores.treaty += .8; scores.campaign = 0; }
    const ruler = unitsOf(w, k, 'king')[0], best = ruler ? chooseBrainAction(w, ruler, Object.keys(scores), [stock.food / Math.max(1, sc.pop * 5), stock.wood / 150, k.cityIds.length / 4, (k.claimedRegions || 0) / w.climateRegions.length, sc.threat / 5, k.traits.ambition], scores) : Object.keys(scores).reduce((a, b) => scores[b] > scores[a] ? b : a, 'sustain');
    k.plan = best; k.planText = STRATEGIES[best]; k.lastDanger = sc.threat;
    assignJobs(w, k);
  }
  function assignJobs(w, k) {
    const people = unitsOf(w, k, 'worker').sort((a, b) => a.id - b.id), pop = Math.max(1, population(w, k));
    let food = k.stock.food < pop * 2.8 ? .48 : k.stock.food < pop * 4.8 ? .38 : .28;
    if (w.seasonIndex === 3) food += .08;
    const cropOutlook = kingdomFoodOutlook(w, k);
    if (cropOutlook < .92) food += clamp((.92 - cropOutlook) * .5, .04, .22);
    const waterPressure = kingdomWaterOutlook(w, k) < .86;
    if (waterPressure) food += .03;
    food = clamp(food, .2, .58);
    let wood = k.stock.wood < 34 ? .3 : .22, stone = k.stock.stone < 28 ? .2 : .14, iron = k.stock.iron < 22 ? .18 : .12, gold = .08;
    if (waterPressure) { wood += .035; stone += .035; }
    const ratios = { food, wood, stone, iron, gold }, assigned = [];
    const cabinet = k.ministers;
    food = clamp(food * (.9 + (cabinet.agriculture.skill || .7) * .2) + (cabinet.agriculture.harvestBias || 0), .2, .62);
    ratios.food = food;
    for (const job of Object.keys(ratios)) for (let n = 0; n < Math.round(people.length * ratios[job]); n++) assigned.push(job);
    while (assigned.length < people.length) assigned.push(k.stock.food < 55 ? 'food' : (k.stock.wood < 20 ? 'wood' : 'stone'));
    assigned.length = people.length;
    const hasAlliance = w.kingdoms.some(other => other.id !== k.id && !other.eliminated && relations(w, k.id, other.id)?.state === 'alliance');
    const projects = citiesWithProjects(w, k), builderCount = projects.length ? Math.max(1, Math.min(3, Math.ceil(people.length * .15))) : 0;
    const merchantCount = hasAlliance ? Math.min(2, Math.floor(people.length / 12)) : 0;
    let offset = 0;
    for (; offset < builderCount && offset < people.length; offset++) { people[offset].profession = 'builder'; people[offset].projectCityId = projects[0]?.id; }
    for (let i = 0; i < merchantCount && offset < people.length; i++, offset++) people[offset].profession = 'merchant';
    for (let i = offset; i < people.length; i++) { const u = people[i]; u.job = assigned[i]; u.profession = RESOURCE_PROFESSION[u.job] || 'farmer'; if (u.carryType !== u.job && !u.carry) u.carryType = u.job; }
  }
  function thinkKing(w, k) {
    if (k.eliminated || w.tick - k.lastThink < 20) return;
    k.lastThink = w.tick;
    if (!k.cityIds.length) { foundRefuge(w, k); return; }
    if (!cityById(w, k.capitalId)) k.capitalId = k.cityIds[0];
    updateCabinet(w, k);
    chooseStrategy(w, k);
    decideDiplomacy(w, k);
    tryBuild(w, k);
    const generals = unitsOf(w, k, 'general');
    for (const g of generals) decideGeneral(w, k, g);
    if (w.tick % 100 < 20) addLog(w, k.name + ': ' + k.planText.toLowerCase() + '.');
  }
  function updateCabinet(w, k) {
    if (w.tick - k.lastCabinet < 80) return;
    k.lastCabinet = w.tick;
    const pop = Math.max(1, population(w, k)), foodTarget = pop * 2.8;
    const econ = k.ministers.economy, agriculture = k.ministers.agriculture, defense = k.ministers.defense;
    econ.taxRate = clamp(.07 + (35 - k.stock.gold) * .00065, .025, .12);
    agriculture.harvestBias = clamp((foodTarget - k.stock.food) / foodTarget * .08 + (kingdomFoodOutlook(w, k) < .7 ? .07 : 0), 0, .15);
    defense.readiness = clamp(.35 + defense.skill * .4 + (k.lastDanger ? .1 : 0) + (k.plan === 'fortify' ? .1 : 0), .25, 1);
    for (const minister of Object.values(k.ministers)) minister.experience = (minister.experience || 0) + .01;
  }
  function decideDiplomacy(w, k) {
    if (w.tick - k.lastDiplomacy < 40) return; k.lastDiplomacy = w.tick;
    const myPower = unitsOf(w, k, 'soldier').length + k.cityIds.length * 2;
    for (const other of w.kingdoms) {
      if (other.id === k.id || other.eliminated || !other.cityIds.length) continue;
      const r = relations(w, k.id, other.id); if (!r || r.cooldown > w.tick) continue;
      const enemyPower = unitsOf(w, other, 'soldier').length + other.cityIds.length * 2;
      const myCity = cityById(w, k.capitalId), theirCity = cityById(w, other.capitalId);
      const d = myCity && theirCity ? distance(myCity, theirCity) : 99;
      if (r.state === 'war') {
        const weak = myPower < enemyPower * .58 || k.stock.food < population(w, k) * 1.6 || (myCity && myCity.hp < myCity.maxHp * .32);
        if (weak && w.tick - r.since > 90 && k.traits.prudence > .35) { r.state = 'truce'; r.relation = Math.max(r.relation, -10); r.since = w.tick; r.cooldown = w.tick + 70; addLog(w, k.name + ' pede uma trégua para salvar suas cidades.'); }
      } else if (r.state === 'truce') {
        if (w.tick - r.since > 70) { r.state = 'peace'; r.since = w.tick; }
      } else if (r.state === 'alliance') {
        r.relation = Math.min(70, r.relation + .2);
        if (r.relation < -18) { r.state = 'peace'; addLog(w, 'A aliança entre ' + k.name + ' e ' + other.name + ' se rompe.'); }
      } else {
        r.relation = clamp(r.relation + (k.traits.diplomacy - .5) * .08, -55, 55);
        const fear = enemyPower > myPower * 1.3;
        if ((fear || k.plan === 'treaty') && r.relation > 16 && w.tick > 80 && w.rng() < .36) { r.state = 'alliance'; r.since = w.tick; addLog(w, k.name + ' firma um pacto de defesa com ' + other.name + '.'); }
        const supplied = k.stock.food > population(w, k) * 3.2 && k.stock.wood > 55 && k.stock.iron > 15;
        const opening = unitsOf(w, other, 'soldier').length < myPower * .72 || other.plan === 'campaign';
        if (w.tick > 90 && d < W * .92 && supplied && opening && r.relation < 10 && k.traits.ambition > .48 && w.rng() < .25 + k.traits.ambition * .16) {
          r.state = 'war'; r.since = w.tick; r.relation = -35; w.warsStarted++;
          addLog(w, k.name + ' declara guerra a ' + other.name + '. Os generais marcham.');
        }
      }
    }
  }
  function tryBuild(w, k) {
    if (w.tick - k.lastBuild < 26 || !k.cityIds.length) return; k.lastBuild = w.tick;
    const pop = population(w, k); let c = cityById(w, k.capitalId); if (!c) return;
    let type = null, cost = null;
    const cities = k.cityIds.map(cityById.bind(null, w)).filter(city => city && !city.ruined);
    const waterSite = cities.slice().sort((a, b) => a.waterAccess - b.waterAccess)[0];
    const farmSite = cities.filter(city => (city.buildings.farm || 0) < 5).sort((a, b) => farmYieldFactor(w, b) - farmYieldFactor(w, a))[0];
    const irrigationSite = cities.filter(city => (city.buildings.irrigation || 0) < 2 && city.buildings.farm > 0 && regionAt(w, city.x, city.y).weather === 'drought' && city.waterAccess > .82).sort((a, b) => farmYieldFactor(w, b) - farmYieldFactor(w, a))[0];
    if (waterSite && waterSite.waterAccess < .78 && (waterSite.buildings.well || 0) < 3) { type = 'well'; cost = { wood: 13, stone: 10 }; c = waterSite; }
    else if (waterSite && waterSite.waterAccess < .9 && (waterSite.buildings.cistern || 0) < 2) { type = 'cistern'; cost = { wood: 16, stone: 9 }; c = waterSite; }
    else if (irrigationSite) { type = 'irrigation'; cost = { wood: 19, stone: 12 }; c = irrigationSite; }
    else if (k.stock.food < pop * 3.2 && farmSite) { type = 'farm'; cost = { wood: 14, stone: 7 }; c = farmSite; }
    else if ((k.lastDanger > 0 || k.plan === 'fortify') && c.buildings.watchtower < 2) { type = 'watchtower'; cost = { wood: 18, stone: 15 }; }
    else if (k.stock.wood < 32 && c.buildings.sawmill < 3) { type = 'sawmill'; cost = { wood: 11, stone: 7 }; }
    else if (k.stock.stone < 30 && c.buildings.quarry < 2) { type = 'quarry'; cost = { wood: 12, stone: 10 }; }
    else if (k.stock.iron < 18 && c.buildings.mine < 2) { type = 'mine'; cost = { wood: 16, stone: 12, iron: 2 }; }
    else if ((k.plan === 'fortify' || c.hp < c.maxHp * .78) && c.buildings.wall < 4) { type = 'wall'; cost = { wood: 15, stone: 16 }; }
    else if (k.plan === 'recruit' && c.buildings.barracks < 2) { type = 'barracks'; cost = { wood: 20, stone: 14, iron: 5 }; }
    else if (k.plan === 'expand' && k.cityIds.length < 4 && k.stock.food > 180 && k.stock.wood > 115 && k.stock.stone > 60) { type = 'village'; cost = { food: 35, wood: 48, stone: 20 }; }
    else if (k.plan === 'expand' && w.structures.filter(s => s.owner === k.id && s.type === 'outpost').length < 3 && !w.structures.some(s => s.owner === k.id && s.type === 'construction' && s.projectType === 'outpost') && k.stock.food > 135 && k.stock.wood > 75 && k.stock.stone > 35 && hasFrontierRegion(w, k)) { type = 'outpost'; cost = { food: 26, wood: 32, stone: 14 }; c = cities.find(city => !city.project) || c; }
    if (!type || !canPay(k, cost)) return;
    startConstruction(w, k, c, type, cost);
  }
  function startConstruction(w, k, city, type, cost) {
    if (!city || city.project || !BUILD_WORK[type] || !canPay(k, cost)) return false;
    const at = type === 'village' ? findSettlementSpot(w, city, k) : type === 'outpost' ? findOutpostSpot(w, k) : findBuildingSpot(w, city, k);
    if (!at) return false;
    pay(k, cost);
    const projectId = w.nextId++;
    city.project = { id: projectId, type, x: at.x, y: at.y, progress: 0, required: Math.max(8, BUILD_WORK[type] * (1 - k.ministers.economy.skill * .12)), started: w.tick, cost: Object.assign({}, cost) };
    w.structures.push({ id: w.nextId++, owner: k.id, cityId: city.id, type: 'construction', projectType: type, projectId, x: at.x, y: at.y, level: 1 });
    updateTerritories(w);
    addLog(w, k.name + ' inicia ' + (type === 'village' ? 'um novo povoado' : 'a construção de ' + constructionLabel(type)) + ' em ' + city.name + '.');
    return true;
  }
  function constructionLabel(type) { return ({ farm: 'uma fazenda', sawmill: 'uma serraria', quarry: 'uma pedreira', mine: 'uma mina', wall: 'um trecho de muralha', barracks: 'um quartel', well: 'um poço', cistern: 'uma cisterna', irrigation: 'canais de irrigação', watchtower: 'uma torre de vigia', outpost: 'um posto de fronteira' })[type] || type; }
  function completeConstruction(w, k, city) {
    const project = city.project; if (!project || project.progress < project.required) return;
    w.structures = w.structures.filter(s => s.projectId !== project.id);
    city.project = null; w.completedProjects++;
    if (project.type === 'village') {
      const nc = addCity(w, k, project.x, project.y, 'village', 1);
      nc.name = ['Alden', 'Rio Baixo', 'Monte Claro', 'Vila Âmbar'][k.id] + ' ' + k.cityIds.length;
      addLog(w, k.name + ' conclui e povoa ' + nc.name + '.');
    } else if (project.type === 'outpost') {
      w.structures.push({ id: w.nextId++, owner: k.id, cityId: city.id, type: 'outpost', x: project.x, y: project.y, level: 1 });
      addLog(w, k.name + ' conclui um posto de fronteira e amplia sua influência regional.');
    } else {
      const type = project.type;
      city.buildings[type] = (city.buildings[type] || 0) + 1;
      if (type === 'wall') { city.fort++; city.maxHp += 34; city.hp = Math.min(city.maxHp, city.hp + 34); }
      w.structures.push({ id: w.nextId++, owner: k.id, cityId: city.id, type, x: project.x, y: project.y, level: city.buildings[type] });
      if (type === 'watchtower') city.territoryRadius = Math.max(city.territoryRadius || Math.round(22 * MAP_SCALE), Math.round(28 * MAP_SCALE));
      addLog(w, k.name + ' conclui ' + constructionLabel(type) + ' perto de ' + city.name + '.');
    }
    updateTerritories(w);
  }
  function canPay(k, cost) { return Object.keys(cost).every(t => k.stock[t] >= cost[t]); }
  function pay(k, cost) { Object.keys(cost).forEach(t => k.stock[t] -= cost[t]); }
  function refund(k, cost) { Object.keys(cost).forEach(t => k.stock[t] += cost[t]); }
  function findBuildingSpot(w, c, k) {
    for (let r = 1; r < 4; r++) for (let y = c.y - r; y <= c.y + r; y++) for (let x = c.x - r; x <= c.x + r; x++) if (Math.abs(x - c.x) + Math.abs(y - c.y) === r && passable(w, x, y) && !w.structures.some(s => s.x === x && s.y === y)) { if (tile(w, x, y).terrain !== 0) { tile(w, x, y).terrain = 0; w.paths.clear(); w.localPaths.clear(); } return { x, y }; }
    return null;
  }
  function findSettlementSpot(w, from, k) {
    const candidates = [];
    for (let y = 3; y < H - 3; y += 2) for (let x = 3; x < W - 3; x += 2) {
      const d = distance(from, { x, y }); if (d < 5 || d > 11 || !passable(w, x, y) || w.cities.some(c => distance(c, { x, y }) < 4)) continue;
      const enemyDist = Math.min(...w.kingdoms.filter(o => o.id !== k.id && !o.eliminated).map(o => { const c = cityById(w, o.capitalId); return c ? distance(c, { x, y }) : 90; }));
      const forest = Math.abs(x - W / 2) + Math.abs(y - H / 2), region = regionAt(w, x, y), water = riverProximity(w, x, y);
      const foodPotential = region.fertility * (.7 + region.moisture * .5) * (region.weather === 'drought' ? .55 : 1);
      candidates.push({ x, y, score: d * .15 + enemyDist * .45 + forest * .05 + foodPotential * 1.8 + water.access * .9 + w.rng() * 3 });
    }
    candidates.sort((a, b) => b.score - a.score); return candidates[0] || null;
  }
  function findOutpostSpot(w, k) {
    const candidates = [];
    for (let id = 0; id < w.climateRegions.length; id++) {
      const region = w.climateRegions[id]; if (region.territoryOwner >= 0) continue;
      const col = id % REGION_COLS, row = Math.floor(id / REGION_COLS), neighbors = [col > 0 ? id - 1 : -1, col + 1 < REGION_COLS ? id + 1 : -1, row > 0 ? id - REGION_COLS : -1, row + 1 < REGION_ROWS ? id + REGION_COLS : -1];
      if (!neighbors.some(next => next >= 0 && w.climateRegions[next].territoryOwner === k.id)) continue;
      let best = null; const centerX = col * REGION_W + REGION_W / 2, centerY = row * REGION_H + REGION_H / 2;
      for (let y = Math.max(row * REGION_H + 2, centerY - 4); y <= Math.min(H - 2, (row + 1) * REGION_H - 2, centerY + 4); y += 2) for (let x = Math.max(col * REGION_W + 2, centerX - 4); x <= Math.min(W - 2, (col + 1) * REGION_W - 2, centerX + 4); x += 2) {
        if (!passable(w, x, y) || w.cities.some(city => distance(city, { x, y }) < 5) || w.structures.some(structure => distance(structure, { x, y }) < 3)) continue;
        const enemyDistance = Math.min(...w.kingdoms.filter(other => other.id !== k.id && !other.eliminated).map(other => { const city = cityById(w, other.capitalId); return city ? distance(city, { x, y }) : 99; }));
        if (enemyDistance < 8) continue;
        const water = riverProximity(w, x, y), score = region.fertility + region.moisture * .35 + water.access * .4 + Math.min(30, enemyDistance) * .012;
        if (!best || score > best.score) best = { x, y, score };
      }
      if (best) candidates.push(best);
    }
    candidates.sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x);
    return candidates[0] || null;
  }
  function decideGeneral(w, k, g) {
    if (g.lastPlan !== undefined && w.tick - g.lastPlan < 12) return; g.lastPlan = w.tick;
    const wars = w.kingdoms.filter(o => o.id !== k.id && !o.eliminated && atWar(w, k.id, o.id));
    const army = unitsOf(w, k, 'soldier').filter(s => s.generalId === g.id), lieutenants = unitsOf(w, k, 'lieutenant').filter(l => l.generalId === g.id);
    if (!wars.length) {
      const intent = chooseBrainAction(w, g, ['defend', 'patrol'], [0, clamp(k.stock.food / Math.max(1, population(w, k) * 3), 0, 1), k.lastDanger ? 1 : 0, 1, clamp(k.cityIds.length / 4, 0, 1), k.traits.prudence], { defend: k.lastDanger ? .75 : .15, patrol: k.lastDanger ? .6 : .45 });
      g.order = intent === 'patrol' ? 'patrol' : 'guard'; g.strategy = 'hold'; g.targetCity = k.capitalId;
    }
    else {
      const targets = wars.flatMap(o => o.cityIds.map(id => cityById(w, id)).filter(Boolean));
      const here = cityById(w, k.capitalId) || { x: g.x, y: g.y };
      targets.sort((a, b) => ((a.hp / a.maxHp) * 15 + distance(here, a) - (a.owner === k.id ? 20 : 0)) - ((b.hp / b.maxHp) * 15 + distance(here, b) - (b.owner === k.id ? 20 : 0)));
      const ready = army.filter(s => s.hp > 28).length;
      const affordable = k.stock.food > population(w, k) * .8 && k.stock.gold > 3;
      const options = ready >= 4 && affordable ? ['defend', 'attack'] : ['defend'];
      g.order = chooseBrainAction(w, g, options, [clamp(ready / Math.max(1, army.length), 0, 1), clamp(k.stock.food / Math.max(1, population(w, k) * 3), 0, 1), clamp(k.stock.gold / 20, 0, 1), clamp(k.lastDanger / 5, 0, 1), clamp(distance(here, targets[0] || here) / 50, 0, 1), k.traits.ambition], { defend: .55 + (k.stock.food < population(w, k) * 1.5 ? .35 : 0), attack: 1 });
      const cavalry = army.filter(s => s.class === 'horse').length;
      const forested = tile(w, g.x, g.y).terrain === 1;
      const target = targets[(g.id + Math.floor(w.tick / 80)) % Math.max(1, targets.length)];
      g.targetCity = g.order === 'attack' && target ? target.id : k.capitalId;
      g.strategy = g.order !== 'attack' ? 'hold' : k.stock.food < population(w, k) * 1.4 ? 'hold' : cavalry >= 2 ? 'flank' : forested ? 'ambush' : target && target.fort > 0 ? 'siege' : ['flank', 'ambush', 'siege'][g.id % 3];
    }
    g.commandText = g.order === 'attack' ? TACTICS[g.strategy] : g.order === 'patrol' ? 'Patrulhar fronteiras e rotas' : TACTICS.hold;
    g.subordinateCount = lieutenants.length;
  }
  function advanceClimate(w) {
    const season = w.seasonIndex;
    for (const region of w.climateRegions) {
      region.weatherTicks--;
      if (region.weatherTicks <= 0) {
        if (region.weather === 'drought') {
          region.weather = 'clear'; region.droughtSeverity = 0;
          region.weatherTicks = 12 + Math.floor(w.rng() * 13);
          addLog(w, 'As chuvas retornam a ' + region.name + '; os campos começam a se recuperar.');
        } else {
          const drySeason = season === 1 ? .018 : season === 2 ? .005 : 0;
          const lowMoisture = region.moisture < .32 ? .012 : 0;
          const droughtChance = .004 + region.aridity * .018 + drySeason + lowMoisture;
          if (w.rng() < droughtChance) {
            region.weather = 'drought'; region.droughtSeverity = .55 + w.rng() * .4;
            region.weatherTicks = 30 + Math.floor(w.rng() * 43); w.droughtsStarted++;
            addLog(w, (region.droughtSeverity > .82 ? 'Uma seca severa assola ' : 'A seca alcança ') + region.name + '. As colheitas e os rios perdem força.');
          } else {
            const seasonalRain = season === 0 || season === 2 ? .12 : 0;
            const rainChance = clamp(.22 + seasonalRain + (region.moisture < .38 ? .08 : 0) - region.aridity * .12, .12, .52);
            if (w.rng() < rainChance) { region.weather = 'rain'; region.weatherTicks = 8 + Math.floor(w.rng() * 12); }
            else { region.weather = 'clear'; region.weatherTicks = 12 + Math.floor(w.rng() * 17); }
            region.droughtSeverity = 0;
          }
        }
      }
      if (region.weather === 'drought') region.moisture -= .004 + region.droughtSeverity * .006;
      else if (region.weather === 'rain') region.moisture += .012;
      else if (season === 0 || season === 2) region.moisture += .0015;
      else if (season === 1) region.moisture -= .003 * region.aridity;
      else region.moisture -= .0008;
      region.moisture = clamp(region.moisture, .08, .96);
      region.riverFlow = clamp(.36 + region.moisture * .58 + (region.weather === 'rain' ? .12 : 0) - (region.weather === 'drought' ? region.droughtSeverity * .38 : 0), .08, .98);
    }
    for (const t of w.riverTiles) t.flow = w.climateRegions[t.regionId].riverFlow;
  }
  function updateEcology(w) {
    if (w.tick % 8 !== 0) return;
    const seasonGrowth = [1.3, 1.08, .76, .22][w.seasonIndex];
    for (const node of w.nodes) {
      if (node.amount >= node.max || (node.type !== 'food' && node.type !== 'wood')) continue;
      const t = tile(w, node.x, node.y), region = w.climateRegions[t.regionId];
      const moisture = .35 + region.moisture * .9;
      const weather = region.weather === 'drought' ? Math.max(.12, 1 - region.droughtSeverity * .82) : region.weather === 'rain' ? 1.28 : 1;
      const rate = node.type === 'food' ? .34 : .085;
      const growth = Math.min(node.max - node.amount, rate * seasonGrowth * moisture * weather);
      node.amount += growth; w.ecologicalGrowth[node.type] += growth;
      if (node.type === 'wood') t.forestCover = clamp((t.forestCover || 0) + growth / node.max * .62, .08, 1);
    }
  }
  function tick(world, count) {
    for (let n = 0; n < (count || 1); n++) advanceOne(world);
    return world;
  }
  function brainTarget(world, unit) {
    if (unit.kind === 'worker') {
      const projectCity = cityById(world, unit.projectCityId), project = projectCity?.project;
      if (unit.profession === 'builder' && project) return project;
      if (unit.carry > 0) return cityById(world, unit.cityId);
      const node = world.nodes.find(item => item.id === unit.targetNode && item.amount > 0);
      return node || cityById(world, unit.cityId);
    }
    if (unit.kind === 'soldier') { const lieutenant = world.units.find(item => item.id === unit.lieutenantId); return cityById(world, lieutenant?.targetCity || unit.cityId); }
    if (unit.kind === 'general') return cityById(world, unit.targetCity || unit.cityId);
    if (unit.kind === 'lieutenant') {
      const squad = (unit.squad || []).map(id => world.units.find(item => item.id === id && item.alive)).filter(Boolean);
      return squad.length ? { x: squad.reduce((sum, item) => sum + item.x, 0) / squad.length, y: squad.reduce((sum, item) => sum + item.y, 0) / squad.length } : cityById(world, unit.cityId);
    }
    return cityById(world, unit.cityId);
  }
  function brainMetrics(world, unit) {
    const kingdom = kingdomById(world, unit.kingdomId), projectCity = cityById(world, unit.projectCityId), project = projectCity?.project, target = brainTarget(world, unit);
    return { x: unit.x, y: unit.y, hp: unit.hp, carry: unit.carry || 0, stock: kingdom?.stock[unit.job] || 0, food: kingdom?.stock.food || 0,
      progress: project?.progress || 0, completedProjects: world.completedProjects, merit: unit.merit || 0, kills: unit.kills || 0,
      cities: kingdom?.cityIds.length || 0, territory: kingdom?.claimedRegions || 0, captures: world.captures, deaths: world.warDeaths,
      targetX: target?.x ?? unit.x, targetY: target?.y ?? unit.y };
  }
  function runUnitAction(world, unit, action) {
    const before = brainMetrics(world, unit); action(world, unit);
    const after = brainMetrics(world, unit), kingdom = kingdomById(world, unit.kingdomId), progress = Math.abs(before.targetX - before.x) + Math.abs(before.targetY - before.y) - (Math.abs(before.targetX - after.x) + Math.abs(before.targetY - after.y));
    let reward = 0;
    if (unit.kind === 'worker') reward = Math.max(0, after.stock - before.stock) * .16 + (after.carry - before.carry) * .06 + Math.max(0, after.progress - before.progress) * .65 + Math.max(0, after.completedProjects - before.completedProjects) * .4 + progress * .018 - Math.max(0, before.hp - after.hp) * .04;
    else if (unit.kind === 'soldier') reward = (after.merit - before.merit) * .08 + (after.kills - before.kills) * .55 + progress * .012 - Math.max(0, before.hp - after.hp) * .035;
    else if (unit.kind === 'king') reward = (after.food - before.food) * .004 + (after.territory - before.territory) * .16 + (after.cities - before.cities) * .45 + (after.captures - before.captures) * .3 - Math.max(0, after.deaths - before.deaths) * .04;
    else reward = progress * .025 - Math.max(0, before.hp - after.hp) * .035;
    const intent = unit.brain?.lastAction || 'ação';
    recordBrainOutcome(unit, clamp(reward, -1, 1), intent + (reward >= .08 ? ' · resultado favorável' : reward <= -.08 ? ' · custo ou perda' : ' · efeito pequeno'));
  }
  function advanceOne(w) {
    if (w.ended) return;
    w.tick++; w.seasonIndex = Math.floor(w.tick / 80) % 4; w.year = Math.floor(w.tick / 320) + 1;
    if (w.tick % 80 === 0) addLog(w, 'O reino entra em ' + ['primavera', 'verão', 'outono', 'inverno'][w.seasonIndex] + ' do ano ' + w.year + '.');
    advanceClimate(w); updateWater(w); updateEcology(w);
    for (const k of w.kingdoms) if (!k.eliminated) thinkKing(w, k);
    economy(w); updateMarket(w); tradeWithAllies(w);
    for (const u of w.units) if (u.alive) { u.age++; if (u.moveCd > 0) u.moveCd--; if (u.attackCd > 0) u.attackCd--; if (u.kind === 'worker') runUnitAction(w, u, actWorker); }
    for (const u of w.units) if (u.alive && u.kind === 'soldier') runUnitAction(w, u, actSoldier);
    for (const u of w.units) if (u.alive && u.kind === 'lieutenant') runUnitAction(w, u, actLieutenant);
    for (const u of w.units) if (u.alive && u.kind === 'general') runUnitAction(w, u, actGeneral);
    for (const u of w.units) if (u.alive && u.kind === 'king') runUnitAction(w, u, (world, ruler) => { const c = cityById(world, ruler.cityId); if (c && distance(ruler, c) > 0) { ruler.x = c.x; ruler.y = c.y; } });
    for (const k of w.kingdoms) if (!k.eliminated) lifecycle(w, k);
    w.units = w.units.filter(u => u.alive);
    const survivors = w.kingdoms.filter(k => !k.eliminated);
    if (survivors.length === 0) { w.ended = true; addLog(w, 'As últimas casas reais caem; ninguém conseguiu manter o reino.'); }
    else if (survivors.length === 1 && w.tick > 280) {
      const winner = survivors[0]; w.ended = true; addLog(w, winner.name + ' torna-se a última coroa de pé.');
    }
  }
  function economy(w) {
    for (const k of w.kingdoms) if (!k.eliminated) {
      const pop = population(w, k), workers = unitsOf(w, k, 'worker').length;
      k.warUpkeep = { food: 0, gold: 0, iron: 0 };
      const winter = w.seasonIndex === 3, farm = k.cityIds.reduce((s, id) => { const c = cityById(w, id); return s + (c ? (c.buildings.farm || 0) * farmYieldFactor(w, c) : 0); }, 0), mill = k.cityIds.reduce((s, id) => s + (cityById(w, id)?.buildings.sawmill || 0), 0), quarry = k.cityIds.reduce((s, id) => s + (cityById(w, id)?.buildings.quarry || 0), 0), mines = k.cityIds.reduce((s, id) => s + (cityById(w, id)?.buildings.mine || 0), 0);
      k.stock.food += farm * .3; k.stock.wood += mill * .11; k.stock.stone += quarry * .08; k.stock.iron += mines * .035;
      k.stock.food -= pop * (winter ? .022 : .017);
      const economyMinister = k.ministers.economy;
      const cityGoldIncome = k.cityIds.length * CITY_GOLD_INCOME * (.85 + economyMinister.skill * .25) + pop * economyMinister.taxRate * (.2 + economyMinister.skill * .3) * .01;
      k.stock.gold += cityGoldIncome; k.goldIncome = cityGoldIncome;
      const wars = w.kingdoms.filter(other => other.id !== k.id && !other.eliminated && atWar(w, k.id, other.id));
      if (wars.length) {
        const soldiers = unitsOf(w, k, 'soldier'), attackingLieutenants = new Set(unitsOf(w, k, 'lieutenant').filter(l => l.order === 'attack').map(l => l.id));
        const marching = soldiers.filter(s => attackingLieutenants.has(s.lieutenantId)).length;
        const foodCost = soldiers.length * .02 + marching * .012, goldCost = soldiers.length * WAR_GOLD_PER_SOLDIER + marching * WAR_GOLD_PER_MARCHING_SOLDIER, ironCost = marching * .004;
        k.stock.food -= foodCost; k.stock.gold -= goldCost; k.stock.iron -= ironCost;
        k.warUpkeep = { food: foodCost, gold: goldCost, iron: ironCost };
        w.foodSpentAtWar += foodCost; w.goldSpentAtWar += goldCost; w.ironSpentAtWar += ironCost;
      }
      for (const t of Object.keys(k.stock)) k.stock[t] = clamp(k.stock[t], 0, 999);
      if (k.stock.food <= 0) for (const u of unitsOf(w, k)) { u.hp -= u.kind === 'king' ? .16 : .22; if (u.hp <= 0) killUnit(w, u, 'a fome atingiu ' + u.name + ' em ' + k.name + '.'); }
      else if (k.stock.food > pop * 3 && w.tick % 16 === 0) { const sick = unitsOf(w, k).filter(u => u.hp < u.maxHp); sick.forEach(u => { u.hp = Math.min(u.maxHp, u.hp + 1.2); }); }
      for (const id of k.cityIds) {
        const city = cityById(w, id); if (!city || city.ruined || city.waterAccess >= .64) continue;
        const dehydration = clamp((.64 - city.waterAccess) * .22, 0, .12);
        for (const u of unitsOf(w, k).filter(person => person.cityId === city.id)) {
          u.hp -= dehydration;
          if (u.hp <= 0) killUnit(w, u, 'a falta de água atingiu ' + u.name + ' em ' + city.name + '.');
        }
      }
    }
  }
  function tradeWithAllies(w) {
    if (w.tick % 40 !== 0) return;
    updateMarket(w);
    const needs = (k) => {
      const pop = Math.max(1, population(w, k));
      return [
        { type: 'food', threshold: pop * 2.8, score: (pop * 2.8 - k.stock.food) / (pop * 2.8) },
        { type: 'iron', threshold: 14, score: (14 - k.stock.iron) / 14 },
        { type: 'wood', threshold: 28, score: (28 - k.stock.wood) / 28 },
        { type: 'stone', threshold: 22, score: (22 - k.stock.stone) / 22 }
      ].filter(n => n.score > 0).sort((a, b) => b.score - a.score)[0];
    };
    for (const relation of Object.values(w.diplomacy)) {
      if (relation.state !== 'alliance' || w.tick - relation.lastTrade < 80) continue;
      const realms = [kingdomById(w, relation.a), kingdomById(w, relation.b)].filter(k => k && !k.eliminated);
      for (const buyer of realms) {
        const seller = realms.find(k => k.id !== buyer.id), need = needs(buyer);
        if (!seller || !need) continue;
        const reserve = need.type === 'food' ? population(w, seller) * 2.8 : need.type === 'wood' ? 32 : need.type === 'stone' ? 24 : 16;
        const goldReserve = Math.max(4, Math.min(10, buyer.cityIds.length * 2));
        const spendableGold = Math.max(0, buyer.stock.gold - goldReserve);
        const buyerCity = cityById(w, buyer.capitalId), sellerCity = cityById(w, seller.capitalId);
        const buyerRegion = buyerCity ? regionAt(w, buyerCity.x, buyerCity.y) : null, sellerRegion = sellerCity ? regionAt(w, sellerCity.x, sellerCity.y) : null;
        const unitPrice = ((buyerRegion?.prices[need.type] || w.market.globalPrices[need.type]) + (sellerRegion?.prices[need.type] || w.market.globalPrices[need.type])) / 2 * .92;
        const merchants = unitsOf(w, buyer, 'worker').filter(u => u.profession === 'merchant').length;
        const capacity = Math.min(28, 12 + merchants * 5);
        const surplus = Math.max(0, seller.stock[need.type] - reserve), amount = Math.min(capacity, Math.floor(surplus), Math.floor(spendableGold / unitPrice), Math.ceil(need.threshold - buyer.stock[need.type]));
        if (amount < 1) continue;
        const price = amount * unitPrice;
        buyer.stock[need.type] += amount; buyer.stock.gold -= price; seller.stock[need.type] -= amount; seller.stock.gold += price;
        relation.lastTrade = w.tick; w.trades++; w.market.tradeVolume += amount;
        buyer.lastTradeText = 'comprou ' + amount + ' de ' + TYPES[need.type].name + ' de ' + seller.name;
        seller.lastTradeText = 'vendeu ' + amount + ' de ' + TYPES[need.type].name + ' para ' + buyer.name;
        addLog(w, buyer.name + ' compra ' + amount + ' de ' + TYPES[need.type].name + ' de ' + seller.name + '.');
        break;
      }
    }
  }
  function actWorker(w, u) {
    const k = kingdomById(w, u.kingdomId); if (!k || k.eliminated || !k.cityIds.length) return;
    let home = cityById(w, u.cityId); if (!home || home.owner !== k.id) { home = nearestCity(w, k, u.x, u.y) || cityById(w, k.capitalId); if (!home) return; u.cityId = home.id; }
    const worksite = cityById(w, u.projectCityId), project = u.profession === 'builder' && worksite?.owner === k.id ? worksite.project : null;
    const targetNode = nearestNode(w, u, u.job || 'food'), options = ['gather'], utilities = { gather: targetNode ? .55 : .1 };
    if (u.carry > 0) { options.push('deliver'); utilities.deliver = .2 + u.carry * .45 + (!targetNode ? .65 : 0); }
    if (project) { options.push('build'); utilities.build = 2 + (project.progress / project.required > .8 ? .25 : 0); }
    const intent = chooseBrainAction(w, u, options, [clamp(k.stock[u.job] / Math.max(1, population(w, k) * 3), 0, 1), clamp(u.carry / 3, 0, 1), project ? clamp(1 - project.progress / project.required, 0, 1) : 0, clamp(distance(u, project || targetNode || home) / 20, 0, 1), clamp(u.hp / u.maxHp, 0, 1), clamp((population(w, k) * 2.8 - k.stock.food) / Math.max(1, population(w, k) * 2.8), -1, 1)], utilities);
    if (intent === 'deliver' && u.carry > 0) {
      if (distance(u, home) > 1) { if (u.moveCd === 0) { moveTowards(w, u, home); u.moveCd = 1; } return; }
      k.stock[u.carryType || u.job] = Math.min(999, k.stock[u.carryType || u.job] + u.carry); u.carry = 0; u.carryType = u.job;
    }
    if (u.profession === 'builder' && !project) { u.profession = RESOURCE_PROFESSION[u.job] || 'farmer'; u.projectCityId = null; }
    if (u.profession === 'builder' && intent === 'build') {
      const worksite = cityById(w, u.projectCityId), project = worksite?.owner === k.id ? worksite.project : null;
      if (project) {
        if (u.carry > 0) { k.stock[u.carryType || u.job] = Math.min(999, k.stock[u.carryType || u.job] + u.carry); u.carry = 0; }
        if (distance(u, project) > 1) { if (u.moveCd === 0) { moveTowards(w, u, project); u.moveCd = 1; } return; }
        project.progress += .44 + k.ministers.economy.skill * .23;
        project.builders = (project.builders || 0) + 1;
        completeConstruction(w, k, worksite); return;
      }
      u.profession = RESOURCE_PROFESSION[u.job] || 'farmer'; u.projectCityId = null;
    }
    if (u.profession === 'merchant') {
      const partner = w.kingdoms.find(other => other.id !== k.id && !other.eliminated && relations(w, k.id, other.id)?.state === 'alliance');
      const target = partner && cityById(w, partner.capitalId);
      if (target) {
        const destination = u.tradeLeg === 'return' ? home : target;
        if (distance(u, destination) > 1) { if (u.moveCd === 0) { moveTowards(w, u, destination); u.moveCd = 1; } return; }
        u.tradeLeg = u.tradeLeg === 'return' ? 'outbound' : 'return'; return;
      } else u.profession = RESOURCE_PROFESSION[u.job] || 'farmer';
    }
    if (!u.carryType) u.carryType = u.job;
    if (u.carry >= 3 || (u.carry && !nearestNode(w, u, u.job))) {
      if (distance(u, home) > 1) { if (u.moveCd === 0) { moveTowards(w, u, home); u.moveCd = 1; } }
      else { k.stock[u.carryType] = Math.min(999, k.stock[u.carryType] + u.carry); u.carry = 0; u.carryType = u.job; }
      return;
    }
    let node = u.targetNode && w.nodes.find(n => n.id === u.targetNode && n.amount > 0 && n.type === u.job);
    if (!node) { node = nearestNode(w, u, u.job); u.targetNode = node ? node.id : null; }
    if (!node) { u.job = k.stock.food < 50 ? 'food' : (k.stock.wood < 30 ? 'wood' : 'stone'); u.targetNode = null; return; }
    const d = distance(u, node);
    if (d <= 1) { if (u.harvestCd <= 0 && node.amount > 0) { const amount = Math.min(1 + (u.job === 'food' ? 1 : 0), 3 - u.carry, node.amount); u.carry += amount; u.carryType = node.type; node.amount -= amount; if (node.type === 'wood') { const forest = tile(w, node.x, node.y); forest.forestCover = Math.max(.08, forest.forestCover - amount / node.max * .62); } u.harvestCd = u.job === 'food' ? 2 : 3; } }
    else if (u.moveCd === 0) { moveTowards(w, u, node); u.moveCd = 1; }
    if (u.harvestCd > 0) u.harvestCd--;
  }
  function hostileUnits(w, u, radius) { return w.units.filter(e => e.alive && e.kind === 'soldier' && e.kingdomId !== u.kingdomId && atWar(w, u.kingdomId, e.kingdomId) && distance(e, u) <= radius).sort((a, b) => distance(a, u) - distance(b, u)); }
  function actSoldier(w, u) {
    const k = kingdomById(w, u.kingdomId), lieutenant = w.units.find(v => v.id === u.lieutenantId && v.alive), commander = w.units.find(v => v.id === u.generalId && v.alive), home = cityById(w, u.cityId) || (k && cityById(w, k.capitalId)); if (!k || !lieutenant || !home) return;
    const nearby = hostileUnits(w, u, u.class === 'bow' ? 5 : 2)[0];
    const orderAttack = lieutenant.order === 'attack' && atWar(w, k.id, (cityById(w, lieutenant.targetCity || home.id) || home).owner), options = ['follow'], utilities = { follow: orderAttack ? .65 : .4 };
    if (nearby) { options.push('engage'); utilities.engage = .8 + clamp((u.morale || 0) * .2, 0, .2); }
    if (u.hp < u.maxHp * .65 || (u.morale || 0) < .2) { options.push('retreat'); utilities.retreat = .35 + (1 - u.hp / u.maxHp) * 1.5 + ((u.morale || 0) < .2 ? .35 : 0); }
    const intent = chooseBrainAction(w, u, options, [clamp(u.hp / u.maxHp, 0, 1), clamp(u.morale || 0, 0, 1), nearby ? 1 : 0, orderAttack ? 1 : 0, clamp(distance(u, home) / 20, 0, 1), k.lastDanger ? 1 : 0], utilities);
    if (intent === 'retreat' && distance(u, home) > 2) { if (u.moveCd === 0) { moveTowards(w, u, home); u.moveCd = u.class === 'horse' ? 0 : 1; } return; }
    if (u.hp < 26 && distance(u, home) > 2) { if (u.moveCd === 0) { moveTowards(w, u, home); u.moveCd = u.class === 'horse' ? 0 : 1; } return; }
    if (nearby && intent === 'engage') { attackUnit(w, u, nearby); return; }
    const target = cityById(w, lieutenant.targetCity || home.id) || home;
    if (lieutenant.order === 'attack' && atWar(w, k.id, target.owner)) {
      const enemy = hostileUnits(w, u, u.class === 'bow' ? 6 : 3)[0]; if (enemy && intent === 'engage') { attackUnit(w, u, enemy); return; }
      if (distance(u, target) <= 2) { if (u.attackCd === 0) { const baseDamage = u.class === 'horse' ? 8 : u.class === 'bow' ? 5 : 7, damage = Math.ceil(baseDamage * (commander?.strategy === 'siege' ? 1.3 : 1)); target.hp = Math.max(0, target.hp - damage); u.merit = (u.merit || 0) + .35; u.attackCd = 7; if (target.hp === 0) captureCity(w, k, target); } }
      else if (u.moveCd === 0) {
        let approach = target;
        if (commander?.strategy === 'flank' && distance(u, target) > 5) { const dx = Math.sign(target.x - home.x), dy = Math.sign(target.y - home.y); approach = { x: clamp(target.x - dy * 4, 0, W - 1), y: clamp(target.y + dx * 4, 0, H - 1) }; }
        moveTowards(w, u, approach); u.moveCd = u.class === 'horse' ? 0 : 1;
      }
    } else if (distance(u, home) > (u.class === 'bow' ? 5 : 4)) {
      if (u.moveCd === 0) { moveTowards(w, u, home); u.moveCd = 1; }
    } else if (u.hp < u.maxHp && distance(u, home) <= 2 && w.tick % 4 === 0) u.hp = Math.min(u.maxHp, u.hp + 1);
  }
  function attackUnit(w, attacker, target) {
    if (attacker.attackCd > 0) return;
    const commander = w.units.find(u => u.id === attacker.generalId && u.alive), forestAmbush = commander?.strategy === 'ambush' && tile(w, attacker.x, attacker.y).terrain === 1 && !attacker.ambushed;
    const baseDamage = attacker.class === 'horse' ? 11 : attacker.class === 'bow' ? 8 : 10, dmg = baseDamage + (forestAmbush ? Math.ceil(baseDamage * .35) : 0);
    const hit = w.rng() > (forestAmbush ? .03 : .09); attacker.attackCd = attacker.class === 'horse' ? 5 : attacker.class === 'bow' ? 8 : 7;
    if (forestAmbush) attacker.ambushed = true;
    if (hit) {
      const defender = kingdomById(w, target.kingdomId), region = regionAt(w, target.x, target.y), defended = defender && region.territoryOwner === defender.id;
      const protection = defended ? .06 + (defender.ministers.defense.skill || .5) * .12 : 0;
      target.hp -= Math.max(1, Math.round(dmg * (1 - protection))); target.morale = (target.morale || 1) - (forestAmbush ? .16 : .08); attacker.merit = (attacker.merit || 0) + .7;
      if (target.hp <= 0) { const enemy = kingdomById(w, target.kingdomId); if (enemy) enemy.prestige = Math.max(0, enemy.prestige - 1); const winner = kingdomById(w, attacker.kingdomId); if (winner) winner.prestige += 1; attacker.merit += 4; attacker.kills = (attacker.kills || 0) + 1; w.warDeaths++; killUnit(w, target, target.name + ' caiu diante de ' + (winner?.name || 'um exército inimigo') + '.'); }
      const kingdom = kingdomById(w, attacker.kingdomId); if (kingdom) promoteByMerit(w, kingdom, attacker);
    }
  }
  function actLieutenant(w, u) {
    const k = kingdomById(w, u.kingdomId), general = w.units.find(g => g.id === u.generalId && g.alive); if (!k || !general) return;
    if (u.lastCommand !== w.tick) { u.lastCommand = w.tick; u.order = general.order; u.targetCity = general.targetCity; u.strategy = general.strategy; }
    const squad = (u.squad || []).map(id => w.units.find(s => s.id === id && s.alive)).filter(Boolean); if (!squad.length) return;
    const weak = squad.filter(s => s.hp < 25).length;
    const avg = { x: squad.reduce((a, s) => a + s.x, 0) / squad.length, y: squad.reduce((a, s) => a + s.y, 0) / squad.length };
    const weakShare = weak / squad.length, spread = distance(avg, u), forcedRetreat = weak >= Math.max(1, Math.ceil(squad.length * .5));
    const options = forcedRetreat ? ['regroup', 'hold'] : ['regroup', 'hold', ...(u.order === 'attack' ? ['advance'] : [])];
    const intent = chooseBrainAction(w, u, options, [clamp(weakShare, 0, 1), clamp(spread / 8, 0, 1), u.order === 'attack' ? 1 : 0, clamp(u.hp / u.maxHp, 0, 1), clamp((u.morale || 1), 0, 1), k.lastDanger ? 1 : 0], { regroup: spread > 2 ? .75 + weakShare : .1, advance: u.order === 'attack' ? .55 : 0, hold: forcedRetreat ? 0 : .2 });
    if (forcedRetreat) { const base = cityById(w, k.capitalId); if (base) { u.targetCity = base.id; u.order = 'retreat'; } }
    if (intent === 'regroup' && u.moveCd === 0 && spread > 2) { moveTowards(w, u, forcedRetreat ? cityById(w, k.capitalId) || avg : avg); u.moveCd = 1; }
    else if (intent === 'advance' && u.moveCd === 0 && u.targetCity) { const target = cityById(w, u.targetCity); if (target && distance(u, target) > 3) { moveTowards(w, u, target); u.moveCd = 1; } }
  }
  function actGeneral(w, u) {
    const k = kingdomById(w, u.kingdomId); if (!k) return;
    if (u.commandTarget) { const target = cityById(w, u.commandTarget); if (!target) { u.commandTarget = null; return; } }
    const base = cityById(w, k.capitalId); if (base && distance(u, base) > 4 && (!u.order || u.order === 'guard')) moveTowards(w, u, base);
    if (u.order === 'attack' && u.targetCity) { const target = cityById(w, u.targetCity); if (target && distance(u, target) > 5 && u.moveCd === 0) { moveTowards(w, u, target); u.moveCd = 2; } }
  }
  function captureCity(w, winner, city) {
    const previous = kingdomById(w, city.owner); if (!previous || previous.id === winner.id) return;
    const residents = unitsOf(w, previous, 'worker').filter(u => u.cityId === city.id), civilianLosses = Math.min(residents.length, Math.floor(residents.length * .18));
    for (const resident of residents.slice(0, civilianLosses)) { w.warDeaths++; killUnit(w, resident, null); }
    previous.cityIds = previous.cityIds.filter(id => id !== city.id); winner.cityIds.push(city.id); city.owner = winner.id; city.hp = Math.max(130, city.maxHp * .38); city.maxHp = Math.max(city.maxHp, 300); city.ruined = false; city.level = Math.max(1, city.level - 1); city.project = null; w.captures++;
    w.structures = w.structures.filter(s => !(s.cityId === city.id && s.type === 'construction'));
    for (const structure of w.structures) if (structure.cityId === city.id) structure.owner = winner.id;
    for (const u of w.units.filter(v => v.kingdomId === previous.id)) if (u.cityId === city.id) u.cityId = previous.capitalId || previous.cityIds[0];
    if (previous.capitalId === city.id) { previous.capitalId = previous.cityIds[0] || null; const king = unitsOf(w, previous, 'king')[0]; const refuge = cityById(w, previous.capitalId); if (king && refuge) { king.cityId = refuge.id; king.x = refuge.x; king.y = refuge.y; } else if (king) { king.cityId = null; king.isExile = true; king.x = city.x; king.y = city.y; } }
    const rel = relations(w, winner.id, previous.id); if (rel) { rel.state = 'truce'; rel.since = w.tick; rel.cooldown = w.tick + 100; rel.relation = -15; }
    updateTerritories(w);
    addLog(w, winner.name + ' conquista ' + city.name + ' de ' + previous.name + (civilianLosses ? '; ' + civilianLosses + ' civis morreram durante o saque.' : '.'));
    if (!previous.cityIds.length) { previous.eliminated = false; addLog(w, previous.name + ' perde sua última cidade; a corte e os sobreviventes fogem para o exílio.'); }
  }
  function lifecycle(w, k) {
    const pop = population(w, k), people = unitsOf(w, k);
    ensureHierarchy(w, k);
    if (!k.cityIds.length && people.length) { if (w.tick % 100 === 0) foundRefuge(w, k); return; }
    const cities = k.cityIds.map(id => cityById(w, id)).filter(c => c && !c.ruined);
    for (const city of cities) {
      if (w.tick - city.lastGrowth < 80 || cityPopulation(w, city) >= cityCapacity(w, city) || k.stock.food < pop * 2.8 || k.stock.wood < 20 || city.waterAccess < .45) continue;
      k.stock.food -= 12; k.stock.wood -= 3;
      const jobs = ['food', 'food', 'wood', 'stone', 'iron', 'gold'], job = pick(w.rng, jobs);
      addUnit(w, k, 'worker', city.x + 2, city.y + 2, { name: pick(w.rng, ['Camponês', 'Carpinteira', 'Mineiro', 'Pastor', 'Tecelã', 'Oleiro']), title: 'novo cidadão', hp: 75, cityId: city.id, job, profession: RESOURCE_PROFESSION[job] || 'farmer', carry: 0, carryType: null, harvestCd: 0 });
      city.lastGrowth = w.tick; w.births++; addLog(w, 'A população de ' + city.name + ' cresce; uma nova família se estabelece em ' + k.name + '.');
    }
    const activeWar = w.kingdoms.some(other => other.id !== k.id && !other.eliminated && atWar(w, k.id, other.id));
    const army = unitsOf(w, k, 'soldier'), armyTarget = Math.min(60, Math.max(12, k.cityIds.length * 10, Math.floor(pop * .42)));
    const mobilizationOrdered = k.plan === 'recruit' || activeWar && army.length < armyTarget;
    if (mobilizationOrdered && w.tick - k.lastRecruit >= 18 && army.length < armyTarget && k.stock.food > Math.max(35, pop * 1.3) && k.stock.iron >= 4 && k.stock.wood >= 2) recruitSoldier(w, k);
    if (pop === 0 || (!k.cityIds.length && pop < 3)) { k.eliminated = true; addLog(w, k.name + ' deixa de existir como nação independente.'); }
  }
  function promoteByMerit(w, k) {
    let soldiers = unitsOf(w, k, 'soldier'), lieutenants = unitsOf(w, k, 'lieutenant');
    const lieutenantLimit = Math.max(2, Math.min(12, Math.ceil(soldiers.length / 6)));
    const candidate = soldiers.filter(s => (s.merit || 0) >= 8).sort((a, b) => b.merit - a.merit)[0];
    if (candidate && lieutenants.length < lieutenantLimit) {
      const previous = w.units.find(u => u.id === candidate.lieutenantId && u.alive), generalId = candidate.generalId || unitsOf(w, k, 'general')[0]?.id;
      if (previous) previous.squad = (previous.squad || []).filter(id => id !== candidate.id);
      candidate.kind = 'lieutenant'; candidate.title = 'comandante de unidade'; candidate.name = 'Tenente ' + (candidate.name || 'promovido');
      candidate.squad = []; candidate.order = 'guard'; candidate.generalId = generalId; candidate.lieutenantId = null;
      const oldSquad = (previous?.squad || []).map(id => w.units.find(u => u.id === id && u.alive && u.kind === 'soldier')).filter(Boolean);
      for (const subordinate of oldSquad.slice(0, Math.max(0, Math.min(3, oldSquad.length - 2)))) { subordinate.lieutenantId = candidate.id; candidate.squad.push(subordinate.id); }
      w.promotions++; addLog(w, candidate.name + ' sobe de soldado a tenente após demonstrar mérito em combate.');
      lieutenants = unitsOf(w, k, 'lieutenant');
    }
    soldiers = unitsOf(w, k, 'soldier');
    const generals = unitsOf(w, k, 'general'), generalLimit = Math.max(1, Math.min(5, Math.floor(soldiers.length / 24) + 1));
    const officer = lieutenants.filter(l => (l.merit || 0) >= 20 && (l.squad || []).filter(id => UidAlive(w, id)).length >= 3).sort((a, b) => b.merit - a.merit)[0];
    if (!officer || generals.length >= generalLimit) return;
    const commanderSquad = (officer.squad || []).slice(), replacement = commanderSquad.map(id => w.units.find(u => u.id === id && u.alive && u.kind === 'soldier')).filter(Boolean).sort((a, b) => (b.merit || 0) - (a.merit || 0))[0];
    if (!replacement) return;
    officer.kind = 'general'; officer.title = 'comandante de campo';
    officer.name = 'Comandante ' + (officer.name || 'promovido').replace(/^Tenente\s*/i, '');
    officer.squad = []; officer.lieutenantId = null; officer.generalId = null; officer.order = 'guard'; officer.strategy = 'hold'; officer.targetCity = k.capitalId;
    officer.leaderId = unitsOf(w, k, 'king')[0]?.id;
    replacement.kind = 'lieutenant'; replacement.title = 'comandante de unidade'; replacement.name = 'Tenente ' + (replacement.name || 'promovido');
    replacement.generalId = officer.id; replacement.lieutenantId = null; replacement.order = 'guard'; replacement.targetCity = k.capitalId;
    replacement.squad = commanderSquad.filter(id => id !== replacement.id);
    for (const soldierId of replacement.squad) {
      const subordinate = w.units.find(u => u.id === soldierId && u.alive && u.kind === 'soldier');
      if (subordinate) { subordinate.lieutenantId = replacement.id; subordinate.generalId = officer.id; }
    }
    w.promotions += 2;
    addLog(w, replacement.name + ' assume uma unidade e ' + officer.name + ' é promovido a comandante de campo por mérito.');
  }
  function ensureHierarchy(w, k) {
    let people = unitsOf(w, k); if (!people.length) return;
    let king = people.find(u => u.kind === 'king');
    if (!king) {
      king = people.find(u => u.kind === 'general') || people.find(u => u.kind === 'lieutenant') || people.find(u => u.kind === 'soldier') || people.find(u => u.kind === 'worker');
      king.kind = 'king'; king.title = 'regente';
      const capital = cityById(w, k.capitalId); if (capital) { king.cityId = capital.id; king.x = capital.x; king.y = capital.y; }
      addLog(w, k.name + ' coroa um novo regente após a queda do soberano.');
    }
    let generals = unitsOf(w, k, 'general'), lieutenants = unitsOf(w, k, 'lieutenant'), soldiers = unitsOf(w, k, 'soldier');
    if (!generals.length) {
      if (lieutenants.length) {
        const general = lieutenants.slice().sort((a, b) => (b.squad || []).filter(id => UidAlive(w, id)).length - (a.squad || []).filter(id => UidAlive(w, id)).length)[0];
        general.kind = 'general'; general.title = 'marechal'; general.name = 'General ' + general.name.replace(/^Tenente\s*/i, ''); general.order = 'guard'; general.strategy = 'hold'; general.targetCity = k.capitalId; general.squad = [];
        addLog(w, k.name + ' promove um tenente para recompor o comando do exército.');
      } else {
        const city = cityById(w, k.capitalId), x = city ? city.x : king.x, y = city ? city.y : king.y;
        addUnit(w, k, 'general', x + 1, y, { name: 'General regente', title: 'marechal', cityId: city ? city.id : null, leaderId: king.id, order: 'guard', strategy: 'hold', targetCity: k.capitalId, attackCd: 0 });
      }
      generals = unitsOf(w, k, 'general'); lieutenants = unitsOf(w, k, 'lieutenant');
    }
    if (!lieutenants.length && soldiers.length) {
      const city = cityById(w, k.capitalId), x = city ? city.x : king.x, y = city ? city.y : king.y;
      addUnit(w, k, 'lieutenant', x, y + 2, { name: 'Tenente promovido', title: 'comandante de unidade', cityId: city ? city.id : null, generalId: generals[0].id, squad: [], order: generals[0].order });
      lieutenants = unitsOf(w, k, 'lieutenant');
    }
    generals.forEach(g => { if (!g.order) g.order = 'guard'; if (!g.strategy) g.strategy = 'hold'; if (!g.targetCity) g.targetCity = k.capitalId; });
    lieutenants.forEach(l => { if (!Array.isArray(l.squad)) l.squad = []; });
    for (const l of lieutenants) {
      let general = generals.find(g => g.id === l.generalId);
      if (!general) general = generals.slice().sort((a, b) => lieutenants.filter(x => x.generalId === a.id).length - lieutenants.filter(x => x.generalId === b.id).length)[0];
      l.generalId = general.id;
      l.squad = soldiers.filter(s => s.lieutenantId === l.id).map(s => s.id);
    }
    for (const soldier of soldiers) {
      let l = lieutenants.find(candidate => candidate.id === soldier.lieutenantId);
      if (!l && lieutenants.length) { l = lieutenants.slice().sort((a, b) => a.squad.length - b.squad.length)[0]; soldier.lieutenantId = l.id; l.squad.push(soldier.id); }
      if (l) soldier.generalId = l.generalId;
    }
  }
  function UidAlive(w, id) { const u = w.units.find(v => v.id === id); return !!u && u.alive; }
  function recruitSoldier(w, k) {
    const city = cityById(w, k.capitalId), workers = unitsOf(w, k, 'worker').sort((a, b) => (a.job === 'food') - (b.job === 'food'));
    if (!city || workers.length <= 4 || !canPay(k, { food: 9, iron: 4, wood: 2 })) return;
    const lieutenants = unitsOf(w, k, 'lieutenant'); if (!lieutenants.length) return;
    pay(k, { food: 9, iron: 4, wood: 2 });
    const recruit = workers[0], previousProfession = PROFESSION_LABEL[recruit.profession] || RESOURCE_PROFESSION[recruit.job] || 'trabalho civil', cl = pick(w.rng, ['spear', 'spear', 'bow', 'horse']);
    recruit.kind = 'soldier'; recruit.name = pick(w.rng, ['Arven', 'Tilda', 'Oren', 'Mira', 'Dalen', 'Sera']);
    recruit.profession = 'soldier'; recruit.title = cl === 'bow' ? 'arqueiro' : cl === 'horse' ? 'cavaleiro' : 'lanceiro'; recruit.class = cl;
    recruit.maxHp = 96; recruit.hp = Math.min(recruit.hp, 86); recruit.merit = recruit.merit || 0; recruit.kills = recruit.kills || 0;
    const lieutenant = lieutenants.slice().sort((a, b) => (a.squad || []).filter(id => UidAlive(w, id)).length - (b.squad || []).filter(id => UidAlive(w, id)).length)[0];
    recruit.x = city.x + 2; recruit.y = city.y; recruit.cityId = city.id; recruit.lieutenantId = lieutenant.id; recruit.generalId = lieutenant.generalId; recruit.carry = 0; recruit.targetNode = null; recruit.attackCd = 0; recruit.morale = .86;
    lieutenant.squad.push(recruit.id); k.lastRecruit = w.tick; k.mobilized = (k.mobilized || 0) + 1;
    addLog(w, k.name + ' convoca ' + recruit.name + ', antes dedicado a ' + previousProfession + ', para a defesa do reino.');
  }
  function foundRefuge(w, k) {
    const people = unitsOf(w, k), king = people.find(u => u.kind === 'king'); if (!king || k.cityIds.length || k.stock.food < 50 || k.stock.wood < 35) return;
    const enemyCities = w.cities.filter(c => c.owner !== k.id && !kingdomById(w, c.owner)?.eliminated);
    let candidates = [];
    for (let y = 3; y < H - 3; y += 2) for (let x = 3; x < W - 3; x += 2) if (passable(w, x, y) && !w.cities.some(c => distance(c, { x, y }) < 7)) {
      const d = enemyCities.length ? Math.min(...enemyCities.map(c => distance(c, { x, y }))) : 20; if (d > 8) candidates.push({ x, y, d });
    }
    candidates.sort((a, b) => b.d - a.d); const at = candidates[0];
    if (at) { k.stock.food -= 50; k.stock.wood -= 35; const city = addCity(w, k, at.x, at.y, 'camp', 1); city.name = 'Refúgio de ' + k.name; k.capitalId = city.id; king.cityId = city.id; king.x = city.x; king.y = city.y; k.eliminated = false; for (const u of people) u.cityId = city.id; updateTerritories(w); addLog(w, k.name + ' funda um refúgio distante e volta a erguer sua bandeira.'); }
  }
  function killUnit(w, u, message) { if (!u.alive) return; u.alive = false; w.deaths++; if (message) addLog(w, message); }
  function snapshot(w) {
    return { cycle: w.tick, year: w.year, season: ['Primavera','Verão','Outono','Inverno'][w.seasonIndex], alive: w.kingdoms.filter(k => !k.eliminated).length, wars: Object.values(w.diplomacy).filter(r => r.state === 'war').length, population: w.units.filter(u => u.alive).length, cities: w.cities.filter(c => !c.ruined).length, births: w.births, deaths: w.deaths, warDeaths: w.warDeaths, captures: w.captures, trades: w.trades, promotions: w.promotions, foodSpentAtWar: w.foodSpentAtWar, goldSpentAtWar: w.goldSpentAtWar, ironSpentAtWar: w.ironSpentAtWar, droughts: w.climateRegions.filter(r => r.weather === 'drought').length, droughtsStarted: w.droughtsStarted, waterShortages: w.cities.filter(c => !c.ruined && c.waterAccess < .68).length };
  }
  return { width: W, height: H, regionCols: REGION_COLS, regionRows: REGION_ROWS, types: TYPES, strategies: STRATEGIES, tactics: TACTICS, professions: PROFESSION_LABEL, basePrices: BASE_PRICES, createWorld: makeWorld, tick, snapshot, cityById, kingdomById, unitsOf, atWar, relations, distance, population, cityPopulation, cityCapacity, promoteByMerit, regionAt, farmYieldFactor, waterDemand, waterSupply, updateWater, updateMarket, updateTerritories, startConstruction, assignJobs, kingdomWaterOutlook, riverProximity };
});
