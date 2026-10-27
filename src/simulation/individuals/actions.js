import { nearestLoot, collectLoot } from '../economy/loot.js';
import { ANIMALS, DAILY_FOOD_NEED, FOOD_RESERVE_PER_UNIT, HUMAN_FOOD, MEAT_NUTRITIONAL_VALUE, PEOPLE_ACTIONS, PLANTS, SHEEP_ADULT_AGE_DAYS } from '../../config/ecosystem.js';
import { clamp, distance, species } from '../core/math.js';
import { cellAt, cellsWithin, nearby } from '../world/spatial.js';
import { resourceUsePressure } from '../world/roads.js';
import { activeCommunity, localNameFeature, recordCommunityUse, splitCommunities, updateCommunityStages, updateSocialLinks } from '../society/communities.js';
import { log } from '../core/events.js';
import { rand } from '../core/random.js';
import { addFoodReserve, addHarvestedFood, addResource, carriedResources, communityFoodStock, communityMaterialStock, consumeEdibleCargo, consumeFoodReserve, moveCarriedResource, storeCommunityFruit, transferResource, withdrawCommunityFood } from '../economy/inventories.js';
import { moveOne } from './movement.js';
import { bushHarvestHitbox, collidesWithWorldAt, hitboxesOverlap, mineralHitbox, npcHitbox, worldCollisionIndex } from '../physics/hitboxes.js';
import { communityHerd, domesticatedSheep } from '../ecology/animals.js';
import { communityRelation, completeCommunityTask, updateCommunityGovernance } from '../society/governance.js';
import { canCommunityBuild, communityBuildUtility, communityBuildingNeed, communityStructures, nextCommunityStructure, workOnCommunityStructure } from '../settlements/construction.js';
import { availableCommunityPen } from '../ecology/herd.js';
import { eatPlants, isBushAnchor, plantBiomass } from '../ecology/plants.js';
import { refreshHarvestSuitability } from '../world/queries.js';
import { changePersonHealth, killPerson, reproducePeople, updateDependent } from './lifecycle.js';
import Senses from './perception.js';
import { ensureFoodAidPlan, findTradePartner, performShare, performTrade, resolveFoodAidRequest } from '../economy/trade.js';
import { choosePeopleAction, updateBrain } from '../../controllers/individual/neural.js';
import { drinkWater } from '../ecology/hydrology.js';
import { recordPersonalMemory } from './strategy.js';
import { canPatrolToday, patrolSoldier } from '../kingdoms/patrols.js';
import {
  buyMilitaryMeal, clearCivilianDuties, drawGarrisonRation, GARRISON_RATION_TARGET,
  GARRISON_RECOVERY, militaryDutyCenterFor, PEACETIME_SOLDIER_FOOD_NEED, resolveMilitaryServiceEvaluation, restPersonInHouse
} from '../kingdoms/service.js';
import { campaignOrderFor, drawCampaignRation, performCampaignOrder, recordCampaignPersonalRation } from '../kingdoms/campaigns.js';
import { canEnterForeignTerritory, kingdomRelation } from '../kingdoms/territories.js';
import { createPersonSpatialIndex, peopleNear } from './spatial-index.js';
import { invalidateNavigation } from './navigation-cache.js';
import { clearMilitaryCommand } from '../kingdoms/military-identity.js';
import { updateResidencyAbsence } from '../society/residency.js';
import { resolveSocialMeeting } from '../society/social-meetings.js';
import { indicateKnownWaterReference } from '../society/water-indication.js';
import { consumePersonEnergy } from './energy.js';
import { chooseMilitaryAction, learnMilitaryOutcome, militaryTrainingPairs, trainMilitaryPair } from '../kingdoms/military-learning.js';
import { advanceSocialIntention, defineSocialIntention, maintainSocialIntentions, physicalIntentionBlockers } from '../society/social-evidence.js';

const STARVATION_HEALTH_LOSS_PER_POINT = .035;
const PERSONAL_FOOD_PRESSURE_THRESHOLD = 42;
const CRITICAL_FOOD_RESERVE_THRESHOLD = 8;
const FORAGE_TARGET_HYSTERESIS = .14;
const MAX_FAILED_FOOD_TARGETS = 8;
const FAILED_FOOD_TARGET_COOLDOWN_DAYS = 2;
const RESOURCE_CONFLICT_TRUCE_DAYS = 14;
const HARVEST_REACH_DISTANCE = 1.05;

function mineralCollisionClass(tile) {
    const hitbox = mineralHitbox(tile);
    return hitbox ? hitbox.resourceKind + ':' + hitbox.radius : '';
}

function touchesHarvestBush(w, person, tile, plantId) {
    return isBushAnchor(w, tile, plantId)
      && hitboxesOverlap(npcHitbox(person), bushHarvestHitbox(w, tile, plantId));
  }

function canHarvestFoodAt(w, person, tile) {
    return tile?.cropFieldId != null
      ? distance(person, tile) <= HARVEST_REACH_DISTANCE
      : touchesHarvestBush(w, person, tile, 'berry');
  }

function hideCollectedBush(w, tile, plantId) {
    const hiddenUntilField = plantId === 'browse' ? 'browseBushHiddenUntilDay' : 'berryBushHiddenUntilDay';
    tile[hiddenUntilField] = w.day + 7;
  }

function findPersonById(w, id) {
    if (w.peopleById instanceof Map) {
      const person = w.peopleById.get(id);
      return person?.alive ? person : undefined;
    }
    return w.people.find(person => person.id === id && person.alive);
  }


function kingdomRepairProgress(w, community) {
    if (!community) return 0;
    return (w.structures || []).filter(structure => structure.kingdomId === community.kingdomId && structure.complete
      && structure.destroyedDay == null).reduce((sum, structure) => {
      const integrity = Number.isFinite(structure.integrity) ? structure.integrity : 1;
      const health = Number.isFinite(structure.maxHealth) && structure.maxHealth > 0
        ? (Number.isFinite(structure.health) ? structure.health / structure.maxHealth : 1) : 0;
      return sum + integrity + health;
    }, 0);
  }

function recordPlantFoodBiomass(w, amount, cultivatedAmount = 0, tile = null) {
    if (!(amount > 0)) return;
    w.harvests.plantFoodBiomass = (w.harvests.plantFoodBiomass || 0) + amount;
    if (cultivatedAmount > 0) {
      w.harvests.cultivatedFoodBiomass = (w.harvests.cultivatedFoodBiomass || 0) + cultivatedAmount;
      const field = tile && (w.structures || []).find(structure => structure.id === tile.cropFieldId && structure.type === 'roça');
      if (field) field.cropHarvested = (field.cropHarvested || 0) + cultivatedAmount;
    }
  }

function harvestHumanFood(w, tile, capacity) {
    const cultivatedBefore = plantBiomass(tile, ['cultivated-root']);
    const harvest = eatPlants(w, tile, HUMAN_FOOD, capacity);
    const cultivatedHarvest = Math.max(0, cultivatedBefore - plantBiomass(tile, ['cultivated-root']));
    recordPlantFoodBiomass(w, harvest, cultivatedHarvest, tile);
    return harvest;
  }

export function personalFoodHarvestLimit(person, requested, reserveCapacity, directStorage = false) {
    if (!person || !Number.isFinite(requested) || requested <= 0
        || !Number.isFinite(reserveCapacity) || reserveCapacity < 0) return 0;
    const alreadyCarried = Number.isFinite(person.carriedFruit) ? Math.max(0, person.carriedFruit) : 0;
    const carryCapacity = directStorage ? requested : Math.max(0, 24 - alreadyCarried);
    return Math.min(requested, reserveCapacity + carryCapacity);
  }

export function bestPeopleFoodCell(w, person, radius, fieldId = null) {
    let best = null, bestScore = -Infinity;
    let bestSurvivalTarget = null, bestSurvivalScore = -Infinity, continuingSurvivalTarget = null;
    const criticalFoodPressure = person.foodReserve <= CRITICAL_FOOD_RESERVE_THRESHOLD;
    const resources = person.perception && person.perception.resources || [];
    const failedTargets = (person.failedFoodTargets || []).filter(target => Number.isInteger(target.x)
      && Number.isInteger(target.y) && Number.isInteger(target.untilDay) && target.untilDay >= w.day
      && (target.navigationRevision == null || target.navigationRevision === w.navigationRevision)
      && (target.failedFromX == null || target.failedFromX === Math.round(person.x))
      && (target.failedFromY == null || target.failedFromY === Math.round(person.y)));
    if (failedTargets.length !== (person.failedFoodTargets || []).length) person.failedFoodTargets = failedTargets;
    const failedTargetKeys = new Set(failedTargets.map(target => target.x + ',' + target.y));
    const harvestCapacity = clamp(1.8 + person.skills.forage * 3.2, 1.8, 5);
    for (const resource of resources) {
      const tile = cellAt(w, resource.x, resource.y);
      if (failedTargetKeys.has(resource.x + ',' + resource.y)) continue;
      if (fieldId != null && tile?.cropFieldId !== fieldId) continue;
      if (tile?.cropFieldId == null && !isBushAnchor(w, tile, 'berry')) continue;
      const availableFood = resource.harvestableBiomass || resource.biomass;
      const food = HUMAN_FOOD.reduce((sum, id) => sum + (availableFood[id] || 0), 0);
      if (resource.terrain !== 'land' || resource.distance > radius || food < .8) continue;
      const warningPenalty = tile && canEnterForeignTerritory(w, person, tile) ? 0 : 3;
      const expectedHarvestReserve = Math.min(food, harvestCapacity) * FOOD_RESERVE_PER_UNIT;
      const expectedTravelDays = Math.ceil(Math.max(0, resource.distance - HARVEST_REACH_DISTANCE) / Math.SQRT2);
      const travelCost = expectedTravelDays * DAILY_FOOD_NEED;
      const canCoverSurvivalTrip = expectedHarvestReserve >= travelCost + DAILY_FOOD_NEED;
      const continuingProductiveTarget = person.foodReserve < PERSONAL_FOOD_PRESSURE_THRESHOLD
        && person.foodTarget && person.foodTarget.x === resource.x && person.foodTarget.y === resource.y
        && expectedHarvestReserve > travelCost;
      const continuityBonus = continuingProductiveTarget ? FORAGE_TARGET_HYSTERESIS : 0;
      const usePressurePenalty = tile?.cropFieldId == null ? resourceUsePressure(tile) * .34 : 0;
      const score = Math.min(food, harvestCapacity) * .018 - resource.distance * .065 - resource.slope * .09
        - warningPenalty - usePressurePenalty + continuityBonus;
      const matchesCurrentTarget = person.foodTarget && person.foodTarget.x === resource.x && person.foodTarget.y === resource.y;
      const improvesSelection = score > bestScore;
      const improvesSurvivalSelection = criticalFoodPressure && canCoverSurvivalTrip && score > bestSurvivalScore;
      if (!improvesSelection && !improvesSurvivalSelection && !(criticalFoodPressure && canCoverSurvivalTrip && matchesCurrentTarget)) continue;
      if (!foodApproachTiles(w, person, tile).length) continue;
      const candidate = cellAt(w, resource.x, resource.y);
      if (improvesSelection) { best = candidate; bestScore = score; }
      if (criticalFoodPressure && canCoverSurvivalTrip) {
        if (matchesCurrentTarget) continuingSurvivalTarget = candidate;
        if (score > bestSurvivalScore) { bestSurvivalTarget = candidate; bestSurvivalScore = score; }
      }
    }
    if (criticalFoodPressure) return continuingSurvivalTarget || bestSurvivalTarget || best;
    return best;
  }

function foodApproachTiles(w, person, foodTile) {
  if (!w || !person || !foodTile) return [];
  const cropField = foodTile.cropFieldId != null;
  if (!cropField && !isBushAnchor(w, foodTile, 'berry')) return [];
  const harvestHitbox = cropField ? null : bushHarvestHitbox(w, foodTile, 'berry');
  if (!cropField && !harvestHitbox) return [];
  const collisionIndex = worldCollisionIndex(w);
  const candidates = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const tile = cellAt(w, foodTile.x + dx, foodTile.y + dy);
    if (!tile || tile.terrain !== 'land' || collidesWithWorldAt(w, person, tile.x, tile.y, collisionIndex)
        || !canEnterForeignTerritory(w, person, tile)) continue;
    const reachesFood = cropField ? distance(tile, foodTile) <= HARVEST_REACH_DISTANCE
      : hitboxesOverlap(npcHitbox(person, tile.x, tile.y), harvestHitbox);
    if (!reachesFood) continue;
    candidates.push(tile);
  }
  return candidates.sort((a, b) => distance(person, a) - distance(person, b)
    || distance(a, foodTile) - distance(b, foodTile) || a.y - b.y || a.x - b.x);
}

export function moveTowardFood(w, person, foodTile) {
  for (const approach of foodApproachTiles(w, person, foodTile)) {
    if (moveOne(w, person, approach, false)) {
      person.failedFoodTargets = (person.failedFoodTargets || []).filter(target =>
        target.x !== foodTile.x || target.y !== foodTile.y);
      return true;
    }
  }
  const failedTargets = (person.failedFoodTargets || []).filter(target => target.untilDay >= w.day
    && (target.navigationRevision == null || target.navigationRevision === w.navigationRevision)
    && (target.failedFromX == null || target.failedFromX === Math.round(person.x))
    && (target.failedFromY == null || target.failedFromY === Math.round(person.y))
    && (target.x !== foodTile.x || target.y !== foodTile.y));
  failedTargets.push({ x: foodTile.x, y: foodTile.y, untilDay: w.day + FAILED_FOOD_TARGET_COOLDOWN_DAYS,
    failedFromX: Math.round(person.x), failedFromY: Math.round(person.y), navigationRevision: w.navigationRevision });
  person.failedFoodTargets = failedTargets.slice(-MAX_FAILED_FOOD_TARGETS);
  return false;
}

export function collectFoodForCommunity(w, person, tile) {
    if (!person || !tile) return 0;
    if (tile.cropFieldId == null && !touchesHarvestBush(w, person, tile, 'berry')) return 0;
    const capacity = Math.max(0, 24 - (person.carriedFood || 0));
    if (capacity <= .01) return 0;
    const harvest = harvestHumanFood(w, tile, Math.min(capacity, clamp(1.8 + person.skills.forage * 3.2, 1.8, 5)));
    const carried = addResource(person, 'carriedFood', harvest, 24);
    if (carried <= .01) return 0;
    if (tile.cropFieldId == null) hideCollectedBush(w, tile, 'berry');
    person.visualActivity = { kind: 'harvest', x: tile.x, y: tile.y, day: w.day + 1,
      ...(tile.cropFieldId == null ? { tool: 'knife' } : {}) };
    consumePersonEnergy(person, .22);
    person.skills.forage = clamp(person.skills.forage + .004, 0, 1);
    person.state = 'levando alimento para o reino';
    person.lastLesson = 'A coleta delegada virou carga para o estoque comum; ela só estará disponível depois do transporte.';
    const field = tile.cropFieldId == null ? null : w.structures.find(s => s.id === tile.cropFieldId
      && s.type === 'roça' && s.complete && s.communityId === person.communityId
      && s.destroyedDay == null && s.integrity !== 0);
    const community = field && distance(person, tile) <= 1.6 ? activeCommunity(w, person) : null;
    if (community) {
      moveCarriedResource(person, 'carriedFood', community, 'food', person.carriedFood);
      person.state = 'colhendo para a reserva da roça';
      person.lastLesson = 'A colheita foi retirada do talhão e guardada na própria roça para abastecer a comunidade.';
    }
    return carried;
  }

export function updateKingdomFoodSupplyPhase(assignment, foodReserve, carriedFood = 0) {
    if (!assignment || assignment.source !== 'kingdom-strategy') return null;
    if (assignment.action === 'forage') {
      assignment.supplyPhase = foodReserve > 35 ? 'communal-collection' : 'personal-recovery';
    } else if (assignment.action === 'deliver' && carriedFood > .01) {
      assignment.supplyPhase = 'communal-delivery';
    } else return null;
    return assignment.supplyPhase;
  }

export function bestSheepFeedCell(w, person, radius) {
    const resources = person.perception && person.perception.resources || [];
    return resources.filter(resource => resource.terrain === 'land' && resource.distance <= radius
        && (resource.biomass.browse || 0) > .8 && isBushAnchor(w, cellAt(w, resource.x, resource.y), 'browse'))
      .sort((a, b) => ((Math.min(b.biomass.browse || 0, 100) + (b.biomass.browse >= 70 ? 25 : 0)) - b.distance * 5
          - resourceUsePressure(cellAt(w, b.x, b.y)) * 28)
        - ((Math.min(a.biomass.browse || 0, 100) + (a.biomass.browse >= 70 ? 25 : 0)) - a.distance * 5
          - resourceUsePressure(cellAt(w, a.x, a.y)) * 28))
      .map(resource => cellAt(w, resource.x, resource.y))[0] || null;
  }

export function nearestHuntable(w, person, radius) {
    const observations = person.perception && person.perception.animals || [];
    return observations.filter(sighting => sighting.visible && sighting.distance <= radius
      && species(sighting.speciesId, ANIMALS)?.huntable)
      .map(sighting => w.animals.find(a => a.id === sighting.id && a.alive))
      .filter(animal => animal && animal.herdCommunityId == null && !animal.beingLedBy)
      .sort((a, b) => distance(person, a) - distance(person, b))[0] || null;
  }

export function nearestKnownHuntable(w, person, radius) {
    return (person.perception && person.perception.animals || [])
      .filter(sighting => sighting.speciesId && species(sighting.speciesId, ANIMALS)?.huntable && sighting.distance <= radius)
      .filter(sighting => {
        const animal = w.animals.find(item => item.id === sighting.id && item.alive);
        return animal && animal.herdCommunityId == null && !animal.beingLedBy;
      })
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
    const sighting = nearestKnownHuntable(w, person, radius);
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
    const livingMembers = community ? community.memberIds.filter(id => findPersonById(w, id)?.alive).length : 0;
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
    return clamp(peopleNear(w, person.x, person.y, 3.5)
      .filter(p => p.alive && p.communityId === community.id && distance(p, person) <= 3.5).length - 1, 0, 4) / 4;
  }

export function nearestShelterFor(w, person) {
    return w.structures.filter(s => usableShelter(s) && person.communityId != null && s.communityId === person.communityId)
      .sort((a, b) => distance(person, a) - distance(person, b))[0] || null;
  }

export function nearestEmergencyHerdSheep(w, person, community, radius = 2.25) {
    if (!w || !person || !community || person.communityId !== community.id || person.foodReserve >= 48
        || (person.carriedMeat || 0) > .01 || !nearestShelterFor(w, person)) return null;
    const adults = domesticatedSheep(w, community).filter(animal => animal.ageDays >= SHEEP_ADULT_AGE_DAYS && !animal.beingLedBy);
    if (adults.length <= 2) return null;
    const visibleHerd = new Set((person.perception && person.perception.animals || [])
      .filter(sighting => sighting.visible && sighting.speciesId === 'sheep').map(sighting => sighting.id));
    if (!visibleHerd.size) return null;
    const residents = (w.people || []).filter(item => item.alive && item.communityId === community.id);
    const dailyDemand = residents.reduce((total, item) => total + (item.ageDays >= 12 * 365 ? DAILY_FOOD_NEED : .42), 0);
    const storedShelterMeat = (w.structures || []).filter(shelter => usableShelter(shelter) && shelter.communityId === community.id)
      .reduce((total, shelter) => total + Math.max(0, Number(shelter.meatStored) || 0), 0);
    const unregisteredShelterMeat = Math.max(0, storedShelterMeat - Math.max(0, Number(community.stores.meat) || 0));
    if (communityFoodStock(community) + unregisteredShelterMeat * MEAT_NUTRITIONAL_VALUE + .001 >= dailyDemand) return null;
    return adults.filter(animal => visibleHerd.has(animal.id) && distance(person, animal) <= radius)
      .sort((a, b) => distance(person, a) - distance(person, b) || a.id - b.id)[0] || null;
  }

function usableShelter(structure) {
    return structure.complete && structure.type === 'abrigo' && structure.destroyedDay == null
      && structure.integrity !== 0 && structure.health !== 0;
  }

export function nearestKnownStorage(w, person, community) {
    if (community) {
      const shelter = nearestShelterFor(w, person);
      return { community, shelter, pen: nearestPenFor(w, person), destination: shelter || community };
    }
    const sightings = person.perception && person.perception.knownStorages || [];
    for (const sighting of sightings.slice().sort((a, b) =>
      ((person.carriedMeat || 0) > .01 ? Number(b.kind === 'shelter') - Number(a.kind === 'shelter') : 0)
        || a.distance - b.distance)) {
      const owner = w.communities.find(c => c.id === sighting.communityId && !c.dissolved);
      if (!owner) continue;
      const shelter = sighting.kind === 'shelter'
        ? w.structures.find(s => s.id === sighting.id && s.communityId === owner.id && usableShelter(s)) || null
        : null;
      if (sighting.kind === 'shelter' && !shelter || (person.carriedMeat || 0) > .01 && !shelter) continue;
      return { community: owner, shelter, pen: null, destination: shelter || owner };
    }
    return { community: null, shelter: null, pen: null, destination: null };
  }

export function cargoDeliveryPlan(w, person, community, storage = nearestKnownStorage(w, person, community)) {
    const meat = (person.carriedMeat || 0) > .01;
    const feedOnly = (person.carriedFeed || 0) > .01 && !meat
      && !(person.carriedFruit > .01) && !(person.carriedFood > .01);
    const destination = meat ? storage.shelter : feedOnly ? storage.pen || storage.destination : storage.destination;
    return destination && storage.community && (!meat || storage.shelter)
      ? { destination, community: storage.community, shelter: storage.shelter } : null;
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
    if (!prey || !prey.alive || prey.beingLedBy || person.carriedMeat > .01) return false;
    const livestock = prey.herdCommunityId != null;
    if (livestock && (prey.speciesId !== 'sheep'
        || nearestEmergencyHerdSheep(w, person, community, 2.25)?.id !== prey.id)) return false;
    if (!nearestShelterFor(w, person)) {
      person.state = 'sem abrigo para armazenar caça';
      person.lastLesson = 'Sem um abrigo, a caça não pode ser guardada; procurar alimento ou migrar evita insistir sem retorno.';
      return false;
    }
    const tile = cellAt(w, Math.round(prey.x), Math.round(prey.y));
    const profile = species(prey.speciesId, ANIMALS);
    const support = humanHarvestSupport(w, person, community);
    const probability = clamp(profile.catchability + person.skills.hunt * .22 + person.physicalStrength * .1
      + support * .1 + (tile ? tile.huntingSuitability : 0) * .14 - person.injury * .003, .06, .86);
    person.visualActivity = { kind: 'hunt', x: prey.x, y: prey.y, day: w.day + 1 };
    consumePersonEnergy(person, 1.05);
    person.hydration = Math.max(0, person.hydration - .12);
    if (rand(w) >= probability) {
      person.skills.hunt = clamp(person.skills.hunt + .003, 0, 1);
      person.state = 'caça sem captura';
      person.lastLesson = 'A presa escapou; perseguir custou energia e hidratação. Uma área com mais presas ou ajuda de outros membros melhora a próxima tentativa.';
      return false;
    }
    const meat = clamp(prey.massKg * .48, 1.2, 28);
    const meatAdded = addResource(person, 'carriedMeat', meat, 28);
    if (meatAdded + .001 < meat) return false;
    prey.alive = false; w.deaths++; w.deathsByCause.harvest++;
    if (livestock) {
      w.harvests.livestock = (w.harvests.livestock || 0) + 1;
      w.harvests.livestockMeat = Number(((w.harvests.livestockMeat || 0) + meatAdded).toFixed(2));
    } else {
      w.harvests.hunting++;
      if (tile) tile.detritusGPerM2 += prey.massKg * 8;
    }
    person.skills.hunt = clamp(person.skills.hunt + .012, 0, 1);
    person.state = livestock ? 'levando carne do rebanho ao abrigo' : 'carregando carne';
    person.lastLesson = 'A captura converteu um animal em carne carregada; a reserva só recebe o alimento quando a carga chega ao abrigo.';
    if (!livestock) markCommunityGround(w, person, 'hunting', tile);
    log(w, person.name + (livestock ? ' abateu uma ovelha adulta excedente de ' + community.name : ' caçou ' + profile.name.toLowerCase())
      + ' e carregou ' + meat.toFixed(1) + ' unidades de carne para armazenar em um abrigo.');
    return true;
  }

export function attemptHumanFishing(w, person, fish, community) {
    if (!fish || !fish.alive) return false;
    person.visualActivity = { kind: 'fish', x: fish.x, y: fish.y, day: w.day + 1 };
    const tile = cellAt(w, Math.round(fish.x), Math.round(fish.y));
    const support = humanHarvestSupport(w, person, community);
    const probability = clamp(.12 + person.skills.fish * .24 + support * .08 + (tile ? tile.fishingSuitability : 0) * .46, .06, .84);
    consumePersonEnergy(person, .72);
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
    const fishingWater = tile?.waterKind === 'ocean' ? 'o oceano' : tile?.waterKind === 'lake' ? 'um lago' : 'um trecho de rio';
    log(w, person.name + ' pescou em ' + fishingWater + ' e obteve ' + meat.toFixed(1) + ' unidades de alimento.');
    return true;
  }

export function huntForFood(w, person, community) {
    if (!nearestShelterFor(w, person)) {
      const food = bestPeopleFoodCell(w, person, 8);
      const destination = food || bestHabitatCell(w, person);
      if (destination) moveOne(w, person, destination, false);
      person.state = food ? 'procurando alimento' : 'migrando para recursos';
      person.lastLesson = 'Sem abrigo para armazenar caça, buscar alimento vegetal ou migrar oferece uma saída útil.';
      return false;
    }
    const prey = nearestHuntable(w, person, 2.25);
    if (prey) return attemptHumanHunt(w, person, prey, community);
    const herdPrey = nearestEmergencyHerdSheep(w, person, community, 2.25);
    if (herdPrey) return attemptHumanHunt(w, person, herdPrey, community);
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
    const pen = availableCommunityPen(w, community.id, person);
    const sheep = w.animals.find(animal => animal.id === sighting.id && animal.alive && animal.speciesId === 'sheep');
    if (!sheep || sheep.herdCommunityId !== null || sheep.beingLedBy || person.leadingSheepId) return false;
    if (!pen) { person.state = 'curral sem espaço'; return false; }
    if (distance(person, sheep) > 1.45) {
      moveOne(w, person, cellAt(w, Math.round(sheep.x), Math.round(sheep.y)), false);
      person.state = 'aproximando-se da ovelha';
      person.lastLesson = 'A ovelha só pode ser conduzida a partir de perto; a aproximação custa energia e ela ainda pode fugir.';
      return false;
    }
    sheep.herdPenId = pen.id;
    person.leadingSheepPenId = pen.id;
    sheep.beingLedBy = person.id; person.leadingSheepId = sheep.id;
    consumePersonEnergy(person, .9); person.hydration = Math.max(0, person.hydration - .18);
    sheep.state = 'sendo conduzida';
    person.state = 'conduzindo ovelha';
    person.lastLesson = 'A ovelha foi alcançada. Conduzi-la até o curral exige tempo e energia; lá ela poderá consumir brotos guardados.';
    log(w, person.name + ' alcançou uma ovelha selvagem e começou a conduzi-la ao curral de ' + community.name + '.');
    return true;
  }

export function leadSheep(w, person, community) {
    const sheep = w.animals.find(animal => animal.id === person.leadingSheepId && animal.alive && animal.beingLedBy === person.id);
    const pen = community && (w.structures.find(structure => structure.id === (sheep?.herdPenId || person.leadingSheepPenId)
      && structure.complete && structure.destroyedDay == null && structure.integrity !== 0
      && structure.type === 'curral' && structure.communityId === community.id)
      || availableCommunityPen(w, community.id, person));
    if (!sheep || !pen) {
      if (sheep) { sheep.beingLedBy = null; sheep.herdPenId = null; sheep.state = 'fugiu durante a condução'; }
      person.leadingSheepId = null; person.leadingSheepPenId = null; person.state = 'sem ovelha para conduzir'; return false;
    }
    if (distance(person, pen) > 1.4) {
      moveOne(w, person, cellAt(w, pen.x, pen.y), false);
      consumePersonEnergy(person, .38);
      person.hydration = Math.max(0, person.hydration - .08);
      sheep.x = person.x + .25; sheep.y = person.y + .15;
      sheep.state = 'seguindo o condutor'; person.state = 'conduzindo ovelha ao curral';
      person.lastLesson = 'A condução aproxima a ovelha do curral e consome energia; manter o trajeto curto reduz o custo.';
      return false;
    }
    sheep.x = pen.x + .2; sheep.y = pen.y + .2;
    sheep.beingLedBy = null; sheep.herdCommunityId = community.id; sheep.herdPenId = pen.id; sheep.aiEnabled = false;
    person.leadingSheepPenId = null;
    sheep.habituation = Math.max(sheep.habituation || 0, .72); sheep.lastFedDay = w.day;
    person.leadingSheepId = null; consumePersonEnergy(person, .2);
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
    const attackers = peopleNear(w, person.x, person.y, 4)
      .filter(member => member.alive && member.communityId === community.id && distance(member, person) <= 4);
    const defenders = peopleNear(w, target.shelter.x, target.shelter.y, 4)
      .filter(member => member.alive && member.communityId === targetGroup.id && distance(member, target.shelter) <= 4);
    const strength = group => group.reduce((sum, member) => sum + member.physicalStrength * .55 + member.energy * .006 + member.skills.diplomacy * .12, 0);
    const attackPower = strength(attackers), defensePower = strength(defenders) + (target.shelter.complete ? .45 : 0);
    consumePersonEnergy(person, 3.8); person.hydration = Math.max(0, person.hydration - .45);
    if (defensePower >= attackPower * 1.08) {
      w.raidAttempts++;
      person.injury += 1.5 + Math.min(3, defensePower - attackPower) * .45;
      changePersonHealth(w, person, -person.injury * .25, 'raid');
      relation.tension = clamp(relation.tension + .16, 0, 1); relation.trust = Math.max(0, relation.trust - .12); relation.conflicts++;
      person.state = 'assalto repelido'; person.lastRaidSuccess = false; w.conflicts++;
      const message = targetGroup.name + ' protegeu seu armazém; ' + person.name + ' recuou ferido e a tensão entre os reinos aumentou.';
      community.history.push(message); targetGroup.history.push(message); log(w, message);
      return false;
    }
    const loot = Math.min(8 + attackers.length * 2, availableFood * .3, 18);
    const stolen = withdrawCommunityFood(w, targetGroup, loot, 'raid-loss');
    w.raidAttempts++; w.successfulRaids++;
    const store = target.shelter;
    store.raidLoss = (store.raidLoss || 0) + stolen.nutrition;
    addResource(person, 'carriedMeat', stolen.meat, 28);
    addResource(person, 'carriedFruit', stolen.fruit, 24);
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
    const previousMineralCollision = best.kind === 'wood' ? null : mineralCollisionClass(tile);
    let gathered = 0;
    if (best.kind === 'wood') {
      const id = (best.biomass.broadleaf || 0) >= (best.biomass.conifer || 0) ? 'broadleaf' : 'conifer';
      const broadIndex = PLANTS.findIndex(p => p.id === 'broadleaf'), coniferIndex = PLANTS.findIndex(p => p.id === 'conifer');
      const biomass = tile.plants[broadIndex] + tile.plants[coniferIndex];
      tile.plants[broadIndex] = Math.min(tile.plants[broadIndex], Math.max(18, tile.plants[broadIndex] * .075));
      tile.plants[coniferIndex] = Math.min(tile.plants[coniferIndex], Math.max(18, tile.plants[coniferIndex] * .075));
      tile.stump = { type: id, untilDay: w.day + 95 };
      invalidateNavigation(w);
      gathered = clamp(5 + biomass * .016, 7, 24);
      const logItem = { id: w.nextId++, x: tile.x, y: tile.y, amount: 0, type: 'tree', treeType: id, createdDay: w.day, available: true };
      addResource(logItem, 'amount', gathered);
      w.logs.push(logItem);
      tile.detritusGPerM2 += Math.max(0, biomass - tile.plants[broadIndex] - tile.plants[coniferIndex]) * .025;
      person.state = 'derrubando árvore';
      person.lastLesson = 'A árvore virou um tronco solto. Ele ainda precisa ser recolhido e levado ao abrigo para entrar no estoque.';
      log(w, person.name + ' derrubou uma árvore; um tronco ficou no chão para qualquer pessoa próxima recolher.');
    } else if (best.kind === 'stone') {
      const intended = Math.min(4.5, tile.stoneDeposit, 2.2 + person.skills.gather * 1.8);
      if (tile.stoneDeposit >= 8) {
        gathered = Math.min(intended, tile.stoneDeposit);
        tile.stoneDeposit -= gathered;
        (w.loot ||= []).push({ id: w.nextId++, x: tile.x, y: tile.y,
          resources: { stone: gathered }, available: true, droppedDay: w.day });
        person.state = 'minerando rocha'; person.lastLesson = 'A rocha grande se quebrou em pedras menores; qualquer pessoa pode recolhê-las do chão.';
      } else {
        gathered = transferResource(tile, person, 'stoneDeposit', intended, 'carriedStone');
        person.state = 'extraindo pedra'; person.lastLesson = 'A jazida diminuiu e a pedra extraída agora precisa ser transportada ao abrigo.';
      }
    } else {
      const intended = Math.min(1.8, tile.goldOre, .5 + person.skills.gather * .7);
      gathered = transferResource(tile, person, 'goldOre', intended, 'carriedGold');
      person.state = 'extraindo ouro'; person.lastLesson = 'A jazida de ouro é finita; o minério guardado poderá financiar compras no posto de coleta.';
    }
    if (gathered <= .01) return 0;
    if (previousMineralCollision !== null && previousMineralCollision !== mineralCollisionClass(tile)) invalidateNavigation(w);
    person.visualActivity = { kind: best.kind === 'wood' ? 'chop' : 'mine', x: tile.x, y: tile.y, day: w.day + 1 };
    consumePersonEnergy(person, best.kind === 'wood' ? .72 : .5);
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
    const intended = Math.min(space, item.amount);
    if (intended <= .05) { person.state = 'sem espaço para o tronco'; return 0; }
    const amount = transferResource(item, person, 'amount', intended, 'carriedWood', 24);
    if (amount <= .05) { person.state = 'sem espaço para o tronco'; return 0; }
    if (item.amount <= .05) item.available = false;
    consumePersonEnergy(person, .36 + amount * .018);
    person.skills.gather = clamp(person.skills.gather + .004, 0, 1);
    person.state = 'carregando madeira';
    person.lastLesson = 'O tronco foi recolhido e precisa chegar ao abrigo para virar madeira armazenada.';
    return amount;
  }

export function collectSheepFeed(w, person, community, target) {
    if (!community || !target || !nearestPenFor(w, person)) return 0;
    if (!touchesHarvestBush(w, person, target, 'browse')) {
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
    const sizeFactor = before >= 70 ? 1.15 : .82;
    const capacity = Math.max(0, 18 - (person.carriedFeed || 0));
    const take = Math.min(capacity / sizeFactor, 5.5 + person.skills.care * 4.5, before);
    if (take <= .05) { person.state = 'arbusto sem brotos'; return 0; }
    target.plants[index] -= take;
    hideCollectedBush(w, target, 'browse');
    target.detritusGPerM2 += take * .035;
    const storedFeed = take * sizeFactor;
    addResource(person, 'carriedFeed', storedFeed, 18);
    person.visualActivity = { kind: 'harvest', x: target.x, y: target.y, day: w.day + 1, tool: 'knife' };
    consumePersonEnergy(person, .32);
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
    if (!prior) return;
    const community = activeCommunity(w, person);
    const priorCommunity = activeCommunity(w, prior.person);
    if (!community || !priorCommunity) return;
    const relation = communityRelation(w, community, priorCommunity);
    relation.resourceTruces = (relation.resourceTruces || []).filter(truce => truce.expiresDay >= w.day);
    if (relation.resourceTruces.some(truce => truce.kind === kind && distance(truce, tile) <= radius)) return;
    if (w.contestedResources && w.contestedResources.has(key)) return;
    const other = prior.person;
    const browsePressure = kind === 'browse' && (communityHerd(w, activeCommunity(w, person)).length
      || communityHerd(w, activeCommunity(w, other)).length);
    if (kind !== 'browse' && other.foodReserve > 58 && person.foodReserve > 58) return;
    if (kind === 'browse' && !browsePressure) return;
    if (patchValue < (kind === 'browse' ? 16 : 10)) return;
    const result = resolveResourceConflict(w, person, other, tile, kind, patchValue);
    if (result) {
      if (w.contestedResources) w.contestedResources.add(key);
      relation.resourceTruces.push({ kind, x: tile.x, y: tile.y, expiresDay: w.day + RESOURCE_CONFLICT_TRUCE_DAYS });
      if (relation.resourceTruces.length > 16) relation.resourceTruces.splice(0, relation.resourceTruces.length - 16);
      const kingdomA = w.kingdoms.find(kingdom => kingdom.id === result.winner.kingdomId);
      const kingdomB = w.kingdoms.find(kingdom => kingdom.id === result.loser.kingdomId);
      if (kingdomA && kingdomB && kingdomA.id !== kingdomB.id) {
        const relation = kingdomRelation(w, kingdomA.id, kingdomB.id);
        relation.tension = clamp((relation.tension || 0) + .16 + Math.min(.08, (patchValue || 0) / 1800), 0, 1);
        relation.resourceDisputes = (relation.resourceDisputes || 0) + 1;
        for (const [kingdom, opponentId, outcome] of [[kingdomA, kingdomB.id, 'held'], [kingdomB, kingdomA.id, 'lost']]) {
          kingdom.militaryIntel ||= [];
          kingdom.militaryIntel.push({ day: w.day + 1, reportDay: w.day + 3, kind: 'resource-dispute',
            opponentId, cause: 'confronto por uma área de ' + (kind === 'browse' ? 'pastagem' : 'alimento'),
            source: 'relato de moradores que disputaram o recurso', resourceKind: kind, outcome,
            location: { x: tile.x, y: tile.y }, patchValue: Number(patchValue.toFixed(1)) });
          if (kingdom.militaryIntel.length > 16) kingdom.militaryIntel.shift();
        }
      }
    }
    return result;
  }

export function resolveResourceConflict(w, a, b, tile, resourceKind, patchValue) {
    const ca = activeCommunity(w, a), cb = activeCommunity(w, b);
    if (!ca || !cb || ca.id === cb.id) return null;
    const relation = communityRelation(w, ca, cb);
    const supportA = peopleNear(w, a.x, a.y, 3.5).filter(p => p.alive && p.communityId === ca.id && distance(p, a) < 3.5).length;
    const supportB = peopleNear(w, b.x, b.y, 3.5).filter(p => p.alive && p.communityId === cb.id && distance(p, b) < 3.5).length;
    const strengthA = a.physicalStrength + a.energy * .025 + supportA * .32 + a.skills.diplomacy * .15;
    const strengthB = b.physicalStrength + b.energy * .025 + supportB * .32 + b.skills.diplomacy * .15;
    const winner = strengthA === strengthB ? (a.id < b.id ? a : b) : strengthA > strengthB ? a : b;
    const loser = winner === a ? b : a;
    const loserGroup = winner === a ? cb : ca;
    const margin = Math.abs(strengthA - strengthB);
    const resourcePressure = Math.min(1.6, Math.max(0, patchValue || 0) / 220);
    const injury = 1.4 + clamp(4.5 - margin * .35, .6, 4.5) + resourcePressure;
    consumePersonEnergy(a, 3.8); consumePersonEnergy(b, 3.8);
    a.hydration = Math.max(0, a.hydration - .8); b.hydration = Math.max(0, b.hydration - .8);
    loser.injury += injury; changePersonHealth(w, loser, -injury * .55, 'resource-conflict');
    winner.injury += injury * .2; changePersonHealth(w, winner, -injury * .12, 'resource-conflict');
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

function updatePeopleCore(w) {
    refreshHarvestSuitability(w);
    const living = w.people.filter(p => p.alive).sort((a, b) => a.id - b.id);
    const socialMeetingParticipants = new Set();
    const trainingPairs = militaryTrainingPairs(w);
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
      if (p.role === 'soldier' && p.health >= 60) p.tacticalRecovering = false;
      if (p.ageDays < 12 * 365) {
        updateDependent(w, p);
        continue;
      }
      let emergencyCarriedRationToday = 0;
      p.perception = Senses.observe(w, p, 'person', PLANTS);
      maintainSocialIntentions(w, p);
      if (p.role === 'soldier') resolveMilitaryServiceEvaluation(w, p);

      const community = activeCommunity(w, p);
      if (p.role === 'soldier') clearCivilianDuties(w, p, false);
      const campaignOrder = campaignOrderFor(w, p);
      const peacetimeSoldier = p.role === 'soldier' && p.campaignId == null
        && !campaignOrder?.campaign && !campaignOrder?.returning;
      const militaryCenter = peacetimeSoldier ? militaryDutyCenterFor(w, p) : null;
      const garrisonKingdom = peacetimeSoldier ? w.kingdoms.find(item => item.id === p.kingdomId) : null;
      const garrisonCommunity = garrisonKingdom && w.communities.find(item =>
        item.id === garrisonKingdom.communityId && item.kingdomId === p.kingdomId);
      const garrisonFoodAvailable = Math.max(0, Number(garrisonKingdom?.treasury?.stock?.food) || 0)
        + communityFoodStock(garrisonCommunity);
      const dailyFoodNeed = peacetimeSoldier ? PEACETIME_SOLDIER_FOOD_NEED : DAILY_FOOD_NEED;
      const communitySize = community ? (communityCounts.get(community.id) || 0) : 0;
      const sheltered = w.structures.some(s => s.complete && s.type === 'abrigo' && community && p.communityId === s.communityId && distance(p, s) <= 4);
      consumePersonEnergy(p, (peacetimeSoldier ? .18 : sheltered ? .4 : .48) + p.injury * .006);
      p.hydration = clamp(p.hydration - .3, 0, 100);
      const campaignRation = drawCampaignRation(w, p, dailyFoodNeed);
      if (campaignRation > .01) addFoodReserve(p, campaignRation, 'campaign-ration');
      const purchasedRation = peacetimeSoldier ? 0 : buyMilitaryMeal(w, p, Math.max(0, dailyFoodNeed - campaignRation));
      if (peacetimeSoldier) drawGarrisonRation(w, p, militaryCenter, GARRISON_RATION_TARGET);
      const communityRationNeed = p.role === 'soldier' || p.foodReserve >= PERSONAL_FOOD_PRESSURE_THRESHOLD
        ? 0 : Math.max(0, dailyFoodNeed - campaignRation - purchasedRation);
      const onFriendlySupplyGround = !campaignOrder || cellAt(w, Math.round(p.x), Math.round(p.y))?.kingdomId === p.kingdomId;
      if (community && onFriendlySupplyGround && communityRationNeed > .01 && communityFoodStock(community) > .01) {
        const personalCapacity = Math.max(0, 100 - p.foodReserve) / FOOD_RESERVE_PER_UNIT;
        const meal = Math.min(communityRationNeed / FOOD_RESERVE_PER_UNIT, communityFoodStock(community), personalCapacity);
        if (meal > .01) {
          withdrawCommunityFood(w, community, meal, 'resident-food-issue');
          addFoodReserve(p, meal * FOOD_RESERVE_PER_UNIT, 'resident-community-meal');
          p.sharedMeals = (p.sharedMeals || 0) + meal;
        }
      }
      const personalRationDeficit = Math.max(0, dailyFoodNeed - p.foodReserve);
      if (personalRationDeficit > .001 && ((p.carriedFood || 0) + (p.carriedFruit || 0) + (p.carriedMeat || 0)) > .01) {
        const consumedCarriedFood = consumeEdibleCargo(p, personalRationDeficit / FOOD_RESERVE_PER_UNIT, 'emergency-carried-food-consumption');
        if (consumedCarriedFood > .001) {
          emergencyCarriedRationToday = consumedCarriedFood;
          addFoodReserve(p, consumedCarriedFood * FOOD_RESERVE_PER_UNIT, 'emergency-carried-food-ration');
          if (p.lastEmergencyRationDay !== w.day - 1) {
            const carriedFor = community ? 'carga destinada ao estoque de ' + community.name : 'carga transportada';
            log(w, 'Ração emergencial: ' + p.name + ' consumiu ' + consumedCarriedFood.toFixed(2) + ' unidades da ' + carriedFor
              + ' para completar a ração diária; reserva pessoal antes: ' + (p.foodReserve - consumedCarriedFood * FOOD_RESERVE_PER_UNIT).toFixed(2)
              + ' pontos; estoque comunitário: ' + communityFoodStock(community).toFixed(2) + ' unidades.');
          }
          p.lastEmergencyRationDay = w.day;
        }
      }
      const consumedFood = consumeFoodReserve(p, dailyFoodNeed,
        peacetimeSoldier ? 'military-garrison-consumption' : 'resident-consumption');
      recordCampaignPersonalRation(w, p, Math.max(0, consumedFood - campaignRation));
      const unmetFood = Math.max(0, dailyFoodNeed - consumedFood);
      p.socialNeed = clamp(p.socialNeed + .19, 0, 100);
      changePersonHealth(w, p, p.foodReserve > 28 && p.hydration > 28 && p.injury < 2 ? .025 : 0, 'recovery');
      if (unmetFood > .001) changePersonHealth(w, p,
        -(unmetFood / dailyFoodNeed) * 10 * STARVATION_HEALTH_LOSS_PER_POINT, 'starvation');
      if (p.hydration < 10) changePersonHealth(w, p, -.62, 'dehydration');
      if (p.injury > 0) changePersonHealth(w, p, -p.injury * .012, 'injury');
      const local = cellAt(w, p.x, p.y);
      let food = bestPeopleFoodCell(w, p, 8);
      const currentAssignment = p.assignment && p.assignment.communityId === p.communityId && p.assignment.expiresDay >= w.day
        ? p.assignment : null;
      const assignedFoodField = currentAssignment?.foodFieldId == null ? null : w.structures.find(s =>
        s.id === currentAssignment.foodFieldId && s.type === 'roça' && s.complete && s.communityId === p.communityId
        && s.destroyedDay == null && s.integrity !== 0);
      if (assignedFoodField) {
        const fieldFood = bestPeopleFoodCell(w, p, 8, assignedFoodField.id);
        if (fieldFood) food = fieldFood;
        else if (distance(p, assignedFoodField) > 4) food = cellAt(w, assignedFoodField.x, assignedFoodField.y);
      }
      const waterHere = nearestWater(w, p, 3);
      const waterTarget = waterHere || nearestWater(w, p, 100);
      const waterCue = !waterTarget && p.hydration < 62 ? bestPerceivedWaterCue(w, p) : null;
      const predatorRisk = (p.perception.animals || []).some(sighting => sighting.visible && sighting.distance < 4
        && species(sighting.speciesId, ANIMALS)?.prey.includes('person')) ? .75 : 0;
      const territoryAwareness = p.perception.territorialAwareness;
      const borderRisk = territoryAwareness && territoryAwareness.inForeignTerritory ? .8
        : territoryAwareness && territoryAwareness.nearestForeignTerritory && territoryAwareness.nearestForeignTerritory.distance <= 2 ? .35 : 0;
      const risk = clamp(predatorRisk + p.conflictRisk + borderRisk, 0, 1);
      const socialTarget = socialMeetingParticipants.has(p.id) ? null : nearestPerson(w, p, 14, socialMeetingParticipants);
      const foodAidTarget = (p.perception && p.perception.people || [])
        .filter(sighting => sighting.visible && sighting.distance <= 14 && sighting.visibleSignals?.foodDistress === true
          && !socialMeetingParticipants.has(sighting.id))
        .map(sighting => findPersonById(w, sighting.id))
        .filter(target => target && target.alive)
        .sort((a, b) => distance(p, a) - distance(p, b) || a.id - b.id)[0] || null;
      const foodRequestTarget = p.foodReserve < 40
        ? (p.perception?.people || []).filter(sighting => sighting.visible && sighting.distance <= 1.6
          && sighting.visibleSignals?.foodSurplus === true && !socialMeetingParticipants.has(sighting.id))
          .map(sighting => findPersonById(w, sighting.id)).filter(Boolean)
          .sort((a, b) => distance(p, a) - distance(p, b))[0] || null
        : null;
      const currentFoodAidPlan = (p.socialIntentions || []).find(item => item.type === 'seek_food_aid'
        && ['active', 'suspended'].includes(item.status));
      const perceivedFoodHelper = p.foodReserve < 40
        ? (p.perception?.people || []).filter(sighting => sighting.visible && sighting.distance <= 14
          && sighting.visibleSignals?.foodSurplus === true && !socialMeetingParticipants.has(sighting.id))
          .map(sighting => findPersonById(w, sighting.id)).filter(Boolean)
          .sort((a, b) => distance(p, a) - distance(p, b) || a.id - b.id)[0] || null
        : null;
      const aidPlan = currentFoodAidPlan
        ? { intention: currentFoodAidPlan }
        : perceivedFoodHelper ? ensureFoodAidPlan(w, p, perceivedFoodHelper) : null;
      const aidPlanIntention = aidPlan?.intention || currentFoodAidPlan;
      const aidPlanTarget = aidPlanIntention ? findPersonById(w, aidPlanIntention.targetId) : null;
      const groupFood = communityFoodStock(community);
      const groupMaterial = community ? communityMaterialStock(community) : 0;
      const browseFood = bestSheepFeedCell(w, p, 8);
      const foodAccess = food ? clamp(plantBiomass(food, HUMAN_FOOD) / 90, 0, 1) : 0;
      const waterAccess = waterTarget ? clamp(1 - distance(p, waterTarget) / 38, 0, 1) : 0;
      const localSuitability = foodAccess * .65 + waterAccess * .35;
      const shelter = nearestShelterFor(w, p);
      const huntGround = bestHuntingGround(w, p, 12);
      const preyNearby = nearestHuntable(w, p, 3.5);
      const herdPrey = nearestEmergencyHerdSheep(w, p, community, 2.25);
      const preyTile = preyNearby && cellAt(w, Math.round(preyNearby.x), Math.round(preyNearby.y));
      const visibleCover = preyTile ? clamp(plantBiomass(preyTile, ['browse', 'berry', 'broadleaf', 'conifer']) / 500, 0, 1) : 0;
      const huntAccess = shelter
        ? preyNearby ? .5 + visibleCover * .3 : herdPrey ? .5 : huntGround ? .18 + clamp(1 - distance(p, huntGround) / 18, 0, 1) * .28 : 0
        : 0;
      const pen = nearestPenFor(w, p);
      const availablePen = community ? availableCommunityPen(w, community.id, p) : null;
      const sheepSighting = nearestPerceivedSheep(w, p, 5.5);
      const raidTarget = nearestRaidTarget(w, p, community);
      const storage = nearestKnownStorage(w, p, community);
      const delivery = cargoDeliveryPlan(w, p, community, storage);
      const deliveryNeed = clamp(carriedResources(p) / 24, 0, 1);
      const canDeliverEdibleCargo = !!delivery
        && (p.carriedFood || 0) + (p.carriedFruit || 0) + (p.carriedMeat || 0) > .01;
      const looseLog = nearestKnownLog(p, 7);
      const droppedLoot = nearestLoot(w, p, 7);
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
      const communityFoodAidAvailable = !!(community && foodAidTarget
        && foodAidTarget.communityId === community.id && community.memberIds.includes(foodAidTarget.id)
        && distance(p, community) <= 7 && distance(p, foodAidTarget) <= 7
        && communityFoodStock(community) > 1);
      const voluntaryFoodAidAvailable = !!(foodAidTarget && p.foodReserve > 82 && distance(p, foodAidTarget) <= 1.6);
      const tradePartner = findTradePartner(w, community, p);
      const hasFoodPressure = p.foodReserve < PERSONAL_FOOD_PRESSURE_THRESHOLD && !food;
      const hasWaterPressure = p.hydration < 55 && (!waterTarget || distance(p, waterTarget) > 18);
      const foodNeed = clamp((70 - p.foodReserve) / 70, 0, 1) * (groupFood > 20 ? .72 : 1);
      const hasLocalHarvest = foodNeed > .35 && !!shelter && (preyNearby || herdPrey || huntGround);
      const canMigrate = !!bestHabitatCell(w, p) && (localSuitability < .1 || p.conflictRisk > .62 || hasFoodPressure || hasWaterPressure) && !hasLocalHarvest;
      const marketTrust = tradePartner && tradePartner.relation ? tradePartner.relation.trust : .35;
      const utility = [
        food ? inputs[0] * 1.85 + .24 + inputs[4] * .2 + (community && groupFood < 8 ? .12 : 0) + p.skills.forage * .08 : -.6,
        shelter && (preyNearby || herdPrey || huntGround) && (p.carriedMeat || 0) <= .01 ? .1 + foodNeed * (.45 + huntAccess * .5) + p.skills.hunt * .16 + (preyNearby || herdPrey ? .28 : 0) : -.65,
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
        (communityFoodAidAvailable || voluntaryFoodAidAvailable) ? .3 + inputs[6] * .5 + p.skills.care * .16 : -.55,
        tradePartner ? .54 + p.skills.diplomacy * .15 + marketTrust * .12 : -.55,
        canMigrate ? .18 + risk * .58 + (1 - localSuitability) * .32 + (hasFoodPressure ? .64 : 0) + (hasWaterPressure ? .62 : 0) : -.7,
        community && availablePen && sheepSighting && sheepSighting.visible && !p.leadingSheepId
          ? .28 + (sheepSighting.distance <= 1.6 ? .72 : .24) + p.skills.care * .14 + (communityHerd(w, community).length < 3 ? .12 : 0) : -.8,
        p.leadingSheepId && pen ? 1.18 : -.8,
        raidTarget && community && communityFoodStock(community) / Math.max(1, communitySize) < 2.2
          ? .2 + clamp(.95 - communityFoodStock(community) / Math.max(1, communitySize), 0, 1) * .7 + raidTarget.relation.tension * .28 : -.85
      ];
      const assignment = currentAssignment;
      updateKingdomFoodSupplyPhase(assignment, p.foodReserve, p.carriedFood);
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
      const healthRelatedWaterRisk = p.health <= 5 && p.hydration <= 14 && !!(waterTarget || waterCue);
      const urgentWaterNeed = p.hydration <= 9 || healthRelatedWaterRisk;
      const emergencyFoodOpportunity = p.role !== 'soldier' && p.foodReserve <= DAILY_FOOD_NEED && food
        && (!waterHere || distance(p, waterHere) > 1.5)
        && canHarvestFoodAt(w, p, food);
      const survivalAction = urgentWaterNeed
        ? emergencyFoodOpportunity ? 'forage'
          : waterTarget ? 'drink' : (waterCue || bestHabitatCell(w, p) ? 'migrate' : null)
        : p.foodReserve <= 8
          ? p.role === 'soldier' ? null
            : (canDeliverEdibleCargo ? 'deliver'
            : droppedLoot && distance(p, droppedLoot) <= 1.6 && ((droppedLoot.resources.food || 0) + (droppedLoot.resources.meat || 0)) > 0 ? 'collect_loot'
              : food ? 'forage' : (shelter && (preyNearby || herdPrey || huntGround) ? 'hunt' : (bestHabitatCell(w, p) ? 'migrate' : null)))
          : null;
      if (assignment && !survivalAction && !assignmentConflict) {
        const assignedIndex = PEOPLE_ACTIONS.indexOf(p.assignment.action);
        const leader = findPersonById(w, assignment.assignedBy);
        const relation = leader && (w.socialLinks[p.id + ':' + leader.id] || w.socialLinks[leader.id + ':' + p.id]);
        const trust = relation ? relation.trust : .2;
        const authority = clamp(.45 + trust * .42 + clamp((leader && leader.prestige || 0) / 40, 0, .13), .35, 1);
        if (assignedIndex >= 0) utility[assignedIndex] += (assignment.priority === 'urgent' ? .68 : .48) * authority;
        assignment.pauseReason = null;
        assignment.lastPausedDay = null;
      } else if (assignment && (survivalAction || assignmentConflict)) {
        assignment.pauseReason = assignmentPauseReason || (survivalAction === 'drink' || (survivalAction === 'migrate' && urgentWaterNeed)
          ? 'sede crítica' : survivalAction === 'rest' ? 'energia crítica' : 'fome crítica');
        assignment.lastPausedDay = w.day;
      }
      const carryingGoods = carriedResources(p) > .01;
      const carrierMaintenanceAction = carryingGoods && !peacetimeSoldier && !campaignOrder
        ? p.hydration < 40 && waterTarget ? 'drink'
          : p.foodReserve < 24 && food && !canDeliverEdibleCargo ? 'forage'
            : null : null;
      const collectionLoad = delivery ? clamp(6 + distance(p, delivery.destination) * 1.5, 6, 24) : 0;
      const continueCommunalCollection = carryingGoods && delivery && distance(p, delivery.destination) > 1.5
        && assignment?.source === 'kingdom-strategy' && assignment.action === 'forage'
        && !assignmentConflict && (p.carriedFood || 0) > .01 && p.carriedFood < collectionLoad
        && carriedResources(p) - p.carriedFood <= .01 && food && canHarvestFoodAt(w, p, food);
      const cargoAction = carryingGoods ? continueCommunalCollection ? 'forage' : delivery ? 'deliver' : 'migrate' : null;
      const foodDuty = assignedFoodField && assignment.action === 'forage' && !assignmentConflict && food ? 'forage' : null;
      const patrolDuty = !survivalAction && !campaignOrder && !carryingGoods && canPatrolToday(w, p, !!assignment);
      const soldierHomeRest = p.role === 'soldier' && (!campaignOrder?.withdrawing || campaignOrder.returning)
        && (p.energy < GARRISON_RECOVERY.energy || p.tacticalRecovering
          || p.health < GARRISON_RECOVERY.health || p.injury >= GARRISON_RECOVERY.restInjury
          || p.militaryRestTargetId != null && (p.restingStructureId == null
            || p.energy < GARRISON_RECOVERY.restEnergy || p.health < GARRISON_RECOVERY.restHealth
            || p.injury >= GARRISON_RECOVERY.restInjury));
      const residentHomeRest = p.role !== 'soldier' && (p.energy <= GARRISON_RECOVERY.startRestEnergy
        || p.constructionRetreating
        || p.restingOutdoors && p.energy < GARRISON_RECOVERY.restEnergy
        || p.homeRestTargetId != null && (p.restingStructureId == null
          || p.energy < GARRISON_RECOVERY.restEnergy || p.health < GARRISON_RECOVERY.restHealth
          || p.injury >= GARRISON_RECOVERY.restInjury));
      const homeRest = soldierHomeRest || residentHomeRest;
      const assignedBuildDuty = assignment && assignment.action === 'build' && !assignmentConflict && !survivalAction
        && !homeRest && !carryingGoods && !p.leadingSheepId;
      // Food and water require resupply or drinking, never an endless sleep.
      const returnToGarrison = peacetimeSoldier && p.foodReserve < GARRISON_RECOVERY.food
        && garrisonFoodAvailable > .01 && militaryCenter && distance(p, militaryCenter) > 2;
      if (p.militaryBrain) p.militaryBrain.pending = null;
      const militaryAction = p.role === 'soldier' && (!homeRest || returnToGarrison)
        && (!survivalAction || returnToGarrison)
        ? chooseMilitaryAction(w, p, { campaign: !!campaignOrder?.campaign, resupply: returnToGarrison,
          thirst: p.hydration < 40 && !!waterTarget, patrol: patrolDuty,
          training: !campaignOrder && trainingPairs.has(p.id) }) : null;
      const peacetimeSoldierAction = militaryAction;
      const action = campaignOrder && campaignOrder.withdrawing && !homeRest && survivalAction !== 'drink'
        ? 'campaign'
        : returnToGarrison && peacetimeSoldierAction === 'return_garrison' ? peacetimeSoldierAction
        : survivalAction || carrierMaintenanceAction || (homeRest ? 'rest' : peacetimeSoldier ? peacetimeSoldierAction : (droppedLoot && !assignment && !carryingGoods && p.energy >= 9
          && (!campaignOrder || !campaignOrder.withdrawing && distance(p, droppedLoot) <= 1.6) ? 'collect_loot'
          : campaignOrder ? militaryAction || 'campaign' : cargoAction || foodDuty || (p.leadingSheepId ? 'lead_sheep'
          : assignedBuildDuty ? 'build'
          : patrolDuty ? 'patrol' : p.role === 'soldier'
            ? p.hydration < 40 && waterTarget ? 'drink' : p.energy < 30 || p.health < 42 || p.injury >= 5 ? 'rest' : 'guard'
            : choosePeopleAction(w, p, inputs, utility))));
      if (p.militaryBrain && action !== militaryAction) p.militaryBrain.pending = null;
      if (action === 'patrol' || action === 'guard' || action === 'collect_loot' || p.role === 'soldier') {
        // Patrol is a duty rather than a neural-network action; do not train the last learned action on it.
        p.brain.pending = null;
        p.brain.lastAction = action;
        if (militaryAction !== action) p.lastDecision = { action, scores: null, inputs: inputs.slice(), day: w.day };
      }
      if (survivalAction || homeRest || carryingGoods || foodDuty || assignedBuildDuty) {
        // Forced survival and recovery actions bypass the neural policy; discard
        // interrupted samples so rewards cannot train the wrong action.
        p.brain.pending = null;
        p.brain.lastAction = action;
        p.lastDecision = { action, scores: null, inputs: inputs.slice(), day: w.day };
      }
      if (action === 'campaign') {
        p.brain.pending = null;
        p.brain.lastAction = 'campaign';
        if (militaryAction !== action) p.lastDecision = { action, scores: null, inputs: inputs.slice(), day: w.day };
      }
      const trainingBefore = p.militaryTraining || 0;
      if (action !== 'train') p.militaryTrainingPartnerId = null;
      const before = p.energy * .28 + p.hydration * .25 + p.foodReserve * .3 + p.health * .17 + (100 - p.socialNeed) * .04;
      if (action !== 'rest') {
        p.restingStructureId = null;
        if (action !== 'drink') {
          p.militaryRestTargetId = null;
          p.homeRestTargetId = null;
        }
      }
      const actionOrigin = { x: p.x, y: p.y };
      const taskStateBefore = {
        foodReserve: p.foodReserve, carriedFood: p.carriedFood || 0, carriedFeed: p.carriedFeed || 0, carriedWood: p.carriedWood || 0,
        carriedStone: p.carriedStone || 0, carriedGold: p.carriedGold || 0,
        food: community ? community.stores.food || 0 : 0, feed: community ? community.stores.feed || 0 : 0,
        wood: community ? community.stores.wood || 0 : 0, stone: community ? community.stores.stone || 0 : 0, gold: community ? community.stores.gold || 0 : 0,
        tradeCount: community ? community.tradeCount || 0 : 0,
        buildProgress: w.structures.filter(structure => structure.communityId === (community && community.id)).reduce((sum, structure) => sum + (structure.progress || 0), 0),
        repairProgress: kingdomRepairProgress(w, community),
        leadingSheepId: p.leadingSheepId
      };
      p.travelCost = 0;
      p.lastLesson = 'A ação ainda não produziu um efeito observável.';
      const target = community ? community : null;

      if (action === 'forage') {

        if (food && canHarvestFoodAt(w, p, food)) {
          const dispute = claimForagePatch(w, p, food);
          if (dispute && dispute.loser === p) {
            p.foodTarget = null;
            p.state = 'recuando após disputa';
            p.lastLesson = 'Perdeu o acesso à mancha disputada, sofreu ferimento e gastou energia; negociar ou migrar pode evitar nova perda.';
          } else {
            p.foodTarget = null;
            const communityFoodWorker = assignment && assignment.source === 'kingdom-strategy'
              && assignment.action === 'forage' && p.foodReserve > 35 && carrierMaintenanceAction !== 'forage';
            if (communityFoodWorker) {
              if (collectFoodForCommunity(w, p, food) <= .01) {
                p.state = 'carga de alimento sem espaço';
                p.lastLesson = 'A carga de alimento já está cheia; levá-la ao abrigo libera espaço para outra coleta.';
              }
            } else {
            const reserveCapacity = Math.max(0, (91 - p.foodReserve) / FOOD_RESERVE_PER_UNIT);
            const desiredHarvest = clamp(1.8 + p.skills.forage * 3.2, 1.8, 5);
            const fruitShelter = nearestShelterFor(w, p);
            const directStorage = community && ((fruitShelter && distance(p, fruitShelter) <= 1.5)
              || (!fruitShelter && distance(p, community) <= 5));
            const harvestLimit = personalFoodHarvestLimit(p, desiredHarvest, reserveCapacity, !!directStorage);
            const harvest = harvestHumanFood(w, food, harvestLimit);
            const use = Math.min(harvest, reserveCapacity);
            addFoodReserve(p, use * FOOD_RESERVE_PER_UNIT, 'personal-harvest');
            if (harvest > .1) {
              if (food.cropFieldId == null) hideCollectedBush(w, food, 'berry');
              p.visualActivity = { kind: 'harvest', x: food.x, y: food.y, day: w.day + 1,
                ...(food.cropFieldId == null ? { tool: 'knife' } : {}) };
            }

            p.energy = clamp(p.energy + use * .18, 0, 100);
            const surplus = Math.max(0, harvest - use);
            if (community && fruitShelter && distance(p, fruitShelter) <= 1.5) storeCommunityFruit(w, community, fruitShelter, surplus);
            else if (community && !fruitShelter && distance(p, community) <= 5) storeCommunityFruit(w, community, null, surplus);
            else addResource(p, 'carriedFruit', surplus, 24);
            consumePersonEnergy(p, .22);
            p.skills.forage = clamp(p.skills.forage + .004, 0, 1);
            p.state = harvest > .1 ? 'coletando alimento' : 'recurso esgotado';
            p.lastLesson = dispute ? 'Garantiu o recurso, mas a disputa causou ferimentos, gasto e tensão entre reinos.' : harvest > .1 ? 'Encontrar uma mancha de alimento repôs reservas; a coleta reduziu a biomassa local.' : 'A mancha estava esgotada; procurar outra área evita insistir sem retorno.';
            }
          }
        } else if (food) {
          let movementTarget = food, foundRoute = false;
          for (let attempts = 0; movementTarget && attempts < 4; attempts++) {
            if (moveTowardFood(w, p, movementTarget)) { foundRoute = true; break; }
            movementTarget = bestPeopleFoodCell(w, p, 8, assignedFoodField?.id ?? null);
          }
          if (foundRoute) {
            p.foodTarget = { x: movementTarget.x, y: movementTarget.y };
            const isBush = movementTarget.cropFieldId == null;
            p.state = 'procurando alimento'; p.lastLesson = isBush
              ? 'Deslocar-se até um ponto livre ao lado do arbusto custa energia; a colheita começa ao alcançar a área de interação.'
              : 'Deslocar-se até a roça custa energia e tempo; colher no talhão exige alcançar o campo.';
          } else {
            p.foodTarget = null;
            p.state = 'alimento inacessível'; p.lastLesson = 'Os destinos de alimento conhecidos não têm uma rota alcançável; reavaliar a percepção evita insistir no mesmo caminho.';
          }
        }
        else { p.foodTarget = null; p.state = 'sem alimento próximo'; p.lastLesson = 'Não encontrou alimento no alcance; migração ou cooperação pode abrir outras opções.'; }
      } else if (action === 'hunt') {
        huntForFood(w, p, community);
      } else if (action === 'deliver') {
        const carryingMeat = (p.carriedMeat || 0) > .01;
        const carryingFruit = (p.carriedFruit || 0) > .01;
        const carryingFeed = (p.carriedFeed || 0) > .01;
        const carryingFood = (p.carriedFood || 0) > .01;
        const destination = delivery?.destination;
        const receivingCommunity = delivery?.community;
        const receivingShelter = delivery?.shelter;
        if (!destination || !receivingCommunity || (carryingMeat && !receivingShelter)) {
          p.state = carryingMeat ? 'aguardando abrigo para armazenar carne' : 'aguardando abrigo para guardar recursos';
          p.lastLesson = 'A carga continua com quem a transporta até um local comunitário adequado ficar disponível.';
        } else if (distance(p, destination) <= 1.5) {
          const fruitInShelter = carryingFruit && !!receivingShelter;
          if (p.carriedMeat > .01) {
            const amount = moveCarriedResource(p, 'carriedMeat', receivingCommunity, 'meat', p.carriedMeat);
            if (amount > .01) addResource(receivingShelter, 'meatStored', amount);
          }
          if (p.carriedFeed > .01) moveCarriedResource(p, 'carriedFeed', receivingCommunity, 'feed', p.carriedFeed);
          if (p.carriedFruit > .01) {
            const amount = moveCarriedResource(p, 'carriedFruit', receivingCommunity, 'food', p.carriedFruit);
            if (amount > .01 && receivingShelter && receivingShelter.complete && receivingShelter.type === 'abrigo') {
              addResource(receivingShelter, 'fruitStored', amount);
            }
          }
          if (p.carriedFood > .01) moveCarriedResource(p, 'carriedFood', receivingCommunity, 'food', p.carriedFood);
          if (p.carriedWood > .01) moveCarriedResource(p, 'carriedWood', receivingCommunity, 'wood', p.carriedWood);
          if (p.carriedStone > .01) moveCarriedResource(p, 'carriedStone', receivingCommunity, 'stone', p.carriedStone);
          if (p.carriedGold > .01) moveCarriedResource(p, 'carriedGold', receivingCommunity, 'gold', p.carriedGold);
          if (p.carriedMaterial > .01) moveCarriedResource(p, 'carriedMaterial', receivingCommunity, 'wood', p.carriedMaterial);
          p.state = carryingMeat ? 'carne armazenada no abrigo' : fruitInShelter ? 'frutos armazenados no abrigo' : carryingFruit ? 'frutos na reserva comunitária' : carryingFeed ? 'ração guardada no curral' : carryingFood ? 'alimento armazenado no abrigo' : 'recursos armazenados no abrigo';
          p.lastLesson = carryingFeed && !carryingFruit
            ? 'Os brotos chegaram ao curral e podem alimentar as ovelhas; o estoque diminui conforme o rebanho consome.'
            : carryingFruit && receivingShelter ? 'Os frutos chegaram ao abrigo e agora integram o inventário físico e a reserva alimentar compartilhada.'
            : carryingFruit ? 'Os frutos chegaram à reserva do reino; um abrigo permite armazená-los fisicamente.'
            : 'A carga chegou ao abrigo e agora integra as reservas compartilhadas do reino.';
          if (carryingMeat) log(w, p.name + ' armazenou carne no abrigo de ' + receivingCommunity.name + '.');
          if (fruitInShelter) log(w, p.name + ' levou frutos ao abrigo de ' + receivingCommunity.name + '.');
        } else {
          moveOne(w, p, cellAt(w, destination.x, destination.y), false);
          p.state = carryingFeed ? 'levando ração ao curral' : 'levando recursos ao abrigo';
          p.lastLesson = 'Transportar recursos consome energia e tempo, mas torna a coleta disponível para o reino.';
        }
      } else if (action === 'drink') {
        if (waterHere && distance(p, waterHere) <= 1.5 && drinkWater(w, p, waterHere, 28)) {
          consumePersonEnergy(p, .08); p.state = 'bebendo água';
          p.visualActivity = { kind: 'drink', x: waterHere.x, y: waterHere.y, day: w.day + 1 };
          p.lastLesson = waterHere.terrain === 'water'
            ? waterHere.waterKind === 'ocean' ? 'A água do oceano recuperou hidratação.' : 'A água do lago recuperou hidratação.'
            : 'A poça formada pelo escoamento recuperou hidratação e diminuiu no solo.';
        }
        else if (waterTarget) { moveOne(w, p, waterTarget, false); p.state = 'buscando água'; p.lastLesson = 'A aproximação da água custa energia e tempo.'; }
        else { p.state = 'sem água conhecida'; p.lastLesson = 'A água não foi localizada; continuar aqui mantém a desidratação.'; }
      } else if (action === 'socialize') {
        const visibleAidPlanTarget = aidPlanTarget && (p.perception?.people || []).some(item =>
          String(item.id) === String(aidPlanTarget.id) && item.visible && item.visibleSignals?.foodSurplus === true);
        const routeRetry = aidPlanIntention?.status === 'suspended'
          && aidPlanIntention.blockers.length > 0 && aidPlanIntention.blockers.every(blocker => blocker === 'route_infeasible');
        let aidPlanMovement = false;
        let aidRequest = null;
        if (visibleAidPlanTarget && (aidPlanIntention.status === 'active' || routeRetry)) {
          if (distance(p, aidPlanTarget) <= 1.6) {
            aidRequest = resolveFoodAidRequest(w, p, aidPlanTarget, socialMeetingParticipants);
          } else {
            const from = { x: p.x, y: p.y };
            const moved = moveOne(w, p, cellAt(w, aidPlanTarget.x, aidPlanTarget.y), false);
            aidPlanMovement = true;
            if (moved && distance(p, aidPlanTarget) < distance(from, aidPlanTarget) - .001) {
              advanceSocialIntention(w, p.id, aidPlanIntention.intentionId, {
                progress: Math.max(1, aidPlanIntention.progress), status: 'active', blockers: []
              });
              p.state = 'indo pedir ajuda alimentar';
              p.lastLesson = 'O plano social manteve o ajudante visível como destino; aproximar-se consome energia e deixa a transferência para o encontro.';
            } else {
              advanceSocialIntention(w, p.id, aidPlanIntention.intentionId, {
                progress: aidPlanIntention.progress, status: 'suspended', blockers: ['route_infeasible']
              });
              p.state = 'rota de ajuda inviável';
              p.lastLesson = 'A rota até o ajudante não avançou; o plano fica suspenso e será reavaliado sem criar tarefa de movimento permanente.';
            }
          }
        } else {
          aidRequest = !aidPlanIntention && foodRequestTarget
            ? resolveFoodAidRequest(w, p, foodRequestTarget, socialMeetingParticipants) : null;
        }
        const meeting = aidRequest?.requested || aidPlanMovement ? null : socialTarget && distance(p, socialTarget) > 2.1
          ? null : socialTarget && resolveSocialMeeting(w, p, socialTarget, socialMeetingParticipants);
        if (aidRequest?.requested) {
          // The request and its response are resolved atomically before another encounter can use either person.
        } else if (aidPlanMovement) {
          // The social intention records route progress or a route blocker without changing neural inputs.
        } else if (meeting?.completed) {
          const indication = indicateKnownWaterReference(w, p, socialTarget);
          if (indication.transferred) {
            p.state = 'indicando água conhecida';
            p.lastLesson = 'A referência veio de uma fonte que você já conhecia; o relato conserva quem transmitiu e o lugar observado.';
          }
        } else if (socialTarget && !meeting && distance(p, socialTarget) > 2.1) {
          moveOne(w, p, cellAt(w, socialTarget.x, socialTarget.y), false); p.state = 'procurando companhia';
        } else {
          p.state = 'encontro adiado';
          p.lastLesson = meeting?.reason === 'physical-emergency'
            ? 'A conversa foi suspensa porque uma pessoa precisa atender uma emergência física.'
            : meeting?.reason === 'participant-busy'
              ? 'A pessoa já participou de outro encontro neste dia.'
              : 'O encontro exige uma pessoa viva e visível dentro do alcance.';
        }
      } else if (action === 'rest') {
        const indoors = restPersonInHouse(w, p);
        const resting = indoors || p.militaryRestTargetId == null && p.homeRestTargetId == null;
        if (resting) p.energy = clamp(p.energy + (indoors ? GARRISON_RECOVERY.energyPerDay : 4.2), 0, 100);
        p.restingOutdoors = !indoors && resting && p.energy < GARRISON_RECOVERY.restEnergy;
        if (indoors) {
          p.injury = Math.max(0, p.injury - GARRISON_RECOVERY.injuryPerDay);
          changePersonHealth(w, p, GARRISON_RECOVERY.healthPerDay, 'recovery');
        } else if (resting && p.injury > 0) {
          p.injury = Math.max(0, p.injury - .035);
          changePersonHealth(w, p, .08, 'recovery');
        }
        if (indoors) p.state = 'descansando dentro da casa';
        else if (p.militaryRestTargetId != null || p.homeRestTargetId != null) p.state = 'indo descansar na casa';
        else p.state = 'descansando';
        if (p.constructionRetreating && !indoors) p.state = 'retirando-se da obra para tratar ferimentos';
        if (p.constructionRetreating && p.health >= (p.constructionRecoveryHealth || 85)
          && p.energy >= GARRISON_RECOVERY.restEnergy && p.injury < 2) {
          p.constructionRetreating = false;
          p.constructionRecoveryHealth = null;
        }
        p.lastLesson = indoors
          ? 'A pessoa entrou em casa para recuperar energia e tratar ferimentos antes de retomar suas atividades.'
          : p.militaryRestTargetId != null || p.homeRestTargetId != null
            ? 'A pessoa segue para sua casa; o descanso começa ao entrar.'
            : 'O descanso recuperou energia enquanto não há uma casa disponível.';
      } else if (action === 'build') {
        const assignedProject = assignment && assignment.source === 'community-project'
          ? w.structures.find(structure => structure.id === assignment.structureId && !structure.complete && !structure.kingdomProject
            && structure.destroyedDay == null && structure.integrity !== 0) : null;
        if (assignment && assignment.source === 'community-project' && !assignedProject) {
          p.assignment = null;
          p.state = 'obra financiada concluída';
          p.lastLesson = 'A estrutura atribuída foi concluída; o trabalhador voltou à prioridade atual do reino.';
        } else {
          workOnCommunityStructure(w, p, community, communitySize);
          p.skills.build = clamp(p.skills.build + .003, 0, 1);
          p.lastLesson = 'Construir consome material, alimento e energia; a estrutura passa a beneficiar o reino.';
        }
      } else if (action === 'gather') gatherMaterials(w, p, community);
      else if (action === 'collect_log') collectLooseLog(w, p, looseLog);
      else if (action === 'collect_loot') collectLoot(w, p, droppedLoot);
      else if (action === 'collect_feed') collectSheepFeed(w, p, community, browseFood);
      else if (action === 'share') {
        if (!performShare(w, p, community, foodAidTarget)) { p.state = 'sem excedente para partilhar'; p.lastLesson = 'A partilha só ocorre quando existe reserva disponível e alguém próximo demonstra necessidade.'; }
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
      } else if (action === 'guard') {
        p.state = 'de guarda';
        p.lastLesson = 'Em paz, a guarnição mantém o posto e usa uma ração reduzida do estoque do reino.';
      } else if (action === 'train') {
        if (!trainMilitaryPair(w, p, trainingPairs.get(p.id))) {
          if (p.state !== 'indo ao treino de combate simulado') p.state = 'aguardando colega para treino';
        }
      } else if (action === 'return_garrison') {
        const moved = militaryCenter && moveOne(w, p, militaryCenter, false, { preferRoads: true });
        p.towerMounted = false;
        if (p.towerDutyId != null) {
          const tower = w.structures.find(structure => structure.id === p.towerDutyId);
          if (tower?.archerId === p.id) tower.archerId = null;
          p.towerRecovering = true;
        }
        p.state = moved ? 'retornando ao centro militar para repouso' : 'aguardando repouso na guarnição';
        p.lastLesson = 'Em paz, o soldado volta ao centro militar quando precisa de comida ou descanso; a ração reduzida vem do estoque do reino.';
      } else if (action === 'campaign') {
        performCampaignOrder(w, p, campaignOrder);
      } else {
        const existingMigrationPlan = action === 'migrate' && (p.socialIntentions || []).find(item =>
          item.type === 'prepare_migration' && ['active', 'suspended'].includes(item.status));
        let habitat = existingMigrationPlan?.destination
          ? cellAt(w, existingMigrationPlan.destination.x, existingMigrationPlan.destination.y) : null;
        if (!habitat) habitat = bestPeopleMigrationCell(w, p, waterTarget, waterCue);
        let migrationPlan = existingMigrationPlan || null;
        if (action === 'migrate' && !migrationPlan
            && (p.socialIntentions || []).filter(item => !['completed', 'abandoned'].includes(item.status)).length < 3) {
          const physicalBlockers = physicalIntentionBlockers(p, w.day);
          migrationPlan = defineSocialIntention(w, p.id, {
            type: 'prepare_migration', priority: .5, dueDay: w.day + 14,
            destination: habitat ? { x: habitat.x, y: habitat.y } : null,
            blockers: [...physicalBlockers, ...(habitat ? [] : ['no_viable_destination'])],
            steps: [{ action: 'select_viable_destination' }, { action: 'reach_destination' }],
            endsWhen: 'viable_destination_reached_or_deadline'
          });
        }
        if (habitat) {
          const moved = moveOne(w, p, habitat, false);
          if (action === 'migrate' && migrationPlan) {
            const destination = { x: habitat.x, y: habitat.y };
            if (distance(p, habitat) <= 1.5) {
              advanceSocialIntention(w, p.id, migrationPlan.intentionId, {
                progress: migrationPlan.steps.length, status: 'completed', blockers: [], destination,
                terminationReason: 'destination_reached'
              });
            } else if (moved) {
              const physicalBlockers = physicalIntentionBlockers(p, w.day);
              const blockers = [...new Set([
                ...(migrationPlan.blockers || []).filter(blocker =>
                  blocker !== 'route_infeasible' && blocker !== 'no_viable_destination'),
                ...physicalBlockers
              ])];
              advanceSocialIntention(w, p.id, migrationPlan.intentionId, {
                progress: Math.max(1, migrationPlan.progress), status: blockers.length ? 'suspended' : 'active',
                blockers, destination
              });
            } else {
              const physicalBlockers = physicalIntentionBlockers(p, w.day);
              advanceSocialIntention(w, p.id, migrationPlan.intentionId, {
                progress: Math.max(migrationPlan.progress, 1), status: 'suspended',
                blockers: [...new Set([...(migrationPlan.blockers || []).filter(blocker => blocker !== 'no_viable_destination'),
                  ...physicalBlockers, 'route_infeasible'])],
                destination
              });
            }
          }
          p.state = p.conflictRisk > .45 ? 'migrando após disputa' : 'migrando para recursos';
        } else if (action === 'migrate' && migrationPlan) {
          const physicalBlockers = physicalIntentionBlockers(p, w.day);
          advanceSocialIntention(w, p.id, migrationPlan.intentionId, {
            status: 'suspended', blockers: [...new Set([...(migrationPlan.blockers || []).filter(blocker => blocker !== 'route_infeasible'),
              ...physicalBlockers, 'no_viable_destination'])],
            destination: null
          });
        }
        p.lastLesson = 'A migração custa energia, mas pode reduzir exposição a escassez ou disputa.';
      }

      if (p.role === 'soldier' && (p.x !== actionOrigin.x || p.y !== actionOrigin.y)) {
        p.militaryFacingX = p.x - actionOrigin.x;
        p.militaryFacingY = p.y - actionOrigin.y;
      }
      if (emergencyCarriedRationToday > .001) {
        p.lastLesson = (p.lastLesson ? p.lastLesson + ' ' : '')
          + 'A ração de hoje consumiu ' + emergencyCarriedRationToday.toFixed(2) + ' unidades da carga alimentar.';
      }
      if (p.carriedFruit > .1 && community) {
        const fruitShelter = nearestShelterFor(w, p);
        if (fruitShelter && distance(p, fruitShelter) <= 1.5) {
          const amount = moveCarriedResource(p, 'carriedFruit', community, 'food', p.carriedFruit);
          if (amount > .01) addResource(fruitShelter, 'fruitStored', amount);
        } else if (!fruitShelter && distance(p, community) <= 5) {
          moveCarriedResource(p, 'carriedFruit', community, 'food', p.carriedFruit);
        }
      }
      const taskStateAfter = {
        foodReserve: p.foodReserve, carriedFood: p.carriedFood || 0, carriedFeed: p.carriedFeed || 0, carriedWood: p.carriedWood || 0,
        carriedStone: p.carriedStone || 0, carriedGold: p.carriedGold || 0,
        food: community ? community.stores.food || 0 : 0, feed: community ? community.stores.feed || 0 : 0,
        wood: community ? community.stores.wood || 0 : 0, stone: community ? community.stores.stone || 0 : 0, gold: community ? community.stores.gold || 0 : 0,
        tradeCount: community ? community.tradeCount || 0 : 0,
        buildProgress: w.structures.filter(structure => structure.communityId === (community && community.id)).reduce((sum, structure) => sum + (structure.progress || 0), 0),
        repairProgress: kingdomRepairProgress(w, community),
        leadingSheepId: p.leadingSheepId
      };
      completeCommunityTask(w, p, action, taskStateBefore, taskStateAfter);
      updateKingdomFoodSupplyPhase(p.assignment, p.foodReserve, p.carriedFood);
      if (community) recordCommunityUse(w, p);
      const after = p.energy * .28 + p.hydration * .25 + p.foodReserve * .3 + p.health * .17 + (100 - p.socialNeed) * .04;
      updateBrain(p, clamp((after - before) / 12, -.8, .8));
      if (p.role === 'soldier') learnMilitaryOutcome(p, (after - before) / 12
        + ((p.militaryTraining || 0) - trainingBefore) * 15
        + (action === 'guard' ? .025 : action === 'patrol' ? .045 : action === 'campaign' ? .05 : 0));
      recordPersonalMemory(p, w.day + 1);
      if (community) {
        const satisfaction = community.satisfaction || 0;
        const { leftAfterLongAbsence, leftAfterAccumulatedDissatisfaction } = updateResidencyAbsence(w, p, community, {
          action, assignment, moved: p.x !== actionOrigin.x || p.y !== actionOrigin.y,
          deliveredToOwnCommunity: action === 'deliver' && delivery?.community.id === community.id
        });
        if (p.role !== 'soldier' && (leftAfterLongAbsence || leftAfterAccumulatedDissatisfaction)) {
          const leavingKingdom = w.kingdoms.find(kingdom => kingdom.id === p.kingdomId);
          const home = w.structures.find(structure => structure.id === p.homeId
            && ['casa', 'abrigo'].includes(structure.type));
          if (home) home.residentIds = (home.residentIds || []).filter(id => id !== p.id);
          if (leavingKingdom) leavingKingdom.memberIds = leavingKingdom.memberIds.filter(id => id !== p.id);
          const reasons = [];
          if (leftAfterLongAbsence) reasons.push('ausência de ' + p.awayDays + ' dias com satisfação abaixo de 0,400 (valor '
            + satisfaction.toFixed(6) + ')');
          if (leftAfterAccumulatedDissatisfaction) reasons.push('insatisfação acumulada por ' + p.dissatisfactionDays + ' dias');
          const personalFoodAtExit = p.foodReserve.toFixed(1);
          const sharedFoodAtExit = communityFoodStock(community).toFixed(1);
          p.communityId = null; p.kingdomId = null; p.homeId = null; p.awayDays = 0;
          clearMilitaryCommand(p);
          community.memberIds = community.memberIds.filter(id => id !== p.id);
          p.assignment = null;
          p.lastLesson = 'A saída para terra comum ocorreu após ' + reasons.join(' e ') + '; reserva pessoal de alimento: '
            + personalFoodAtExit + ' pontos; estoque comunitário: ' + sharedFoodAtExit + ' unidades.';
          log(w, p.name + ' deixou ' + community.name + ' após ' + reasons.join(' e ')
            + '; reserva pessoal ' + personalFoodAtExit + ' pontos e estoque comum ' + sharedFoodAtExit + ' unidades.');
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


export function updatePeople(w) {
    const saved = ['peopleById', 'peopleSpatialIndex']
      .map(key => ({ key, hadValue: Object.prototype.hasOwnProperty.call(w, key), value: w[key] }));
    w.peopleById = new Map((w.people || []).map(person => [person.id, person]));
    w.peopleSpatialIndex = createPersonSpatialIndex(w.people);
    try {
      return updatePeopleCore(w);
    } finally {
      for (const { key, hadValue, value } of saved) {
        if (hadValue) w[key] = value;
        else delete w[key];
      }
    }
  }
export function nearestPerson(w, p, radius, excludedIds = null) {
    const sightings = p.perception && p.perception.people || [];
    return sightings.filter(s => s.visible && s.distance <= radius && !excludedIds?.has(s.id))
      .map(s => findPersonById(w, s.id))
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
      const foreignPenalty = p.kingdomId != null && t.kingdomId != null && t.kingdomId !== p.kingdomId
        ? canEnterForeignTerritory(w, p, t) ? .85 : 3 : 0;
      const s = plantBiomass(t, HUMAN_FOOD) * .005 + (t.soilWaterMm / t.soilCapacityMm) * .3 - t.slope * .2 - foreignPenalty + rand(w) * .08;
      if (s > score) { best = t; score = s; }
    }
    return best;
  }

export function bestPeopleMigrationCell(w, person, waterTarget, waterCue) {
    const waterIsDestination = person.hydration <= 35 && waterTarget && distance(person, waterTarget) > 1.5;
    if (waterIsDestination) return waterTarget;
    const waterCueIsDestination = person.hydration <= 35 && waterCue && distance(person, waterCue) > 1.5;
    if (waterCueIsDestination) return waterCue;
    return bestHabitatCell(w, person);
  }
