import Sim from '../src/simulation/engine.js';
import { DAILY_FOOD_NEED, FOOD_RESERVE_PER_UNIT, HUMAN_FOOD, PLANTS } from '../src/config/ecosystem.js';
import { isTreeAnchor, plantBiomass } from '../src/simulation/ecology/plants.js';
import { cellAt, cellsWithin } from '../src/simulation/world/spatial.js';
import { communityFoodStock } from '../src/simulation/economy/inventories.js';
import { canEnterForeignTerritory } from '../src/simulation/kingdoms/territories.js';
import { bestPerceivedWaterCue, nearestWater } from '../src/simulation/individuals/actions.js';
import { applyFrontierLayout } from './frontier-layout.mjs';

const seed = Number(process.env.DIAGNOSE_SEED || 42);
const days = Math.max(1, Math.floor(Number(process.env.DIAGNOSE_DAYS || 253)));
const layout = process.env.DIAGNOSE_LAYOUT || 'default';
const compact = process.env.DIAGNOSE_COMPACT === '1';
const focusOnly = process.env.DIAGNOSE_FOCUS_ONLY === '1';
const focusPersonNames = new Set((process.env.DIAGNOSE_PEOPLE || '').split(',').map(name => name.trim().toLocaleLowerCase()).filter(Boolean));
const world = Sim.createWorld(seed);
const deaths = [];
const builderAudit = [];
const kingdomExits = [];
const territoryIncidents = [];
const territoryEntries = [];
const territoryMovementTraces = [];
const campaignRationHistory = [];
const herdSnapshots = [];
const initialCounts = { people: world.people.length, animals: world.animals.length };
const personHistory = new Map();
const focusPersonHistory = new Map();
const forageHistory = new Map();
const pendingForageTargets = new Map();
const zeroYieldTargets = new Map();
const zeroYieldAlternativeDiagnostics = {
  events: 0,
  withNearbyVisibleAlternative: 0,
  withNearbyHarvestableAlternative: 0,
  withNearbyFullActionAlternative: 0,
  withNearbyFullActionAlternativeWithinScoreGap001: 0,
  withNearbyFullActionAlternativeWithinScoreGap002: 0
};
const sampledRetargetPeople = new Set();
const sampledArrivalPeople = new Set();
const forageTargetDiagnostics = {
  targetStarts: 0,
  continuedSelections: 0,
  retargetedBeforeHarvest: 0,
  retargetedWithOneDayGap: 0,
  retargetedWithMultipleDayGap: 0,
  retargetedWhileOldTargetVisible: 0,
  retargetedWhileOldTargetHarvestable: 0,
  abandonedWithoutTarget: 0,
  harvestArrivals: 0,
  totalTravelDays: 0,
  arrivalTravelBuckets: { sameDay: 0, oneDay: 0, twoToThreeDays: 0, fourPlusDays: 0 },
  zeroYieldArrivals: 0,
  delayedArrivals: 0,
  delayedZeroYieldArrivals: 0,
  biomassComparisonCount: 0,
  biomassDeltaComparisonCount: 0,
  delayedBiomassDeltaComparisonCount: 0,
  totalAbsolutePerceptionErrorAtArrival: 0,
  totalBiomassChangeFromSelection: 0,
  totalAbsoluteBiomassChangeFromSelection: 0,
  totalDelayedBiomassChangeFromSelection: 0,
  totalAbsoluteDelayedBiomassChangeFromSelection: 0,
  retargetSamples: [],
  arrivalSamples: []
};
const forageDiagnostics = {
  lowReserveSelections: 0,
  lowReserveSelectionsWithoutTarget: 0,
  lowReserveHarvests: 0,
  zeroYieldHarvests: 0,
  harvestsBelowDailyNeed: 0,
  totalLowReserveHarvestBiomass: 0
};

const layoutPlacements = layout === 'frontier' ? applyFrontierLayout(world) : [];
if (layout !== 'frontier' && layout !== 'default') {
  throw new Error(`DIAGNOSE_LAYOUT inválido: ${layout}`);
}

function foodValue(biomass) {
  return HUMAN_FOOD.reduce((sum, id) => sum + (biomass && biomass[id] || 0), 0);
}

function summarizeFoodOptions(person, target) {
  const harvestCapacity = Math.max(1.8, Math.min(5, 1.8 + person.skills.forage * 3.2));
  const perceivedResources = person.perception && person.perception.resources || [];
  const resources = perceivedResources
    .filter(resource => resource.visible && resource.terrain === 'land' && resource.distance <= 8)
    .map(resource => {
      const tile = cellAt(world, resource.x, resource.y);
      const perceivedBiomassByPlant = Object.fromEntries(HUMAN_FOOD.map(id => [id, Number((resource.biomass[id] || 0).toFixed(2))]));
      const perceivedHarvestableBiomassByPlant = Object.fromEntries(HUMAN_FOOD.map(id => [id,
        Number(((resource.harvestableBiomass && resource.harvestableBiomass[id]) || 0).toFixed(2))]));
      const currentBiomassByPlant = Object.fromEntries(HUMAN_FOOD.map(id => [id,
        Number((tile ? plantBiomass(tile, [id]) : 0).toFixed(2))]));
      const harvestableBiomassByPlant = Object.fromEntries(HUMAN_FOOD.map(id => {
        const profile = PLANTS.find(plant => plant.id === id);
        const protectedReserve = profile?.cultivatedOnly && tile?.cropFieldId != null ? profile.rootReserve || 0 : 0;
        return [id, Number(Math.max(0, currentBiomassByPlant[id] - protectedReserve).toFixed(2))];
      }));
      const perceivedHarvestableBiomass = Object.values(perceivedHarvestableBiomassByPlant)
        .reduce((sum, amount) => sum + amount, 0);
      const currentHarvestableBiomass = Object.values(harvestableBiomassByPlant).reduce((sum, amount) => sum + amount, 0);
      const perceivedBiomass = foodValue(resource.biomass);
      const territoryEntryAllowed = tile ? canEnterForeignTerritory(world, person, tile) : false;
      const treeAnchor = tile ? isTreeAnchor(world, tile) : false;
      return {
        x: resource.x,
        y: resource.y,
        distance: Number(resource.distance.toFixed(2)),
        perceivedBiomass: Number(perceivedBiomass.toFixed(2)),
        currentBiomass: Number((tile ? plantBiomass(tile, HUMAN_FOOD) : 0).toFixed(2)),
        perceivedBiomassByPlant,
        perceivedHarvestableBiomassByPlant,
        currentBiomassByPlant,
        harvestableBiomassByPlant,
        perceivedHarvestableBiomass: Number(perceivedHarvestableBiomass.toFixed(2)),
        currentHarvestableBiomass: Number(currentHarvestableBiomass.toFixed(2)),
        slope: Number((resource.slope || 0).toFixed(2)),
        kingdomId: tile?.kingdomId ?? null,
        territoryEntryAllowed,
        treeAnchor,
        score: Number((Math.min(perceivedBiomass, harvestCapacity) * .018 - resource.distance * .065
          - (resource.slope || 0) * .09 - (territoryEntryAllowed ? 0 : 3)).toFixed(3)),
        harvestableScore: Number((Math.min(perceivedHarvestableBiomass, harvestCapacity) * .018 - resource.distance * .065
          - (resource.slope || 0) * .09 - (territoryEntryAllowed ? 0 : 3)).toFixed(3))
      };
    })
    .filter(resource => resource.perceivedBiomass > .8 || resource.currentBiomass > .8
      || (target && resource.x === target.x && resource.y === target.y));
  const selected = target && resources.find(resource => resource.x === target.x && resource.y === target.y);
  const targetTile = target && cellAt(world, target.x, target.y);
  const neighborhoodBiomass = targetTile
    ? cellsWithin(world, target.x, target.y, 2.1, tile => tile.terrain === 'land')
      .reduce((sum, tile) => sum + plantBiomass(tile, HUMAN_FOOD), 0)
    : 0;
  const byDistance = [...resources].sort((a, b) => a.distance - b.distance || b.perceivedBiomass - a.perceivedBiomass);
  const byBiomass = [...resources].sort((a, b) => b.perceivedBiomass - a.perceivedBiomass || a.distance - b.distance);
  const byScore = [...resources].sort((a, b) => b.score - a.score || a.distance - b.distance);
  const byHarvestableScore = [...resources].sort((a, b) => b.harvestableScore - a.harvestableScore || a.distance - b.distance);
  const safeResources = resources.filter(resource => resource.kingdomId == null || resource.kingdomId === person.kingdomId);
  const bySafeScore = [...safeResources].sort((a, b) => b.score - a.score || a.distance - b.distance);
  const bySafeDistance = [...safeResources].sort((a, b) => a.distance - b.distance || b.perceivedBiomass - a.perceivedBiomass);
  return {
    visibleCellCount: resources.length,
    visiblePerceivedBiomass: Number(resources.reduce((sum, item) => sum + item.perceivedBiomass, 0).toFixed(2)),
    visibleCurrentBiomass: Number(resources.reduce((sum, item) => sum + item.currentBiomass, 0).toFixed(2)),
    visibleCurrentHarvestableBiomass: Number(resources.reduce((sum, item) => sum + item.currentHarvestableBiomass, 0).toFixed(2)),
    harvestCapacity: Number(harvestCapacity.toFixed(2)),
    selectedPerceivedBiomass: selected ? selected.perceivedBiomass : null,
    selectedCurrentBiomass: selected ? selected.currentBiomass : null,
    selectedPerceivedHarvestableBiomass: selected ? selected.perceivedHarvestableBiomass : null,
    selectedCurrentHarvestableBiomass: selected ? selected.currentHarvestableBiomass : null,
    selectedScore: selected ? selected.score : null,
    selectedTreeAnchor: selected ? selected.treeAnchor : null,
    selectedKingdomId: selected ? selected.kingdomId : null,
    selectedTerritoryEntryAllowed: selected ? selected.territoryEntryAllowed : null,
    selectedNeighborhoodBiomass: Number(neighborhoodBiomass.toFixed(2)),
    nearestCells: byDistance.slice(0, 3),
    richestCells: byBiomass.slice(0, 3),
    bestScoredCells: byScore.slice(0, 3),
    bestSafeScoredCells: bySafeScore.slice(0, 3),
    nearestSafeCells: bySafeDistance.slice(0, 3),
    bestHarvestableScoredCells: byHarvestableScore.slice(0, 3)
  };
}

function recordForageDiagnostic(event) {
  const person = world.people.find(item => item.id === event.personId);
  if (!person) return;
  const reserveBefore = Number(event.reserveBefore ?? person.foodReserve) || 0;
  if (reserveBefore > 8) return;
  const foodOptions = summarizeFoodOptions(person, event.target);
  const entry = {
    day: event.day,
    phase: event.phase,
    position: { x: event.x, y: event.y },
    reserveBefore: Number(reserveBefore.toFixed(3)),
    reserveAfter: Number.isFinite(event.reserveAfter) ? event.reserveAfter : null,
    hydration: event.hydration,
    target: event.target,
    foodOptions,
    harvestedBiomass: Number.isFinite(event.harvestedBiomass) ? event.harvestedBiomass : null,
    reserveFoodUsed: Number.isFinite(event.reserveFoodUsed) ? event.reserveFoodUsed : null,
    targetBiomassBefore: Number.isFinite(event.biomassBefore) ? event.biomassBefore : null,
    targetBiomassAfter: Number.isFinite(event.biomassAfter) ? event.biomassAfter : null
  };
  const history = forageHistory.get(person.id) || [];
  history.push(entry);
  if (history.length > 20) history.shift();
  forageHistory.set(person.id, history);

  const pending = pendingForageTargets.get(person.id);
  if (event.phase === 'selected') {
    if (!event.target) {
      if (pending) forageTargetDiagnostics.abandonedWithoutTarget++;
      pendingForageTargets.delete(person.id);
    } else if (pending && pending.x === event.target.x && pending.y === event.target.y) {
      forageTargetDiagnostics.continuedSelections++;
      pending.lastSelectedDay = event.day;
      pending.lastDistance = event.target.distance;
      pending.reserveAtLastSelection = reserveBefore;
      pending.lastSelectedPosition = { x: event.x, y: event.y };
    } else {
      if (pending) {
        forageTargetDiagnostics.retargetedBeforeHarvest++;
        const selectionGapDays = event.day - pending.lastSelectedDay;
        if (selectionGapDays <= 1) forageTargetDiagnostics.retargetedWithOneDayGap++;
        else forageTargetDiagnostics.retargetedWithMultipleDayGap++;
        const oldTargetSummary = summarizeFoodOptions(person, pending.target);
        const oldTargetVisible = (person.perception && person.perception.resources || []).some(resource =>
          resource.visible && resource.x === pending.x && resource.y === pending.y);
        if (oldTargetVisible) forageTargetDiagnostics.retargetedWhileOldTargetVisible++;
        const oldTargetHarvestable = Number(oldTargetSummary.selectedCurrentHarvestableBiomass) || 0;
        if (oldTargetHarvestable > .8) forageTargetDiagnostics.retargetedWhileOldTargetHarvestable++;
        if (!sampledRetargetPeople.has(person.id) && forageTargetDiagnostics.retargetSamples.length < 40) {
          sampledRetargetPeople.add(person.id);
          forageTargetDiagnostics.retargetSamples.push({
          personId: person.id, name: person.name,
          from: { x: pending.x, y: pending.y, firstDay: pending.firstDay, lastSelectedDay: pending.lastSelectedDay,
            initialDistance: pending.initialDistance, daysPursued: event.day - pending.firstDay,
            perceivedAtSelection: pending.perceivedAtSelection, actualAtSelection: pending.actualAtSelection },
          fromPosition: pending.lastSelectedPosition,
          selectionGapDays,
          toPosition: { x: event.x, y: event.y },
          to: { x: event.target.x, y: event.target.y, distance: event.target.distance,
            reserve: Number(reserveBefore.toFixed(3)), day: event.day },
          oldTargetVisible, oldTargetPerceivedNow: oldTargetSummary.selectedPerceivedBiomass,
          oldTargetHarvestableNow: oldTargetHarvestable,
          oldTargetCurrentNow: oldTargetSummary.selectedCurrentBiomass
          });
        }
      }
      forageTargetDiagnostics.targetStarts++;
      const selectedOption = foodOptions.bestScoredCells.find(item => item.x === event.target.x && item.y === event.target.y);
      const nearbyAlternatives = foodOptions.bestScoredCells.filter(item =>
        (item.x !== event.target.x || item.y !== event.target.y)
        && Math.hypot(item.x - event.target.x, item.y - event.target.y) <= 1.5);
      const nearbyFullActionAlternative = nearbyAlternatives
        .filter(item => item.currentHarvestableBiomass >= foodOptions.harvestCapacity)
        .sort((a, b) => b.score - a.score || a.distance - b.distance)[0] || null;
      pendingForageTargets.set(person.id, {
        x: event.target.x, y: event.target.y, target: { ...event.target },
        firstDay: event.day, lastSelectedDay: event.day, initialDistance: event.target.distance,
        firstSelectedPosition: { x: event.x, y: event.y }, lastSelectedPosition: { x: event.x, y: event.y },
        lastDistance: event.target.distance, reserveAtFirstSelection: reserveBefore,
        reserveAtLastSelection: reserveBefore,
        perceivedAtSelection: event.target.perceivedBiomass,
        perceivedHarvestableAtSelection: foodOptions.selectedPerceivedHarvestableBiomass,
        actualAtSelection: foodOptions.selectedCurrentBiomass,
        harvestableAtSelection: foodOptions.selectedCurrentHarvestableBiomass,
        selectionScore: selectedOption?.score ?? null,
        nearbyVisibleAlternativeCount: nearbyAlternatives.length,
        nearbyBestHarvestable: nearbyAlternatives.reduce((best, item) => Math.max(best, item.currentHarvestableBiomass), 0),
        nearbyFullActionAlternative: nearbyFullActionAlternative ? {
          x: nearbyFullActionAlternative.x, y: nearbyFullActionAlternative.y,
          score: nearbyFullActionAlternative.score,
          scoreGap: selectedOption ? Number((selectedOption.score - nearbyFullActionAlternative.score).toFixed(3)) : null,
          currentHarvestableBiomass: nearbyFullActionAlternative.currentHarvestableBiomass,
          distance: nearbyFullActionAlternative.distance
        } : null
      });
    }
  } else if (event.phase === 'harvested' && pending
      && pending.x === event.target?.x && pending.y === event.target?.y) {
    const travelDays = Math.max(0, event.day - pending.firstDay);
    forageTargetDiagnostics.harvestArrivals++;
    forageTargetDiagnostics.totalTravelDays += travelDays;
    if (travelDays <= 0) forageTargetDiagnostics.arrivalTravelBuckets.sameDay++;
    else if (travelDays === 1) forageTargetDiagnostics.arrivalTravelBuckets.oneDay++;
    else if (travelDays <= 3) forageTargetDiagnostics.arrivalTravelBuckets.twoToThreeDays++;
    else forageTargetDiagnostics.arrivalTravelBuckets.fourPlusDays++;
    if (travelDays > 0) forageTargetDiagnostics.delayedArrivals++;
    const biomassBefore = event.biomassBefore;
    const perceivedAtArrival = event.target?.perceivedBiomass;
    if (Number.isFinite(event.harvestedBiomass) && event.harvestedBiomass <= .1) {
      forageTargetDiagnostics.zeroYieldArrivals++;
      if (travelDays > 0) forageTargetDiagnostics.delayedZeroYieldArrivals++;
    }
    if (Number.isFinite(biomassBefore) && Number.isFinite(perceivedAtArrival)) {
      forageTargetDiagnostics.biomassComparisonCount++;
      forageTargetDiagnostics.totalAbsolutePerceptionErrorAtArrival += Math.abs(perceivedAtArrival - biomassBefore);
    }
    if (Number.isFinite(biomassBefore) && Number.isFinite(pending.actualAtSelection)) {
      forageTargetDiagnostics.biomassDeltaComparisonCount++;
      const delta = biomassBefore - pending.actualAtSelection;
      forageTargetDiagnostics.totalBiomassChangeFromSelection += delta;
      forageTargetDiagnostics.totalAbsoluteBiomassChangeFromSelection += Math.abs(delta);
      if (travelDays > 0) {
        forageTargetDiagnostics.delayedBiomassDeltaComparisonCount++;
        forageTargetDiagnostics.totalDelayedBiomassChangeFromSelection += delta;
        forageTargetDiagnostics.totalAbsoluteDelayedBiomassChangeFromSelection += Math.abs(delta);
      }
    }
    if (travelDays > 0 && !sampledArrivalPeople.has(person.id) && forageTargetDiagnostics.arrivalSamples.length < 40) {
      sampledArrivalPeople.add(person.id);
      forageTargetDiagnostics.arrivalSamples.push({
      personId: person.id, name: person.name, target: { x: pending.x, y: pending.y },
      firstSelectedDay: pending.firstDay, arrivalDay: event.day, travelDays,
      firstSelectedPosition: pending.firstSelectedPosition, arrivalPosition: { x: event.x, y: event.y },
      initialDistance: pending.initialDistance, distanceAtArrival: event.target?.distance ?? null,
      reserveAtFirstSelection: Number(pending.reserveAtFirstSelection.toFixed(3)),
      reserveAtArrival: Number(reserveBefore.toFixed(3)),
      perceivedBiomassAtSelection: pending.perceivedAtSelection,
      actualBiomassAtSelection: pending.actualAtSelection,
      perceivedBiomassAtArrival: event.target?.perceivedBiomass ?? null,
      biomassBeforeHarvest: event.biomassBefore,
      harvestedBiomass: event.harvestedBiomass
      });
    }
    pendingForageTargets.delete(person.id);
  }

  if (event.phase === 'selected') {
    forageDiagnostics.lowReserveSelections++;
    if (!event.target) forageDiagnostics.lowReserveSelectionsWithoutTarget++;
  } else if (event.phase === 'harvested') {
    forageDiagnostics.lowReserveHarvests++;
    forageDiagnostics.totalLowReserveHarvestBiomass += Number(event.harvestedBiomass) || 0;
    if ((Number(event.harvestedBiomass) || 0) <= .1) {
      forageDiagnostics.zeroYieldHarvests++;
      zeroYieldAlternativeDiagnostics.events++;
      if (pending && pending.nearbyVisibleAlternativeCount > 0) {
        zeroYieldAlternativeDiagnostics.withNearbyVisibleAlternative++;
      }
      if (pending && pending.nearbyBestHarvestable > .8) {
        zeroYieldAlternativeDiagnostics.withNearbyHarvestableAlternative++;
      }
      if (pending && pending.nearbyFullActionAlternative) {
        zeroYieldAlternativeDiagnostics.withNearbyFullActionAlternative++;
        const scoreGap = pending.nearbyFullActionAlternative.scoreGap;
        if (Number.isFinite(scoreGap) && Math.abs(scoreGap) <= .01) {
          zeroYieldAlternativeDiagnostics.withNearbyFullActionAlternativeWithinScoreGap001++;
        }
        if (Number.isFinite(scoreGap) && Math.abs(scoreGap) <= .02) {
          zeroYieldAlternativeDiagnostics.withNearbyFullActionAlternativeWithinScoreGap002++;
        }
      }
      const key = `${person.id}:${event.target?.x},${event.target?.y}`;
      const item = zeroYieldTargets.get(key) || {
        personId: person.id, name: person.name, x: event.target?.x ?? null, y: event.target?.y ?? null,
        count: 0, firstDay: event.day, lastDay: event.day,
        biomassAtFirstSelection: pending?.actualAtSelection ?? null,
        perceivedHarvestableAtFirstSelection: pending?.perceivedHarvestableAtSelection ?? null,
        harvestableAtFirstSelection: pending?.harvestableAtSelection ?? null,
        totalHarvestedBiomass: 0
      };
      item.count++;
      item.lastDay = event.day;
      item.totalHarvestedBiomass += Number(event.harvestedBiomass) || 0;
      zeroYieldTargets.set(key, item);
    }
    if ((Number(event.harvestedBiomass) || 0) * FOOD_RESERVE_PER_UNIT < DAILY_FOOD_NEED) {
      forageDiagnostics.harvestsBelowDailyNeed++;
    }
  }
}

function selectedForageTargetAt(personId, day) {
  const recentForage = forageHistory.get(personId) || [];
  const selection = recentForage[recentForage.length - 1];
  if (!selection || selection.day !== day || selection.phase !== 'selected') return null;
  const selectedCell = selection.foodOptions.bestScoredCells.find(item => item.x === selection.target?.x && item.y === selection.target?.y);
  const bestSafeCell = selection.foodOptions.bestSafeScoredCells[0] || null;
  return { target: selection.target, selectedCell, bestSafeCell,
    scoreGap: selectedCell && bestSafeCell ? Number((selectedCell.score - bestSafeCell.score).toFixed(3)) : null };
}

function recordTerritoryMovement(event) {
  const person = world.people.find(item => item.id === event.personId);
  territoryMovementTraces.push({ ...event, name: person?.name || null,
    selectedForageTarget: selectedForageTargetAt(event.personId, event.day) });
}

function recordTerritoryEntry(event) {
  const person = world.people.find(item => item.id === event.personId);
  const foodOptions = person ? summarizeKnownFoodOptions(person, event.day) : null;
  const movementTrace = [...territoryMovementTraces].reverse()
    .find(trace => trace.personId === event.personId && trace.day === event.day) || null;
  territoryEntries.push({ ...event, name: person?.name || null, observedDay: event.day + 1,
    foodOptions: foodOptions && { counts: foodOptions.counts,
      nearestHomeOrNeutral: foodOptions.nearestHomeOrNeutral, nearestForeign: foodOptions.nearestForeign },
    selectedForageTarget: selectedForageTargetAt(event.personId, event.day), movementTrace });
}

function communityFor(person) {
  return world.communities.find(item => item.id === person.communityId) || null;
}

function nearestEdible(person) {
  let best = 0;
  for (const tile of cellsWithin(world, person.x, person.y, 8, () => true)) {
    best = Math.max(best, plantBiomass(tile, HUMAN_FOOD));
  }
  return Number(best.toFixed(2));
}

function knownFoodOptions(person, day = world.day) {
  return (person.perception && person.perception.resources || [])
    .filter(resource => resource.visible && resource.terrain === 'land'
      && HUMAN_FOOD.reduce((sum, id) => sum + (resource.biomass[id] || 0), 0) > .8)
    .map(resource => {
      const tile = cellAt(world, resource.x, resource.y);
      const kingdomId = tile?.kingdomId ?? null;
      return {
        x: resource.x,
        y: resource.y,
        distance: Number(resource.distance.toFixed(1)),
        biomass: Number(HUMAN_FOOD.reduce((sum, id) => sum + (resource.biomass[id] || 0), 0).toFixed(1)),
        kingdomId,
        homeOrNeutral: kingdomId == null || kingdomId === person.kingdomId,
        warnedForeignTerritory: kingdomId != null && kingdomId !== person.kingdomId
          && !!(person.territoryWarnings && person.territoryWarnings[kingdomId] >= day)
      };
    });
}

function summarizeKnownFoodOptions(person, day = world.day) {
  const options = knownFoodOptions(person, day);
  const byDistance = (items) => [...items].sort((a, b) => a.distance - b.distance || b.biomass - a.biomass);
  return {
    counts: {
      total: options.length,
      homeOrNeutral: options.filter(item => item.homeOrNeutral).length,
      foreign: options.filter(item => !item.homeOrNeutral).length,
      warnedForeign: options.filter(item => item.warnedForeignTerritory).length
    },
    nearest: byDistance(options).slice(0, 3),
    nearestHomeOrNeutral: byDistance(options.filter(item => item.homeOrNeutral)).slice(0, 3),
    nearestForeign: byDistance(options.filter(item => !item.homeOrNeutral)).slice(0, 3)
  };
}

function campaignFoodSnapshot(person) {
  const campaign = (world.campaigns || []).find(item => item.id === person.campaignId) || null;
  const side = campaign && [campaign.attacker, campaign.defender].find(item => item.kingdomId === person.kingdomId
    && item.troopIds.includes(person.id));
  return {
    campaignStatus: campaign && campaign.status || null,
    campaignSupplyFood: side ? Number((side.supply && side.supply.stock && side.supply.stock.food || 0).toFixed(2)) : null,
    campaignRationsConsumed: side ? Number((side.rationsConsumed || 0).toFixed(2)) : null
  };
}

function capture(person) {
  const community = communityFor(person);
  const kingdom = world.kingdoms.find(item => item.id === person.kingdomId);
  const campaign = (world.campaigns || []).find(item => item.id === person.campaignId) || null;
  const campaignSide = campaign && [campaign.attacker, campaign.defender].find(side => side.kingdomId === person.kingdomId
    && side.troopIds.includes(person.id));
  const treasury = kingdom && kingdom.treasury && kingdom.treasury.stock || {};
  const market = kingdom && kingdom.market || {};
  const familyIds = new Set([...(person.parents || []), person.guardianId].filter(Number.isInteger));
  const nearbyAdults = world.people.filter(item => item.alive && item.id !== person.id && item.ageDays >= 12 * 365
    && Math.hypot(item.x - person.x, item.y - person.y) <= 6
    && (person.kingdomId !== null && person.kingdomId !== undefined
      ? item.kingdomId === person.kingdomId
      : person.communityId !== null && person.communityId !== undefined && item.communityId === person.communityId))
    .map(item => {
      const caregiverKingdom = world.kingdoms.find(kingdom => kingdom.id === item.kingdomId);
      const campaign = (world.campaigns || []).find(candidate => candidate.id === item.campaignId) || null;
      return {
        id: item.id, name: item.name, family: familyIds.has(item.id),
        distance: Number(Math.hypot(item.x - person.x, item.y - person.y).toFixed(2)),
        x: Number(item.x.toFixed(1)), y: Number(item.y.toFixed(1)), role: item.role,
        foodReserve: Number(item.foodReserve.toFixed(2)), action: item.brain && item.brain.lastAction || null,
        state: item.state, campaignId: item.campaignId ?? null, campaignStatus: campaign && campaign.status || null,
        communityFood: Number(communityFoodStock(communityFor(item)).toFixed(2)),
        treasuryFood: Number((caregiverKingdom && caregiverKingdom.treasury && caregiverKingdom.treasury.stock.food || 0).toFixed(2))
      };
    })
    .sort((a, b) => a.distance - b.distance || b.foodReserve - a.foodReserve || a.id - b.id);
  const caregivers = world.people.filter(item => item.alive && familyIds.has(item.id)).map(item => ({
    id: item.id,
    name: item.name,
    ageDays: Math.round(item.ageDays),
    x: Number(item.x.toFixed(1)),
    y: Number(item.y.toFixed(1)),
    foodReserve: Number(item.foodReserve.toFixed(2)),
    energy: Number(item.energy.toFixed(2)),
    carriedMeat: Number((item.carriedMeat || 0).toFixed(2)),
    action: item.brain && item.brain.lastAction || null,
    state: item.state,
    ...campaignFoodSnapshot(item),
    assignment: item.assignment && { action: item.assignment.action, goal: item.assignment.goal },
    knownHuntables: (item.perception && item.perception.animals || [])
      .filter(sighting => sighting.visible && sighting.distance <= 13)
      .map(sighting => {
        const animal = world.animals.find(candidate => candidate.id === sighting.id);
        return { id: sighting.id, speciesId: sighting.speciesId, x: sighting.x, y: sighting.y,
          distance: Number(sighting.distance.toFixed(1)), alive: !!(animal && animal.alive),
          herdCommunityId: animal ? animal.herdCommunityId ?? null : null };
      }),
    knownFoodTargets: (item.perception && item.perception.resources || [])
      .filter(resource => resource.visible && resource.terrain === 'land'
        && HUMAN_FOOD.reduce((sum, id) => sum + (resource.biomass[id] || 0), 0) > .8)
      .slice(0, 3)
      .map(resource => {
        const tile = cellAt(world, resource.x, resource.y);
        return { x: resource.x, y: resource.y, distance: Number(resource.distance.toFixed(1)),
          biomass: Number(HUMAN_FOOD.reduce((sum, id) => sum + (resource.biomass[id] || 0), 0).toFixed(1)),
          kingdomId: tile?.kingdomId ?? null,
          warnedForeignTerritory: tile && tile.kingdomId != null && tile.kingdomId !== item.kingdomId
            && item.territoryWarnings && item.territoryWarnings[tile.kingdomId] >= world.day };
      }),
    huntingGround: community && community.grounds && community.grounds.hunting,
    shelters: world.structures.filter(structure => structure.complete && structure.type === 'abrigo'
      && structure.communityId === item.communityId).map(structure => ({ id: structure.id, x: structure.x, y: structure.y }))
  }));
  const foodOptions = summarizeKnownFoodOptions(person);
  const knownFoodTargets = foodOptions.nearest;
  return {
    id: person.id,
    name: person.name,
    ageDays: Math.round(person.ageDays),
    role: person.role,
    kingdomId: person.kingdomId ?? null,
    campaignId: person.campaignId ?? null,
    campaignStatus: campaign && campaign.status || null,
    campaignHome: campaignSide && campaignSide.home ? { ...campaignSide.home } : null,
    ...campaignFoodSnapshot(person),
    distanceToCampaignHome: campaignSide && campaignSide.home
      ? Number(Math.hypot(person.x - campaignSide.home.x, person.y - campaignSide.home.y).toFixed(2)) : null,
    parents: person.parents || [],
    guardianId: person.guardianId ?? null,
    caregivers,
    nearbyAdults,
    x: Number(person.x.toFixed(1)),
    y: Number(person.y.toFixed(1)),
    foodReserve: Number(person.foodReserve.toFixed(2)),
    hydration: Number(person.hydration.toFixed(2)),
    health: Number(person.health.toFixed(2)),
    injury: Number((person.injury || 0).toFixed(2)),
    energy: Number(person.energy.toFixed(2)),
    action: person.brain && person.brain.lastAction || null,
    state: person.state,
    lesson: person.lastLesson,
    territoryAwareness: person.territoryAwareness ? { ...person.territoryAwareness } : null,
    territoryExposure: person.territoryExposure ? { ...person.territoryExposure } : null,
    activeTerritoryWarnings: Object.entries(person.territoryWarnings || {})
      .filter(([, untilDay]) => untilDay >= world.day).map(([ownerId, untilDay]) => ({ ownerId: Number(ownerId), untilDay })),
    assignment: person.assignment && { action: person.assignment.action, goal: person.assignment.goal, pauseReason: person.assignment.pauseReason },
    childrenInCare: world.people.filter(child => child.alive
      && ((child.guardianId === person.id) || (child.parents || []).includes(person.id))).length,
    communityId: person.communityId,
    communityFood: Number(communityFoodStock(community).toFixed(2)),
    communityMembers: community && community.memberIds.length || 0,
    awayDays: person.awayDays || 0,
    dissatisfactionDays: person.dissatisfactionDays || 0,
    communitySatisfaction: Number((community && community.satisfaction || 0).toFixed(3)),
    treasuryFood: Number((treasury.food || 0).toFixed(2)),
    marketFood: Number((market.supply && market.supply.food || 0).toFixed(2)),
    strategy: kingdom && kingdom.strategy && { goal: kingdom.strategy.goal, action: kingdom.strategy.action, reason: kingdom.strategy.reason },
    nearbyEdibleBiomass: nearestEdible(person),
    knownFoodTargets,
    knownFoodTargetCounts: foodOptions.counts,
    knownSafeFoodTargets: foodOptions.nearestHomeOrNeutral,
    sharedMeals: Number((person.sharedMeals || 0).toFixed(2))
  };
}

function captureHistory(person, day) {
  const community = communityFor(person);
  const kingdom = world.kingdoms.find(item => item.id === person.kingdomId);
  const campaign = (world.campaigns || []).find(item => item.id === person.campaignId) || null;
  const campaignSide = campaign && [campaign.attacker, campaign.defender].find(side => side.kingdomId === person.kingdomId
    && side.troopIds.includes(person.id));
  const familyIds = new Set([...(person.parents || []), person.guardianId].filter(Number.isInteger));
    const nearbyAdults = world.people.filter(item => item.alive && item.id !== person.id && item.ageDays >= 12 * 365
      && Math.hypot(item.x - person.x, item.y - person.y) <= 6
      && (person.kingdomId !== null && person.kingdomId !== undefined
        ? item.kingdomId === person.kingdomId
        : person.communityId !== null && person.communityId !== undefined && item.communityId === person.communityId))
      .map(item => {
        const campaign = (world.campaigns || []).find(candidate => candidate.id === item.campaignId) || null;
        return {
          id: item.id, name: item.name, family: familyIds.has(item.id),
          distance: Number(Math.hypot(item.x - person.x, item.y - person.y).toFixed(2)),
          x: Number(item.x.toFixed(1)), y: Number(item.y.toFixed(1)), role: item.role,
          foodReserve: Number(item.foodReserve.toFixed(2)), action: item.brain && item.brain.lastAction || null,
          state: item.state, campaignId: item.campaignId ?? null, campaignStatus: campaign && campaign.status || null
        };
      })
      .sort((a, b) => a.distance - b.distance || b.foodReserve - a.foodReserve || a.id - b.id);
  const foodOptions = summarizeKnownFoodOptions(person, day);
  const waterTargetTile = nearestWater(world, person, 100);
  const waterTarget = waterTargetTile && {
    x: waterTargetTile.x, y: waterTargetTile.y,
    distance: Number(Math.hypot(person.x - waterTargetTile.x, person.y - waterTargetTile.y).toFixed(2)),
    terrain: waterTargetTile.terrain, waterKind: waterTargetTile.waterKind || null,
    surfaceWaterMm: Number((waterTargetTile.surfaceWaterMm || 0).toFixed(2))
  };
  const knownWater = (person.perception && person.perception.knownWater || [])
    .map(point => {
      const tile = cellAt(world, point.x, point.y);
      return {
        x: point.x, y: point.y, source: point.source,
        distance: Number(point.distance.toFixed(2)), confidence: Number((point.confidence || 0).toFixed(3)),
        lastSeenDay: point.lastSeenDay,
        validNow: !!tile && (tile.terrain === 'water' || (tile.surfaceWaterMm || 0) >= 1.5),
        terrain: tile && tile.terrain || null, waterKind: tile && tile.waterKind || null,
        surfaceWaterMm: Number((tile && tile.surfaceWaterMm || 0).toFixed(2))
      };
    })
    .sort((a, b) => a.distance - b.distance || b.confidence - a.confidence).slice(0, 5);
  const waterCueTile = bestPerceivedWaterCue(world, person);
  const waterCue = waterCueTile && {
    x: waterCueTile.x, y: waterCueTile.y,
    distance: Number(Math.hypot(person.x - waterCueTile.x, person.y - waterCueTile.y).toFixed(2)),
    soilWaterMm: Number((waterCueTile.soilWaterMm || 0).toFixed(2))
  };
  return {
    day,
    role: person.role,
    kingdomId: person.kingdomId ?? null,
    campaignId: person.campaignId ?? null,
    campaignStatus: campaign && campaign.status || null,
    campaignHome: campaignSide && campaignSide.home ? { ...campaignSide.home } : null,
    ...campaignFoodSnapshot(person),
    distanceToCampaignHome: campaignSide && campaignSide.home
      ? Number(Math.hypot(person.x - campaignSide.home.x, person.y - campaignSide.home.y).toFixed(2)) : null,
    foodReserve: Number(person.foodReserve.toFixed(2)),
    hydration: Number(person.hydration.toFixed(2)),
    waterTarget: waterTarget || null,
    knownWater,
    waterCue: waterCue || null,
    health: Number(person.health.toFixed(2)),
    injury: Number((person.injury || 0).toFixed(2)),
    energy: Number(person.energy.toFixed(2)),
    carriedFood: Number((person.carriedFood || 0).toFixed(2)),
    carriedFruit: Number((person.carriedFruit || 0).toFixed(2)),
    x: Number(person.x.toFixed(1)),
    y: Number(person.y.toFixed(1)),
    action: person.brain && person.brain.lastAction || null,
    state: person.state,
    territoryAwareness: person.territoryAwareness ? { ...person.territoryAwareness } : null,
    activeTerritoryWarnings: Object.entries(person.territoryWarnings || {})
      .filter(([, untilDay]) => untilDay >= day).map(([ownerId, untilDay]) => ({ ownerId: Number(ownerId), untilDay })),
    guardianId: person.guardianId ?? null,
      nearbyAdults,
    caregivers: world.people.filter(item => item.alive && familyIds.has(item.id)).map(item => ({
      id: item.id,
      x: Number(item.x.toFixed(1)),
      y: Number(item.y.toFixed(1)),
      foodReserve: Number(item.foodReserve.toFixed(2)),
      energy: Number(item.energy.toFixed(2)),
      carriedMeat: Number((item.carriedMeat || 0).toFixed(2)),
      action: item.brain && item.brain.lastAction || null,
      state: item.state,
      ...campaignFoodSnapshot(item),
      assignment: item.assignment && { action: item.assignment.action, goal: item.assignment.goal },
      knownHuntables: (item.perception && item.perception.animals || [])
        .filter(sighting => sighting.visible && sighting.distance <= 13)
        .map(sighting => {
          const animal = world.animals.find(candidate => candidate.id === sighting.id);
          return { id: sighting.id, speciesId: sighting.speciesId, x: sighting.x, y: sighting.y,
            distance: Number(sighting.distance.toFixed(1)), alive: !!(animal && animal.alive),
            herdCommunityId: animal ? animal.herdCommunityId ?? null : null };
        }),
      knownFoodTargets: (item.perception && item.perception.resources || [])
        .filter(resource => resource.visible && resource.terrain === 'land'
          && HUMAN_FOOD.reduce((sum, id) => sum + (resource.biomass[id] || 0), 0) > .8)
        .slice(0, 3)
        .map(resource => ({ x: resource.x, y: resource.y, distance: Number(resource.distance.toFixed(1)),
          biomass: Number(HUMAN_FOOD.reduce((sum, id) => sum + (resource.biomass[id] || 0), 0).toFixed(1)) })),
      huntingGround: community && community.grounds && community.grounds.hunting,
      shelters: world.structures.filter(structure => structure.complete && structure.type === 'abrigo'
        && structure.communityId === item.communityId).map(structure => ({ id: structure.id, x: structure.x, y: structure.y }))
    })),
    childrenInCare: world.people.filter(child => child.alive
      && ((child.guardianId === person.id) || (child.parents || []).includes(person.id))).length,
    sharedMeals: Number((person.sharedMeals || 0).toFixed(2)),
    knownFoodTargets: (person.perception && person.perception.resources || [])
      .filter(resource => resource.visible && resource.terrain === 'land'
        && HUMAN_FOOD.reduce((sum, id) => sum + (resource.biomass[id] || 0), 0) > .8)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 3)
      .map(resource => {
        const tile = cellAt(world, resource.x, resource.y);
        return { x: resource.x, y: resource.y, distance: Number(resource.distance.toFixed(1)),
          biomass: Number(HUMAN_FOOD.reduce((sum, id) => sum + (resource.biomass[id] || 0), 0).toFixed(1)),
          kingdomId: tile?.kingdomId ?? null,
          warnedForeignTerritory: tile && tile.kingdomId != null && tile.kingdomId !== person.kingdomId
            && person.territoryWarnings && person.territoryWarnings[tile.kingdomId] >= day };
      }),
    knownFoodTargetCounts: foodOptions.counts,
    knownSafeFoodTargets: foodOptions.nearestHomeOrNeutral,
    communityFood: Number(communityFoodStock(community).toFixed(2)),
    treasuryFood: Number((kingdom && kingdom.treasury && kingdom.treasury.stock.food || 0).toFixed(2))
  };
}

for (let day = 0; day < days; day++) {
  for (const person of world.people) {
    person.forageDiagnosticRecorder = recordForageDiagnostic;
    person.territoryEntryDiagnosticRecorder = recordTerritoryEntry;
    person.territoryMovementDiagnosticRecorder = recordTerritoryMovement;
  }
  const previous = new Map(world.people.filter(person => person.alive).map(person => [person.id, capture(person)]));
  const previousAnimals = new Map(world.animals.filter(animal => animal.alive).map(animal => [animal.id, {
    ageDays: Math.round(animal.ageDays),
    energy: Number(animal.energy.toFixed(2)),
    hydration: Number((animal.hydration || 0).toFixed(2)),
    state: animal.state,
    action: animal.brain && animal.brain.lastAction || null,
    speciesId: animal.speciesId,
    x: Number(animal.x.toFixed(1)),
    y: Number(animal.y.toFixed(1)),
    herdCommunityId: animal.herdCommunityId ?? null,
    lastFedDay: animal.lastFedDay,
    lastFeedAmount: Number((animal.lastFeedAmount || 0).toFixed(2)),
    feedingEvents: animal.feedingEvents || 0,
    pen: (() => {
      const pen = world.structures.find(structure => structure.complete && structure.type === 'curral'
        && structure.communityId === animal.herdCommunityId);
      if (!pen) return null;
      const radius = pen.radius || 3.5;
      const pasture = cellsWithin(world, pen.x, pen.y, radius,
        tile => tile.terrain === 'land' && plantBiomass(tile, ['browse']) > .02);
      const community = world.communities.find(item => item.id === animal.herdCommunityId);
      return { x: Number(pen.x.toFixed(1)), y: Number(pen.y.toFixed(1)), radius,
        browseBiomass: Number(pasture.reduce((sum, tile) => sum + plantBiomass(tile, ['browse']), 0).toFixed(1)),
        browseCells: pasture.length, communityFeed: Number((community?.stores?.feed || 0).toFixed(2)) };
    })(),
    browseBiomassRadius4: Number(cellsWithin(world, animal.x, animal.y, 4,
      tile => tile.terrain === 'land').reduce((sum, tile) => sum + plantBiomass(tile, ['browse']), 0).toFixed(1)),
    browseBiomassRadius8: Number(cellsWithin(world, animal.x, animal.y, 8,
      tile => tile.terrain === 'land').reduce((sum, tile) => sum + plantBiomass(tile, ['browse']), 0).toFixed(1)),
    nearbyBrowsePatches: cellsWithin(world, animal.x, animal.y, 5,
      tile => tile.terrain === 'land' && plantBiomass(tile, ['browse']) > 1)
      .sort((left, right) => plantBiomass(right, ['browse']) - plantBiomass(left, ['browse']))
      .slice(0, 3).map(tile => ({ x: tile.x, y: tile.y,
        distance: Number(Math.hypot(tile.x - animal.x, tile.y - animal.y).toFixed(1)),
        browseBiomass: Number(plantBiomass(tile, ['browse']).toFixed(1)) }))
  }]));
  Sim.stepDay(world, null, { includeSnapshot: false });
  if (world.day >= 650 && (world.day - 650) % 10 === 0) {
    for (const pen of world.structures.filter(structure => structure.complete && structure.type === 'curral')) {
      const flock = world.animals.filter(animal => animal.alive && animal.herdCommunityId === pen.communityId);
      const radius = pen.radius || 3.5;
      const community = world.communities.find(item => item.id === pen.communityId);
      const penBrowse = cellsWithin(world, pen.x, pen.y, radius,
        tile => tile.terrain === 'land').reduce((sum, tile) => sum + plantBiomass(tile, ['browse']), 0);
      const nearbyBrowse = cellsWithin(world, pen.x, pen.y, 8,
        tile => tile.terrain === 'land').reduce((sum, tile) => sum + plantBiomass(tile, ['browse']), 0);
      herdSnapshots.push({ day: world.day, communityId: pen.communityId,
        pen: { x: Number(pen.x.toFixed(1)), y: Number(pen.y.toFixed(1)), radius },
        flockSize: flock.length,
        meanEnergy: flock.length ? Number((flock.reduce((sum, animal) => sum + animal.energy, 0) / flock.length).toFixed(2)) : 0,
        minimumEnergy: flock.length ? Number(Math.min(...flock.map(animal => animal.energy)).toFixed(2)) : 0,
        sheepFedRecently: flock.filter(animal => world.day - (animal.lastFedDay ?? -999) <= 7).length,
        feedStock: Number((community?.stores?.feed || 0).toFixed(2)),
        penBrowseBiomass: Number(penBrowse.toFixed(1)),
        nearbyBrowseBiomass: Number(nearbyBrowse.toFixed(1))
      });
    }
  }
  for (const campaign of world.campaigns || []) {
    if (!['mobilizing', 'marching', 'engaged', 'withdrawing'].includes(campaign.status)) continue;
    for (const side of [campaign.attacker, campaign.defender]) {
      const troops = side.troopIds.map(id => world.people.find(person => person.id === id && person.alive)).filter(Boolean);
      const totalReserve = troops.reduce((sum, person) => sum + (person.foodReserve || 0), 0);
      const homeDistances = troops.map(person => side.home ? Math.hypot(person.x - side.home.x, person.y - side.home.y) : 0);
      campaignRationHistory.push({
        day: world.day, campaignId: campaign.id, status: campaign.status, kingdomId: side.kingdomId, role: side.role,
        foodStock: Number((side.supply && side.supply.stock && side.supply.stock.food || 0).toFixed(2)),
        rationsConsumed: Number((side.rationsConsumed || 0).toFixed(2)),
        supplyShortageDays: side.supplyShortageDays || 0, troopCount: troops.length,
        meanTroopReserve: troops.length ? Number((totalReserve / troops.length).toFixed(2)) : 0,
        minimumTroopReserve: troops.length ? Number(Math.min(...troops.map(person => person.foodReserve || 0)).toFixed(2)) : 0,
        maximumDistanceToHome: homeDistances.length ? Number(Math.max(...homeDistances).toFixed(2)) : 0
      });
    }
  }
  for (const person of world.people) {
    const before = previous.get(person.id);
    const awareness = person.territoryAwareness;
    if (awareness && awareness.caught && awareness.day === world.day && person.state.startsWith('expulso do território')) {
      const host = world.kingdoms.find(item => item.id === awareness.ownerId);
      territoryIncidents.push({
        id: person.id, name: person.name, day: world.day, role: person.role,
        homeKingdomId: person.kingdomId ?? null, hostKingdomId: awareness.ownerId,
        hostName: host?.name || awareness.name, positionAfterExpulsion: { x: Number(person.x.toFixed(1)), y: Number(person.y.toFixed(1)) },
        foodReserve: Number(person.foodReserve.toFixed(2)), hydration: Number(person.hydration.toFixed(2)),
        health: Number(person.health.toFixed(2)), injury: Number((person.injury || 0).toFixed(2)),
        action: person.brain && person.brain.lastAction || null, warningUntilDay: person.territoryWarnings?.[awareness.ownerId] ?? null,
        exposureAtStart: before?.territoryExposure || null,
        warningActiveAtStart: !!before?.activeTerritoryWarnings?.some(warning => warning.ownerId === awareness.ownerId),
        campaignIdAtStart: before?.campaignId ?? null, campaignStatusAtStart: before?.campaignStatus ?? null,
        before: before ? {
          position: { x: before.x, y: before.y }, foodReserve: before.foodReserve, hydration: before.hydration,
          health: before.health, action: before.action, state: before.state,
          territoryExposure: before.territoryExposure,
          territoryAwareness: before.territoryAwareness,
          activeTerritoryWarnings: before.activeTerritoryWarnings,
          campaignId: before.campaignId, campaignStatus: before.campaignStatus,
          knownFoodTargets: before.knownFoodTargets,
          knownFoodTargetCounts: before.knownFoodTargetCounts,
          knownSafeFoodTargets: before.knownSafeFoodTargets
        } : null
      });
    }
    if (!before || before.kingdomId == null || !person.alive || person.kingdomId != null) continue;
    kingdomExits.push({ id: person.id, name: person.name, day: world.day, fromKingdomId: before.kingdomId,
      before: { x: before.x, y: before.y, foodReserve: before.foodReserve, energy: before.energy,
        action: before.action, state: before.state, awayDays: before.awayDays,
        dissatisfactionDays: before.dissatisfactionDays, communitySatisfaction: before.communitySatisfaction },
      after: { x: Number(person.x.toFixed(1)), y: Number(person.y.toFixed(1)), foodReserve: Number(person.foodReserve.toFixed(2)),
        energy: Number(person.energy.toFixed(2)), state: person.state, lesson: person.lastLesson,
        communityId: person.communityId ?? null } });
  }
  if (world.day >= 50 && (world.day <= 100 || world.day % 30 === 0)) for (const kingdom of world.kingdoms) {
    const community = world.communities.find(item => item.id === kingdom.communityId && !item.dissolved);
    const project = community && world.structures.find(structure => structure.communityId === community.id && !structure.complete);
    if (!project) continue;
    const projectTile = cellAt(world, project.x, project.y);
    const terrainRows = world.day === 61 ? Array.from({ length: 7 }, (_, row) => {
      const y = project.y - 3 + row;
      return { y, row: Array.from({ length: 9 }, (_, column) => {
        const x = project.x - 3 + column;
        const tile = cellAt(world, x, y);
        return !tile ? ' ' : tile.terrain === 'water' ? '~' : tile.terrain === 'rock' ? '#'
          : isTreeAnchor(world, tile) ? 'T' : tile.kingdomId === kingdom.id ? '.' : tile.kingdomId == null ? '+' : 'F';
      }).join('') };
    }) : null;
    const leaderId = kingdom.rulerId;
    const available = (community.memberIds || []).map(id => world.people.find(person => person.id === id && person.alive))
      .filter(person => person && person.id !== leaderId && person.role !== 'soldier' && person.ageDays >= 12 * 365
        && !(person.assignment && person.assignment.expiresDay >= world.day));
    const inRange = available.filter(person => Math.hypot(person.x - project.x, person.y - project.y) <= 14);
    const strongest = inRange.slice().sort((a, b) => b.foodReserve - a.foodReserve || b.energy - a.energy || a.id - b.id)[0];
    const projectBuilders = community.memberIds.map(id => world.people.find(person => person.id === id && person.alive))
      .filter(person => person && person.assignment && person.assignment.source === 'community-project')
      .map(person => ({ id: person.id, action: person.brain && person.brain.lastAction || null, state: person.state,
        x: Number(person.x.toFixed(1)), y: Number(person.y.toFixed(1)), foodReserve: Number(person.foodReserve.toFixed(1)),
        energy: Number(person.energy.toFixed(1)), distance: Number(Math.hypot(person.x - project.x, person.y - project.y).toFixed(1)),
        assignedDay: person.assignment.assignedDay, expiresDay: person.assignment.expiresDay }));
    const strategicBuildAssignments = community.memberIds.map(id => world.people.find(person => person.id === id && person.alive))
      .filter(person => person && person.assignment && person.assignment.source === 'kingdom-strategy'
        && person.assignment.action === 'build')
      .map(person => ({ id: person.id, goal: person.assignment.goal,
        action: person.brain && person.brain.lastAction || null, state: person.state,
        x: Number(person.x.toFixed(1)), y: Number(person.y.toFixed(1)),
        foodReserve: Number(person.foodReserve.toFixed(1)), hydration: Number(person.hydration.toFixed(1)),
        energy: Number(person.energy.toFixed(1)), health: Number(person.health.toFixed(1)),
        distance: Number(Math.hypot(person.x - project.x, person.y - project.y).toFixed(1)),
        assignedDay: person.assignment.assignedDay, expiresDay: person.assignment.expiresDay,
        pauseReason: person.assignment.pauseReason || null }));
    const eligible = threshold => inRange.filter(person => person.foodReserve >= threshold && person.hydration >= 28
      && person.energy > 27 && person.health >= 45 && person.buildCooldown <= 2).length;
    builderAudit.push({ day: world.day, kingdom: kingdom.name, strategyAction: kingdom.strategy && kingdom.strategy.order && kingdom.strategy.order.action,
      progress: project.progress, required: project.required, inRange: inRange.length,
      project: { x: project.x, y: project.y, terrain: projectTile && projectTile.terrain,
        kingdomId: projectTile && projectTile.kingdomId, treeAnchor: isTreeAnchor(world, projectTile),
        terrainRows },
      eligibleAt60: eligible(60), eligibleAt50: eligible(50), eligibleAt40: eligible(40),
      projectBuilders, strategicBuildAssignments,
      workStatus: project.workStatus ? { ...project.workStatus } : null,
      strongest: strongest && { id: strongest.id, foodReserve: Number(strongest.foodReserve.toFixed(1)),
        hydration: Number(strongest.hydration.toFixed(1)), energy: Number(strongest.energy.toFixed(1)),
        health: Number(strongest.health.toFixed(1)), buildCooldown: strongest.buildCooldown }
    });
  }
  for (const person of world.people.filter(item => item.alive)) {
    const snapshot = captureHistory(person, world.day);
    const history = personHistory.get(person.id) || [];
    history.push(snapshot);
    if (history.length > 30) history.shift();
    personHistory.set(person.id, history);
    if (focusPersonNames.has(person.name.toLocaleLowerCase())) {
      const focusedHistory = focusPersonHistory.get(person.id) || [];
      focusedHistory.push(snapshot);
      focusPersonHistory.set(person.id, focusedHistory);
    }
  }
  for (const person of world.people) {
    if (person.alive || !Number.isFinite(person.deathDay) || deaths.some(item => item.id === person.id)) continue;
    deaths.push({
      id: person.id,
      kind: 'person',
      deathDay: person.deathDay,
      cause: person.deathCause,
      beforeDay: previous.get(person.id) || null,
      recentHistory: personHistory.get(person.id) || [],
      recentForageTrace: forageHistory.get(person.id) || [],
      afterDeath: {
        ageDays: Math.round(person.ageDays),
        foodReserve: Number(person.foodReserve.toFixed(2)),
        hydration: Number(person.hydration.toFixed(2)),
        health: Number(person.health.toFixed(2)),
        injury: Number((person.injury || 0).toFixed(2)),
        role: person.role,
        kingdomId: person.kingdomId ?? null,
        communityId: person.communityId ?? null,
        campaignId: person.campaignId ?? null,
        action: person.brain && person.brain.lastAction || null,
        state: person.state,
        lesson: person.lastLesson
      }
    });
  }
  for (const animal of world.animals) {
    if (animal.alive || !Number.isFinite(animal.deathDay) || deaths.some(item => item.kind === 'animal' && item.id === animal.id)) continue;
    deaths.push({
      id: animal.id,
      kind: 'animal',
      species: animal.speciesId,
      deathDay: animal.deathDay,
      cause: animal.deathCause,
      beforeDay: previousAnimals.get(animal.id) || null,
      afterDeath: { energy: Number(animal.energy.toFixed(2)), hydration: Number((animal.hydration || 0).toFixed(2)), state: animal.state }
    });
  }
}

function deathBreakdownFor(kind) {
  return deaths.filter(item => item.kind === kind).reduce((counts, item) => {
    counts[item.cause] = (counts[item.cause] || 0) + 1;
    return counts;
  }, {});
}

const summary = {
  seed,
  days: world.day,
  layout,
  initialCounts,
  layoutPlacements,
  livingPeople: world.people.filter(person => person.alive).length,
  livingAnimals: world.animals.filter(animal => animal.alive).length,
  focusedPeople: [...focusPersonHistory].map(([id, history]) => {
    const person = world.people.find(item => item.id === id);
    const relevantDays = new Set();
    history.forEach((row, index) => {
      if (row.health <= 5 && (row.hydration <= 16 || row.action === 'drink')) {
        for (let nearby = Math.max(0, index - 5); nearby <= Math.min(history.length - 1, index + 5); nearby++) {
          relevantDays.add(nearby);
        }
      }
    });
    return {
      id,
      name: person && person.name,
      alive: !!(person && person.alive),
      current: person ? {
        kingdomId: person.kingdomId ?? null,
        communityId: person.communityId ?? null,
        x: Number(person.x.toFixed(1)), y: Number(person.y.toFixed(1)),
        health: Number(person.health.toFixed(2)), hydration: Number(person.hydration.toFixed(2)),
        foodReserve: Number(person.foodReserve.toFixed(2)), action: person.brain && person.brain.lastAction || null,
        state: person.state
      } : null,
      history: history.filter((_, index) => relevantDays.has(index)).map(row => ({
        day: row.day, health: row.health, hydration: row.hydration, foodReserve: row.foodReserve,
        waterTarget: row.waterTarget, knownWater: row.knownWater, waterCue: row.waterCue,
        action: row.action, state: row.state, x: row.x, y: row.y, kingdomId: row.kingdomId
      }))
    };
  }),
  deathsByCause: world.deathsByCause,
  deathBreakdownByKind: { people: deathBreakdownFor('person'), animals: deathBreakdownFor('animal') },
  animalStarvationDeaths: deaths.filter(item => item.kind === 'animal' && item.cause === 'starvation').map(item => ({
    id: item.id, species: item.species, deathDay: item.deathDay,
    beforeDay: item.beforeDay, afterDeath: item.afterDeath
  })),
  campaignRationHistory,
  herdSnapshots,
  territoryEntries,
  territoryMovementTraces,
  territoryIncidents,
  repeatedTerritoryExpulsions: [...territoryIncidents.reduce((counts, event) => counts.set(event.id, (counts.get(event.id) || 0) + 1), new Map())]
    .filter(([, count]) => count > 1).map(([id, count]) => ({ id, count })),
  plantFoodHarvested: Number((world.harvests.plantFoodBiomass || 0).toFixed(2)),
  cultivatedFoodHarvested: Number((world.harvests.cultivatedFoodBiomass || 0).toFixed(2)),
  humanFoodRegrowth: Number((world.ecologyFlows.humanFoodRegrowth || 0).toFixed(2)),
  cultivatedFoodRegrowth: Number((world.ecologyFlows.humanFoodCultivatedRegrowth || 0).toFixed(2)),
  cultivatedSeeded: Number((world.ecologyFlows.humanFoodCultivationSeeded || 0).toFixed(2)),
  cultivatedFoodBiomass: Number(Sim.snapshot(world).cultivatedFoodBiomass.toFixed(2)),
  humanFoodNaturalLoss: Number((world.ecologyFlows.humanFoodNaturalLoss || 0).toFixed(2)),
  humanFoodSettlementLoss: Number((world.ecologyFlows.humanFoodSettlementLoss || 0).toFixed(2)),
  humanFoodEcologicalLoss: Number((world.ecologyFlows.humanFoodEcologicalLoss || 0).toFixed(2)),
  forageDiagnostics: {
    ...forageDiagnostics,
    totalLowReserveHarvestBiomass: Number(forageDiagnostics.totalLowReserveHarvestBiomass.toFixed(2)),
    meanLowReserveHarvestBiomass: forageDiagnostics.lowReserveHarvests
      ? Number((forageDiagnostics.totalLowReserveHarvestBiomass / forageDiagnostics.lowReserveHarvests).toFixed(3)) : 0
  },
  forageTargetDiagnostics: {
    ...forageTargetDiagnostics,
    meanTravelDaysToHarvest: forageTargetDiagnostics.harvestArrivals
      ? Number((forageTargetDiagnostics.totalTravelDays / forageTargetDiagnostics.harvestArrivals).toFixed(2)) : 0,
    meanPerceptionErrorAtArrival: forageTargetDiagnostics.biomassComparisonCount
      ? Number((forageTargetDiagnostics.totalAbsolutePerceptionErrorAtArrival / forageTargetDiagnostics.biomassComparisonCount).toFixed(3)) : 0,
    meanBiomassChangeFromSelection: forageTargetDiagnostics.biomassDeltaComparisonCount
      ? Number((forageTargetDiagnostics.totalBiomassChangeFromSelection / forageTargetDiagnostics.biomassDeltaComparisonCount).toFixed(3)) : 0,
    meanAbsoluteBiomassChangeFromSelection: forageTargetDiagnostics.biomassDeltaComparisonCount
      ? Number((forageTargetDiagnostics.totalAbsoluteBiomassChangeFromSelection / forageTargetDiagnostics.biomassDeltaComparisonCount).toFixed(3)) : 0,
    meanDelayedBiomassChangeFromSelection: forageTargetDiagnostics.delayedBiomassDeltaComparisonCount
      ? Number((forageTargetDiagnostics.totalDelayedBiomassChangeFromSelection / forageTargetDiagnostics.delayedBiomassDeltaComparisonCount).toFixed(3)) : 0,
    meanAbsoluteDelayedBiomassChangeFromSelection: forageTargetDiagnostics.delayedBiomassDeltaComparisonCount
      ? Number((forageTargetDiagnostics.totalAbsoluteDelayedBiomassChangeFromSelection / forageTargetDiagnostics.delayedBiomassDeltaComparisonCount).toFixed(3)) : 0,
    pendingTargetsAtEnd: pendingForageTargets.size
  },
  zeroYieldTargetDiagnostics: (() => {
    const targets = [...zeroYieldTargets.values()].sort((a, b) => b.count - a.count || a.firstDay - b.firstDay);
    const repeated = targets.filter(item => item.count > 1);
    return {
      uniquePersonTargets: targets.length,
      repeatedPersonTargets: repeated.length,
      eventsOnRepeatedTargets: repeated.reduce((sum, item) => sum + item.count, 0),
      excessRepeatEvents: repeated.reduce((sum, item) => sum + item.count - 1, 0),
      maxRepeats: targets[0]?.count || 0,
      targets: targets.slice(0, 30).map(item => ({
        ...item, totalHarvestedBiomass: Number(item.totalHarvestedBiomass.toFixed(3))
      }))
    };
  })(),
  zeroYieldAlternativeDiagnostics,
  builderAudit,
  kingdomExits,
  kingdomSummaries: world.kingdoms.map(kingdom => {
    const community = communityFor({ communityId: kingdom.communityId });
    return {
      name: kingdom.name,
      population: kingdom.memberIds.length,
      communityFood: Number(communityFoodStock(community).toFixed(2)),
      communityGold: Number((community.stores.gold || 0).toFixed(2)),
      treasuryFood: Number((kingdom.treasury.stock.food || 0).toFixed(2)),
      marketStock: { ...kingdom.market.stock },
      marketTransactions: kingdom.market.transactions,
      tradeCount: community.tradeCount,
      communityStructures: world.structures.filter(structure => structure.communityId === community.id).map(structure => ({
        id: structure.id, type: structure.type, complete: !!structure.complete,
        progress: structure.progress || 0, required: structure.required || 0, builtDay: structure.builtDay ?? null,
        cropHarvested: Number((structure.cropHarvested || 0).toFixed(2)), fieldCells: (structure.fieldTileIndices || []).length
      })),
      activeBuilders: world.people.filter(person => person.alive && person.communityId === community.id
        && person.assignment && person.assignment.source === 'community-project').map(person => ({
        id: person.id, name: person.name, structureId: person.assignment.structureId,
        action: person.assignment.action, foodReserve: Number(person.foodReserve.toFixed(2))
      })),
      taxLedger: kingdom.taxLedger && { cycles: kingdom.taxLedger.cycles, total: kingdom.taxLedger.total },
      reserveTransfers: (kingdom.reserveTransfers || []).slice(-8),
      strategy: kingdom.strategy && { goal: kingdom.strategy.goal, action: kingdom.strategy.action, evidence: kingdom.strategy.evidence }
    };
  }),
  deaths
};

if (compact) {
  const historyFields = ['day', 'role', 'kingdomId', 'campaignId', 'campaignStatus', 'campaignHome', 'distanceToCampaignHome',
    'foodReserve', 'hydration', 'waterTarget', 'knownWater', 'waterCue', 'health', 'injury', 'energy', 'x', 'y', 'action', 'state', 'lesson', 'campaignSupplyFood',
    'campaignRationsConsumed', 'guardianId', 'caregivers', 'communityFood', 'treasuryFood', 'sharedMeals',
    'knownFoodTargets', 'knownFoodTargetCounts', 'nearbyAdults',
    'knownSafeFoodTargets', 'territoryAwareness', 'activeTerritoryWarnings'];
  summary.deaths = deaths.filter(item => item.kind === 'person' && ['starvation', 'injury'].includes(item.cause)).map(item => ({
    id: item.id,
    deathDay: item.deathDay,
    cause: item.cause,
    beforeDay: item.beforeDay && {
      id: item.beforeDay.id, name: item.beforeDay.name, ageDays: item.beforeDay.ageDays, role: item.beforeDay.role,
      kingdomId: item.beforeDay.kingdomId, campaignId: item.beforeDay.campaignId,
      campaignStatus: item.beforeDay.campaignStatus, campaignHome: item.beforeDay.campaignHome,
      campaignSupplyFood: item.beforeDay.campaignSupplyFood,
      campaignRationsConsumed: item.beforeDay.campaignRationsConsumed, guardianId: item.beforeDay.guardianId,
      distanceToCampaignHome: item.beforeDay.distanceToCampaignHome,
      communityId: item.beforeDay.communityId, x: item.beforeDay.x, y: item.beforeDay.y,
      foodReserve: item.beforeDay.foodReserve, health: item.beforeDay.health, injury: item.beforeDay.injury, energy: item.beforeDay.energy,
      action: item.beforeDay.action, state: item.beforeDay.state, assignment: item.beforeDay.assignment,
      childrenInCare: item.beforeDay.childrenInCare, communityFood: item.beforeDay.communityFood,
      treasuryFood: item.beforeDay.treasuryFood, nearbyEdibleBiomass: item.beforeDay.nearbyEdibleBiomass,
      knownFoodTargets: item.beforeDay.knownFoodTargets, sharedMeals: item.beforeDay.sharedMeals,
      caregivers: item.beforeDay.caregivers, nearbyAdults: item.beforeDay.nearbyAdults
    },
    recentHistory: (item.recentHistory || []).slice(-12).map(row => Object.fromEntries(historyFields
      .filter(field => field in row).map(field => [field, row[field]]))),
    recentForageTrace: (item.recentForageTrace || []).slice(-12),
    afterDeath: item.afterDeath
  }));
}

const output = focusOnly ? {
  seed: summary.seed,
  days: summary.days,
  layout: summary.layout,
  focusedPeople: summary.focusedPeople,
  focusedKingdomExits: summary.kingdomExits.filter(event => [...focusPersonNames]
    .some(name => JSON.stringify(event).toLocaleLowerCase().includes(name)))
} : summary;

console.log(JSON.stringify(output, null, 2));
