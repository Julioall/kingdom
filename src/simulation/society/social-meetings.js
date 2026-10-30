import { consumePersonEnergy } from '../individuals/energy.js';
import { recordSocialFact, rememberSocialFact, updateDirectedSocialRelationship } from './social-evidence.js';
import { shareFoodAidKnowledge } from './plan-execution.js';

export const SOCIAL_MEETING_REACH = 2.1;

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function hasPhysicalEmergency(person) {
  return Number.isFinite(person?.hydration) && person.hydration <= 9
    || Number.isFinite(person?.foodReserve) && person.foodReserve <= 8
    || Number.isFinite(person?.health) && person.health <= 18
    || Number.isFinite(person?.energy) && person.energy <= 8;
}

function result(reason) {
  return { completed: false, reason };
}

/** Resolve a completed face-to-face conversation once per participant per day. */
export function resolveSocialMeeting(world, initiator, target, participantsToday = new Set()) {
  if (!initiator?.alive || !target?.alive || initiator.id === target.id) return result('invalid-participants');
  if (participantsToday.has(initiator.id) || participantsToday.has(target.id)) return result('participant-busy');
  const sighting = (initiator.perception?.people || []).find(item => item.id === target.id && item.visible);
  if (!sighting) return result('not-visible');
  if (sighting.visibleSignals?.physicalEmergency || hasPhysicalEmergency(initiator) || hasPhysicalEmergency(target)) {
    return result('physical-emergency');
  }
  if (distance(initiator, target) > SOCIAL_MEETING_REACH) return result('out-of-reach');

  participantsToday.add(initiator.id);
  participantsToday.add(target.id);
  initiator.socialNeed = Math.max(0, (initiator.socialNeed || 0) - 17);
  consumePersonEnergy(initiator, .1);
  initiator.state = 'conversando';
  initiator.lastLesson = 'A conversa foi concluída com uma pessoa visível, sem emergência física e dentro do alcance.';

  const low = Math.min(initiator.id, target.id), high = Math.max(initiator.id, target.id);
  const fact = recordSocialFact(world, {
    idempotencyKey: 'social-meeting:' + world.day + ':' + low + ':' + high,
    type: 'social_meeting',
    participantIds: [initiator.id, target.id],
    witnessIds: [initiator.id, target.id],
    location: { x: (initiator.x + target.x) / 2, y: (initiator.y + target.y) / 2 },
    outcome: { result: 'conversation_completed' }
  });
  rememberSocialFact(world, initiator.id, fact.eventId, { source: 'direct' });
  rememberSocialFact(world, target.id, fact.eventId, { source: 'direct' });
  updateDirectedSocialRelationship(world, initiator.id, target.id, { eventId: fact.eventId, familiarityDelta: .02 });
  updateDirectedSocialRelationship(world, target.id, initiator.id, { eventId: fact.eventId, familiarityDelta: .02 });
  const report = shareFoodAidKnowledge(world, initiator, target) || shareFoodAidKnowledge(world, target, initiator);
  return { completed: true, reason: 'completed', fact, report };
}
