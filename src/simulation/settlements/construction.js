import { clamp, distance, hash01 } from '../core/math.js';
import { communityFoodStock, withdrawCommunityFood } from '../economy/inventories.js';
import { cellAt, cellsWithin } from '../world/spatial.js';
import { plantBiomass } from '../ecology/plants.js';
import { PLANTS } from '../../config/ecosystem.js';
import { localNameFeature } from '../society/communities.js';
import { log } from '../core/events.js';
import { moveOne } from '../individuals/movement.js';

export function communityBuildingNeed(w, community, size) {
    if (!community) return 0;
    const plan = nextCommunityStructure(w, community, size || community.memberIds.length, communityStructures(w, community));
    if (!plan) return 0;
    const wood = Math.max(0, plan.woodCost - (community.stores.wood || 0));
    const stone = Math.max(0, plan.stoneCost - (community.stores.stone || 0));
    return clamp((wood + stone) / Math.max(1, plan.woodCost + plan.stoneCost), 0, 1);
  }

export function communityStructures(w, community) {
    return w.structures.filter(s => s.communityId === community.id);
  }

export function canCommunityBuild(w, community, size) {
    const structures = communityStructures(w, community);
    if (structures.some(s => !s.complete)) return true;
    const limit = size >= 12 ? 5 : size >= 8 ? 4 : size >= 6 ? 3 : size >= 3 ? 1 : 0;
    const completed = structures.filter(s => s.complete).length;
    const plan = nextCommunityStructure(w, community, size, structures);
    return completed < limit && plan && (community.stores.wood || 0) >= plan.woodCost
      && (community.stores.stone || 0) >= plan.stoneCost
      && communityFoodStock(community) >= plan.foodCost && w.day - community.lastBuildDay >= 24;
  }

export function nextCommunityStructure(w, community, size, structures) {
    if (!structures.some(s => s.type === 'abrigo')) return { type: 'abrigo', woodCost: 18, stoneCost: 8, foodCost: 0, required: 28 };
    if (size >= 6 && !structures.some(s => s.type === 'curral')) return { type: 'curral', woodCost: 14, stoneCost: 5, foodCost: 0, required: 34 };
    if (!structures.some(s => s.type === 'posto de coleta')) return { type: 'posto de coleta', woodCost: 20, stoneCost: 12, foodCost: 1, required: 36 };
    if (size >= 12 && !structures.some(s => s.type === 'acampamento')) return { type: 'acampamento', woodCost: 24, stoneCost: 16, foodCost: 1, required: 44 };
    return null;
  }

export function communityBuildUtility(w, community, size) {
    const active = communityStructures(w, community).some(s => !s.complete);
    const hasShelter = communityStructures(w, community).some(s => s.type === 'abrigo' && s.complete);
    return clamp(.28 + size * .035 + (active ? .25 : 0) + (!hasShelter ? .44 : 0), .32, .92);
  }

export function chooseBuildSite(w, community, structures) {
    const completed = structures.filter(s => s.complete);
    const size = community.memberIds.filter(id => w.people.some(p => p.id === id && p.alive)).length;
    const plan = nextCommunityStructure(w, community, size, structures);
    if (!plan) return null;
    const nextType = plan.type;
    const worldStructures = w.structures;
    const candidateRadius = nextType === 'curral' ? 3.5 : 2.5;
    let best = null, bestScore = -Infinity;
    for (const t of w.tiles) {
      if (t.terrain !== 'land' || t.slope > .8 || t.kingdomId !== community.kingdomId) continue;
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
      id: w.nextId++, kingdomId: community.kingdomId, communityId: community.id, type: nextType, x: best.x, y: best.y,
      progress: 0, required: plan.required,
      woodCost: plan.woodCost, stoneCost: plan.stoneCost, foodCost: plan.foodCost,
      fruitStored: nextType === 'abrigo' ? 0 : undefined, meatStored: nextType === 'abrigo' ? 0 : undefined,
      radius: nextType === 'curral' ? 3.5 : undefined,
      complete: false, createdDay: w.day, builtDay: null
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
