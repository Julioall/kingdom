import { distance } from '../core/math.js';
import { cellAt } from '../world/spatial.js';
import { recordSocialFact, rememberSocialFact, updateDirectedSocialRelationship } from './social-evidence.js';

function physicalEmergency(person) {
  return Number.isFinite(person?.hydration) && person.hydration <= 9
    || Number.isFinite(person?.foodReserve) && person.foodReserve <= 8
    || Number.isFinite(person?.health) && person.health <= 18
    || Number.isFinite(person?.energy) && person.energy <= 8;
}

function hasWater(world, point) {
  const tile = cellAt(world, point.x, point.y);
  return tile && (tile.terrain === 'water' || (tile.surfaceWaterMm || 0) >= 1.5) ? tile : null;
}

/** Pass a currently valid water reference from a visible local encounter with its source person attached. */
export function indicateKnownWaterReference(world, informant, recipient) {
  if (!informant?.alive || !recipient?.alive || informant.id === recipient.id) return { transferred: false, reason: 'invalid-participants' };
  const sighting = (informant.perception?.people || []).find(item => item.id === recipient.id && item.visible);
  if (!sighting || sighting.visibleSignals?.waterDistress !== true) return { transferred: false, reason: 'no-visible-water-need' };
  if (distance(informant, recipient) > 2.1) return { transferred: false, reason: 'out-of-reach' };
  if (sighting.visibleSignals?.physicalEmergency || physicalEmergency(informant) || physicalEmergency(recipient)) {
    return { transferred: false, reason: 'physical-emergency' };
  }

  const knownWater = (informant.perception?.knownWater || []).filter(point => Number.isSafeInteger(point.lastSeenDay)
    && point.lastSeenDay <= world.day && hasWater(world, point))
    .sort((a, b) => distance(informant, a) - distance(informant, b) || b.confidence - a.confidence)[0];
  if (!knownWater) return { transferred: false, reason: 'no-known-water' };
  const tile = hasWater(world, knownWater);
  const water = recipient.sensoryMemory?.water || [];
  if (water.some(point => point.x === knownWater.x && point.y === knownWater.y)) {
    return { transferred: false, reason: 'already-known' };
  }

  const fact = recordSocialFact(world, {
    idempotencyKey: 'water-indication:' + world.day + ':' + informant.id + ':' + recipient.id + ':' + knownWater.x + ':' + knownWater.y,
    type: 'water_source_indicated',
    participantIds: [informant.id, recipient.id],
    witnessIds: [informant.id],
    targetId: recipient.id,
    location: { x: knownWater.x, y: knownWater.y },
    outcome: {
      resource: 'water', result: 'reference_received', source: tile.terrain === 'water' ? tile.waterKind || 'lake' : 'runoff',
      lastObservedDay: knownWater.lastSeenDay
    },
    references: []
  });
  rememberSocialFact(world, informant.id, fact.eventId, { source: 'direct' });
  rememberSocialFact(world, recipient.id, fact.eventId, { source: 'reported', sourcePersonId: informant.id });
  recipient.sensoryMemory ||= { actors: {}, water: [], logs: {} };
  recipient.sensoryMemory.water ||= [];
  recipient.sensoryMemory.water.push({
    x: knownWater.x,
    y: knownWater.y,
    source: fact.outcome.source,
    lastSeenDay: knownWater.lastSeenDay,
    knowledgeOrigin: 'reported',
    reportedById: informant.id,
    evidenceEventId: fact.eventId,
    acquiredDay: world.day
  });
  updateDirectedSocialRelationship(world, recipient.id, informant.id, { eventId: fact.eventId, trustDelta: .01 });
  return { transferred: true, reason: 'reference-received', fact };
}
