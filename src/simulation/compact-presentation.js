// JUL-278: opt-in presentation projection for the Worker -> browser boundary.
// This code NEVER mutates the simulation or its authoritative actor records.
// Compact transport intentionally retains lightweight neural action fields used
// to render animations, while cognition/detail is fetched via inspect-person
// and inspect-animal only when the inspector opens.
const HEAVY_ACTOR_FIELDS = Object.freeze([
  'perception','navigationRoute','knownRoutes','sensoryMemory',
  'personalMemory','cognitiveState','lastDecision','militaryBrain'
]);
const BRAIN_PRESENTATION_FIELDS = Object.freeze([
  'mode','lastAction','decisions','updates','inputSize','hiddenSize','actionCount'
]);

function presentActor(actor) {
  const result = { ...actor };
  for (const field of HEAVY_ACTOR_FIELDS) delete result[field];
  if (actor.brain && typeof actor.brain === 'object') {
    result.brain = Object.fromEntries(BRAIN_PRESENTATION_FIELDS
      .filter(field => Object.prototype.hasOwnProperty.call(actor.brain,field))
      .map(field => [field,actor.brain[field]]));
  }
  return result;
}

/** Retains all non-actor state and the exact identity/order of actor arrays. */
export function createCompactPresentationBase(base) {
  if (!base || !Array.isArray(base.people) || !Array.isArray(base.animals))
    throw Error('Invalid authoritative base for compact actor projection.');
  return {
    ...base,
    people: base.people.map(presentActor),
    animals: base.animals.map(presentActor)
  };
}

export const COMPACT_ACTOR_STRIPPED_FIELDS = HEAVY_ACTOR_FIELDS;
