const COMMUNITY_FIELDS = [
  'sharedFood', 'foodPerResident', 'dailyFoodNeed', 'foodBufferDays', 'foodBufferTarget', 'foodBufferTargetDays',
  'feedStock', 'feedTarget', 'feedReserveDays',
  'sheepCount', 'woodStock', 'stoneStock', 'goldStock', 'marketFoodTradeable', 'buildPlan',
  'constructionReady', 'safeBuilderAvailable', 'activeCropProject', 'constructionMaterialNeed'
];

const FOOD_INFRASTRUCTURE_FIELDS = [
  'completedFields', 'activeFieldProject', 'plantedFieldCount', 'standingCropBiomass',
  'harvestableCropPotential', 'harvestedCropToDate', 'activeProjectType', 'nextBuildType',
  'nextBuildReady', 'buildSitePrevalidated', 'completedCorrals', 'sheepCapacity', 'sheepCount',
  'openPenSlots', 'visibleWildSheepCount', 'feedStock', 'feedTarget'
];

const MILITARY_FIELDS = [
  'frontierAlert', 'activeCampaign', 'knownEvidence', 'pendingForceRequests', 'availableSoldiers', 'recruitment'
];

function pick(source, fields) {
  if (!source || typeof source !== 'object') return {};
  return Object.fromEntries(fields
    .filter(key => Object.hasOwn(source, key) && source[key] !== undefined)
    .map(key => [key, source[key]]));
}

function shortText(value, limit) {
  return typeof value === 'string' ? value.slice(0, limit) : value;
}

function compactOrders(orders, minimal) {
  if (!Array.isArray(orders)) return [];
  return orders.slice(0, minimal ? 3 : 5).map(order => ({
    goal: order.goal,
    action: order.action,
    workers: order.workers,
    pausedWorkers: order.pausedWorkers,
    longestActiveDays: order.longestActiveDays,
    ...(!minimal && Array.isArray(order.phases) ? { phases: order.phases.slice(0, 2).map(phase => shortText(phase, 42)) } : {})
  }));
}

function compactMilitary(military, minimal) {
  const result = pick(military, MILITARY_FIELDS);
  if (Array.isArray(result.knownEvidence)) result.knownEvidence = result.knownEvidence.slice(minimal ? -2 : -4);
  if (Array.isArray(result.pendingForceRequests)) result.pendingForceRequests = result.pendingForceRequests.slice(-2);
  if (result.frontierAlert && typeof result.frontierAlert === 'object') {
    result.frontierAlert = pick(result.frontierAlert, [
      'kind', 'opponentId', 'soldiersObserved', 'postsObserved', 'location', 'source'
    ]);
  }
  return result;
}

function compactCommunity(community, minimal) {
  if (!community || typeof community !== 'object') return community;
  const result = pick(community, COMMUNITY_FIELDS);
  const infrastructure = community.foodInfrastructure;
  if (infrastructure && typeof infrastructure === 'object') {
    result.foodInfrastructure = pick(infrastructure, FOOD_INFRASTRUCTURE_FIELDS);
  }
  result.activeRoyalOrders = compactOrders(community.activeRoyalOrders, minimal);
  if (community.lastRoyalOutcome) {
    result.lastRoyalOutcome = pick(community.lastRoyalOutcome, ['status', 'goal', 'action', 'daysAgo', 'reason']);
    result.lastRoyalOutcome.reason = shortText(result.lastRoyalOutcome.reason, minimal ? 72 : 120);
  }
  if (!minimal && Array.isArray(community.recentRoyalOutcomes)) {
    result.recentRoyalOutcomes = community.recentRoyalOutcomes.slice(-2).map(outcome => ({
      ...pick(outcome, ['status', 'goal', 'action', 'daysAgo']),
      reason: shortText(outcome.reason, 72)
    }));
  }
  if (community.repairs) {
    result.repairs = pick(community.repairs, ['damagedStructureCount', 'criticalStructureCount', 'repairCost', 'repairReady']);
  }
  return result;
}

function compactChoices(context, request, minimal) {
  const choices = Array.isArray(context.choices) ? context.choices : [];
  const allowedActions = Array.isArray(request.allowedActions) && request.allowedActions.length
    ? request.allowedActions
    : request.candidateActions || [];
  const allowed = new Set(allowedActions);
  return choices.filter(choice => allowed.has(choice.id)).map(choice => ({
    id: choice.id,
    label: choice.label,
    goal: choice.goal,
    action: choice.action,
    command: choice.command,
    priority: choice.priority,
    garrisonMode: choice.garrisonMode,
    ...(!minimal && choice.reason ? { reason: shortText(choice.reason, 96) } : {})
  }));
}

function projectKingContext(request, minimal) {
  const context = request.context || request.observedFacts || {};
  const report = context.report || {};
  const community = report.community || {};
  const result = {
    kingdom: pick(report.kingdom || context.kingdom, ['id', 'name']),
    report: {
      population: report.population,
      community: compactCommunity(community, minimal),
      treasury: pick(report.treasury, ['food', 'feed', 'wood', 'stone', 'gold']),
      market: pick(report.market, ['foodPrice', 'foodStock', 'foodSupply', 'foodDemand']),
      military: compactMilitary(report.military, minimal),
      territoryTiles: report.territoryTiles,
      garrisonSize: report.garrisonSize,
      policy: pick(report.policy, ['priorities', 'droughtReserveDays'])
    },
    currentPlan: pick(context.currentPlan, ['goal', 'action', 'garrisonMode']),
    choices: compactChoices(context, request, minimal)
  };
  if (!result.kingdom.id && !result.kingdom.name) delete result.kingdom;
  return result;
}

/**
 * Return progressively smaller browser-only views. The allowed action menu is
 * retained in every view; this is a safe projection, not token truncation.
 */
export function browserDecisionContextVariants(request) {
  if (request.role !== 'king') return [request.context || request.observedFacts || {}];
  return [projectKingContext(request, false), projectKingContext(request, true)];
}

export function browserInputTokenBudget(contextTokens, reservedOutputTokens) {
  const context = Number(contextTokens);
  const reserved = Number(reservedOutputTokens);
  if (!Number.isFinite(context) || context <= 0 || !Number.isFinite(reserved)
      || reserved < 0 || reserved >= context) return null;
  return Math.floor(context - reserved);
}

export function browserInputFitsTokenBudget(inputTokens, inputBudget) {
  const input = Number(inputTokens);
  const budget = Number(inputBudget);
  return Number.isFinite(input) && input > 0 && Number.isFinite(budget) && budget > 0 && input <= budget;
}
