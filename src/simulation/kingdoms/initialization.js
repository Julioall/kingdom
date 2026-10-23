import { transferInventory, spendInventory } from '../economy/inventories.js';
import { cellAt } from '../world/spatial.js';
import { recomputeKingdomTerritories, TERRITORY_RULES } from './territories.js';
import { KINGDOM_BUILD_COSTS } from './commands.js';

const KINGDOM_STARTS = [
  { name: 'Valedouro', short: 'Valedouro', color: '#507db2', palette: 'blue', x: 22, y: 22, innerX: 1, innerY: 1 },
  { name: 'Corvânia', short: 'Corvânia', color: '#bd625c', palette: 'red', x: 74, y: 74, innerX: -1, innerY: -1 },
  { name: 'Albruma', short: 'Albruma', color: '#a27db8', palette: 'purple', x: 74, y: 22, innerX: -1, innerY: 1 },
  { name: 'Eryndor', short: 'Eryndor', color: '#c8a54a', palette: 'yellow', x: 22, y: 74, innerX: 1, innerY: -1 }
];
const INITIAL_KINGDOM_COUNT = 2;
const INITIAL_TOWER_OFFSETS = [[16, 7], [7, 16], [-16, -7], [-7, -16]];
export const INITIAL_SOLDIERS_PER_KINGDOM = 2;

const BASE_PRICES = { food: .35, wood: .65, stone: .8, gold: 2, feed: .28 };

function placeStructure(world, kingdom, type, x, y, cost, extra = {}) {
  if (!spendInventory(kingdom.treasury, cost)) throw new Error('Estoque insuficiente para a estrutura inicial: ' + type);
  const structure = {
    id: world.nextId++, type, kingdomId: kingdom.id, communityId: kingdom.communityId || null, x, y,
    complete: true, progress: 1, required: 1, builtDay: world.day,
    cost: { ...cost }, residentIds: [], ...extra
  };
  world.structures.push(structure);
  kingdom.structureIds.push(structure.id);
  return structure;
}

function initialTowerSite(world, castle, offset) {
  const desiredX = castle.x + offset[0], desiredY = castle.y + offset[1];
  const candidates = [];
  for (let radius = 0; radius <= 3; radius++) {
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius && radius > 0) continue;
      const tile = cellAt(world, desiredX + dx, desiredY + dy);
      if (!tile || tile.terrain !== 'land' || Math.hypot(tile.x - castle.x, tile.y - castle.y) > TERRITORY_RULES.castleRadius) continue;
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
      treasury: { ownerType: 'kingdom', ownerId: id, stock: { food: 180, wood: 420, stone: 300, gold: 180, feed: 90 } },
      policy: { taxRate: .075, droughtReserveDays: 30, priorities: ['food', 'water', 'housing', 'defense'] },
      satisfaction: .62, prestige: 0, legacy: null
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
      stores: { food: 0, meat: 0, wood: 0, stone: 0, feed: 0, gold: 0 }, tradeCount: 0, splitCooldown: 0
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
      { wood: 32, stone: 30, gold: 12 }, { spriteKey: 'barracks', capacity: 8, soldierIds: [] });
    kingdom.militaryCenterIds.push(militaryCenter.id);
    const pen = placeStructure(world, kingdom, 'curral', kingdom.x + kingdom.innerX * 15, kingdom.y,
      { wood: 14, stone: 8 }, { radius: 3.5, spriteKey: null });
    for (const [dx, dy] of homeOffsets) {
      const home = placeStructure(world, kingdom, 'casa', kingdom.x + dx, kingdom.y + dy, { wood: 8, stone: 2 }, { capacity: 4, spriteKey: 'house1' });
      kingdom.homeIds.push(home.id);
    }
    placeInitialTowers(world, kingdom, castle);

    const settlement = {
      id: world.nextId++, kingdomId: kingdom.id, name: 'Vila de ' + kingdom.name,
      x: kingdom.x, y: kingdom.y, castleId: castle.id, villageId: village.id,
      marketId: marketStructure.id, penId: pen.id, homeIds: kingdom.homeIds.slice(), createdDay: world.day
    };
    world.settlements.push(settlement);
    kingdom.settlementIds.push(settlement.id);
    kingdom.capitalSettlementId = settlement.id;
    kingdom.market = { ownerType: 'kingdom-market', ownerId: kingdom.id, stock: { food: 0, wood: 0, stone: 0, gold: 0, feed: 0 }, prices: { ...BASE_PRICES }, supply: {}, demand: {}, transactions: 0, lastUpdateDay: -1 };
    for (const resource of Object.keys(BASE_PRICES)) {
      const openingStock = { food: 42, wood: 12, stone: 8, gold: 18, feed: 12 }[resource];
      transferInventory(kingdom.treasury, kingdom.market, resource, openingStock);
    }
  }

  recomputeKingdomTerritories(world);
}

export function updateKingdomMarkets(world) {
  for (const kingdom of world.kingdoms || []) {
    const market = kingdom.market;
    if (!market || market.lastUpdateDay === world.day) continue;
    const population = kingdom.memberIds.filter(id => world.people.some(person => person.id === id && person.alive)).length;
    const demand = { food: population * .78 * 30, wood: population * .05 * 30, stone: population * .025 * 30, gold: population * .01 * 30, feed: population * .08 * 30 };
    for (const resource of Object.keys(BASE_PRICES)) {
      const supply = Math.max(0, market.stock[resource] || 0);
      const ratio = demand[resource] / Math.max(1, supply);
      market.supply[resource] = supply;
      market.demand[resource] = demand[resource];
      market.prices[resource] = Math.round(BASE_PRICES[resource] * Math.max(.65, Math.min(2.8, .82 + ratio * .12)) * 100) / 100;
    }
    market.lastUpdateDay = world.day;
  }
}

export function assignHome(world, kingdom, person) {
  if (!kingdom || !person) return false;
  const home = kingdom.homeIds.map(id => world.structures.find(s => s.id === id && s.type === 'casa' && s.residentIds.length < s.capacity)).find(Boolean);
  let chosen = home;
  if (!chosen) {
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
    chosen = placeStructure(world, kingdom, 'casa', site.x, site.y, { wood: 8, stone: 2 }, { capacity: 4, spriteKey: 'house1' });
    kingdom.homeIds.push(chosen.id);
    const settlement = world.settlements.find(item => item.id === kingdom.capitalSettlementId);
    if (settlement) settlement.homeIds.push(chosen.id);
  }
  chosen.residentIds.push(person.id);
  person.homeId = chosen.id;
  return true;
}

