import { inspectNpcCongestion } from './npc-congestion-diagnostics.mjs';
// Read-only longitudinal health/economy/navigation audit for Kingdom.
// Called *after* stepDay, outside the timed simulation and without attaching
// transient fields to the world or people. All event counts are observations,
// not a substitute for verifying the underlying causal gameplay logic.

const finite = value => Number.isFinite(value) ? value : 0;
const activeAssignment = (assignment, day) => assignment
  && (assignment.expiresDay == null || assignment.expiresDay >= day);

function taskKey(community, record) {
  // The history is a bounded community ring, so these events are a lower
  // bound on true completions when many tasks finish between observations.
  return [community.id, record.personId, record.assignedDay,
    record.action, record.goal || ''].join('|');
}

function completedTaskKeys(world) {
  const result = new Set();
  for (const community of world.communities || [])
    for (const record of community.assignments || [])
      if (record.status === 'concluída') result.add(taskKey(community, record));
  return result;
}

export function createHybridQualityTracker(world) {
  return {
    previousActors: new Map(),
    seenTaskCompletions: completedTaskKeys(world),
    completedStructureIds: new Set((world.structures || [])
      .filter(structure => structure.complete && structure.destroyedDay == null)
      .map(structure => structure.id)),
    totals: {
      observedCompletedTasks: 0, newCompletedStructures: 0,
      actionSwitches: 0, workflowStageChanges: 0, workflowResumptions: 0,
      localDetours: 0, routeCacheHits: 0, routeFailureCacheHits: 0,
      stationaryWhileRoutedDays: 0, passageRequests: 0
    }
  };
}

function delta(current, previous) {
  // Cumulative counters can be absent for most NPCs.
  return Math.max(0, finite(current) - finite(previous));
}

export function sampleHybridQuality(world, tracker) {
  if (!tracker?.previousActors || !tracker?.totals)
    throw new TypeError('Invalid hybrid quality tracker');
  const living = (world.people || []).filter(person => person.alive);
  if (!living.length) throw new Error('No living NPCs left at day ' + world.day);
  const activeIds = new Set();
  const stages = {}, statuses = {}, actions = {};
  const daily = {
    observedCompletedTasks: 0, newCompletedStructures: 0,
    actionSwitches: 0, workflowStageChanges: 0, workflowResumptions: 0,
    localDetours: 0, routeCacheHits: 0, routeFailureCacheHits: 0,
    stationaryWhileRoutedDays: 0, passageRequests: 0
  };
  let activeAssignments = 0, pausedAssignments = 0, overdueAssignments = 0;
  let activeRoutedActors = 0, blockedRouteActors = 0, longBlockedRouteActors = 0;
  let soldiers = 0, soldiersOnCampaign = 0, incapacitated = 0;
  let sumEnergy = 0, sumFood = 0, sumHydration = 0, sumHealth = 0;
  let pendingWorkflows = 0, activeWorkflows = 0;
  let maxBlockedDays = 0;

  for (const person of living) {
    if (![person.x, person.y, person.health, person.energy, person.hydration,
      person.foodReserve].every(Number.isFinite))
      throw new Error('Invalid physical state for NPC ' + person.id + ' on day ' + world.day);
    activeIds.add(person.id);
    sumEnergy += person.energy;
    sumFood += person.foodReserve;
    sumHydration += person.hydration;
    sumHealth += person.health;
    if (person.health <= 10 || person.foodReserve <= 5 || person.hydration <= 8)
      incapacitated++;
    if (person.role === 'soldier') {
      soldiers++;
      if (person.campaignId != null) soldiersOnCampaign++;
    }
    if (person.assignment) {
      if (activeAssignment(person.assignment, world.day)) {
        activeAssignments++;
        if (person.assignment.pauseReason) pausedAssignments++;
      } else overdueAssignments++;
    }
    const flow = person.activityWorkflow;
    if (flow) {
      stages[flow.stage || 'unknown'] = (stages[flow.stage || 'unknown'] || 0) + 1;
      statuses[flow.status || 'unknown'] = (statuses[flow.status || 'unknown'] || 0) + 1;
      if (flow.status === 'interrupted') pendingWorkflows++;
      if (flow.status === 'active') activeWorkflows++;
    }
    const action = person.brain?.lastAction || person.lastDecision?.action || 'none';
    actions[action] = (actions[action] || 0) + 1;
    const previous = tracker.previousActors.get(person.id);
    const congestion = person.navigationCongestion;
    if (congestion) {
      blockedRouteActors++;
      const blockedDays = Math.max(0, finite(congestion.blockedDays));
      maxBlockedDays = Math.max(maxBlockedDays, blockedDays);
      if (blockedDays >= 3) longBlockedRouteActors++;
    }
    const route = person.navigationRoute;
    const routePending = route && !route.completed
      && Number.isInteger(route.cursor) && Array.isArray(route.path)
      && route.cursor < route.path.length - 1;
    if (routePending) activeRoutedActors++;
    if (person.passageRequestSent?.day === world.day) daily.passageRequests++;
    if (previous) {
      if (previous.action !== action) daily.actionSwitches++;
      if (previous.stage != null && flow?.stage != null
          && previous.stage !== flow.stage) daily.workflowStageChanges++;
      if (previous.flowStatus === 'interrupted' && flow?.status === 'active'
          && flow.action === previous.resumeAction)
        daily.workflowResumptions++;
      if (routePending && !person.playerControlled
          && previous.x === person.x && previous.y === person.y)
        daily.stationaryWhileRoutedDays++;
      daily.localDetours += delta(person.navigationLocalDetours, previous.localDetours);
      daily.routeCacheHits += delta(person.navigationCacheHits, previous.routeCacheHits);
      daily.routeFailureCacheHits += delta(person.navigationFailureCacheHits, previous.routeFailureCacheHits);
    } else {
      // Most actors start with zero counters. Sampling a spawned NPC is not a
      // 'new' route event, so baseline its current counters without delta.
    }
    tracker.previousActors.set(person.id, {
      x: person.x, y: person.y, action, stage: flow?.stage || null,
      flowStatus: flow?.status || null, resumeAction: flow?.resumeAction || null,
      localDetours: person.navigationLocalDetours || 0,
      routeCacheHits: person.navigationCacheHits || 0,
      routeFailureCacheHits: person.navigationFailureCacheHits || 0
    });
  }
  for (const id of tracker.previousActors.keys())
    if (!activeIds.has(id)) tracker.previousActors.delete(id);
  for (const community of world.communities || []) {
    for (const record of community.assignments || []) {
      if (record.status !== 'concluída') continue;
      const key = taskKey(community, record);
      if (!tracker.seenTaskCompletions.has(key)) {
        tracker.seenTaskCompletions.add(key);
        daily.observedCompletedTasks++;
      }
    }
  }
  for (const structure of world.structures || []) {
    if (!structure.complete || structure.destroyedDay != null
        || tracker.completedStructureIds.has(structure.id)) continue;
    tracker.completedStructureIds.add(structure.id);
    daily.newCompletedStructures++;
  }
  for (const [key, value] of Object.entries(daily)) tracker.totals[key] += value;
  const denom = living.length;
  const communities = world.communities || [];
  return {
    day: world.day,
    population: {
      alive: denom, soldiers, soldiersOnCampaign,
      animalsAlive: (world.animals || []).filter(animal => animal.alive).length,
      endangeredActors: incapacitated
    },
    vital: {
      meanEnergy: sumEnergy / denom,
      meanHydration: sumHydration / denom,
      meanFoodReserve: sumFood / denom,
      meanHealth: sumHealth / denom
    },
    economy: {
      activeAssignments, pausedAssignments, overdueAssignments,
      completedStructures: (world.structures || [])
        .filter(structure => structure.complete && structure.destroyedDay == null).length,
      unfinishedStructures: (world.structures || [])
        .filter(structure => !structure.complete && structure.destroyedDay == null).length,
      communityFoodStock: communities.reduce((sum, c) => sum + finite(c.stores?.food), 0),
      trades: finite(world.trades),
      raids: finite(world.raidAttempts),
      successfulRaids: finite(world.successfulRaids),
      conflicts: finite(world.conflicts),
      deaths: finite(world.deaths),
      births: finite(world.births)
    },
    navigation: {
      activeRoutedActors, blockedRouteActors, longBlockedRouteActors,
      maxBlockedDays, dailyDetours: daily.localDetours,
      dailyRouteCacheHits: daily.routeCacheHits,
      dailyFailureCacheHits: daily.routeFailureCacheHits,
      dailyPassageRequests: daily.passageRequests,
      stationaryWhileRoutedDays: daily.stationaryWhileRoutedDays,
      congestionDiagnosis: inspectNpcCongestion(world)
    },
    behavior: {
      activeWorkflows, interruptedWorkflows: pendingWorkflows,
      dailyActionSwitches: daily.actionSwitches,
      dailyWorkflowStageChanges: daily.workflowStageChanges,
      dailyWorkflowResumptions: daily.workflowResumptions,
      dailyObservedTaskCompletions: daily.observedCompletedTasks,
      dailyNewCompletedStructures: daily.newCompletedStructures,
      stages, statuses, actions
    },
    cumulative: { ...tracker.totals }
  };
}

export function summarizeTiming(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  if (!sorted.length) throw new Error('Empty timing samples');
  return {
    count: sorted.length, meanMs: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    p50Ms: sorted[Math.ceil(.5 * sorted.length) - 1],
    p95Ms: sorted[Math.ceil(.95 * sorted.length) - 1],
    p99Ms: sorted[Math.ceil(.99 * sorted.length) - 1],
    maxMs: sorted.at(-1)
  };
}
