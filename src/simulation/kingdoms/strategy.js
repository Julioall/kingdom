import { DOMESTIC_SHEEP_DAILY_FEED, MEAT_NUTRITIONAL_VALUE, PLANTS } from '../../config/ecosystem.js';
import { communityFoodStock, transferInventoryToStores } from '../economy/inventories.js';
import { communitySeedSupply } from '../economy/seed-cargo.js';
import {
  COMMUNITY_FOOD_BUFFER_DAYS, communityFoodBufferDays, communityFoodBufferTarget, foodUnitsPerDay, kingdomFoodDemand
} from '../economy/food-policy.js';
import { canRepairKingdomStructure, damagedKingdomStructures, nextCommunityStructure,
  FIELD_CONSTRUCTION_MIN_ENERGY, FIELD_CONSTRUCTION_MIN_FOOD_RESERVE } from '../settlements/construction.js';
import { communityHerdPenAssignments, communityNeedsAdditionalPen, DOMESTIC_SHEEP_PER_PEN } from '../ecology/herd.js';
import { cultivatedFieldStandingBiomass, cultivatedFieldYieldTarget } from '../ecology/plants.js';
import { calendarDate } from '../ecology/climate.js';
import { log } from '../core/events.js';
import { recruitKingdomSoldier, SOLDIER_COST } from './commands.js';
import { AI_DECISION_CONTRACT_VERSION, validateDecisionAction, validateDecisionResult } from '../../ai/contracts.js';
import { stripAbsoluteCalendarFields } from '../../ai/observations.js';
import { KINGDOM_STRATEGY_DECISION_GUIDANCE } from '../../ai/kingdom-strategy-prompt.js';

const COMMUNITY_TASKS = new Set(['forage', 'trade', 'collect_feed', 'gather', 'build', 'capture_sheep']);
const COMMUNITY_BUILDING_TYPES = new Set(['abrigo', 'roça', 'curral', 'posto de coleta', 'acampamento']);
const KINGDOM_AI_INTERVAL_DAYS = 24;
const KINGDOM_AI_REQUEST_TTL_DAYS = 48;
const KINGDOM_AI_RETRY_DAYS = 8;
const TASK_DETAILS = Object.freeze({
  forage: { title: 'repor a reserva comum de alimento', skill: 'forage' },
  trade: { title: 'trocar excedentes por alimento no mercado', skill: 'diplomacy' },
  collect_feed: { title: 'repor a ração da guarnição animal', skill: 'care' },
  capture_sheep: { title: 'procurar e conduzir uma ovelha visível ao curral', skill: 'care' },
  gather: { title: 'reunir materiais para a próxima obra', skill: 'gather' },
  build: { title: 'concluir a próxima obra comunitária', skill: 'build' }
});
const ROYAL_BUILD_DETAILS = Object.freeze({
  'prepare-food-access': { title: 'construir abrigo para apoiar coleta e caça', skill: 'build' },
  'invest-in-cultivated-food': { title: 'construir e semear uma roça', skill: 'build' },
  'replant-cultivated-food': { title: 'replantar uma roça com sementes reservadas', skill: 'build' },
  'invest-in-herd-capacity': { title: 'construir um curral para ampliar o rebanho', skill: 'build' }
});

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function foodBufferDaysForReport(community) {
  if (Number.isFinite(community.foodBufferDays)) return Math.max(0, community.foodBufferDays);
  if (Number.isFinite(community.sharedFood) && Number.isFinite(community.dailyFoodNeed)) {
    return communityFoodBufferDays(community.sharedFood, community.dailyFoodNeed);
  }
  // Older persisted reports only carried the per-resident stock value.
  return Number.isFinite(community.foodPerResident) && community.foodPerResident < 8 ? 0 : Infinity;
}

/**
 * Build the ruler's compact, aggregate report. It deliberately omits people,
 * person IDs, individual needs, and individual perceptions.
 */
export function observeKingdomStrategy(world, kingdomId) {
  const kingdom = world.kingdoms.find(item => item.id === kingdomId);
  if (!kingdom) return null;
  const community = world.communities.find(item => item.id === kingdom.communityId && !item.dissolved);
  const market = kingdom.market || {};
  const foodDemand = kingdomFoodDemand(world, kingdom);
  const population = foodDemand.members.length;
  const dailyFoodNeed = foodDemand.dailyFoodNeed;
  const memberIds = new Set(kingdom.memberIds || []);
  const reportedDemand = finite(market.demand && market.demand.food);
  const foodStock = communityFoodStock(community);
  const foodPerResident = foodStock / Math.max(1, population);
  const foodBufferTarget = communityFoodBufferTarget(dailyFoodNeed);
  const foodBufferDays = communityFoodBufferDays(foodStock, dailyFoodNeed);
  const communityStock = community && community.stores || {};
  const marketStock = market.stock || {};
  const marketFoodTradeable = foodStock < foodBufferTarget && finite(marketStock.food) >= 12
    && (finite(communityStock.gold) >= 6
      || (finite(communityStock.wood) >= 26 && finite(marketStock.wood) + 8 <= 260)
      || (finite(communityStock.stone) >= 18 && finite(marketStock.stone) + 6 <= 260));
  const herdSummary = community
    ? communityHerdPenAssignments(world, community.id)
    : { pens: [], animals: [], counts: new Map() };
  const sheepCount = herdSummary.animals.length;
  const feedStock = finite(community && community.stores && community.stores.feed);
  const feedTarget = Math.max(8, sheepCount * 5);
  const feedReserveDays = sheepCount > 0 ? feedStock / (sheepCount * DOMESTIC_SHEEP_DAILY_FEED) : null;
  const communityStructures = community
    ? world.structures.filter(structure => structure.communityId === community.id && structure.destroyedDay == null
      && structure.integrity !== 0 && (!structure.kingdomProject || structure.complete))
    : [];
  const activeCropProject = communityStructures.some(structure => structure.type === 'roça' && !structure.complete);
  const safeBuilderFoodFloor = activeCropProject ? FIELD_CONSTRUCTION_MIN_FOOD_RESERVE : 16;
  const safeBuilderEnergyFloor = activeCropProject ? FIELD_CONSTRUCTION_MIN_ENERGY : 27;
  const safeBuilderAvailable = world.people.some(person => person.alive && memberIds.has(person.id) && person.role !== 'soldier'
    && person.ageDays >= 12 * 365 && person.energy > safeBuilderEnergyFloor && person.hydration > 18 && person.health > 28
    && person.foodReserve > safeBuilderFoodFloor);
  const activeFoodProject = communityStructures.some(structure => ['abrigo', 'roça'].includes(structure.type) && !structure.complete);
  const size = community ? community.memberIds.length : population;
  const buildPlan = community ? nextCommunityStructure(world, community, size, communityStructures) : null;
  const woodStock = finite(community && community.stores && community.stores.wood);
  const stoneStock = finite(community && community.stores && community.stores.stone);
  const buildLimit = size >= 12 ? 5 : size >= 8 ? 4 : size >= 6 ? 3 : size >= 3 ? 1 : 0;
  const completedStructures = communityStructures.filter(structure => structure.complete
    && COMMUNITY_BUILDING_TYPES.has(structure.type)).length;
  const buildWindowOpen = !!community && world.day - finite(community.lastBuildDay, -999) >= 24;
  const capacityExpansion = community && buildPlan?.type === 'curral' && communityNeedsAdditionalPen(world, community.id);
  const constructionReady = !!buildPlan && (buildPlan.type === 'ongoing'
    || ((completedStructures < buildLimit || capacityExpansion) && buildWindowOpen
      && woodStock >= buildPlan.woodCost && stoneStock >= buildPlan.stoneCost
      && foodStock >= buildPlan.foodCost));
  const constructionMaterialNeed = buildPlan && buildPlan.type !== 'ongoing'
    ? Math.max(0, buildPlan.woodCost - woodStock) + Math.max(0, buildPlan.stoneCost - stoneStock)
    : 0;
  const openPenSlots = herdSummary.pens.reduce((sum, pen) => sum
    + Math.max(0, DOMESTIC_SHEEP_PER_PEN - (herdSummary.counts.get(pen.id) || 0)), 0);
  const visibleWildSheep = new Set();
  if (community && openPenSlots > 0) {
    const animalsById = new Map((world.animals || []).map(animal => [animal.id, animal]));
    for (const person of world.people || []) {
      if (!person.alive || person.communityId !== community.id || person.role === 'soldier') continue;
      for (const sighting of person.perception?.animals || []) {
        if (sighting.speciesId !== 'sheep' || !sighting.visible || finite(sighting.distance, 99) > 5.5) continue;
        const animal = animalsById.get(sighting.id);
        if (animal && (!animal.alive || animal.speciesId !== 'sheep' || animal.herdCommunityId != null || animal.beingLedBy)) continue;
        if (animal) visibleWildSheep.add(animal.id);
      }
    }
  }
  const fieldStructures = communityStructures.filter(structure => structure.type === 'roça');
  const seedStock = Math.max(0, finite(communityStock.seeds));
  const spentFields = fieldStructures.filter(field => field.complete && field.cropCycleState === 'spent')
    .sort((a, b) => finite(a.cropLastSowedDay, a.builtDay || 0) - finite(b.cropLastSowedDay, b.builtDay || 0) || a.id - b.id);
  const replantAvailable = community ? communitySeedSupply(world, community.id, 'replant') : 0;
  const replantField = replantAvailable > .01 ? spentFields[0] || null : null;
  const cropIndex = PLANTS.findIndex(plant => plant.id === 'cultivated-root');
  const cropRootReserve = cropIndex >= 0 ? Math.max(0, finite(PLANTS[cropIndex].rootReserve)) : 0;
  let standingCropBiomass = 0, harvestableCropPotential = 0;
  for (const field of fieldStructures.filter(structure => structure.complete)) {
    for (const index of field.fieldTileIndices || []) {
      const tile = world.tiles?.[index];
      if (!tile || tile.cropFieldId !== field.id) continue;
      const amount = cropIndex >= 0 ? Math.max(0, finite(tile.plants?.[cropIndex])) : 0;
      standingCropBiomass += amount;
      harvestableCropPotential += Math.max(0, amount - cropRootReserve);
    }
  }
  const activeFoodProjectType = communityStructures.find(structure => !structure.complete)?.type || null;
  const nextFoodStructureType = activeFoodProjectType
    || (['abrigo', 'roça', 'curral'].includes(buildPlan?.type) ? buildPlan.type : null);
  const foodInfrastructure = {
    completedFields: fieldStructures.filter(structure => structure.complete).length,
    activeFieldProject: fieldStructures.some(structure => !structure.complete),
    plantedFieldCount: fieldStructures.filter(field => field.complete && (field.fieldTileIndices || [])
      .some(index => world.tiles?.[index]?.cropFieldId === field.id)).length,
    standingCropBiomass: Number(standingCropBiomass.toFixed(1)),
    harvestableCropPotential: Number(harvestableCropPotential.toFixed(1)),
    harvestedCropToDate: Number(fieldStructures.reduce((sum, field) => sum + Math.max(0, finite(field.cropHarvested)), 0).toFixed(1)),
    fields: fieldStructures.filter(field => field.complete).map(field => {
      const plantedTileCount = (field.fieldTileIndices || []).filter(index => world.tiles?.[index]?.cropFieldId === field.id).length;
      const standingBiomass = cultivatedFieldStandingBiomass(world, field);
      const seedMass = Math.max(0, finite(field.cropSeededBiomass, finite(field.seedMass)));
      return {
        id: field.id,
        plantedTileCount,
        seedMass,
        yieldTarget: finite(field.cropYieldTarget, cultivatedFieldYieldTarget(seedMass, plantedTileCount)),
        growthGenerated: finite(field.cropGrowthGenerated),
        harvestedThisCycle: finite(field.cropHarvestedThisCycle),
        standingBiomass: Number(standingBiomass.toFixed(1)),
        seedReserveReturned: finite(field.cropSeedsRetainedThisCycle),
        foodDelivered: finite(field.foodDelivered),
        cycleState: field.cropCycleState || (standingBiomass > 0 ? 'growing' : 'unplanted')
      };
    }),
    activeProjectType: activeFoodProjectType,
    nextBuildType: nextFoodStructureType,
    nextBuildReady: !!nextFoodStructureType && constructionReady && safeBuilderAvailable,
    seedStock,
    replantReady: !!replantField,
    replantFieldId: replantField?.id ?? null,
    replantSeedMass: replantField ? Math.min(replantAvailable,
      Math.max(0, finite(replantField.cropSeededBiomass, finite(replantField.seedMass)))) : 0,
    buildSitePrevalidated: false,
    buildSiteRequirement: 'O construtor precisa encontrar área válida e alcançável; prontidão de materiais não confirma o local.',
    completedCorrals: herdSummary.pens.length,
    sheepCapacity: herdSummary.pens.length * DOMESTIC_SHEEP_PER_PEN,
    sheepCount,
    openPenSlots,
    visibleWildSheepCount: visibleWildSheep.size,
    feedStock,
    feedTarget,
    benefits: {
      roça: 'Cada lote depende da quantidade de sementes e da área plantada; o alvo é limitado por sementes e células, a colheita é finita e limpa as plantas do campo. Não conta biomassa em pé como estoque.',
      curral: 'Cada curral acomoda até ' + DOMESTIC_SHEEP_PER_PEN + ' ovelhas; rebanho precisa de ração e só vira carne pelo abate registrado.',
      abrigo: 'Oferece um ponto seguro para repouso e pode habilitar caça local; não adiciona alimento por si só.'
    }
  };
  const activeRoyalAssignments = (world.people || []).filter(person => person.alive
    && community?.memberIds.includes(person.id) && person.assignment?.source === 'kingdom-strategy'
    && person.assignment.communityId === community.id && person.assignment.expiresDay >= world.day);
  const activeRoyalOrders = Array.from(activeRoyalAssignments.reduce((groups, person) => {
    const assignment = person.assignment;
    const key = String(assignment.goal || 'sem-objetivo') + ':' + assignment.action;
    const order = groups.get(key) || { goal: assignment.goal || null, action: assignment.action, workers: 0,
      pausedWorkers: 0, longestActiveDays: 0, phases: [] };
    order.workers++;
    if (assignment.pauseReason) order.pausedWorkers++;
    order.longestActiveDays = Math.max(order.longestActiveDays, world.day - finite(assignment.assignedDay, world.day));
    const phase = assignment.supplyPhase || assignment.pauseReason || assignment.action;
    if (!order.phases.includes(phase)) order.phases.push(phase);
    groups.set(key, order);
    return groups;
  }, new Map()).values());
  const lastRoyalOutcome = kingdom.strategy?.lastOutcome ? {
    status: kingdom.strategy.lastOutcome.status || null,
    goal: kingdom.strategy.lastOutcome.goal || null,
    action: kingdom.strategy.lastOutcome.action || null,
    daysAgo: Math.max(0, world.day - finite(kingdom.strategy.lastOutcome.day, world.day)),
    reason: String(kingdom.strategy.lastOutcome.reason || '').slice(0, 180)
  } : null;
  const recentRoyalOutcomes = (kingdom.strategy?.history || []).slice(-4).map(item => ({
    status: item.status || null, goal: item.goal || null, action: item.action || null,
    daysAgo: Math.max(0, world.day - finite(item.day, world.day)),
    reason: String(item.reason || '').slice(0, 140)
  }));
  const date = calendarDate(world.day);
  const militaryCenters = (kingdom.militaryCenterIds || []).map(id => world.structures.find(structure => structure.id === id && structure.complete)).filter(Boolean);
  const garrisonSize = militaryCenters.reduce((count, center) => count + (center.soldierIds || []).length, 0);
  const recruitmentSlots = militaryCenters.reduce((count, center) => {
    const pending = world.people.filter(person => person.alive && person.recruitmentOrder?.militaryCenterId === center.id).length;
    return count + Math.max(0, (center.capacity || 8) - (center.soldierIds || []).length - pending);
  }, 0);
  const eligibleRecruitCount = world.people.filter(person => person.alive && memberIds.has(person.id)
    && person.role === 'resident' && person.ageDays >= 15 * 365 && !person.recruitmentOrder
    && person.energy >= 30 && person.hydration >= 30 && person.health >= 55 && person.foodReserve >= 24).length;
  const treasuryStock = kingdom.treasury && kingdom.treasury.stock || {};
  const damagedStructures = damagedKingdomStructures(world, kingdom.id);
  const repairs = {
    damagedStructureCount: damagedStructures.length,
    criticalStructureCount: damagedStructures.filter(item => item.damage >= .5).length,
    damagedStructures: damagedStructures.slice(0, 5).map(item => ({
      id: item.structure.id, type: item.structure.type,
      integrity: Number(item.integrity.toFixed(2)),
      healthRatio: item.healthRatio == null ? null : Number(item.healthRatio.toFixed(2)),
      x: item.structure.x, y: item.structure.y
    })),
    repairCost: { wood: 3, stone: 2 },
    repairReady: canRepairKingdomStructure(world, community)
  };
  const recruitmentAvailable = recruitmentSlots > 0 && eligibleRecruitCount > 0
    && Object.entries(SOLDIER_COST).every(([resource, amount]) => finite(treasuryStock[resource]) >= amount);
  const availableSoldiers = world.people.filter(person => person.alive && person.kingdomId === kingdom.id
    && person.role === 'soldier' && person.campaignId == null).length;
  const trainingOrders = world.people.filter(person => person.alive && memberIds.has(person.id) && person.recruitmentOrder).length;
  const pendingForceRequests = (kingdom.militaryIntel || []).filter(item => item.kind === 'force-requested' && item.status === 'pending');
  const activeCampaign = (world.campaigns || []).find(campaign => campaign.status !== 'complete'
    && (campaign.attackerId === kingdom.id || campaign.defenderId === kingdom.id));
  const knownMilitaryEvidence = (kingdom.militaryIntel || []).filter(item => (item.reportDay ?? item.day) <= world.day).slice(-4).map(item => ({
    day: item.day, kind: item.kind, opponentId: item.opponentId, cause: item.cause,
    source: item.source, status: item.status ?? null, warId: item.warId ?? null,
    location: item.location ? { x: item.location.x, y: item.location.y } : null,
    soldiersObserved: item.soldiersObserved ?? null, postsObserved: item.postsObserved ?? null,
    resourceKind: item.resourceKind ?? null, outcome: item.outcome ?? null
  }));

  return {
    day: world.day,
    calendar: { year: date.year, season: date.season, dayOfSeason: date.dayOfSeason, daysInSeason: date.daysInSeason },
    kingdom: { id: kingdom.id, name: kingdom.name },
    population,
    community: {
      id: community ? community.id : null,
      sharedFood: foodStock,
      activeFoodProject,
      foodPerResident,
      dailyFoodNeed,
      foodBufferTarget,
      foodBufferDays,
      foodBufferTargetDays: COMMUNITY_FOOD_BUFFER_DAYS,
      feedStock,
      feedTarget,
      feedReserveDays,
      sheepCount,
      woodStock,
      stoneStock,
      goldStock: finite(communityStock.gold),
      marketFoodTradeable,
      buildPlan: buildPlan ? { ...buildPlan } : null,
      constructionReady,
      safeBuilderAvailable,
      activeCropProject,
      constructionMaterialNeed,
      foodInfrastructure,
      activeRoyalOrders,
      lastRoyalOutcome,
      recentRoyalOutcomes,
      repairs
    },
    treasury: {
      food: finite(kingdom.treasury && kingdom.treasury.stock && kingdom.treasury.stock.food),
      feed: finite(kingdom.treasury && kingdom.treasury.stock && kingdom.treasury.stock.feed),
      wood: finite(kingdom.treasury && kingdom.treasury.stock && kingdom.treasury.stock.wood),
      stone: finite(kingdom.treasury && kingdom.treasury.stock && kingdom.treasury.stock.stone),
      gold: finite(kingdom.treasury && kingdom.treasury.stock && kingdom.treasury.stock.gold)
    },
    market: {
      foodPrice: finite(market.prices && market.prices.food),
      foodStock: finite(marketStock.food),
      foodSupply: finite(market.supply && market.supply.food),
      foodDemand: reportedDemand
    },
    military: {
      frontierAlert: kingdom.frontierAlert && world.day - kingdom.frontierAlert.day <= 10 ? { ...kingdom.frontierAlert } : null,
      recentTerritoryLosses: (kingdom.frontierLosses || []).filter(item => world.day - item.day <= 60).map(item => ({ ...item })),
      knownEnemyInstallations: (kingdom.knownEnemyInstallations || []).filter(item => world.day - item.day <= 60).map(item => ({ ...item })),
      activeCampaign: activeCampaign ? {
        id: activeCampaign.id, status: activeCampaign.status, cause: activeCampaign.cause,
        target: { x: activeCampaign.target.x, y: activeCampaign.target.y },
        role: activeCampaign.attackerId === kingdom.id ? 'attacker' : 'defender'
      } : null,
      knownEvidence: knownMilitaryEvidence,
      pendingForceRequests: pendingForceRequests.map(item => ({ warId: item.warId, opponentId: item.opponentId,
        cause: item.cause, day: item.day, location: item.location ? { ...item.location } : null })),
      availableSoldiers,
      recruitment: {
        available: recruitmentAvailable, slots: recruitmentSlots,
        eligibleResidents: eligibleRecruitCount, trainingOrders, cost: { ...SOLDIER_COST }
      }
    },
    territoryTiles: Math.max(0, finite(kingdom.territoryTileCount)),
    garrisonSize,
    policy: {
      priorities: Array.isArray(kingdom.policy && kingdom.policy.priorities) ? kingdom.policy.priorities.slice(0, 6) : [],
      droughtReserveDays: Math.max(0, finite(kingdom.policy && kingdom.policy.droughtReserveDays))
    }
  };
}

function dispatchKingdomReserves(world, kingdom, day = world.day + 1) {
  const community = world.communities.find(item => item.id === kingdom.communityId && !item.dissolved);
  if (!community) return null;
  const foodDemand = kingdomFoodDemand(world, kingdom);
  const sheep = world.animals.filter(animal => animal.alive && animal.speciesId === 'sheep' && animal.herdCommunityId === community.id).length;
  const stock = kingdom.treasury && kingdom.treasury.stock;
  if (!stock) return null;

  // Keep a six-month shared reserve so workers can leave food collection once
  // the store has room for routine consumption and nearby population growth.
  // If its remaining stock is below one day's need, release the treasury floor
  // so tomorrow's ration can be buffered. The configured drought reserve is a
  // ceiling on protected treasury stock, not a guarantee that it is funded.
  // Every delivered unit is debited in full.
  const dailyFoodNeed = foodDemand.dailyFoodNeed;
  const dailyFoodUnits = foodUnitsPerDay(dailyFoodNeed);
  const foodTarget = communityFoodBufferTarget(dailyFoodNeed);
  const reserveDays = Math.min(90, Math.max(0, finite(kingdom.policy && kingdom.policy.droughtReserveDays)));
  const communityFoodBefore = communityFoodStock(community);
  const communityFeedBefore = community.stores.feed || 0;
  const treasuryFoodBefore = stock.food || 0;
  const treasuryFeedBefore = stock.feed || 0;
  const emergencyFoodRelease = communityFoodBefore < dailyFoodUnits;
  const treasuryFoodFloor = emergencyFoodRelease
    ? 0 : Math.min(stock.food || 0, dailyFoodUnits * reserveDays);
  const foodAvailable = Math.max(0, (stock.food || 0) - treasuryFoodFloor);
  const foodGap = Math.max(0, foodTarget - communityFoodBefore);
  const foodMoved = transferInventoryToStores(kingdom.treasury, community, 'food', Math.min(foodGap, foodAvailable), 'community-reserve-delivery');

  // Fund the same per-animal reserve used by the planner. Retain one week of
  // feed in the treasury while the community has at least three days of feed;
  // below that threshold, release the floor to avoid preventable livestock deaths.
  const feedTarget = sheep > 0 ? Math.max(8, sheep * 5) : 0;
  const treasuryFeedFloor = (community.stores.feed || 0) < sheep * DOMESTIC_SHEEP_DAILY_FEED * 3
    ? 0 : sheep * DOMESTIC_SHEEP_DAILY_FEED * 7;
  const feedAvailable = Math.max(0, (stock.feed || 0) - treasuryFeedFloor);
  const feedGap = Math.max(0, feedTarget - communityFeedBefore);
  const feedMoved = transferInventoryToStores(kingdom.treasury, community, 'feed', Math.min(feedGap, feedAvailable), 'community-reserve-delivery');

  if (foodMoved <= .01 && feedMoved <= .01) return null;
  const delivery = {
    day,
    source: 'treasury',
    sourceId: kingdom.treasury.ownerId ?? kingdom.id,
    destination: 'community',
    destinationId: community.id,
    foodReason: foodMoved > .01
      ? emergencyFoodRelease ? 'emergency-community-below-one-day' : 'restore-180-day-community-buffer'
      : null,
    feedReason: feedMoved > .01 ? 'restore-herd-feed-buffer' : null,
    food: foodMoved,
    feed: feedMoved,
    communityFoodBefore,
    communityFood: communityFoodStock(community),
    communityFeedBefore,
    communityFeed: community.stores.feed || 0,
    treasuryFoodBefore,
    treasuryFood: stock.food || 0,
    treasuryFeedBefore,
    treasuryFeed: stock.feed || 0,
    protectedFoodFloor: treasuryFoodFloor,
    droughtReserveDays: reserveDays,
    dailyFoodNeed,
    dailyFoodUnits,
    communityFoodTarget: foodTarget
  };
  kingdom.reserveTransfers ||= [];
  kingdom.reserveTransfers.push(delivery);
  if (kingdom.reserveTransfers.length > 24) kingdom.reserveTransfers.shift();
  const amountText = amount => Number(amount.toFixed(3)).toString().replace('.', ',');
  const movement = [foodMoved > .01 ? amountText(foodMoved) + ' alimento' : null,
    feedMoved > .01 ? amountText(feedMoved) + ' ração' : null].filter(Boolean).join(' e ');
  const reasons = [
    delivery.foodReason === 'emergency-community-below-one-day'
      ? 'a reserva comum estava abaixo de um dia de consumo e o piso de seca foi liberado'
      : delivery.foodReason === 'restore-180-day-community-buffer' ? 'reposição do buffer alimentar comunitário de 180 dias' : null,
    delivery.feedReason ? 'reposição do buffer de ração do rebanho' : null
  ].filter(Boolean).join(' e ');
  const message = kingdom.name + ' transferiu ' + movement + ' do tesouro para o estoque comunitário no dia ' + day
    + ': ' + reasons + '. Após o repasse: tesouro com ' + amountText(stock.food || 0) + ' alimento; reserva comum com '
    + amountText(communityFoodStock(community)) + ' unidades; piso de seca calculado em '
    + amountText(treasuryFoodFloor) + ' alimento.';
  community.history.push(message);
  log(world, message, day);
  return delivery;
}

function recruitForPendingForce(world, kingdom, report) {
  if (!report || world.strategicAI?.enabled) return false;
  const request = report.military.pendingForceRequests[0];
  if (!request || report.military.availableSoldiers > 0 || report.military.recruitment.trainingOrders > 0
      || !report.military.recruitment.available
      || report.community.sharedFood < foodUnitsPerDay(report.community.dailyFoodNeed)) return false;

  const result = recruitKingdomSoldier(world, kingdom.id, { startedDay: world.day + 1 });
  if (!result.ok) return false;
  kingdom.militaryRecruitments ||= [];
  kingdom.militaryRecruitments.push({
    day: world.day + 1, warId: request.warId, opponentId: request.opponentId,
    personId: result.person.id, status: 'training', cost: { ...SOLDIER_COST }, readyDay: result.readyDay
  });
  if (kingdom.militaryRecruitments.length > 24) kingdom.militaryRecruitments.shift();
  const opponent = (world.kingdoms || []).find(item => item.id === request.opponentId);
  const labels = { food: 'alimento', wood: 'madeira', gold: 'ouro' };
  const cost = Object.entries(SOLDIER_COST).map(([resource, amount]) => amount + ' ' + labels[resource]).join(', ');
  const message = kingdom.name + ' iniciou o treinamento de ' + result.person.name + ' após observar que a campanha contra '
    + (opponent?.name || 'um reino rival') + ' aguardava efetivo; custo: ' + cost + '. '
    + 'A reserva civil permaneceu acima de um dia de consumo.';
  const community = (world.communities || []).find(item => item.id === kingdom.communityId && !item.dissolved);
  if (community) community.history.push(message);
  log(world, message, world.day + 1);
  return true;
}

/** Pure deterministic fallback: identical aggregate reports produce identical plans. */
export function planKingdomStrategy(report) {
  if (!report || !report.community || report.community.id == null) {
    return { goal: 'maintain-autonomy', action: null, priority: 'normal', garrisonMode: 'standby', reason: 'Não há comunidade registrada para receber uma delegação.' };
  }
  const garrisonMode = report.garrisonSize > 0 && !report.military?.activeCampaign ? 'patrol' : 'standby';
  const sharedFoodBufferDays = foodBufferDaysForReport(report.community);
  if (sharedFoodBufferDays < COMMUNITY_FOOD_BUFFER_DAYS && report.community.marketFoodTradeable) {
    return {
      goal: 'trade-for-shared-food', action: 'trade', priority: 'urgent', garrisonMode,
      reason: 'A reserva comum está baixa e o mercado tem alimento disponível para troca com ouro ou excedentes observados.'
    };
  }
  if (report.community.foodInfrastructure?.replantReady && sharedFoodBufferDays > 1) {
    return {
      goal: 'replant-cultivated-food', action: 'build', priority: 'normal', garrisonMode,
      reason: 'A roça anterior terminou e há sementes já reservadas; replantar agora mantém o crescimento em paralelo ao consumo da colheita entregue.'
    };
  }
  if ((report.community.buildPlan && ['abrigo', 'roça'].includes(report.community.buildPlan.type)
      || report.community.activeCropProject || report.community.activeFoodProject)
      && report.community.constructionReady && report.community.safeBuilderAvailable) {
    return {
      goal: 'invest-in-cultivated-food', action: 'build', priority: 'normal', garrisonMode,
      reason: 'Os materiais permitem preparar abrigo ou roça para abastecimento; há um trabalhador seguro e o cultivo usa sementes reais do talhão.'
    };
  }
  if (report.community.buildPlan?.type === 'roça' && report.community.constructionMaterialNeed > 0) {
    return {
      goal: 'prepare-cultivated-field', action: 'gather', priority: 'normal', garrisonMode,
      reason: 'A primeira roça é a próxima infraestrutura alimentar, mas falta madeira ou pedra; um trabalhador reúne os materiais enquanto os demais podem repor comida.'
    };
  }
  if (sharedFoodBufferDays < COMMUNITY_FOOD_BUFFER_DAYS) {
    const urgency = sharedFoodBufferDays < 2 ? 'urgent' : 'normal';
    return {
      goal: 'secure-shared-food', action: 'forage', priority: urgency, garrisonMode,
      reason: 'A reserva compartilhada cobre ' + sharedFoodBufferDays.toFixed(1)
        + ' dias; a meta é ' + COMMUNITY_FOOD_BUFFER_DAYS + ' dias de consumo observado.'
    };
  }

  if (report.community.repairs?.repairReady) {
    return {
      goal: 'repair-damaged-structures', action: 'build',
      priority: report.community.repairs.criticalStructureCount > 0 ? 'urgent' : 'normal', garrisonMode,
      reason: report.community.repairs.criticalStructureCount > 0
        ? 'Uma construção perdeu pelo menos metade da integridade ou da vida; o tesouro pode pagar o reparo.'
        : 'O relatório encontrou construções danificadas e há madeira e pedra no tesouro para repará-las.'
    };
  }

  if (report.community.sheepCount > 0 && report.community.feedStock < report.community.feedTarget) {
    return {
      goal: 'secure-herd-feed', action: 'collect_feed', priority: 'normal', garrisonMode,
      reason: 'A reserva de ração está abaixo da necessidade observada do rebanho.'
    };
  }

  if (report.community.constructionReady) {
    return {
      goal: 'complete-community-structure', action: 'build', priority: 'normal', garrisonMode,
      reason: 'Os estoques comunitários cobrem os materiais e o alimento exigidos pela próxima obra.'
    };
  }

  if (report.community.buildPlan && report.community.constructionMaterialNeed > 0) {
    return {
      goal: 'gather-construction-materials', action: 'gather', priority: 'normal', garrisonMode,
      reason: 'A próxima obra ainda precisa de madeira ou pedra dos arredores observáveis.'
    };
  }

  return {
    goal: 'maintain-autonomy', action: null, priority: 'normal', garrisonMode,
    reason: 'Os relatórios não mostram falta urgente de alimento, ração ou materiais de construção.'
  };
}

function normalizePlan(proposal, report) {
  if (!proposal || typeof proposal !== 'object' || typeof proposal.goal !== 'string') {
    return { valid: false, reason: 'A estratégia não devolveu um objetivo válido.' };
  }
  const garrisonMode = proposal.garrisonMode == null
    ? report.garrisonSize > 0 ? 'patrol' : 'standby'
    : proposal.garrisonMode;
  if (!['patrol', 'standby'].includes(garrisonMode)) return { valid: false, reason: 'A postura de guarnição não é reconhecida pelo domínio.' };
  if (proposal.action == null) return proposal.goal === 'maintain-autonomy'
    ? { valid: true, plan: { goal: proposal.goal.slice(0, 64), action: null, priority: 'normal', garrisonMode,
        reason: String(proposal.reason || '').replace(/[<>\u0000-\u001f]/g, ' ').trim().slice(0, 180) } }
    : { valid: false, reason: 'Um objetivo delegável precisa indicar uma tarefa.' };
  if (!COMMUNITY_TASKS.has(proposal.action)) return { valid: false, reason: 'A tarefa estratégica não pertence às ações delegáveis do domínio.' };
  if (proposal.action === 'collect_feed' && (!report.community.sheepCount || report.community.feedStock >= report.community.feedTarget)) {
    return { valid: false, reason: 'A comunidade não tem rebanho ou a ração observada já cobre a meta.' };
  }
  if (proposal.action === 'capture_sheep' && (!report.community.foodInfrastructure
      || report.community.foodInfrastructure.openPenSlots <= 0
      || report.community.foodInfrastructure.visibleWildSheepCount <= 0)) {
    return { valid: false, reason: 'Não há ovelha selvagem visível ou vaga observada no curral.' };
  }
  if (proposal.action === 'build' && proposal.goal === 'repair-damaged-structures' && !report.community.repairs?.repairReady) {
    return { valid: false, reason: 'Não há construção danificada ou materiais suficientes no tesouro para repará-la.' };
  }
  if (proposal.action === 'build' && proposal.goal === 'replant-cultivated-food'
      && (!report.community.foodInfrastructure?.replantReady || foodBufferDaysForReport(report.community) <= 1)) {
    return { valid: false, reason: 'A roça não está esgotada com sementes reservadas ou a reserva comum está em emergência.' };
  }
  if (proposal.action === 'build' && !['repair-damaged-structures', 'replant-cultivated-food'].includes(proposal.goal)
      && !report.community.constructionReady) {
    return { valid: false, reason: 'A próxima construção não está autorizada pelos estoques, capacidade ou intervalo de obra.' };
  }
  if (proposal.action === 'gather' && (!report.community.buildPlan || report.community.constructionMaterialNeed <= 0)) {
    return { valid: false, reason: 'Não há necessidade observada de materiais para uma obra comunitária.' };
  }
  if (proposal.action === 'trade' && !report.community.marketFoodTradeable) {
    return { valid: false, reason: 'O relatório não mostra alimento de mercado acessível com ouro ou excedentes para troca.' };
  }
  const details = proposal.goal === 'repair-damaged-structures'
    ? { title: 'reparar construções danificadas', skill: 'build' }
    : ROYAL_BUILD_DETAILS[proposal.goal] || TASK_DETAILS[proposal.action];
  const priority = proposal.priority === 'urgent' ? 'urgent' : 'normal';
  return {
    valid: true,
    plan: {
      goal: proposal.goal.slice(0, 64), action: proposal.action, priority,
      garrisonMode,
      title: details.title, skill: details.skill,
      reason: String(proposal.reason || '').replace(/[<>\u0000-\u001f]/g, ' ').trim().slice(0, 180)
    }
  };
}

function kingdomAiChoice(id, label, proposal, report) {
  const normalized = normalizePlan(proposal, report);
  return normalized.valid ? { id, label, ...normalized.plan } : null;
}

function addFoodCapacityChoices(report, add) {
  const infrastructure = report.community.foodInfrastructure;
  const buildings = {
    abrigo: {
      id: 'prepare_food_shelter', label: 'Construir abrigo para apoiar coleta e caça', goal: 'prepare-food-access',
      reason: 'O abrigo apoia o repouso e pode habilitar caça local; não gera alimento sozinho.'
    },
    roça: {
      id: 'build_food_field', label: 'Construir e semear roça', goal: 'invest-in-cultivated-food',
      reason: 'A obra concluída semeia raízes com sementes finitas; moradores podem colher o campo e entregar a produção.'
    },
    curral: {
      id: 'build_food_corral', label: 'Ampliar o curral do rebanho', goal: 'invest-in-herd-capacity',
      reason: 'O curral oferece até 35 vagas; requer ração e ovelhas e não cria carne automaticamente.'
    }
  };
  const building = infrastructure && infrastructure.nextBuildReady && buildings[infrastructure.nextBuildType];
  if (building) add(building.id, building.label, {
    goal: building.goal, action: 'build', priority: 'normal', reason: building.reason
  });
  if (infrastructure?.openPenSlots > 0 && infrastructure.visibleWildSheepCount > 0) add(
    'capture_sheep', 'Procurar e conduzir ovelhas visíveis ao curral', {
      goal: 'expand-managed-herd', action: 'capture_sheep', priority: 'normal',
      reason: 'Há ovelhas selvagens observadas e vagas físicas no curral; o rebanho exige ração e não é estoque de carne.'
    }
  );
}

function addFieldReplantChoice(report, add) {
  const infrastructure = report?.community?.foodInfrastructure;
  if (!infrastructure?.replantReady || foodBufferDaysForReport(report.community) <= 1) return;
  add('replant_cultivated_field', 'Replantar a roça com sementes reservadas', {
    goal: 'replant-cultivated-food', action: 'build', priority: 'normal',
    reason: 'O lote anterior acabou, há sementes físicas reservadas e a reserva comum ainda cobre o trabalho de replantio.'
  });
}

export function kingdomStrategyChoices(report) {
  const fallback = planKingdomStrategy(report);
  const garrisonMode = fallback.garrisonMode || 'standby';
  const choices = [];
  const add = (id, label, proposal) => {
    const choice = kingdomAiChoice(id, label, { ...proposal, garrisonMode: proposal.garrisonMode ?? garrisonMode }, report);
    if (choice) choices.push(choice);
  };

  if (!report || !report.community || report.community.id == null) {
    add('maintain_autonomy', 'Manter iniciativa local', {
      goal: 'maintain-autonomy', action: null, priority: 'normal', reason: 'Não há comunidade registrada para receber uma delegação.'
    });
    return choices;
  }

  const sharedFoodBufferDays = foodBufferDaysForReport(report.community);
  if (sharedFoodBufferDays < COMMUNITY_FOOD_BUFFER_DAYS) {
    if (report.community.marketFoodTradeable) add('trade_for_food', 'Trocar excedentes por alimento', {
      goal: 'trade-for-shared-food', action: 'trade', priority: 'urgent', reason: 'A reserva comum está baixa e há alimento acessível no mercado.'
    });
    if (report.community.buildPlan?.type === 'roça' && report.community.constructionMaterialNeed > 0) add(
      'prepare_cultivated_field', 'Reunir materiais para a primeira roça', {
        goal: 'prepare-cultivated-field', action: 'gather', priority: 'normal',
        reason: 'Falta madeira ou pedra para iniciar uma roça; a governança reserva no máximo um trabalhador e mantém os demais disponíveis para comida.'
      }
    );
    add('forage_for_food', 'Buscar alimento para a reserva comum', {
      goal: 'secure-shared-food', action: 'forage', priority: sharedFoodBufferDays < 2 ? 'urgent' : 'normal',
      reason: 'O estoque compartilhado está baixo para o número de moradores.'
    });
    addFieldReplantChoice(report, add);
    addFoodCapacityChoices(report, add);
    if (report.community.repairs?.repairReady && report.community.repairs.criticalStructureCount > 0) add(
      'repair_damaged_structures', 'Reparar uma construção crítica', {
        goal: 'repair-damaged-structures', action: 'build', priority: 'urgent',
        reason: 'Uma construção perdeu pelo menos metade da integridade ou da vida e há materiais no tesouro.'
      });
    return choices;
  }

  if (report.community.marketFoodTradeable) add('trade_for_food', 'Reforçar a reserva com uma troca', {
    goal: 'trade-for-shared-food', action: 'trade', priority: 'normal', reason: 'O mercado pode completar a reserva compartilhada usando excedentes disponíveis.'
  });
  if (report.community.repairs?.repairReady) add('repair_damaged_structures', 'Reparar construções danificadas', {
    goal: 'repair-damaged-structures', action: 'build',
    priority: report.community.repairs.criticalStructureCount > 0 ? 'urgent' : 'normal',
    reason: 'O relatório identificou construções danificadas e confirmou materiais no tesouro para repará-las.'
  });
  if (report.community.sheepCount > 0 && report.community.feedStock < report.community.feedTarget) {
    add('secure_herd_feed', 'Repor a ração do rebanho', {
      goal: 'secure-herd-feed', action: 'collect_feed', priority: 'normal', reason: 'A reserva de ração está abaixo da meta observada.'
    });
  }
  addFoodCapacityChoices(report, add);
  addFieldReplantChoice(report, add);
  if (report.community.constructionReady) {
    const cropProject = report.community.buildPlan && report.community.buildPlan.type === 'roça'
      || report.community.activeCropProject;
    add('build_project', cropProject ? 'Investir em cultivo de alimento' : 'Concluir a próxima construção', {
      goal: cropProject ? 'invest-in-cultivated-food' : 'complete-community-structure',
      action: 'build', priority: 'normal', reason: 'Os recursos e as condições observadas permitem avançar a construção.'
    });
  }
  if (report.community.buildPlan && report.community.constructionMaterialNeed > 0) {
    add('gather_materials', 'Reunir materiais para uma construção', {
      goal: 'gather-construction-materials', action: 'gather', priority: 'normal', reason: 'A próxima obra ainda precisa de materiais.'
    });
  }
  if (report.military && report.military.recruitment && report.military.recruitment.available) {
    choices.push({ id: 'recruit_soldier', label: 'Recrutar um soldado', command: 'recruit',
      goal: 'strengthen-garrison', action: null, reason: 'Há vaga militar, um adulto apto e recursos no tesouro para o treinamento.' });
  }
  if (report.garrisonSize > 0 && !report.military.activeCampaign) {
    add('patrol_borders', 'Patrulhar as fronteiras', {
      goal: 'maintain-autonomy', action: null, priority: 'normal', garrisonMode: 'patrol',
      reason: 'Manter a guarnição em patrulha para observar e proteger as fronteiras.'
    });
    add('reserve_garrison', 'Manter a guarnição em reserva', {
      goal: 'maintain-autonomy', action: null, priority: 'normal', garrisonMode: 'standby',
      reason: 'Manter os soldados em reserva e evitar patrulhas de rotina.'
    });
  }
  add('maintain_autonomy', 'Manter a iniciativa local', {
    goal: 'maintain-autonomy', action: null, priority: 'normal', reason: 'Os estoques observados permitem manter a iniciativa local.'
  });
  return choices;
}

function evidenceFor(report) {
  const foodBufferDays = foodBufferDaysForReport(report.community);
  const foodBufferTarget = Number.isFinite(report.community.foodBufferTarget)
    ? report.community.foodBufferTarget
    : communityFoodBufferTarget(report.community.dailyFoodNeed);
  return {
    population: report.population,
    sharedFood: Number(report.community.sharedFood.toFixed(1)),
    foodPerResident: Number(report.community.foodPerResident.toFixed(2)),
    foodBufferDays: Number.isFinite(foodBufferDays) ? Number(foodBufferDays.toFixed(2)) : null,
    foodBufferTarget: Number(foodBufferTarget.toFixed(1)),
    feedStock: Number(report.community.feedStock.toFixed(1)),
    feedTarget: Number(report.community.feedTarget.toFixed(1)),
    feedReserveDays: report.community.feedReserveDays == null ? null : Number(report.community.feedReserveDays.toFixed(1)),
    sheepCount: report.community.sheepCount,
    woodStock: Number(report.community.woodStock.toFixed(1)),
    stoneStock: Number(report.community.stoneStock.toFixed(1)),
    goldStock: Number(report.community.goldStock.toFixed(1)),
    marketFoodTradeable: report.community.marketFoodTradeable,
    marketFoodStock: Number(report.market.foodStock.toFixed(1)),
    treasuryFood: Number(report.treasury.food.toFixed(1)),
    treasuryFeed: Number(report.treasury.feed.toFixed(1)),
    constructionReady: report.community.constructionReady,
    repairs: {
      damagedStructureCount: report.community.repairs.damagedStructureCount,
      criticalStructureCount: report.community.repairs.criticalStructureCount,
      repairReady: report.community.repairs.repairReady,
      repairCost: { ...report.community.repairs.repairCost },
      damagedStructures: report.community.repairs.damagedStructures.map(item => ({ ...item }))
    },
    territoryTiles: report.territoryTiles,
    garrisonSize: report.garrisonSize,
    military: {
      activeCampaign: report.military.activeCampaign ? { ...report.military.activeCampaign } : null,
      knownEvidence: report.military.knownEvidence.map(item => ({ ...item })),
      pendingForceRequests: report.military.pendingForceRequests.map(item => ({ ...item })),
      availableSoldiers: report.military.availableSoldiers,
      recruitment: { ...report.military.recruitment, cost: { ...report.military.recruitment.cost } }
    }
  };
}

function kingdomAiState(world) {
  if (!world.strategicAI) world.strategicAI = { enabled: false, requests: [], decisions: 0, failures: 0, nextRequestSequence: 1 };
  const ai = world.strategicAI;
  ai.requests ||= [];
  ai.pendingByKingdom ||= {};
  ai.nextDecisionDays ||= {};
  ai.nextRequestSequence ||= 1;
  ai.decisions ||= 0;
  ai.failures ||= 0;
  ai.events ||= [];
  return ai;
}

function recordKingdomAiEvent(world, event) {
  const ai = kingdomAiState(world);
  ai.events.push({ day: world.day, ...event });
  if (ai.events.length > 120) ai.events.splice(0, ai.events.length - 120);
}

export function setStrategicAiEnabled(world, enabled) {
  const ai = kingdomAiState(world);
  ai.enabled = !!enabled;
  if (ai.enabled) {
    for (const kingdom of world.kingdoms || []) {
      const id = String(kingdom.id);
      ai.nextDecisionDays[id] = Math.min(ai.nextDecisionDays[id] || world.day + 1, world.day + 1);
    }
    return true;
  }

  ai.requests.length = 0;
  ai.pendingByKingdom = {};
  ai.nextDecisionDays = {};
  for (const kingdom of world.kingdoms || []) {
    if (!kingdom.strategy) continue;
    delete kingdom.strategy.aiPlan;
    kingdom.strategy.evaluatedDay = world.day - 8;
  }
  return false;
}

export function queueKingdomStrategicAiRequests(world) {
  const ai = world.strategicAI;
  if (!ai || !ai.enabled) return 0;
  if (ai.enqueuedDay !== world.day) { ai.enqueuedDay = world.day; ai.enqueuedToday = 0; }
  let added = 0;

  for (const kingdom of world.kingdoms || []) {
    if (ai.enqueuedToday >= 2 || ai.requests.length >= 8) break;
    const id = String(kingdom.id);
    if (ai.pendingByKingdom[id]) continue;
    const dueDay = ai.nextDecisionDays[id] ?? (world.day + 1);
    if (world.day < dueDay) continue;
    const ruler = world.people.find(person => person.id === kingdom.rulerId && person.alive);
    if (!ruler) { ai.nextDecisionDays[id] = world.day + 1; continue; }

    const report = observeKingdomStrategy(world, kingdom.id);
    const choices = kingdomStrategyChoices(report);
    if (!report || !choices.length) { ai.nextDecisionDays[id] = world.day + KINGDOM_AI_RETRY_DAYS; continue; }
    const requestedDay = world.day;
    const context = stripAbsoluteCalendarFields({
      ruler: { name: ruler.name },
      kingdom: report.kingdom,
      report: {
        ...report,
        calendar: { ...report.calendar }
      },
      currentPlan: kingdom.strategy ? {
        goal: kingdom.strategy.goal, action: kingdom.strategy.action,
        garrisonMode: kingdom.strategy.garrisonMode, reason: kingdom.strategy.reason
      } : null,
      recentDecisions: (kingdom.strategy && kingdom.strategy.aiHistory || []).slice(-4),
      decisionGuidance: KINGDOM_STRATEGY_DECISION_GUIDANCE,
      choices: choices.map(({ id: optionId, label, goal, action, priority, garrisonMode, reason }) => ({
        id: optionId, label, goal, action, priority, garrisonMode,
        reason: reason || ''
      }))
    });
    const requestId = 'king:' + id + ':' + ai.nextRequestSequence++;
    const orderVersion = Math.max(0, Math.floor(finite(kingdom.strategy && kingdom.strategy.sinceDay)));
    const campaignId = report.military.activeCampaign ? report.military.activeCampaign.id : null;
    const expiresDay = requestedDay + KINGDOM_AI_REQUEST_TTL_DAYS;
    const priority = choices.some(choice => choice.priority === 'urgent') ? 'urgent' : 'normal';
    const request = {
      contractVersion: AI_DECISION_CONTRACT_VERSION,
      requestId,
      worldEpoch: Number.isSafeInteger(world.simulationEpoch) ? world.simulationEpoch : 0,
      role: 'king',
      agentId: ruler.id,
      kingdomId: kingdom.id,
      campaignId,
      orderVersion,
      reportDay: requestedDay,
      expiresDay,
      priority,
      rulerName: ruler.name,
      requestedDay,
      candidateActions: choices.map(choice => choice.id),
      allowedActions: choices.map(choice => choice.id),
      observedFacts: context,
      context
    };
    ai.pendingByKingdom[id] = {
      requestId, role: request.role, agentId: request.agentId, kingdomId: request.kingdomId,
      campaignId, orderVersion, worldEpoch: request.worldEpoch, reportDay: requestedDay,
      requestedDay, expiresDay, priority, candidateActions: request.candidateActions.slice()
    };
    ai.requests.push(request);
    recordKingdomAiEvent(world, { type: 'request', request });
    ai.nextDecisionDays[id] = requestedDay + KINGDOM_AI_INTERVAL_DAYS;
    ai.enqueuedToday++;
    added++;
  }
  return added;
}

export function pullKingdomStrategicAiRequests(world, limit) {
  const ai = world.strategicAI;
  if (!ai || !ai.enabled) return [];
  const count = Math.max(1, Math.min(2, Math.floor(limit || 1)));
  const ready = [];
  while (ready.length < count && ai.requests.length) {
    const request = ai.requests.shift();
    const id = String(request.kingdomId);
    const kingdom = world.kingdoms.find(item => item.id === request.kingdomId);
    const pending = ai.pendingByKingdom[id];
    if (!kingdom || !pending || pending.requestId !== request.requestId) continue;
    if (world.day > request.expiresDay) {
      failKingdomStrategicAiRequest(world, request);
      continue;
    }
    ready.push(request);
  }
  return ready;
}

export function applyKingdomStrategicAiDecision(world, request, decision, metadata = {}) {
  const ai = world.strategicAI;
  if (!ai || !ai.enabled) return false;
  if (!request || typeof request !== 'object') return false;
  recordKingdomAiEvent(world, { type: 'proposal', request, decision, provider: metadata.provider || null, model: metadata.model || null });
  const kingdomId = request.kingdomId;
  const kingdom = (world.kingdoms || []).find(item => item.id === kingdomId);
  const pending = ai.pendingByKingdom && ai.pendingByKingdom[String(kingdomId)];
  if (!kingdom || !pending) {
    recordKingdomAiEvent(world, { type: 'rejected', requestId: request.requestId, reason: 'pedido duplicado ou reino removido', decision });
    return false;
  }
  const report = observeKingdomStrategy(world, kingdomId);
  const currentOrderVersion = Math.max(0, Math.floor(finite(kingdom.strategy && kingdom.strategy.sinceDay)));
  const currentCampaignId = report && report.military.activeCampaign ? report.military.activeCampaign.id : null;
  const invalidRequest = validateDecisionResult({
    request, pending,
    worldEpoch: Number.isSafeInteger(world.simulationEpoch) ? world.simulationEpoch : 0,
    currentDay: world.day,
    orderVersion: currentOrderVersion,
    campaignId: currentCampaignId,
    role: 'king'
  });
  if (invalidRequest) {
    failKingdomStrategicAiRequest(world, request, { reason: invalidRequest, decision, provider: metadata.provider, model: metadata.model });
    return false;
  }

  const invalidAction = validateDecisionAction(request, decision);
  if (invalidAction) {
    failKingdomStrategicAiRequest(world, request, { reason: invalidAction, decision, provider: metadata.provider, model: metadata.model });
    return false;
  }
  const selectedId = decision.action;
  const ruler = (world.people || []).find(person => person.id === request.agentId && person.alive);
  if (!ruler || kingdom.rulerId !== request.agentId) {
    failKingdomStrategicAiRequest(world, request, { reason: 'agente morto ou substituído', decision, provider: metadata.provider, model: metadata.model });
    return false;
  }
  const selected = kingdomStrategyChoices(report).find(choice => choice.id === selectedId);
  if (!selected) {
    failKingdomStrategicAiRequest(world, request, { reason: 'ação deixou de ser válida no estado atual', decision, provider: metadata.provider, model: metadata.model });
    return false;
  }

  const reason = String(decision && decision.reason || selected.reason)
    .replace(/[<>\u0000-\u001f]/g, ' ').trim().slice(0, 180);
  const confidenceValue = Number(decision && decision.confidence);
  if (selected.command === 'recruit') {
    const result = recruitKingdomSoldier(world, kingdomId);
    if (!result.ok) {
      failKingdomStrategicAiRequest(world, request, { reason: result.reason || 'recursos ou condições de recrutamento mudaram', decision, provider: metadata.provider, model: metadata.model });
      return false;
    }
    kingdom.strategy ||= { goal: 'maintain-autonomy', action: null, reason: '', garrisonMode: 'standby', history: [] };
    kingdom.strategy.lastAiCommand = {
      day: world.day, kind: 'recruit', status: 'training', personName: result.person.name,
      readyDay: result.readyDay, reason, requestId: request.requestId,
      provider: metadata.provider || 'ollama', model: metadata.model || null
    };
    kingdom.strategy.aiHistory ||= [];
    kingdom.strategy.aiHistory.push({ day: world.day, requestId: request.requestId, choice: selectedId,
      goal: selected.goal, action: 'recruit', reason, provider: metadata.provider || 'ollama', model: metadata.model || null });
    if (kingdom.strategy.aiHistory.length > 8) kingdom.strategy.aiHistory.shift();
    delete ai.pendingByKingdom[String(kingdomId)];
    ai.decisions++;
    recordKingdomAiEvent(world, { type: 'applied', requestId: request.requestId, kingdomId, role: request.role,
      decision, provider: metadata.provider || 'ollama', model: metadata.model || null,
      effect: { kind: 'recruit', personId: result.person.id, readyDay: result.readyDay } });
    return true;
  }

  const aiPlan = {
    ...selected, reason,
    requestId: request.requestId,
    provider: metadata.provider || 'ollama',
    model: metadata.model || null,
    confidence: Number.isFinite(confidenceValue) ? Math.max(0, Math.min(1, confidenceValue)) : .5,
    decidedDay: world.day, expiresDay: world.day + KINGDOM_AI_INTERVAL_DAYS
  };
  kingdom.strategy ||= { goal: 'maintain-autonomy', action: null, reason: '', garrisonMode: 'standby', history: [] };
  kingdom.strategy.aiPlan = aiPlan;
  kingdom.strategy.aiHistory ||= [];
  kingdom.strategy.aiHistory.push({ day: world.day, requestId: request.requestId, choice: selectedId,
    goal: selected.goal, action: selected.action, reason, provider: metadata.provider || 'ollama', model: metadata.model || null });
  if (kingdom.strategy.aiHistory.length > 8) kingdom.strategy.aiHistory.shift();
  kingdom.strategy.evaluatedDay = world.day - 8;
  delete ai.pendingByKingdom[String(kingdomId)];
  ai.decisions++;
  recordKingdomAiEvent(world, { type: 'applied', requestId: request.requestId, kingdomId, role: request.role,
    decision, provider: metadata.provider || 'ollama', model: metadata.model || null,
    effect: { kind: 'kingdom-plan', goal: selected.goal, action: selected.action, garrisonMode: selected.garrisonMode } });
  return true;
}

export function failKingdomStrategicAiRequest(world, request, { reason = 'inferência indisponível', decision = null, provider = null, model = null } = {}) {
  const ai = world.strategicAI;
  if (!ai || !request || typeof request !== 'object') return false;
  const id = String(request.kingdomId);
  const pending = ai.pendingByKingdom && ai.pendingByKingdom[id];
  if (!pending || pending.requestId !== request.requestId) {
    recordKingdomAiEvent(world, { type: 'rejected', requestId: request.requestId, kingdomId: request.kingdomId,
      reason: reason || 'pedido antigo ou substituído', decision, provider, model });
    return false;
  }
  delete ai.pendingByKingdom[id];
  if (ai.nextDecisionDays) ai.nextDecisionDays[id] = world.day + KINGDOM_AI_RETRY_DAYS;
  ai.failures = (ai.failures || 0) + 1;
  recordKingdomAiEvent(world, { type: 'rejected', request, decision, reason, provider, model });
  return true;
}

export function updateKingdomStrategies(world, planner = planKingdomStrategy) {
  const strategies = [];
  for (const kingdom of world.kingdoms || []) {
    fundFoodInfrastructure(world, kingdom);
    dispatchKingdomReserves(world, kingdom);
    const report = observeKingdomStrategy(world, kingdom.id);
    if (!report) continue;
    recruitForPendingForce(world, kingdom, report);
    const previous = kingdom.strategy || null;
    let activeAiPlan = world.strategicAI && world.strategicAI.enabled && previous && previous.aiPlan
      && previous.aiPlan.expiresDay >= world.day ? previous.aiPlan : null;
    let aiPlanRefusal = null;
    if (activeAiPlan) {
      const checkedAiPlan = normalizePlan(activeAiPlan, report);
      if (checkedAiPlan.valid) activeAiPlan = { ...activeAiPlan, ...checkedAiPlan.plan };
      else {
        aiPlanRefusal = 'A ordem escolhida pela IA local deixou de ser válida: ' + checkedAiPlan.reason;
        activeAiPlan = null;
      }
    }
    if (previous && world.day - finite(previous.evaluatedDay, -999) < 8) {
      strategies.push(previous);
      continue;
    }

    let proposal, refusal = aiPlanRefusal;
    try { proposal = activeAiPlan || planner(report); }
    catch (error) { refusal = 'A estratégia substituta falhou: ' + String(error && error.message || error).slice(0, 120); }
    let normalized = normalizePlan(proposal, report);
    if (!normalized.valid) {
      refusal = refusal || normalized.reason;
      normalized = normalizePlan(planKingdomStrategy(report), report);
    }
    const plan = normalized.plan || { goal: 'maintain-autonomy', action: null, priority: 'normal', reason: 'Fallback determinístico sem delegação.' };
    const evidence = evidenceFor(report);
    const changed = !previous || previous.goal !== plan.goal || previous.action !== plan.action
      || previous.garrisonMode !== plan.garrisonMode;
    const order = plan.action ? {
      source: 'kingdom-strategy', goal: plan.goal, action: plan.action, title: plan.title,
      skill: plan.skill, priority: plan.priority, assignedDay: world.day,
      expiresAfterDays: plan.priority === 'urgent' ? 7 : 21
    } : null;
    kingdom.strategy = {
      goal: plan.goal, action: plan.action, reason: plan.reason, garrisonMode: plan.garrisonMode,
      sinceDay: changed ? world.day : previous.sinceDay,
      evaluatedDay: world.day,
      evidence,
      order,
      ...(activeAiPlan ? { aiPlan: activeAiPlan } : {}),
      ...(previous && previous.lastAiCommand ? { lastAiCommand: previous.lastAiCommand } : {}),
      ...(previous && Array.isArray(previous.aiHistory) ? { aiHistory: previous.aiHistory.slice(-8) } : {}),
      lastOutcome: refusal ? { status: 'refused', day: world.day, reason: refusal }
        : changed ? { status: plan.action ? 'planned' : 'maintained', day: world.day, goal: plan.goal }
          : previous && previous.lastOutcome || null,
      history: previous && Array.isArray(previous.history) ? previous.history.slice() : []
    };
    if (changed || refusal) {
      const historyEntry = { day: world.day, goal: plan.goal, action: plan.action, garrisonMode: plan.garrisonMode, reason: plan.reason, evidence, refusal };
      kingdom.strategy.history.push(historyEntry);
      if (kingdom.strategy.history.length > 12) kingdom.strategy.history.shift();
      const community = world.communities.find(item => item.id === kingdom.communityId && !item.dissolved);
      if (community && changed) {
        for (const person of world.people) {
          const assignment = person.assignment;
          if (!assignment || assignment.source !== 'kingdom-strategy' || assignment.communityId !== community.id
              || assignment.goal === plan.goal) continue;
          const record = (community.assignments || []).slice().reverse().find(item => item.personId === person.id && item.status === 'delegada');
          if (record) record.status = 'substituída';
          person.assignment = null;
        }
      }
      if (changed) {
        const taskLabel = plan.action ? 'delegará ' + plan.title : 'manterá a iniciativa local';
        const garrisonLabel = plan.garrisonMode === 'patrol' ? 'patrulha de rotina' : 'reserva';
        const message = kingdom.name + ' definiu o objetivo ' + plan.goal + ', ' + taskLabel
          + ' e colocou a guarnição em ' + garrisonLabel + '. '
          + 'Evidências: ' + report.population + ' moradores registrados, estoque comum de alimento '
          + report.community.foodPerResident.toFixed(1) + ' por morador, ração '
          + report.community.feedStock.toFixed(1) + '/' + report.community.feedTarget.toFixed(1) + ', '
          + report.territoryTiles + ' células de domínio.';
        if (community) community.history.push(message);
        log(world, message);
      }
      if (refusal) {
        const message = kingdom.name + ' recusou a ordem estratégica substituta: ' + refusal + ' O fallback determinístico foi aplicado.';
        if (community) community.history.push(message);
        log(world, message);
      }
    }
    strategies.push(kingdom.strategy);
  }
  queueKingdomStrategicAiRequests(world);
  return strategies;
}

export function fundFoodInfrastructure(world, kingdom) {
  const community = world.communities.find(item => item.id === kingdom.communityId && !item.dissolved);
  const dailyFoodNeed = kingdomFoodDemand(world, kingdom).dailyFoodNeed;
  if (!community || community.memberIds.length < 6
      || communityFoodStock(community) >= communityFoodBufferTarget(dailyFoodNeed)) return null;
  const structures = world.structures.filter(s => s.communityId === community.id && s.destroyedDay == null
    && s.integrity !== 0 && (!s.kingdomProject || s.complete));
  if (structures.some(s => s.type === 'roça' && s.complete)) return null;
  const plan = nextCommunityStructure(world, community, community.memberIds.length, structures);
  if (!plan || !['abrigo', 'roça'].includes(plan.type)) return null;
  const stock = kingdom.treasury?.stock;
  const wood = Math.max(0, plan.woodCost - (community.stores.wood || 0));
  const stone = Math.max(0, plan.stoneCost - (community.stores.stone || 0));
  if (!stock || stock.wood < wood || stock.stone < stone || wood + stone <= .01) return null;
  transferInventoryToStores(kingdom.treasury, community, 'wood', wood, 'food-infrastructure-funding');
  transferInventoryToStores(kingdom.treasury, community, 'stone', stone, 'food-infrastructure-funding');
  const funding = { day: world.day, type: plan.type, wood, stone };
  kingdom.foodInfrastructureFunding ||= [];
  kingdom.foodInfrastructureFunding.push(funding);
  kingdom.foodInfrastructureFunding = kingdom.foodInfrastructureFunding.slice(-8);
  log(world, kingdom.name + ' transferiu ' + wood.toFixed(1) + ' madeira e ' + stone.toFixed(1)
    + ' pedra do tesouro para preparar ' + plan.type + ' de abastecimento.');
  return funding;
}
