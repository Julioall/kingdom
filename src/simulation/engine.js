import {
  ANIMALS, ANIMAL_ACTIONS, CELL_AREA_M2, COLORS, HEIGHT, MEAT_NUTRITIONAL_VALUE,
  PEOPLE_ACTIONS, PLANTS, SEASONS, WIDTH
} from '../config/ecosystem.js';

import { createWorld } from './world/generation.js';
import { inspectTile, refreshHarvestSuitability, snapshot } from './world/queries.js';
import { stepDay, tick } from './systems.js';
import { distance } from './core/math.js';

import { calendarDate, seasonIndex, triggerDrought, updateClimate } from './ecology/climate.js';
import { lowestNeighbor, updateSoilAndWater } from './ecology/hydrology.js';
import { decompose, isTreeAnchor, updatePlants } from './ecology/plants.js';
import { feedCommunalHerds, feedSheep, reproduceAnimals, updateAnimals } from './ecology/animals.js';

import { addIndividuals, reproducePeople } from './individuals/lifecycle.js';
import {
  attemptHumanFishing, attemptHumanHunt, attemptRaid, captureSheep, claimForagePatch,
  collectLooseLog, collectSheepFeed, gatherMaterials, leadSheep, markCommunityGround,
  nearestRaidTarget, resolveResourceConflict, updatePeople
} from './individuals/actions.js';
import { corralGate, moveOne } from './individuals/movement.js';
import {
  applyStrategicAiDecision, failStrategicAiRequest, pullStrategicAiRequests,
  setStrategicAiEnabled
} from './individuals/strategy.js';

import {
  acquireCommunityProperty, assignCommunityTasks, communitySatisfaction,
  completeCommunityTask, updateCommunityGovernance
} from './society/governance.js';
import { updateCommunityStages, updateSocialLinks } from './society/communities.js';
import { canCommunityBuild, chooseBuildSite, workOnCommunityStructure } from './settlements/construction.js';
import { findTradePartner, performTrade } from './economy/trade.js';
import { transferCommunityFood } from './economy/inventories.js';
import { buildKingdomStructure, destroyKingdomTower, recruitKingdomSoldier } from './kingdoms/commands.js';

// Stable public surface consumed by the UI and local tools. Keep subsystem
// capabilities grouped here instead of importing simulation internals in views.
const modules = {
  Cosmos: { seasonIndex, calendarDate },
  Atmosphere: { updateClimate, triggerDrought },
  Geosphere: { updateSoilAndWater, lowestNeighbor },
  Biosphere: {
    Botany: { updatePlants, isTreeAnchor },
    Zoology: { updateAnimals, feedSheep, reproduceAnimals },
    Ecology: { decompose }
  },
  // This legacy-facing name is retained to avoid changing existing UI callers.
  SocietyExperiment: {
    updatePeople,
    updateSocialLinks,
    updateCommunityStages,
    updateCommunityGovernance,
    communitySatisfaction,
    acquireCommunityProperty,
    assignCommunityTasks,
    completeCommunityTask,
    captureSheep,
    leadSheep,
    nearestRaidTarget,
    attemptRaid,
    claimForagePatch,
    resolveResourceConflict,
    reproducePeople,
    refreshHarvestSuitability,
    markCommunityGround,
    attemptHumanHunt,
    attemptHumanFishing,
    moveOne,
    corralGate,
    canCommunityBuild,
    chooseBuildSite,
    workOnCommunityStructure,
    gatherMaterials,
    collectLooseLog,
    collectSheepFeed,
    performTrade,
    findTradePartner,
    transferCommunityFood,
    feedCommunalHerds,
    setStrategicAiEnabled,
    pullStrategicAiRequests,
    applyStrategicAiDecision,
    failStrategicAiRequest
  }
};

const kingdomCommands = {
  buildKingdomStructure,
  destroyKingdomTower,
  recruitKingdomSoldier
};

export default {
  width: WIDTH,
  height: HEIGHT,
  cellAreaM2: CELL_AREA_M2,
  seasons: SEASONS,
  plants: PLANTS,
  animals: ANIMALS,
  actions: PEOPLE_ACTIONS,
  animalActions: ANIMAL_ACTIONS,
  colors: COLORS,
  nutrition: { fruit: 1, meat: MEAT_NUTRITIONAL_VALUE },
  createWorld,
  tick,
  stepDay,
  snapshot,
  inspectTile,
  addIndividuals,
  distance,
  modules,
  kingdomCommands
};
