import { ANIMALS, DAILY_FOOD_NEED, FOOD_RESERVE_PER_UNIT, HUMAN_FOOD, PEOPLE_ACTIONS, PLANTS } from '../../config/ecosystem.js';
import { clamp, distance, species } from '../core/math.js';
import { cellAt, cellsWithin, nearby } from '../world/spatial.js';
import { activeCommunity, localNameFeature, recordCommunityUse, splitCommunities, updateCommunityStages, updateSocialLinks } from '../society/communities.js';
import { log } from '../core/events.js';
import { rand } from '../core/random.js';
import { addHarvestedFood, carriedResources, communityFoodStock, communityMaterialStock, storeCommunityFruit, withdrawCommunityFood } from '../economy/inventories.js';
import { moveOne } from './movement.js';
import { communityHerd, domesticatedSheep } from '../ecology/animals.js';
import { communityRelation, completeCommunityTask, updateCommunityGovernance } from '../society/governance.js';
import { canCommunityBuild, communityBuildUtility, communityBuildingNeed, communityStructures, nextCommunityStructure, workOnCommunityStructure } from '../settlements/construction.js';
import { eatPlants, plantBiomass } from '../ecology/plants.js';
import { refreshHarvestSuitability } from '../world/queries.js';
import { killPerson, reproducePeople, updateDependent } from './lifecycle.js';
import Senses from './perception.js';
import { findTradePartner, performShare, performTrade } from '../economy/trade.js';
import { choosePeopleAction, updateBrain } from '../../controllers/individual/neural.js';
import { drinkWater } from '../ecology/hydrology.js';
import { queueStrategicAiRequest, recordPersonalMemory } from './strategy.js';
import { canPatrolToday, patrolSoldier } from '../kingdoms/patrols.js';

export function bestPeopleFoodCell(w, person, radius) {
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

export function bestSheepFeedCell(w, person, radius) {
    const resources = person.perception && person.perception.resources || [];
    return resources.filter(resource => resource.terrain === 'land' && resource.distance <= radius && (resource.biomass.browse || 0) > .8)
      .sort((a, b) => ((Math.min(b.biomass.browse || 0, 100) + (b.biomass.browse >= 70 ? 25 : 0)) - b.distance * 5)
        - ((Math.min(a.biomass.browse || 0, 100) + (a.biomass.browse >= 70 ? 25 : 0)) - a.distance * 5))
      .map(resource => cellAt(w, resource.x, resource.y))[0] || null;
  }

export function nearestHuntable(w, person, radius) {
    const observations = person.perception && person.perception.animals || [];
    return observations.filter(sighting => sighting.visible && sighting.distance <= radius
      && species(sighting.speciesId, ANIMALS)?.huntable)
      .map(sighting => w.animals.find(a => a.id === sighting.id && a.alive))
      .filter(Boolean).sort((a, b) => distance(person, a) - distance(person, b))[0] || null;
  }

export function nearestKnownHuntable(person, radius) {
    return (person.perception && person.perception.animals || [])
      .filter(sighting => sighting.speciesId && species(sighting.speciesId, ANIMALS)?.huntable && sighting.distance <= radius)
      .sort((a, b) => (b.confidence - a.confidence) || (a.distance - b.distance))[0] || null;
  }

export function nearestFish(w, person, radius) {
    const sightings = person.perception && person.perception.animals || [];
    return sightings.filter(s => s.visible && s.distance <= radius && species(s.speciesId, ANIMALS)?.fishable)
      .map(s => w.animals.find(a => a.id === s.id && a.alive))
      .filter(Boolean).sort((a, b) => distance(person, a) - distance(person, b))[0] || null;
  }

export function bestHuntingGround(w, person, radius) {
    const community = activeCommunity(w, person);
    const ground = community && community.grounds && community.grounds.hunting;
    if (ground && distance(person, ground) <= radius) return cellAt(w, ground.x, ground.y);
    const sighting = nearestKnownHuntable(person, radius);
    return sighting ? cellAt(w, sighting.x, sighting.y) : null;
  }

export function bestFishingBank(w, person, radius) {
    let best = null, bestScore = -Infinity;
    for (const bank of cellsWithin(w, person.x, person.y, radius, t => t.terrain === 'land')) {
      const water = nearby(w, bank.x, bank.y, 1.5, t => t.terrain === 'water' && t.fishingSuitability > .02);
      if (!water) continue;
      const score = water.fishingSuitability - distance(person, bank) * .014 - bank.slope * .025;
      if (score > bestScore) { best = { bank, water, score }; bestScore = score; }
    }
    return best;
  }

export function markCommunityGround(w, person, kind, tile) {
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

export function humanHarvestSupport(w, person, community) {
    if (!community) return 0;
    return clamp(w.people.filter(p => p.alive && p.communityId === community.id && distance(p, person) <= 3.5).length - 1, 0, 4) / 4;
  }

export function nearestShelterFor(w, person) {
    return w.structures.filter(s => s.complete && s.type === 'abrigo' && s.communityId === person.communityId)
      .sort((a, b) => distance(person, a) - distance(person, b))[0] || null;
  }

export function nearestKnownStorage(w, person, community) {
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

export function nearestKnownLog(person, radius) {
    return (person.perception && person.perception.logs || [])
      .filter(item => item.amount > .01 && item.distance <= radius)
      .sort((a, b) => (b.confidence - a.confidence) || (a.distance - b.distance))[0] || null;
  }

export function bestPerceivedWaterCue(w, agent) {
    const resources = agent.perception && agent.perception.resources || [];
    const candidates = resources.filter(r => r.visible && r.terrain === 'land' && r.distance > .8)
      .sort((a, b) => ((b.soilMoisture || 0) - b.distance * .012) - ((a.soilMoisture || 0) - a.distance * .012));
    return candidates.length ? cellAt(w, candidates[0].x, candidates[0].y) : null;
  }

export function nearestPenFor(w, person) {
    return w.structures.filter(s => s.complete && s.type === 'curral' && s.communityId === person.communityId)
      .sort((a, b) => distance(person, a) - distance(person, b))[0] || null;
  }

export function attemptHumanHunt(w, person, prey, community) {
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

export function attemptHumanFishing(w, person, fish, community) {
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

export function huntForFood(w, person, community) {
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

export function fishForFood(w, person, community) {
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

export function nearestPerceivedSheep(w, person, radius) {
    return (person.perception && person.perception.animals || []).filter(sighting => sighting.speciesId === 'sheep'
      && sighting.visible && sighting.distance <= radius && w.animals.some(animal => animal.id === sighting.id && animal.alive
        && animal.speciesId === 'sheep' && animal.herdCommunityId === null && !animal.beingLedBy))
      .sort((a, b) => a.distance - b.distance)[0] || null;
  }

export function captureSheep(w, person, community, sighting) {
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

export function leadSheep(w, person, community) {
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
    sheep.beingLedBy = null; sheep.herdCommunityId = community.id; sheep.aiEnabled = false;
    sheep.habituation = Math.max(sheep.habituation || 0, .72); sheep.lastFedDay = w.day;
    person.leadingSheepId = null; person.energy = Math.max(0, person.energy - .2);
    sheep.state = 'no curral'; person.state = 'ovelha entregue ao curral';
    person.lastLesson = 'A ovelha chegou ao curral e agora pertence ao rebanho comunitário; a ração guardada será consumida pelo rebanho.';
    community.history.push(person.name + ' conduziu uma ovelha selvagem até o curral.');
    log(w, person.name + ' entregou uma ovelha ao curral de ' + community.name + '.');
    return true;
  }

export function nearestRaidTarget(w, person, community) {
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

export function attemptRaid(w, person, community, target) {
    if (!community || !target || !target.community || !target.shelter || !target.shelter.complete) return false;
    if (distance(person, target.shelter) > 1.5) {
      moveOne(w, person, cellAt(w, target.shelter.x, target.shelter.y), false);
      person.state = 'indo observar o armazém rival';
      person.lastLesson = 'O reino só ataca um armazém que foi percebido recentemente e cuja relação já está tensa; a aproximação também consome energia.';
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
      const message = targetGroup.name + ' protegeu seu armazém; ' + person.name + ' recuou ferido e a tensão entre os reinos aumentou.';
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
    person.lastLesson = 'O reino tomou alimento do armazém. A carga ainda precisa chegar ao próprio abrigo; o reino rival perdeu estoque, as relações pioraram e a chance de retaliação cresceu.';
    const message = community.name + ' retirou ' + stolen.nutrition.toFixed(1) + ' unidades nutricionais do armazém de ' + targetGroup.name + '; o saque ainda precisa ser transportado.';
    community.history.push(message); targetGroup.history.push(message); log(w, message);
    return stolen.nutrition > .01;
  }

export function gatherMaterials(w, person, community) {
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

export function collectLooseLog(w, person, sighting) {
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

export function collectSheepFeed(w, person, community, target) {
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

export function claimForagePatch(w, person, tile, resourceKind) {
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

export function resolveResourceConflict(w, a, b, tile, resourceKind, patchValue) {
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

export function updatePeople(w) {
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
      const territoryAwareness = p.perception.territorialAwareness;
      const borderRisk = territoryAwareness && territoryAwareness.inForeignTerritory ? .8
        : territoryAwareness && territoryAwareness.nearestForeignTerritory && territoryAwareness.nearestForeignTerritory.distance <= 2 ? .35 : 0;
      const risk = clamp(predatorRisk + p.conflictRisk + borderRisk, 0, 1);
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
      const herd = community ? domesticatedSheep(w, community) : [];
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
        .08 + Math.max(0, .28 - localSuitability) * .7 + risk * .16 - borderRisk * .8,
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
      const patrolDuty = !survivalAction && !carryingGoods && canPatrolToday(w, p, !!assignment);
      const action = survivalAction || (carryingGoods ? 'deliver' : p.leadingSheepId ? 'lead_sheep'
        : patrolDuty ? 'patrol' : choosePeopleAction(w, p, inputs, utility));
      if (action === 'patrol') {
        // Patrol is a duty rather than a neural-network action; do not train the last learned action on it.
        p.brain.pending = null;
        p.brain.lastAction = 'patrol';
        p.lastDecision = { action, scores: null, inputs: inputs.slice(), day: w.day };
      }
      if (survivalAction) {
        // A forced survival action bypasses the neural policy; discard any sample
        // left by an interrupted decision so its reward cannot train the wrong action.
        p.brain.pending = null;
        p.brain.lastAction = action;
        p.lastDecision = { action, scores: null, inputs: inputs.slice(), day: w.day };
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
            p.lastLesson = dispute ? 'Garantiu o recurso, mas a disputa causou ferimentos, gasto e tensão entre reinos.' : harvest > .1 ? 'Encontrar uma mancha de alimento repôs reservas; a coleta reduziu a biomassa local.' : 'A mancha estava esgotada; procurar outra área evita insistir sem retorno.';
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
            : carryingFruit ? 'Os frutos chegaram à reserva do reino; um abrigo permite armazená-los fisicamente.'
            : 'A carga chegou ao abrigo e agora integra as reservas compartilhadas do reino.';
          if (carryingMeat) log(w, p.name + ' armazenou carne no abrigo de ' + community.name + '.');
          if (fruitInShelter) log(w, p.name + ' levou frutos ao abrigo de ' + receivingCommunity.name + '.');
        } else {
          moveOne(w, p, cellAt(w, destination.x, destination.y), false);
          p.state = carryingFeed ? 'levando ração ao curral' : 'levando recursos ao abrigo';
          p.lastLesson = 'Transportar recursos consome energia e tempo, mas torna a coleta disponível para o reino.';
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
        p.lastLesson = 'Construir consome material, alimento e energia; a estrutura passa a beneficiar o reino.';
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
      } else if (action === 'patrol') {
        patrolSoldier(w, p);
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
      if (!survivalAction && action !== 'patrol') queueStrategicAiRequest(w, p, community, utility);
      if (community) {
        const away = distance(p, community);
        const satisfaction = community.satisfaction || 0;
        if (p.role === 'soldier') {
          // Guard duty keeps soldiers attached to their kingdom even while a post is away from the settlement center.
          p.awayDays = 0;
          p.dissatisfactionDays = 0;
        } else {
          p.awayDays = away > 10 ? p.awayDays + 1 : Math.max(0, p.awayDays - 2);
          if (satisfaction < .28 && p.awayDays > 12 && (p.foodReserve < 28 || p.socialNeed > 78)) p.dissatisfactionDays = (p.dissatisfactionDays || 0) + 1;
          else p.dissatisfactionDays = Math.max(0, (p.dissatisfactionDays || 0) - 2);
        }
        if (p.role !== 'soldier' && ((p.awayDays > 45 && satisfaction < .4) || (p.dissatisfactionDays > 20 && p.awayDays > 20))) {
          const leavingKingdom = w.kingdoms.find(kingdom => kingdom.id === p.kingdomId);
          const home = w.structures.find(structure => structure.id === p.homeId && structure.type === 'casa');
          if (home) home.residentIds = home.residentIds.filter(id => id !== p.id);
          if (leavingKingdom) leavingKingdom.memberIds = leavingKingdom.memberIds.filter(id => id !== p.id);
          p.communityId = null; p.kingdomId = null; p.homeId = null; p.awayDays = 0;
          community.memberIds = community.memberIds.filter(id => id !== p.id);
          p.assignment = null;
          p.lastLesson = 'A insatisfação prolongada levou você a sair do reino; a falta de alimento ou apoio pesou nessa decisão.';
          log(w, p.name + ' deixou ' + community.name + ' após um período de insatisfação e passou a viver em terra comum.');
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

export function nearestPerson(w, p, radius) {
    const sightings = p.perception && p.perception.people || [];
    return sightings.filter(s => s.visible && s.distance <= radius)
      .map(s => w.people.find(q => q.id === s.id && q.alive))
      .filter(Boolean).sort((a, b) => distance(p, a) - distance(p, b))[0] || null;
  }

export function nearestWater(w, p, radius) {
    const known = p.perception && p.perception.knownWater || [];
    return known.filter(point => point.distance <= (radius || Infinity))
      .sort((a, b) => (a.distance - b.distance) || (b.confidence - a.confidence))
      .map(point => cellAt(w, point.x, point.y))
      .find(tile => tile && (tile.terrain === 'water' || (tile.surfaceWaterMm || 0) >= 1.5)) || null;
  }

export function bestHabitatCell(w, p) {
    let best = null, score = -Infinity;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const t = cellAt(w, p.x + dx, p.y + dy);
      if (!t || t.terrain !== 'land') continue;
      const foreignPenalty = p.kingdomId != null && t.kingdomId != null && t.kingdomId !== p.kingdomId ? .85 : 0;
      const s = plantBiomass(t, ['grass', 'berry']) * .005 + (t.soilWaterMm / t.soilCapacityMm) * .3 - t.slope * .2 - foreignPenalty + rand(w) * .08;
      if (s > score) { best = t; score = s; }
    }
    return best;
  }
