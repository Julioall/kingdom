// Hierarchical execution flow: control/priority -> activity -> task stage.
// The assignment, command, supplies and actual position remain authoritative.
// Only a minimal execution bookmark is persisted when the experimental
// npcBehavior=hybrid mode is enabled; no parallel inventory, route or orders.
const RESUMABLE = new Set(['build', 'forage', 'gather', 'deliver',
  'collect_feed', 'collect_log', 'lead_sheep', 'trade', 'patrol']);
const INTERRUPTIONS = new Set(['survival', 'recovery']);
const MAX_INTERRUPTION_DAYS = 7;

export function npcAssignmentIdentity(assignment) {
  if (!assignment) return null;
  return [assignment.source ?? '', assignment.goal ?? '',
    assignment.structureId ?? '', assignment.foodFieldId ?? '',
    assignment.expiresDay ?? ''].join('|');
}

function hasCurrentAssignment(person, day) {
  return person.assignment && (person.assignment.expiresDay == null
    || person.assignment.expiresDay >= day);
}
function hasValidAssignment(person, day) {
  return hasCurrentAssignment(person, day) && !person.assignment.pauseReason;
}

function cargoAmount(person) {
  return (person.carriedFood || 0) + (person.carriedFeed || 0)
    + (person.carriedWood || 0) + (person.carriedStone || 0)
    + (person.carriedGold || 0) + (person.carriedFruit || 0)
    + (person.carriedCommunitySeeds || 0);
}

/** Pure stage classification from the existing authoritative task state. */
export function npcExecutionStage(world, person, action, community) {
  const assignment = person.assignment;
  if (action === 'build') {
    if (assignment?.goal === 'repair-damaged-structures') return 'repair';
    if (assignment?.goal === 'replant-cultivated-food') {
      if ((person.carriedSeeds || 0) + (person.carriedCommunitySeeds || 0) > .01) return 'deliver-seeds';
      return 'obtain-seeds';
    }
    const structure = assignment?.structureId != null
      ? (world.structures || []).find(item => item.id === assignment.structureId
        && !item.complete && item.destroyedDay == null) : null;
    if (!structure) return 'select-site';
    if (Math.hypot(person.x - structure.x, person.y - structure.y) > 2.5) return 'travel';
    if ((community?.stores?.wood || 0) < .01 && (community?.stores?.stone || 0) < .01)
      return 'await-materials';
    return 'work';
  }
  if (action === 'forage' || action === 'gather' || action === 'collect_feed') {
    return cargoAmount(person) > 20 ? 'return-cargo' : 'collect';
  }
  if (action === 'deliver') {
    if (cargoAmount(person) <= .01) return 'acquire-cargo';
    if (community && Math.hypot(person.x - community.x, person.y - community.y) > 2)
      return 'travel';
    return 'unload';
  }
  if (action === 'lead_sheep') return person.leadingSheepId ? 'escort' : 'acquire-herd';
  if (action === 'patrol') return 'patrol-route';
  if (action === 'campaign') return 'execute-order';
  if (action === 'return_garrison') return 'return-to-post';
  if (action === 'trade') return cargoAmount(person) > .01 ? 'deliver-offer' : 'negotiate';
  if (action === 'rest' || action === 'field_rest') return 'recover';
  if (action === 'drink' || action === 'forage' && person.hydration < 8) return 'restore-needs';
  if (action === 'guard') return 'hold-position';
  if (action === 'socialize') return 'meet';
  return 'execute';
}

/**
 * Run BEFORE learning transition; this is the only place a previously
 * interrupted delegated task may replace a new voluntary routine choice.
 * It never overrides an emergency, military command or existing social plan.
 */
export function beginNpcWorkflow(world, person, choice, community) {
  const day = world.day;
  const previous = person.activityWorkflow;
  const assignmentCurrent = hasCurrentAssignment(person, day);
  const assignmentValid = assignmentCurrent && !person.assignment.pauseReason;
  // Paused assignments remain the same mission during a survival interruption.
  const identity = assignmentCurrent ? npcAssignmentIdentity(person.assignment) : null;
  const interruption = INTERRUPTIONS.has(choice.mode);
  let action = choice.action, mode = choice.mode;
  let resumeAction = null, resumeIdentity = null;
  if (interruption) {
    if (previous?.resumeAction && previous.resumeIdentity === identity
        && day - previous.lastDay <= MAX_INTERRUPTION_DAYS) {
      resumeAction = previous.resumeAction;
      resumeIdentity = identity;
    } else if (assignmentCurrent && previous?.assignmentIdentity === identity
        && RESUMABLE.has(previous.action)) {
      resumeAction = previous.action;
      resumeIdentity = identity;
    }
  } else if (choice.mode === 'routine' && assignmentValid
      && previous?.resumeAction && previous.resumeIdentity === identity
      && day - previous.lastDay <= MAX_INTERRUPTION_DAYS
      && RESUMABLE.has(previous.resumeAction)) {
    // Revalidate the actual assignment: forage may have become deliver
    // during the interruption. We do not invent/resurrect an obsolete task.
    const assigned = person.assignment.action;
    if (RESUMABLE.has(assigned)) {
      action = assigned;
      mode = 'work';
      // The neural action was evaluated but not executed. Do not credit it
      // for a forced resumption or silently train against the wrong reward.
      if (person.brain) {
        person.brain.pending = null;
        person.brain.lastAction = action;
      }
      if (person.lastDecision)
        person.lastDecision = { ...person.lastDecision, action, scores: null };
    }
  }
  const sameAction = previous && previous.action === action
    && previous.assignmentIdentity === identity && !interruption;
  person.activityWorkflow = {
    action, mode, stage: npcExecutionStage(world, person, action, community),
    status: interruption ? 'interrupted' : 'active',
    sinceDay: sameAction ? previous.sinceDay : day,
    lastDay: day,
    assignmentIdentity: identity,
    resumeAction, resumeIdentity
  };
  return { action, mode };
}

/** Refresh the stage after delivery, building, grazing or delegated completion. */
export function completeNpcWorkflow(world, person, action, community) {
  const flow = person.activityWorkflow;
  if (!flow || flow.action !== action || flow.lastDay !== world.day) return;
  // An assignment paused by emergency is still valid for the bookmark.
  const identity = hasCurrentAssignment(person, world.day)
    ? npcAssignmentIdentity(person.assignment) : null;
  if (flow.assignmentIdentity && !identity && flow.status === 'active') {
    flow.status = 'released';
    flow.stage = 'finished';
    flow.resumeAction = null;
    flow.resumeIdentity = null;
    return;
  }
  flow.stage = npcExecutionStage(world, person, action, community);
  if (!identity || flow.resumeIdentity !== identity) {
    flow.resumeAction = null;
    flow.resumeIdentity = null;
  }
}
