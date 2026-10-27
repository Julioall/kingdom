import { rearProjection, safeCorralFootprint } from '../kingdoms/rear-sites.js';
import { initializeStructureHealth } from '../kingdoms/fortifications.js';
import { clamp, distance, hash01 } from '../core/math.js';
import { communityFoodStock, consumeFoodReserve, spendInventory, spendStoreInventory, transferResource, withdrawCommunityFood } from '../economy/inventories.js';
import { cellAt, cellsWithin } from '../world/spatial.js';
import { collectCommunityFieldSeeds, plantBiomass, sowCommunityField } from '../ecology/plants.js';
import { PLANTS } from '../../config/ecosystem.js';
import { formatWholeMeasure } from '../../config/whole-measures.js';
import { localNameFeature } from '../society/communities.js';
import { log } from '../core/events.js';
import { moveOne, reachableAreaAround } from '../individuals/movement.js';
import { hitboxesOverlap, structureHitbox, worldCollisionIndex } from '../physics/hitboxes.js';
import { consumePersonEnergy } from '../individuals/energy.js';
import { claimConstructionWorkstation, clearConstructionWorkpointResources, constructionContactPoint, constructionWorkpointReachable, constructionWorkPositions } from './construction-workstations.js';
import { communityNeedsAdditionalPen } from '../ecology/herd.js';

const COMMUNITY_BUILDING_TYPES = new Set(['abrigo', 'roça', 'curral', 'posto de coleta', 'acampamento']);
const KINGDOM_REPAIR_COST = Object.freeze({ wood: 3, stone: 2 });
const CONSTRUCTION_OBSTACLE_NAMES = Object.freeze({ tree: 'árvore', stone: 'pedra', gold: 'minério de ouro' });
export const FIELD_CONSTRUCTION_MIN_FOOD_RESERVE = 8;
export const FIELD_CONSTRUCTION_MIN_ENERGY = 24;

export function isFoodFieldConstructionAssignment(world, assignment) {
  if (!assignment || assignment.action !== 'build') return false;
  if (['invest-in-cultivated-food', 'replant-cultivated-food'].includes(assignment.goal)) return true;
  const structure = (world.structures || []).find(item => item.id === assignment.structureId);
  return structure?.type === 'roça' && !structure.complete;
}

export function canWorkOnFoodFieldWithReserve(person, assignment, world) {
  return isFoodFieldConstructionAssignment(world, assignment)
    && person.foodReserve > FIELD_CONSTRUCTION_MIN_FOOD_RESERVE;
}

export function canGatherFoodFieldMaterialsWithReserve(person, assignment) {
  return assignment?.action === 'gather' && assignment.goal === 'prepare-cultivated-field'
    && person.foodReserve > FIELD_CONSTRUCTION_MIN_FOOD_RESERVE;
}

export function hasConstructionFoodReserve(person, structure) {
  return structure?.type === 'roça'
    ? person.foodReserve > FIELD_CONSTRUCTION_MIN_FOOD_RESERVE
    : person.foodReserve >= 24;
}

export function hasConstructionEnergy(person, structure) {
  return person.energy > (structure?.type === 'roça' ? FIELD_CONSTRUCTION_MIN_ENERGY : 27);
}

function constructionObstacleDescription(kinds) {
  return kinds.map(kind => CONSTRUCTION_OBSTACLE_NAMES[kind] || 'recurso').join(' e ');
}

export function damagedKingdomStructures(w, kingdomId) {
    return (w.structures || []).filter(structure => structure.kingdomId === kingdomId && structure.complete
      && structure.destroyedDay == null && structure.integrity !== 0
      && ((Number.isFinite(structure.integrity) && structure.integrity < .99)
        || (Number.isFinite(structure.maxHealth) && structure.maxHealth > 0
          && Number.isFinite(structure.health) && structure.health < structure.maxHealth * .99)))
      .map(structure => {
        const integrity = Number.isFinite(structure.integrity) ? structure.integrity : 1;
        const healthRatio = Number.isFinite(structure.maxHealth) && structure.maxHealth > 0
          ? Math.max(0, Math.min(1, Number.isFinite(structure.health) ? structure.health / structure.maxHealth : 1)) : null;
        return { structure, integrity, healthRatio,
          damage: Math.max(1 - integrity, healthRatio == null ? 0 : 1 - healthRatio) };
      })
      .sort((a, b) => b.damage - a.damage || a.structure.id - b.structure.id);
  }

export function canRepairKingdomStructure(w, community) {
    if (!community) return false;
    const kingdom = (w.kingdoms || []).find(item => item.id === community.kingdomId);
    const stock = kingdom && kingdom.treasury && kingdom.treasury.stock;
    return damagedKingdomStructures(w, community.kingdomId).length > 0
      && !!stock && stock.wood >= KINGDOM_REPAIR_COST.wood && stock.stone >= KINGDOM_REPAIR_COST.stone;
  }

function workOnKingdomStructureRepair(w, person, community) {
    const kingdom = (w.kingdoms || []).find(item => item.id === community.kingdomId);
    const target = damagedKingdomStructures(w, community.kingdomId)[0]?.structure;
    if (!kingdom || !target) { person.state = 'não há construção danificada'; return false; }
    if (target.siegeBlocked) { person.state = 'reparo adiado durante o cerco'; person.buildCooldown = 2; return false; }
    const workstation = claimConstructionWorkstation(w, target, person);
    if (!workstation) {
      person.state = 'aguardando um ponto livre para reparar';
      person.buildCooldown = 2;
      return false;
    }
    const cleared = clearConstructionWorkpointResources(w, person, workstation.position);
    if (cleared.cleared) {
      person.state = 'limpando ' + constructionObstacleDescription(cleared.kinds) + ' do ponto de reparo';
      person.lastLesson = 'O morador removeu somente o recurso que ocupava o ponto de trabalho.';
      person.buildCooldown = 1;
      return false;
    }
    if (!workstation.arrived) {
      moveOne(w, person, cellAt(w, workstation.position.x, workstation.position.y), false);
      person.state = 'indo reparar ' + target.type;
      person.buildCooldown = 2;
      return false;
    }
    if (target.lastRepairDay === w.day) {
      const contact = constructionContactPoint(target);
      person.visualActivity = { kind: 'build', ...contact, day: w.day + 1 };
      person.state = 'auxiliando no reparo de ' + target.type;
      person.buildCooldown = 1;
      return false;
    }
    if (!spendInventory(kingdom.treasury, KINGDOM_REPAIR_COST, 'fortification-repair')) {
      person.state = 'faltam materiais reais para reparar'; person.buildCooldown = 8; return false;
    }
    target.integrity = Math.min(1, (Number.isFinite(target.integrity) ? target.integrity : 1) + .1);
    if (Number.isFinite(target.maxHealth) && target.maxHealth > 0) {
      target.health = Math.min(target.maxHealth, (Number.isFinite(target.health) ? target.health : 0) + target.maxHealth * .12);
    }
    target.lastRepairDay = w.day;
    const contact = constructionContactPoint(target);
    person.visualActivity = { kind: 'build', ...contact, day: w.day + 1 };
    consumePersonEnergy(person, 1.2);
    consumeFoodReserve(person, .2, 'repair-effort');
    person.buildCooldown = 1;
    person.state = 'reparando ' + target.type;
    person.lastLesson = 'O reino pagou madeira e pedra do tesouro; o reparo recuperou a integridade e a vida da construção.';
    const message = person.name + ' reparou ' + target.type + ' para ' + kingdom.name + ': integridade '
      + Math.round(target.integrity * 100) + '%' + (target.maxHealth ? ', vida ' + Math.round(target.health) + '/' + target.maxHealth : '') + '.';
    community.history.push(message);
    log(w, message);
    return true;
  }

export function communityBuildingNeed(w, community, size) {
    if (!community) return 0;
    const plan = nextCommunityStructure(w, community, size || community.memberIds.length, communityStructures(w, community));
    if (!plan) return 0;
    const wood = Math.max(0, plan.woodCost - (community.stores.wood || 0));
    const stone = Math.max(0, plan.stoneCost - (community.stores.stone || 0));
    return clamp((wood + stone) / Math.max(1, plan.woodCost + plan.stoneCost), 0, 1);
  }

export function communityStructures(w, community) {
    return w.structures.filter(s => s.communityId === community.id && s.destroyedDay == null
      && s.integrity !== 0 && (!s.kingdomProject || s.complete));
  }

export function canCommunityBuild(w, community, size) {
    const structures = communityStructures(w, community);
    if (structures.some(s => !s.complete)) return true;
    const limit = size >= 12 ? 5 : size >= 8 ? 4 : size >= 6 ? 3 : size >= 3 ? 1 : 0;
    const completed = structures.filter(s => s.complete && COMMUNITY_BUILDING_TYPES.has(s.type)).length;
    const plan = nextCommunityStructure(w, community, size, structures);
    const capacityExpansion = plan?.type === 'curral' && communityNeedsAdditionalPen(w, community.id);
    return (completed < limit || capacityExpansion) && plan && (community.stores.wood || 0) >= plan.woodCost
      && (community.stores.stone || 0) >= plan.stoneCost
      && communityFoodStock(community) >= plan.foodCost && w.day - community.lastBuildDay >= 24;
  }

export function nextCommunityStructure(w, community, size, structures) {
    if (structures.some(s => !s.complete)) return { type: 'ongoing', woodCost: 0, stoneCost: 0, foodCost: 0 };
    if (community.isKingdomGroup && size >= 6 && !structures.some(s => s.type === 'roça')) {
      return { type: 'roça', woodCost: 16, stoneCost: 6, foodCost: 0, seedMass: 8, required: 34 };
    }
    if (!structures.some(s => s.type === 'abrigo')) return { type: 'abrigo', woodCost: 18, stoneCost: 8, foodCost: 0, required: 28 };
    if (size >= 6 && !structures.some(s => s.type === 'roça')) return { type: 'roça', woodCost: 16, stoneCost: 6, foodCost: 0, seedMass: 8, required: 34 };
    if (size >= 6 && !structures.some(s => s.type === 'curral')) return { type: 'curral', woodCost: 14, stoneCost: 5, foodCost: 0, required: 34 };
    if (communityNeedsAdditionalPen(w, community.id)) return { type: 'curral', woodCost: 14, stoneCost: 5, foodCost: 0, required: 34 };
    if (!structures.some(s => s.type === 'posto de coleta')) return { type: 'posto de coleta', woodCost: 20, stoneCost: 12, foodCost: 1, required: 36 };
    if (size >= 12 && !structures.some(s => s.type === 'acampamento')) return { type: 'acampamento', woodCost: 24, stoneCost: 16, foodCost: 1, required: 44 };
    return null;
  }

export function communityBuildUtility(w, community, size) {
    const active = communityStructures(w, community).some(s => !s.complete);
    const hasShelter = communityStructures(w, community).some(s => s.type === 'abrigo' && s.complete);
    const needsPen = communityNeedsAdditionalPen(w, community.id);
    return clamp(.28 + size * .035 + (active ? .25 : 0) + (!hasShelter ? .44 : 0) + (needsPen ? .3 : 0), .32, .98);
  }

function overlapsSiteResources(w, hitbox, resourceIndex) {
    if (!hitbox) return false;
    const radius = Math.max(hitbox.halfWidth || 0, hitbox.halfDepth || 0) + .5;
    for (const tile of cellsWithin(w, hitbox.x, hitbox.y, radius, () => true)) {
      const resources = resourceIndex.byTile.get(tile.i) || [];
      if (resources.some(resource => hitboxesOverlap(hitbox, resource))) return true;
    }
    return false;
  }

export function chooseBuildSite(w, community, structures, builder = null) {
    const completed = structures.filter(s => s.complete);
    const size = community.memberIds.filter(id => w.people.some(p => p.id === id && p.alive)).length;
    const plan = nextCommunityStructure(w, community, size, structures);
    if (!plan) return null;
    const nextType = plan.type;
    const isFarm = nextType === 'roça';
    const worldStructures = w.structures;
    const candidateRadius = nextType === 'curral' ? 3.5 : 2.5;
    const resourceIndex = worldCollisionIndex(w).resources;
    const reachableWorkTiles = builder
      ? new Set(reachableAreaAround(w, builder, builder, Math.hypot(w.width, w.height)).map(tile => tile.i)) : null;
    let best = null, bestScore = -Infinity;
    for (const t of w.tiles) {
      if (t.x < 2 || t.y < 2 || t.x >= w.width - 2 || t.y >= w.height - 2) continue;
      if (t.terrain !== 'land' || t.slope > .8 || t.waterDist < 3 || t.kingdomId !== community.kingdomId) continue;
      if (nextType === 'curral') {
        const kingdom = w.kingdoms.find(k => k.id === community.kingdomId);
        if (kingdom && (rearProjection(w, kingdom, t) < 6 || !safeCorralFootprint(w, t))) continue;
      }
      const overlapsStructure = worldStructures.some(structure => {
        if (structure.destroyedDay != null) return false;
        const existingRadius = structure.type === 'curral' ? (structure.radius || 3.5) : 2.5;
        return distance(t, structure) < candidateRadius + existingRadius + .75;
      });
      if (overlapsStructure) continue;
      const centerDistance = Math.hypot(t.x - community.x, t.y - community.y);
      const ownedProperty = (community.properties || []).find(property => distance(t, property) <= (property.radius || 5));
      if (!completed.length && centerDistance > 5) continue;
      if (completed.length) {
        const nearest = Math.min(...completed.map(s => distance(t, s)));
        if (nearest < 6 || (nearest > (isFarm ? 12 : 17) && !ownedProperty)
            || (centerDistance > (isFarm ? 12 : 22) && !ownedProperty)) continue;
      }
      const localBiomass = cellsWithin(w, t.x, t.y, 2, q => q.terrain === 'land').reduce((sum, q) => sum + plantBiomass(q, ['grass', 'berry', 'broadleaf', 'conifer']), 0);
      if (localBiomass < 160) continue;
      const waterAccess = Math.max(0, 6 - t.waterDist);
      const spacingTarget = isFarm ? 7 : 9;
      const spacing = completed.length ? Math.min(...completed.map(s => Math.abs(distance(t, s) - spacingTarget))) : centerDistance;
      const noise = hash01(w.seed + community.id * 31, t.x, t.y) * .08;
      const fieldTiles = nextType === 'roça' ? cellsWithin(w, t.x, t.y, 3.35, q => q.terrain === 'land'
        && q.slope <= .65 && q.soilType !== 'sandy' && q.waterDist <= 20 && q.cropFieldId == null) : null;
      if (fieldTiles && fieldTiles.length < 16) continue;
      const fieldSeedBiomass = fieldTiles && fieldTiles.reduce((sum, q) => sum + plantBiomass(q, ['berry']), 0);
      if (fieldTiles && fieldSeedBiomass + .001 < plan.seedMass) continue;
      const nearbyBrowse = cellsWithin(w, t.x, t.y, 3.5, q => q.terrain === 'land')
        .reduce((sum, q) => sum + plantBiomass(q, ['browse']), 0);
      const flockDistance = Math.min(...w.animals.filter(a => a.alive && a.speciesId === 'sheep').map(a => distance(a, t)), 22);
      const sitePreview = { type: nextType, x: t.x, y: t.y,
        radius: nextType === 'curral' ? 3.5 : undefined, complete: false };
      const siteHitbox = structureHitbox({ ...sitePreview, complete: true });
      if (overlapsSiteResources(w, siteHitbox, resourceIndex)) continue;
      const workPositions = builder ? constructionWorkPositions(w, sitePreview, builder) : null;
      if (builder && (!workPositions || workPositions.some(point =>
        !constructionWorkpointReachable(w, builder, point, reachableWorkTiles)))) continue;
      const score = Math.log1p(localBiomass) * .24 + waterAccess * .12 - t.slope * 1.4 - spacing * .045 - centerDistance * .012
        + (ownedProperty ? .42 : 0) + (nextType === 'curral' ? Math.log1p(nearbyBrowse) * .19 - flockDistance * .045 : 0)
        + (fieldTiles ? Math.min(1, fieldTiles.length / 25) * .61 + Math.min(1, fieldSeedBiomass / plan.seedMass) * .18 : 0) + noise;
      if (score > bestScore) { best = { tile: t, fieldTileIndices: fieldTiles && fieldTiles.map(q => q.i), workPositions }; bestScore = score; }
    }
    if (!best) return null;
    return {
      id: w.nextId++, kingdomId: community.kingdomId, communityId: community.id, type: nextType, x: best.tile.x, y: best.tile.y,
      progress: 0, required: plan.required,
      woodCost: plan.woodCost, stoneCost: plan.stoneCost, foodCost: plan.foodCost,
      seedMass: plan.seedMass || 0,
      fieldTileIndices: best.fieldTileIndices || undefined,
      workPositions: best.workPositions || undefined,
      fruitStored: nextType === 'abrigo' ? 0 : undefined, meatStored: nextType === 'abrigo' ? 0 : undefined,
      capacity: nextType === 'abrigo' ? 13 : undefined,
      residentIds: nextType === 'abrigo' ? [] : undefined,
      radius: nextType === 'curral' ? 3.5 : undefined,
      complete: false, createdDay: w.day, builtDay: null, lastProgressDay: null
    };
  }

export function takeBuildMaterial(w, structure, amount) {
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

export function workOnCommunityStructure(w, person, community, size) {
    if (person.assignment && person.assignment.goal === 'repair-damaged-structures') {
      return workOnKingdomStructureRepair(w, person, community);
    }
    let structures = communityStructures(w, community);
    let structure = structures.find(s => !s.complete);
    if (!structure) {
      structure = chooseBuildSite(w, community, structures, person);
      if (!structure) { person.state = 'procurando local para construir'; person.buildCooldown = 4; return; }
      if ((community.stores.wood || 0) < structure.woodCost || (community.stores.stone || 0) < structure.stoneCost
          || communityFoodStock(community) < structure.foodCost) {
        person.state = 'faltam recursos compartilhados'; person.buildCooldown = 8; return;
      }
      if (structure.type === 'roça' && collectCommunityFieldSeeds(w, structure) < structure.seedMass) {
        person.state = 'faltam sementes silvestres próximas'; person.buildCooldown = 8; return;
      }
      if (!spendStoreInventory(community, { wood: structure.woodCost, stone: structure.stoneCost }, 'construction-materials')) {
        person.state = 'faltam recursos compartilhados'; person.buildCooldown = 8; return;
      }
      withdrawCommunityFood(w, community, structure.foodCost, 'construction-food-cost');
      initializeStructureHealth(structure);
      w.structures.push(structure);
      const kingdom = w.kingdoms.find(item => item.id === community.kingdomId);
      if (kingdom) {
        kingdom.structureIds ||= [];
        if (!kingdom.structureIds.includes(structure.id)) kingdom.structureIds.push(structure.id);
      }
      community.history.push('Começou a construção de ' + structure.type + ' perto de ' + localNameFeature(w, structure.x, structure.y) + '.');
      log(w, community.name + ' começou a construir ' + structure.type + ' em uma área de recursos próximos.');
    }
    const workstation = claimConstructionWorkstation(w, structure, person);
    if (!workstation) {
      person.state = 'aguardando uma vaga na construção';
      person.buildCooldown = 2;
      return;
    }
    const cleared = clearConstructionWorkpointResources(w, person, workstation.position);
    if (cleared.cleared) {
      person.state = 'limpando ' + constructionObstacleDescription(cleared.kinds) + ' do ponto de construção';
      person.lastLesson = 'O morador removeu somente o recurso que ocupava o ponto de trabalho.';
      person.buildCooldown = 1;
      return;
    }
    if (!workstation.arrived) {
      moveOne(w, person, cellAt(w, workstation.position.x, workstation.position.y), false);
      person.state = 'indo para o ponto de construção'; person.buildCooldown = 2; return;
    }
    // Several residents can help, but an entire building cannot materialize
    // between two daily snapshots just because many workers chose it at once.
    if (structure.lastProgressDay === w.day) {
      const contact = constructionContactPoint(structure);
      person.visualActivity = { kind: 'build', ...contact, day: w.day + 1 };
      person.state = 'auxiliando na construção de ' + structure.type;
      person.buildCooldown = 1;
      return;
    }
    structure.progress++;
    const contact = constructionContactPoint(structure);
    person.visualActivity = { kind: 'build', ...contact, day: w.day + 1 };
    structure.lastProgressDay = w.day;
    consumePersonEnergy(person, 1.6);
    consumeFoodReserve(person, .4, 'construction-effort');
    person.buildCooldown = 1;
    person.state = 'construindo ' + structure.type;
    if (structure.progress >= structure.required) {
      structure.complete = true;
      if (structure.maxHealth) structure.health = structure.maxHealth;
      structure.builtDay = w.day; community.lastBuildDay = w.day;
      if (structure.type === 'divisa') {
        const ground = community.grounds && community.grounds[structure.groundKind];
        if (ground) ground.boundaryStructureId = structure.id;
      }
      if (structure.type === 'roça') {
        const planted = sowCommunityField(w, structure);
        community.history.push('Investiu ' + Math.round(planted) + ' unidades de sementes em ' + (structure.fieldTileIndices || []).length + ' células; a produção cresce em ciclos enquanto o campo estiver plantado.');
      }
      community.history.push('Concluiu ' + structure.type + ' no dia ' + w.day + '.');
      log(w, community.name + ' concluiu ' + structure.type + (structure.type === 'divisa' ? ' ao redor de sua área de ' + (structure.groundKind === 'hunting' ? 'caça' : 'pesca') + '; cruzar o limite custa mais energia.' : '; sua área de uso alcançou novos recursos.'));
    }
  }

export function workOnReplantingField(w, person, community, fieldId = person?.assignment?.foodFieldId) {
  if (!w || !person?.alive || !community?.stores || person.communityId !== community.id) return false;
  const field = (w.structures || []).find(item => item.id === fieldId && item.type === 'roça'
    && item.communityId === community.id && item.complete && item.destroyedDay == null && item.integrity !== 0);
  const availableSeeds = Math.max(0, Number(community.stores.seeds) || 0);
  if (!field || field.cropCycleState !== 'spent' || availableSeeds <= .01) {
    person.state = !field ? 'roça para replantio indisponível' : 'aguardando sementes para replantio';
    return false;
  }

  const cropTiles = (field.fieldTileIndices || []).map(index => w.tiles[index])
    .filter(tile => tile && tile.cropFieldId === field.id && tile.terrain === 'land')
    .sort((a, b) => distance(person, a) - distance(person, b) || a.i - b.i);
  if (!cropTiles.length) {
    person.state = 'área da roça indisponível para replantio';
    return false;
  }
  const plantingTile = cropTiles.find(tile => distance(person, tile) <= 1.6);
  if (!plantingTile) {
    const moved = cropTiles.some(tile => moveOne(w, person, cellAt(w, tile.x, tile.y), false));
    person.state = moved ? 'indo semear a roça' : 'rota da roça bloqueada para replantio';
    person.buildCooldown = moved ? 1 : 3;
    return false;
  }

  const previousSeedMass = Math.max(0, Number(field.cropSeededBiomass) || Number(field.seedMass) || 0);
  const seedMass = Math.min(availableSeeds, previousSeedMass || availableSeeds);
  if (seedMass <= .01) return false;
  const movedSeeds = transferResource(community.stores, field, 'seeds', seedMass, 'cropSeedStored');
  if (movedSeeds <= .01) return false;
  const planted = sowCommunityField(w, field);
  if (planted <= .01) {
    transferResource(field, community.stores, 'cropSeedStored', movedSeeds, 'seeds');
    return false;
  }
  field.cropSeedsRetainedThisCycle = 0;
  field.cropLastSowedDay = w.day;
  if (person.assignment) person.assignment.replantSowedDay = w.day;
  person.state = 'semeando a roça';
  person.lastLesson = 'O morador debitou sementes reservadas e replantou a área existente; o crescimento começa em um novo lote finito.';
  community.history.push('Replantou a roça com ' + formatWholeMeasure(planted) + ' unidades de sementes reservadas no estoque comum.');
  log(w, community.name + ' replantou uma roça com ' + formatWholeMeasure(planted) + ' unidades de sementes; novo lote iniciado.', w.day + 1);
  return true;
}
