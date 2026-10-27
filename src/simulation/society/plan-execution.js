import { distance } from '../core/math.js';
import { advanceSocialIntention, physicalIntentionBlockers,
  recordSocialBeliefEvidence, rememberSocialFact } from './social-evidence.js';

const SCHEDULING_BLOCKERS = new Set(['military_duty', 'urgent_needs', 'rest_required',
  'cargo_delivery', 'garrison_resupply', 'participant_busy']);
const OPEN = new Set(['active', 'suspended']);

// Both aid event types identify the recipient in targetId; the other participant is the helper.
function foodHelperId(fact) {
  if (fact.targetId == null || fact.participantIds?.length !== 2) return null;
  return fact.participantIds.find(id => id !== String(fact.targetId));
}

/** One recent experience per encounter, preserving its root and the reporting source. */
export function shareFoodAidKnowledge(world, source, recipient) {
  const known = new Set((recipient.socialMemories || []).map(memory => memory.rootEventId));
  const sourceMemories = new Set((source.socialMemories || []).map(memory => memory.rootEventId));
  const fact = (world.socialEvidence?.facts || []).slice().reverse().find(item => sourceMemories.has(item.eventId)
    && !known.has(item.eventId) && world.day - item.day <= 30 && foodHelperId(item) != null
    && (item.type === 'food_aid_transferred' && item.outcome?.amount > 0
      || item.type === 'food_aid_request_resolved' && item.outcome?.result === 'refused'));
  if (!fact) return null;
  rememberSocialFact(world, recipient.id, fact.eventId, { source: 'reported', sourcePersonId: source.id });
  recordSocialBeliefEvidence(world, recipient.id, { topic: 'food_aid_reliability', aboutId: foodHelperId(fact),
    eventId: fact.eventId, polarity: fact.type === 'food_aid_transferred' ? 1 : -1 });
  return fact;
}

// Only remembered evidence may influence a choice. Global facts are not an NPC's knowledge.
export function foodAidEvidenceIds(world, person, helperId) {
  const known = new Set((person.socialMemories || []).map(memory => memory.rootEventId));
  return (world.socialEvidence?.facts || []).filter(fact => known.has(fact.eventId)
    && ['food_aid_transferred', 'food_aid_request_resolved'].includes(fact.type)
    && foodHelperId(fact) === String(helperId)).map(fact => fact.eventId).slice(-4);
}

export function selectFoodHelper(world, person, busy = new Set()) {
  if (person.role === 'soldier' || person.foodReserve >= 40) return null;
  const known = new Set((person.socialMemories || []).map(memory => memory.rootEventId));
  const candidates = (person.perception?.people || []).filter(sighting => sighting.visible
    && sighting.distance <= 14 && sighting.visibleSignals?.foodSurplus === true
    && !sighting.visibleSignals?.physicalEmergency && !busy.has(sighting.id))
    .map(sighting => (world.people || []).find(candidate => candidate.alive && String(candidate.id) === String(sighting.id)))
    .filter(helper => helper && !(person.socialIntentions || []).some(plan => plan.type === 'seek_food_aid'
      && String(plan.targetId) === String(helper.id) && plan.status === 'abandoned'
      && ['deadline_expired', 'aid_refused', 'target_unavailable'].includes(plan.terminationReason)
      && world.day - plan.updatedDay < 4));
  const score = helper => {
    const belief = (person.socialBeliefs || []).find(item => item.topic === 'food_aid_reliability'
      && String(item.aboutId) === String(helper.id)
      && [...(item.supportingEventIds || []), ...(item.opposingEventIds || [])].some(id => known.has(id)));
    return distance(person, helper) - (belief ? belief.evaluation * belief.certainty * 4 : 0);
  };
  return candidates.sort((a, b) => score(a) - score(b) || a.id - b.id)[0] || null;
}

// A small deterministic executor reuses existing actions; it never trains a neural sample.
export function selectSocialPlanAction(world, person, context = {}) {
  const plans = (person.socialIntentions || []).filter(plan => OPEN.has(plan.status)
    && ['seek_food_aid', 'prepare_migration'].includes(plan.type))
    .sort((a, b) => b.priority - a.priority || a.createdDay - b.createdDay);
  let selected = null;
  for (const plan of plans) {
    const blockers = (plan.blockers || []).filter(value => !SCHEDULING_BLOCKERS.has(value));
    const scheduling = context.militaryDuty || person.role === 'soldier'
      ? 'military_duty' : context.urgentNeeds ? 'urgent_needs'
        : context.resupply ? 'garrison_resupply' : context.rest ? 'rest_required'
          : context.cargo ? 'cargo_delivery'
            : plan.type === 'seek_food_aid' && (context.busy?.has(person.id)
              || context.busy?.has(Number(plan.targetId))) ? 'participant_busy' : null;
    const physical = physicalIntentionBlockers(person, world.day);
    const nextBlockers = [...new Set([...blockers, ...physical, ...(scheduling ? [scheduling] : [])])];
    const status = nextBlockers.length ? 'suspended' : 'active';
    advanceSocialIntention(world, person.id, plan.intentionId, { status, blockers: nextBlockers });
    const retriable = nextBlockers.every(value => ['route_infeasible', 'no_viable_destination'].includes(value));
    if (selected || scheduling || physical.length || !retriable) continue;
    if (plan.type === 'seek_food_aid') {
      const sighting = person.perception?.people?.find(item => String(item.id) === String(plan.targetId)
        && item.visible && item.visibleSignals?.foodSurplus === true && !item.visibleSignals?.physicalEmergency);
      if (!sighting || person.foodReserve >= 40) continue;
      selected = { action: 'socialize', intentionId: plan.intentionId };
    } else selected = { action: 'migrate', intentionId: plan.intentionId };
  }
  return selected;
}
