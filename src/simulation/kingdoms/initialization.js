import { chooseRearCorralSite } from './rear-sites.js';
import { initializeTowerHealth } from './fortifications.js';
import { transferInventory, transferStoresToInventory, spendInventory } from '../economy/inventories.js';
import { DOMESTIC_SHEEP_DAILY_FEED, HEIGHT, WIDTH } from '../../config/ecosystem.js';
import { log } from '../core/events.js';
import { cellAt } from '../world/spatial.js';
import { recomputeKingdomTerritories, TERRITORY_RULES } from './territories.js';
import { KINGDOM_BUILD_COSTS } from './commands.js';
import { kingdomFoodDemand } from '../economy/food-policy.js';
import { isTreeAnchor } from '../ecology/plants.js';
import { seedRoyalChangeReserve } from '../economy/royal-coin-exchange.js';

const KINGDOM_STARTS = [
  { name: 'Valedouro', short: 'Valedouro', color: '#507db2', palette: 'blue', x: Math.round(18 * WIDTH / 36), y: Math.round(7 * HEIGHT / 26), innerX: 1, innerY: 1 },
  { name: 'Corvânia', short: 'Corvânia', color: '#bd625c', palette: 'red', x: Math.round(18 * WIDTH / 36), y: Math.round(19 * HEIGHT / 26), innerX: -1, innerY: -1 },
  { name: 'Albruma', short: 'Albruma', color: '#a27db8', palette: 'purple', x: 74, y: 22, innerX: -1, innerY: 1 },
  { name: 'Eryndor', short: 'Eryndor', color: '#c8a54a', palette: 'yellow', x: 22, y: 74, innerX: 1, innerY: -1 }
];
const INITIAL_KINGDOM_COUNT = 2;
const INITIAL_TOWER_OFFSETS = [[16, 7], [7, 16], [-16, -7], [-7, -16]];
export const INITIAL_POPULATION_PER_KINGDOM = 48;
export const INITIAL_MILITARY_ROSTER = Object.freeze([
  { school: 'centro_militar', militaryClass: 'guerreiro', count: 13 },
  { school: 'centro_militar', militaryClass: 'lanceiro', count: 7 },
  { school: 'arquearia', militaryClass: 'arqueiro', count: 5 },
  { school: 'monasterio', militaryClass: 'monge', count: 2 }
]);
export const INITIAL_SOLDIERS_PER_KINGDOM = INITIAL_MILITARY_ROSTER.reduce((sum, entry) => sum + entry.count, 0);

const BASE_PRICES = { food: .35, wood: .65, stone: .8, gold: 2, feed: .28, iron: .85, seeds: .5 };

function placeStructure(world, kingdom, type, x, y, cost, extra = {}) {
  if (!spendInventory(kingdom.treasury, cost)) throw new Error('Estoque insuficiente para a estrutura inicial: ' + type);
  const structure = {
    id: world.nextId++, type, kingdomId: kingdom.id, communityId: kingdom.communityId || null, x, y,
    entryTile: type === 'torre' ? { x, y: y + 1 } : undefined,
    complete: true, progress: 1, required: 1, builtDay: world.day, integrity: 1, lastMaintenanceThreshold: 1,
    cost: { ...cost }, residentIds: [], ...extra
  };
  initializeTowerHealth(structure);
  world.structures.push(structure);
  kingdom.structureIds.push(structure.id);
  return structure;
}

function initialTowerSite(world, castle, offset) {
  const desiredX = castle.x + offset[0], desiredY = castle.y + offset[1];
  const candidates = [];
  for (let radius = 0; radius <= 24; radius++) {
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius && radius > 0) continue;
      const tile = cellAt(world, desiredX + dx, desiredY + dy);
      if (!tile || tile.terrain !== 'land' || Math.hypot(tile.x - castle.x, tile.y - castle.y) > TERRITORY_RULES.castleRadius) continue;
      const entrance = cellAt(world, tile.x, tile.y + 1);
      if (!entrance || entrance.terrain !== 'land' || isTreeAnchor(world, entrance)) continue;
      const overlaps = world.structures.some(structure => {
        if (!structure.complete) return false;
        const existingRadius = structure.type === 'curral' ? (structure.radius || 3.5) : 2.5;
        return Math.hypot(tile.x - structure.x, tile.y - structure.y) < 2.1 + existingRadius + 1;
      });
      if (!overlaps) candidates.push(tile);
    }
  }
  candidates.sort((a, b) => Math.hypot(a.x - desiredX, a.y - desiredY) + a.slope * .12
    - (Math.hypot(b.x - desiredX, b.y - desiredY) + b.slope * .12));
  return candidates[0] || null;
}

function placeInitialTowers(world, kingdom, castle) {
  for (const offset of INITIAL_TOWER_OFFSETS) {
    const site = initialTowerSite(world, castle, offset);
    if (!site) throw new Error('Não há espaço seguro para uma das torres iniciais de ' + kingdom.name + '.');
    const tower = placeStructure(world, kingdom, 'torre', site.x, site.y, KINGDOM_BUILD_COSTS.torre,
      { spriteKey: 'tower', territoryRadius: TERRITORY_RULES.towerRadius });
    kingdom.towerIds.push(tower.id);
  }
}

export function initializeKingdoms(world) {
  world.kingdoms = KINGDOM_STARTS.slice(0, INITIAL_KINGDOM_COUNT).map((start, index) => {
    const id = world.nextId++;
    const kingdom = {
      id, name: start.name, short: start.short, color: start.color, palette: start.palette,
      x: start.x, y: start.y, createdDay: world.day, rulerId: null, memberIds: [],
      innerX: start.innerX, innerY: start.innerY, communityId: null,
      settlementIds: [], structureIds: [], homeIds: [], towerIds: [], militaryCenterIds: [], territoryTileCount: 0,
      treasury: { ownerType: 'kingdom', ownerId: id, stock: { food: 4800, wood: 1200, stone: 700, gold: 9000, copper: 0, silver: 0, iron: 0, feed: 180, seeds: 0 } },
      policy: { taxRate: .075, droughtReserveDays: 30, priorities: ['food', 'water', 'housing', 'defense'] },
      satisfaction: .62, prestige: 0, legacy: null,
      frontierExpansion: {
        enabled: true, outpostIds: [], nextDecisionDay: 31, lastProjectStartedDay: null,
        pendingProjectId: null, status: 'observing',
        reason: 'O reino observa a fronteira e só avança com recursos do próprio tesouro.', lastOutcome: null
      }
    };
    world.kingdoms[index] = kingdom;
    return kingdom;
  });

  for (const kingdom of world.kingdoms) {
    const communityId = world.nextId++;
    kingdom.communityId = communityId;
    world.communities.push({
      id: communityId, kingdomId: kingdom.id, isKingdomGroup: true, name: kingdom.name, nameSource: kingdom.name,
      color: kingdom.color, memberIds: [], stage: 'reino', previousStage: 'reino', x: kingdom.x, y: kingdom.y,
      cohesion: .2, satisfaction: .62, leaderId: null, leadershipChallenge: null, assignments: [], properties: [],
      lastGovernanceDay: -999, lastPropertyDay: -999, createdDay: world.day, history: [], usedCells: {},
      grounds: { hunting: null, fishing: null }, lastBuildDay: -999,
      stores: { food: 0, meat: 0, wood: 0, stone: 0, feed: 0, gold: 0, copper: 0, silver: 0, iron: 0, seeds: 0 }, tradeCount: 0, splitCooldown: 0
    });
  }

  const homeOffsets = [[-9, -9], [-3, -9], [3, -9], [9, -9], [-9, 9], [-3, 9], [3, 9], [9, 9]];
  for (const kingdom of world.kingdoms) {
    const castle = placeStructure(world, kingdom, 'castelo', kingdom.x, kingdom.y,
      { wood: 52, stone: 78, gold: 24 }, { spriteKey: 'castle', territoryRadius: TERRITORY_RULES.castleRadius });
    const village = placeStructure(world, kingdom, 'vila', kingdom.x - kingdom.innerX * 14, kingdom.y,
      { wood: 24, stone: 14 }, { spriteKey: 'house3' });
    const marketStructure = placeStructure(world, kingdom, 'mercado', kingdom.x, kingdom.y - kingdom.innerY * 14,
      { wood: 20, stone: 10 }, { spriteKey: 'house2' });
    const militaryCenter = placeStructure(world, kingdom, 'centro_militar', kingdom.x, kingdom.y + kingdom.innerY * 14,
      { wood: 32, stone: 30, gold: 12 }, { spriteKey: 'barracks', capacity: 60, soldierIds: [] });
    kingdom.militaryCenterIds.push(militaryCenter.id);
    const rearSite = chooseRearCorralSite(world, kingdom, homeOffsets.map(([dx, dy]) => ({ x: kingdom.x + dx, y: kingdom.y + dy })));
    if (!rearSite) throw new Error('Não há retaguarda segura para o curral de ' + kingdom.name);
    const pen = placeStructure(world, kingdom, 'curral', rearSite.x, rearSite.y,
      { wood: 14, stone: 8 }, { radius: 3.5, spriteKey: null });
    for (const [dx, dy] of homeOffsets) {
      const home = placeStructure(world, kingdom, 'casa', kingdom.x + dx, kingdom.y + dy, { wood: 8, stone: 2 }, { capacity: 13, spriteKey: 'house1' });
      kingdom.homeIds.push(home.id);
    }
    placeStructure(world, kingdom, 'monasterio', kingdom.x + kingdom.innerX * 7, kingdom.y + 15,
      KINGDOM_BUILD_COSTS.monasterio, { spriteKey: 'monastery', trainingClass: 'monge' });
    placeStructure(world, kingdom, 'arquearia', kingdom.x + kingdom.innerX * 7, kingdom.y - 15,
      KINGDOM_BUILD_COSTS.arquearia, { spriteKey: 'archery', trainingClass: 'arqueiro' });
    placeInitialTowers(world, kingdom, castle);

    const settlement = {
      id: world.nextId++, kingdomId: kingdom.id, name: 'Vila de ' + kingdom.name,
      x: kingdom.x, y: kingdom.y, castleId: castle.id, villageId: village.id,
      marketId: marketStructure.id, penId: pen.id, homeIds: kingdom.homeIds.slice(), createdDay: world.day
    };
    world.settlements.push(settlement);
    kingdom.settlementIds.push(settlement.id);
    kingdom.capitalSettlementId = settlement.id;
    kingdom.market = { ownerType: 'kingdom-market', ownerId: kingdom.id, stock: { food: 0, wood: 0, stone: 0, gold: 0, copper: 0, silver: 0, iron: 0, feed: 0, seeds: 0 }, prices: { ...BASE_PRICES }, supply: {}, demand: {}, transactions: 0, lastUpdateDay: -1 };
    for (const resource of Object.keys(BASE_PRICES)) {
      const openingStock = { food: 42, wood: 12, stone: 8, gold: 18, feed: 12, iron: 0, seeds: 0 }[resource];
      if (openingStock > 0) transferInventory(kingdom.treasury, kingdom.market, resource, openingStock);
    }
    // Recoin five pieces of existing royal gold into 20 silver and 300 copper.
    // Total nominal wealth stays unchanged, and the market must ask the
    // castle for denominations as needed rather than receiving free change.
    if (!seedRoyalChangeReserve(kingdom)) throw new Error('O tesouro inicial não permite uma reserva de troco.');
  }

  recomputeKingdomTerritories(world);
}

function collectKingdomTax(world, kingdom, day, dailyFoodDemand, population) {
  const community = world.communities.find(item => item.id === kingdom.communityId && !item.dissolved);
  if (!community) return null;
  const rate = Math.max(0, Math.min(.25, Number(kingdom.policy && kingdom.policy.taxRate) || 0));
  const sheep = world.animals.filter(animal => animal.alive && animal.speciesId === 'sheep'
    && animal.herdCommunityId === community.id).length;
  const floors = {
    food: dailyFoodDemand * 2,
    wood: 18,
    stone: 12,
    feed: Math.max(8, sheep * 5),
    gold: 4
  };
  const tax = {};
  for (const resource of ['food', 'wood', 'stone', 'feed', 'gold']) {
    const surplus = Math.max(0, (community.stores[resource] || 0) - floors[resource]);
    const assessment = surplus * rate;
    if (assessment <= .01) continue;
    const moved = transferStoresToInventory(community, kingdom.treasury, resource, assessment);
    if (moved > .01) tax[resource] = moved;
  }
  const total = Object.values(tax).reduce((sum, amount) => sum + amount, 0);
  kingdom.taxLedger ||= { cycles: 0, total: {}, history: [] };
  kingdom.taxLedger.cycles++;
  kingdom.taxLedger.lastDay = day;
  for (const [resource, amount] of Object.entries(tax)) {
    kingdom.taxLedger.total[resource] = Number(((kingdom.taxLedger.total[resource] || 0) + amount).toFixed(2));
  }
  const status = total > .01 ? 'collected' : 'protected-reserve';
  const record = { day, status, assessedRate: rate, population, tax, protectedFloors: floors };
  kingdom.taxLedger.history.push(record);
  if (kingdom.taxLedger.history.length > 24) kingdom.taxLedger.history.shift();
  const message = total > .01
    ? kingdom.name + ' recolheu tributos de ' + Object.entries(tax).map(([resource, amount]) => Number(amount.toFixed(2)) + ' ' + resource).join(', ') + ' no dia ' + day + '.'
    : kingdom.name + ' não recolheu tributo no dia ' + day + ': os estoques comunitários ficaram dentro das reservas protegidas.';
  community.history.push(message);
  log(world, message);
  return record;
}

export function updateKingdomMarkets(world, marketDay = world.day) {
  for (const kingdom of world.kingdoms || []) {
    const market = kingdom.market;
    if (!market || market.lastUpdateDay === marketDay) continue;
    const foodDemand = kingdomFoodDemand(world, kingdom);
    const population = foodDemand.members.length;
    const dailyFoodDemand = foodDemand.dailyFoodNeed;
    const sheep = world.animals.filter(animal => animal.alive && animal.speciesId === 'sheep'
      && animal.herdCommunityId === kingdom.communityId).length;
    const demand = {
      food: dailyFoodDemand * 30,
      wood: population * .05 * 30,
      stone: population * .025 * 30,
      gold: population * .01 * 30,
      feed: sheep * DOMESTIC_SHEEP_DAILY_FEED * 30,
      // Industrial demand is only a price signal until crafting costs are implemented.
      iron: population * .045 * 30,
      // Finite opening seed supply. Subsequent sowing requires real retained harvest or market stock.
      seeds: 8 * (world.structures || []).filter(structure => structure.type === 'roça'
        && structure.communityId === kingdom.communityId && structure.destroyedDay == null).length + 8
    };
    for (const resource of Object.keys(BASE_PRICES)) {
      const supply = Math.max(0, market.stock[resource] || 0);
      const ratio = demand[resource] / Math.max(1, supply);
      market.supply[resource] = supply;
      market.demand[resource] = demand[resource];
      market.prices[resource] = Math.round(BASE_PRICES[resource] * Math.max(.65, Math.min(2.8, .82 + ratio * .12)) * 100) / 100;
    }
    market.lastUpdateDay = marketDay;
    if (marketDay > 0 && marketDay % 30 === 0) collectKingdomTax(world, kingdom, marketDay, dailyFoodDemand, population);
  }
}

export function assignHome(world, kingdom, person) {
  if (!kingdom || !person) return false;
  const home = kingdom.homeIds.map(id => world.structures.find(s => s.id === id && s.type === 'casa' && s.complete
    && s.destroyedDay == null && s.residentIds.length < s.capacity)).find(Boolean);
  let chosen = home;
  if (!chosen) {
    if (world.structures.some(s => s.kingdomId === kingdom.id && s.type === 'casa' && s.kingdomProject
      && !s.complete && s.destroyedDay == null && s.integrity > 0)) return false;
    if ((kingdom.treasury.stock.wood || 0) < 8 || (kingdom.treasury.stock.stone || 0) < 2) return false;
    const slots = [];
    for (let radius = 14; radius <= 30; radius += 5) {
      for (let offset = -radius; offset <= radius; offset += 5) {
        slots.push([offset, -radius], [offset, radius], [-radius, offset], [radius, offset]);
      }
    }
    let site = null;
    for (const [dx, dy] of slots) {
      const targetX = kingdom.x + dx, targetY = kingdom.y + dy;
      const tile = cellAt(world, targetX, targetY);
      if (!tile || tile.terrain !== 'land' || tile.kingdomId !== kingdom.id) continue;
      if (world.structures.some(s => s.type !== 'curral' && Math.hypot(s.x - tile.x, s.y - tile.y) < 4.2)) continue;
      if (world.structures.some(s => s.type === 'curral' && Math.hypot(s.x - tile.x, s.y - tile.y) < (s.radius || 3.5) + 2)) continue;
      site = tile; break;
    }
    if (!site) return false;
    chosen = placeStructure(world, kingdom, 'casa', site.x, site.y, { wood: 8, stone: 2 }, {
      capacity: 13, spriteKey: 'house1', kingdomProject: true, complete: false, progress: 0,
      required: 10, builtDay: null, createdDay: world.day, constructionStartedDay: null
    });
    kingdom.homeIds.push(chosen.id);
    const settlement = world.settlements.find(item => item.id === kingdom.capitalSettlementId);
    if (settlement) settlement.homeIds.push(chosen.id);
    log(world, kingdom.name + ' planejou uma casa para os moradores sem vaga; a obra aguarda um peão no local.');
    return false;
  }
  chosen.residentIds.push(person.id);
  person.homeId = chosen.id;
  return true;
}
