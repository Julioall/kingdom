// JUL-278: conservative, opt-in presentation projection for the simulation
// Worker. Never mutate the authoritative world or its actor objects.
//
// These fields belong to cognition, memory and route planning: the render
// canvas has no reason to receive them on every daily update. The detailed
// inspector fetches the full selected actor through inspect-person/animal.
//
// This is NOT enabled by default. The QA-only compactActors=1 mode tests the
// presentation consumers before a default or production rollout.
export const DEFERRED_PERSON_FIELDS = Object.freeze([
  'perception', 'navigationRoute', 'knownRoutes', 'sensoryMemory',
  'brain', 'militaryBrain', 'cognitiveState'
]);
export const DEFERRED_ANIMAL_FIELDS = Object.freeze([
  'perception', 'sensoryMemory', 'brain'
]);

function stripDeferredFields(actor, fields) {
  const projected = {...actor};
  for (const field of fields) delete projected[field];
  // The canvas renders a subtle action cue from brain.lastAction. Keep only
  // that presentation scalar, not the shared neural weights or decision
  // history; an explicit marker tells the inspector to await full cognition.
  projected.brain = { lastAction: actor.brain?.lastAction };
  projected.__compactActorSnapshot = true;
  return projected;
}

/**
 * Snapshot base is a shallow world projection. Copy actor arrays before any
 * deletion: the Worker must retain every neural/memory field in its live
 * world to preserve learning, movement and authoritative simulations.
 */
export function compactActorSnapshotBase(base) {
  if (!base || !Array.isArray(base.people) || !Array.isArray(base.animals))
    throw Error('Invalid world base for compact actor projection.');
  return {
    ...base,
    people: base.people.map(actor => stripDeferredFields(actor, DEFERRED_PERSON_FIELDS)),
    animals: base.animals.map(actor => stripDeferredFields(actor, DEFERRED_ANIMAL_FIELDS))
  };
}
