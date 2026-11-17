// Temporary, synchronous lookups used only while resolving one simulated day.
// Keep these maps out of snapshots, saves and actor memory. This is not a new
// authoritative state store and should never survive the callback.
import { createPersonSpatialIndex } from './spatial-index.js';

const TEMPORARY_INDEX_KEYS = ['peopleById', 'peopleSpatialIndex', 'animalsById'];

export function withIndividualDayIndexes(world, run) {
  if (!world || !Array.isArray(world.people) || typeof run !== 'function')
    throw new TypeError('Invalid individual day context');
  const saved = TEMPORARY_INDEX_KEYS.map(key => ({
    key, hadValue: Object.prototype.hasOwnProperty.call(world, key), value: world[key]
  }));
  try {
    world.peopleById = new Map(world.people.map(person => [person.id, person]));
    world.peopleSpatialIndex = createPersonSpatialIndex(world.people);
    world.animalsById = new Map();
    for (const animal of world.animals || []) {
      if (!world.animalsById.has(animal.id)) world.animalsById.set(animal.id, animal);
    }
    return run();
  } finally {
    for (const { key, hadValue, value } of saved) {
      if (hadValue) world[key] = value;
      else delete world[key];
    }
  }
}
