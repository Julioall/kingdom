import { spendInventory } from '../economy/inventories.js';
import { recomputeKingdomTerritories, TERRITORY_RULES } from './territories.js';
import { log } from '../core/events.js';

export const KINGDOM_BUILD_COSTS = Object.freeze({
  torre: Object.freeze({ wood: 34, stone: 24, gold: 8 }),
  centro_militar: Object.freeze({ wood: 32, stone: 30, gold: 12 })
});

export const SOLDIER_COST = Object.freeze({ food: 10, wood: 8, gold: 3 });

function canPlace(world, tile, kingdom, type) {
  if (!tile || tile.terrain !== 'land' || (tile.kingdomId != null && tile.kingdomId !== kingdom.id)) return false;
  const radius = type === 'torre' ? 2.1 : 2.7;
  return !world.structures.some(structure => {
    if (!structure.complete) return false;
    const existingRadius = structure.type === 'curral' ? (structure.radius || 3.5) : 2.5;
    return Math.hypot(tile.x - structure.x, tile.y - structure.y) < radius + existingRadius + 1;
  });
}

function chooseKingdomBuildSite(world, kingdom, type) {
  const opponents = world.kingdoms.filter(other => other.id !== kingdom.id);
  const targetX = world.width / 2 - kingdom.x, targetY = world.height / 2 - kingdom.y;
  const targetLength = Math.max(1, Math.hypot(targetX, targetY));
  const ux = targetX / targetLength, uy = targetY / targetLength;
  const desiredDistance = type === 'torre' ? 21 : 10;
  let best = null, bestScore = -Infinity;
  for (const tile of world.tiles) {
    if (!canPlace(world, tile, kingdom, type)) continue;
    const dx = tile.x - kingdom.x, dy = tile.y - kingdom.y;
    const projection = dx * ux + dy * uy, lateral = Math.abs(dx * uy - dy * ux);
    const distance = Math.hypot(dx, dy);
    if (type === 'torre' && (projection < 12 || projection > 27 || distance < 12 || distance > 29)) continue;
    if (type === 'centro_militar' && (distance < 7 || distance > 16)) continue;
    if (opponents.some(other => Math.hypot(tile.x - other.x, tile.y - other.y) < 10)) continue;
    const neutralBonus = tile.kingdomId == null ? 4 : 0;
    const score = -Math.abs(projection - desiredDistance) * 1.25 - lateral * .72
      - Math.abs(distance - desiredDistance) * .25 + neutralBonus - tile.slope * .8;
    if (score > bestScore) { best = tile; bestScore = score; }
  }
  return best;
}

export function buildKingdomStructure(world, kingdomId, type) {
  const kingdom = world.kingdoms.find(item => item.id === kingdomId);
  const cost = KINGDOM_BUILD_COSTS[type];
  if (!kingdom || !cost) return { ok: false, reason: 'Obra de reino inválida.' };
  const site = chooseKingdomBuildSite(world, kingdom, type);
  if (!site) return { ok: false, reason: 'Não há local seguro dentro do domínio disponível.' };
  if (!spendInventory(kingdom.treasury, cost)) return { ok: false, reason: 'O tesouro não tem os recursos necessários.' };
  const isTower = type === 'torre';
  const structure = {
    id: world.nextId++, type, kingdomId: kingdom.id, communityId: kingdom.communityId || null,
    x: site.x, y: site.y, complete: true, progress: 1, required: 1,
    createdDay: world.day, builtDay: world.day, cost: { ...cost },
    spriteKey: isTower ? 'tower' : 'barracks', territoryRadius: isTower ? TERRITORY_RULES.towerRadius : 0,
    soldierIds: type === 'centro_militar' ? [] : undefined, capacity: type === 'centro_militar' ? 8 : undefined
  };
  world.structures.push(structure);
  kingdom.structureIds.push(structure.id);
  if (isTower) kingdom.towerIds.push(structure.id);
  else kingdom.militaryCenterIds.push(structure.id);
  recomputeKingdomTerritories(world);
  return { ok: true, structure };
}

export function destroyKingdomTower(world, kingdomId, towerId) {
  const kingdom = world.kingdoms.find(item => item.id === kingdomId);
  const towerIndex = world.structures.findIndex(structure => structure.id === towerId
    && structure.kingdomId === kingdomId && structure.type === 'torre' && structure.complete);
  if (!kingdom || towerIndex < 0) return { ok: false, reason: 'A torre não pertence a esse reino ou já foi destruída.' };
  const previousTerritory = kingdom.territoryTileCount;
  const [tower] = world.structures.splice(towerIndex, 1);
  kingdom.structureIds = (kingdom.structureIds || []).filter(id => id !== tower.id);
  kingdom.towerIds = (kingdom.towerIds || []).filter(id => id !== tower.id);
  recomputeKingdomTerritories(world);
  const territoryTilesLost = Math.max(0, previousTerritory - kingdom.territoryTileCount);
  log(world, kingdom.name + ' perdeu uma torre e ' + territoryTilesLost + ' células de domínio.');
  return { ok: true, structure: tower, territoryTileCount: kingdom.territoryTileCount, territoryTilesLost };
}

export function recruitKingdomSoldier(world, kingdomId) {
  const kingdom = world.kingdoms.find(item => item.id === kingdomId);
  if (!kingdom) return { ok: false, reason: 'Reino não encontrado.' };
  const centers = (kingdom.militaryCenterIds || []).map(id => world.structures.find(structure => structure.id === id && structure.complete)).filter(Boolean);
  const center = centers.find(item => (item.soldierIds || []).length < (item.capacity || 8));
  if (!center) return { ok: false, reason: 'É necessário um centro militar com vagas disponíveis.' };
  const recruit = kingdom.memberIds.map(id => world.people.find(person => person.id === id && person.alive))
    .filter(person => person && person.role === 'resident' && person.ageDays >= 15 * 365
      && person.energy >= 30 && person.hydration >= 30 && person.health >= 55 && person.foodReserve >= 24)
    .sort((a, b) => (b.physicalStrength + b.skills.gather * .25) - (a.physicalStrength + a.skills.gather * .25) || a.id - b.id)[0];
  if (!recruit) return { ok: false, reason: 'Não há morador adulto em condições de se alistar.' };
  if (!spendInventory(kingdom.treasury, SOLDIER_COST)) return { ok: false, reason: 'O tesouro não tem alimento, madeira e ouro para equipar o soldado.' };
  recruit.role = 'soldier';
  recruit.militaryClass = 'lanceiro';
  recruit.militaryCenterId = center.id;
  recruit.militaryDutyCenterId = center.id;
  recruit.militaryTraining = 0;
  center.soldierIds ||= [];
  center.soldierIds.push(recruit.id);
  return { ok: true, person: recruit, center };
}
