import { initializeTowerHealth } from './fortifications.js';
import { spendInventory } from '../economy/inventories.js';
import { recomputeKingdomTerritories, TERRITORY_RULES } from './territories.js';
import { log } from '../core/events.js';
import { enlistSoldier } from './service.js';
import { cellAt, cellsWithin } from '../world/spatial.js';
import { isTreeAnchor } from '../ecology/plants.js';
import { reachableAreaAround } from '../individuals/movement.js';
import { invalidateNavigation } from '../individuals/navigation-cache.js';
import { clamp, distance } from '../core/math.js';
import { SITING_STRATEGIES, SITING_LABELS, selectRoyalBuildSite, commitRoyalBuildSite } from './royal-siting.js';

export const KINGDOM_BUILD_COSTS = Object.freeze({
  monasterio: Object.freeze({ wood: 30, stone: 28, gold: 15 }),
  arquearia: Object.freeze({ wood: 35, stone: 15, gold: 12 }),
  torre: Object.freeze({ wood: 34, stone: 24, gold: 8 }),
  centro_militar: Object.freeze({ wood: 32, stone: 30, gold: 12 })
});

export const FRONTIER_OUTPOST_COST = Object.freeze({ wood: 10, stone: 4, gold: 2 });
export const SOLDIER_COST = Object.freeze({ food: 10, wood: 8, gold: 3 });
export const KINGDOM_PROJECT_TIMING = Object.freeze({ torre: 12, frontierOutpost: 8, centro_militar: 18, monasterio: 16, arquearia: 14, recruit: 6 });

function canPlace(world, tile, kingdom, type) {
  if (!tile || tile.terrain !== 'land' || (tile.kingdomId != null && tile.kingdomId !== kingdom.id)) return false;
  if (tile.waterDist < 2.1) return false;
  if (tile.x < 2 || tile.y < 2 || tile.x >= world.width - 2 || tile.y >= world.height - 2) return false;
  if (isTreeAnchor(world, tile)) return false;
  if (type === 'torre' && ((tile.stoneDeposit || 0) > .7 || (tile.goldOre || 0) > .05)) return false;
  if (type === 'torre') {
    const entrance = cellAt(world, tile.x, tile.y + 1);
    if (!entrance || entrance.terrain !== 'land' || entrance.waterDist < 2.1) return false;
  }
  const radius = type === 'torre' ? 2.1 : 2.7;
  return !world.structures.some(structure => {
    if (structure.destroyedDay != null || !structure.complete && !structure.kingdomProject) return false;
    const existingRadius = structure.type === 'curral' ? (structure.radius || 3.5) : 2.5;
    return Math.hypot(tile.x - structure.x, tile.y - structure.y) < radius + existingRadius + 1;
  });
}

export function kingdomBuildSiteCandidates(world, kingdom, type, options = {}) {
  const opponents = world.kingdoms.filter(other => other.id !== kingdom.id);
  const opposite = opponents.slice().sort((a, b) => distance(a, kingdom) - distance(b, kingdom))[0];
  const targetX = (opposite?.x ?? world.width / 2) - kingdom.x, targetY = (opposite?.y ?? world.height / 2) - kingdom.y;
  const targetLength = Math.max(1, Math.hypot(targetX, targetY));
  const ux = targetX / targetLength, uy = targetY / targetLength;
  const desiredDistance = Number.isFinite(options.desiredDistance) ? options.desiredDistance : type === 'torre' ? 21 : 10;
  const minProjection = Number.isFinite(options.minProjection) ? options.minProjection : 12;
  const maxProjection = Number.isFinite(options.maxProjection) ? options.maxProjection : 27;
  const minDistance = Number.isFinite(options.minDistance) ? options.minDistance : type === 'torre' ? 12 : 7;
  const maxDistance = Number.isFinite(options.maxDistance) ? options.maxDistance : type === 'torre' ? 29 : type === 'centro_militar' ? 16 : 24;
  const workers = (world.people || []).filter(p => p.alive && p.kingdomId === kingdom.id && p.role === 'resident' && p.ageDays >= 18 * 365);
  const agent = workers[0] || { kingdomId: kingdom.id, communityId: kingdom.communityId, role: 'resident', territoryWarnings: {}, health: 100, foodReserve: 100, hydration: 100 };
  const reachable = new Set(reachableAreaAround(world, agent, kingdom, maxDistance + 10).map(t => t.i));
  const supportPosts = world.structures.filter(s => s.kingdomId === kingdom.id && s.complete && s.destroyedDay == null && ['torre', 'castelo'].includes(s.type));
  const known = new Set((kingdom.knownEnemyInstallations || []).filter(r => world.day - r.day <= 60).map(r => r.id));
  const enemyPosts = world.structures.filter(s => known.has(s.id) && s.destroyedDay == null);
  const losses = (kingdom.sitingHistory || []).filter(r => r.outcome === 'lost' && world.day - r.day <= 180);
  const sites = [];
  for (const tile of world.tiles) {
    if (!canPlace(world, tile, kingdom, type)) continue;
    if (!reachable.has(tile.i)) continue;
    if (options.requireNeutral && tile.kingdomId != null) continue;
    const dx = tile.x - kingdom.x, dy = tile.y - kingdom.y;
    const projection = dx * ux + dy * uy, lateral = Math.abs(dx * uy - dy * ux);
    const fromCapital = Math.hypot(dx, dy);
    if (fromCapital < minDistance || fromCapital > maxDistance) continue;
    if (type === 'torre' && (projection < minProjection || projection > maxProjection)) continue;
    if (opponents.some(other => Math.hypot(tile.x - other.x, tile.y - other.y) < 10)) continue;
    const area = type === 'torre' ? cellsWithin(world, tile.x, tile.y, TERRITORY_RULES.towerRadius, t => t.terrain === 'land') : [];
    const gain = area.filter(t => t.kingdomId == null).length / Math.max(1, area.length);
    const contested = area.filter(t => t.kingdomId != null && t.kingdomId !== kingdom.id).length / Math.max(1, area.length);
    const support = clamp(1 - Math.min(...supportPosts.map(s => distance(s, tile)), 40) / 35, 0, 1);
    const access = clamp(Math.min(...workers.map(p => distance(p, tile)), fromCapital) / 45, 0, 1);
    const knownDanger = enemyPosts.reduce((risk, s) => Math.max(risk, clamp(1 - distance(s, tile) / 28, 0, 1)), 0);
    const repeatedLoss = losses.some(r => distance(r, tile) < 12) ? .5 : 0;
    const risk = clamp(contested + knownDanger + repeatedLoss + (1 - support) * .25, 0, 1);
    const signedLateral = (-dx * uy + dy * ux) / maxDistance;
    const forward = clamp(projection / maxDistance, 0, 1);
    const balance = support * .6 + gain * .65 - risk * 1.5 - access * .6 - Math.abs(fromCapital - desiredDistance) / 60 - (tile.slope || 0) * .2;
    const values = [support * 1.3 - risk * 2 - access * .8 + gain * .25,
      balance, gain * 1.25 + forward * .5 - risk * 1.5 - access * .6,
      balance + signedLateral * .8, balance - signedLateral * .8];
    if (type !== 'torre') values[0] += tile.kingdomId === kingdom.id ? .3 : 0;
    sites.push({ tile, values, metrics: { gain, support, access, risk, projection, lateral }, signedLateral });
  }
  const chosen = [];
  for (let i = 0; i < SITING_STRATEGIES.length; i++) {
    const ranked = sites.slice().sort((a, b) => b.values[i] - a.values[i]
      || a.metrics.projection - b.metrics.projection || a.signedLateral - b.signedLateral);
    const site = ranked.find(s => chosen.every(other => distance(s.tile, other.tile) >= 5));
    if (!site) continue;
    chosen.push({ ...site, strategy: SITING_STRATEGIES[i], label: SITING_LABELS[i], quality: clamp(site.values[i], -1, 1),
      reason: 'Acesso terrestre confirmado; apoio defensivo ' + Math.round(site.metrics.support * 100)
        + '%, risco observado ' + Math.round(site.metrics.risk * 100) + '% e potencial de expansão ' + Math.round(site.metrics.gain * 100) + '%.' });
  }
  return chosen;
}

export function chooseKingdomBuildSite(world, kingdom, type, options = {}) {
  return selectRoyalBuildSite(world, kingdom, type, kingdomBuildSiteCandidates(world, kingdom, type, options))?.tile || null;
}

export function buildKingdomStructure(world, kingdomId, type, options = {}) {
  const kingdom = world.kingdoms.find(item => item.id === kingdomId);
  const cost = type === 'torre' && options.frontierOutpost === true
    ? FRONTIER_OUTPOST_COST : KINGDOM_BUILD_COSTS[type];
  if (!kingdom || !cost) return { ok: false, reason: 'Obra de reino inválida.' };
  if (world.structures.some(structure => structure.kingdomId === kingdom.id
      && structure.kingdomProject && !structure.complete && structure.integrity > 0 && structure.builtDay == null)) {
    return { ok: false, reason: 'O reino já tem uma obra de defesa em andamento.' };
  }
  const selection = selectRoyalBuildSite(world, kingdom, type, kingdomBuildSiteCandidates(world, kingdom, type, options));
  const site = selection?.tile;
  if (!site) return { ok: false, reason: 'Não há local seguro dentro do domínio disponível.' };
  if (!spendInventory(kingdom.treasury, cost, options.frontierOutpost ? 'frontier-outpost-construction' : 'kingdom-structure-construction')) {
    return { ok: false, reason: 'O tesouro não tem os recursos necessários.' };
  }
  const isTower = type === 'torre';
  const isFrontierOutpost = isTower && options.frontierOutpost === true;
  const structure = {
    id: world.nextId++, type, kingdomId: kingdom.id, communityId: kingdom.communityId || null,
    x: site.x, y: site.y, complete: false, progress: 0,
    entryTile: isTower ? { x: site.x, y: site.y + 1 } : undefined,
    required: isFrontierOutpost ? KINGDOM_PROJECT_TIMING.frontierOutpost : KINGDOM_PROJECT_TIMING[type],
    kingdomProject: true, createdDay: world.day, constructionStartedDay: world.day, builtDay: null,
    cost: { ...cost }, integrity: 1, lastMaintenanceThreshold: 1,
    spriteKey: isTower ? 'tower' : type === 'arquearia' ? 'archery' : type === 'monasterio' ? 'monastery' : 'barracks',
    territoryRadius: isTower ? TERRITORY_RULES.towerRadius : 0,
    frontierOutpost: isFrontierOutpost,
    expansionEvidence: options.frontierOutpost === true ? {
      decisionDay: world.day, territoryBefore: kingdom.territoryTileCount || 0,
      treasuryBefore: { ...kingdom.treasury.stock }, site: { x: site.x, y: site.y }, cost: { ...cost }
    } : undefined,
    soldierIds: type === 'centro_militar' ? [] : undefined, capacity: type === 'centro_militar' ? 60 : undefined
  };
  initializeTowerHealth(structure);
  world.structures.push(structure);
  commitRoyalBuildSite(world, kingdom, selection, structure);
  kingdom.structureIds.push(structure.id);
  if (isTower) kingdom.towerIds.push(structure.id);
  else if (type === 'centro_militar') kingdom.militaryCenterIds.push(structure.id);
  const structureLabel = isFrontierOutpost ? 'um posto de fronteira' : isTower ? 'uma torre' : 'um centro militar';
  log(world, kingdom.name + ' iniciou a construção de ' + structureLabel
    + '; os recursos foram debitados e a obra leva ' + structure.required + ' dias.');
  return { ok: true, structure, readyDay: world.day + structure.required, pending: true };
}

export function destroyKingdomTower(world, kingdomId, towerId) {
  const kingdom = world.kingdoms.find(item => item.id === kingdomId);
  const towerIndex = world.structures.findIndex(structure => structure.id === towerId
    && structure.kingdomId === kingdomId && structure.type === 'torre' && structure.complete);
  if (!kingdom || towerIndex < 0) return { ok: false, reason: 'A torre não pertence a esse reino ou já foi destruída.' };
  const previousTerritory = kingdom.territoryTileCount;
  const [tower] = world.structures.splice(towerIndex, 1);
  invalidateNavigation(world);
  kingdom.structureIds = (kingdom.structureIds || []).filter(id => id !== tower.id);
  kingdom.towerIds = (kingdom.towerIds || []).filter(id => id !== tower.id);
  recomputeKingdomTerritories(world);
  const territoryTilesLost = Math.max(0, previousTerritory - kingdom.territoryTileCount);
  log(world, kingdom.name + ' perdeu uma torre e ' + territoryTilesLost + ' células de domínio.');
  return { ok: true, structure: tower, territoryTileCount: kingdom.territoryTileCount, territoryTilesLost };
}

export function recruitKingdomSoldier(world, kingdomId, options = {}) {
  const kingdom = world.kingdoms.find(item => item.id === kingdomId);
  if (!kingdom) return { ok: false, reason: 'Reino não encontrado.' };
  const militaryClass = options.militaryClass || 'lanceiro';
  if (!['guerreiro', 'lanceiro', 'arqueiro', 'monge'].includes(militaryClass)) return { ok: false, reason: 'Classe militar inválida.' };
  const school = militaryClass === 'arqueiro' ? 'arquearia' : militaryClass === 'monge' ? 'monasterio' : null;
  if (school && !world.structures.some(s => s.kingdomId === kingdomId && s.type === school && s.complete))
    return { ok: false, reason: 'Construa ' + school + ' para treinar esta classe.' };
  const centers = (kingdom.militaryCenterIds || []).map(id => world.structures.find(structure => structure.id === id && structure.complete)).filter(Boolean);
  const center = centers.find(item => {
    const pending = world.people.filter(person => person.alive && person.recruitmentOrder?.militaryCenterId === item.id).length;
    return (item.soldierIds || []).filter(id => world.people.some(p => p.id === id && p.alive && p.role === 'soldier')).length + pending < (item.capacity || 8);
  });
  if (!center) return { ok: false, reason: 'É necessário um centro militar com vagas disponíveis.' };
  const recruit = kingdom.memberIds.map(id => world.people.find(person => person.id === id && person.alive))
    .filter(person => person && person.role === 'resident' && person.ageDays >= 15 * 365
      && !person.recruitmentOrder && person.energy >= 30 && person.hydration >= 30
      && person.health >= 55 && person.foodReserve >= 24)
    .sort((a, b) => (b.physicalStrength + b.skills.gather * .25) - (a.physicalStrength + a.skills.gather * .25) || a.id - b.id)[0];
  if (!recruit) return { ok: false, reason: 'Não há morador adulto em condições de se alistar.' };
  if (!spendInventory(kingdom.treasury, SOLDIER_COST, 'soldier-recruitment')) {
    return { ok: false, reason: 'O tesouro não tem alimento, madeira e ouro para equipar o soldado.' };
  }
  if (options.immediate) {
    enlistSoldier(world, recruit, center, world.day, militaryClass);
    return { ok: true, person: recruit, center, pending: false };
  }
  const startedDay = Number.isInteger(options.startedDay) ? options.startedDay : world.day;
  recruit.recruitmentOrder = {
    kingdomId: kingdom.id, militaryCenterId: center.id, militaryClass,
    startedDay, readyDay: startedDay + KINGDOM_PROJECT_TIMING.recruit
  };
  log(world, kingdom.name + ' iniciou o treinamento de ' + recruit.name + '; alimento, madeira e ouro foram debitados. '
    + 'O treinamento leva ' + KINGDOM_PROJECT_TIMING.recruit + ' dias.', startedDay);
  return { ok: true, person: recruit, center, readyDay: recruit.recruitmentOrder.readyDay, pending: true };
}
