// A view-local index: never index the authoritative Worker world.
// Rebuilt when a full snapshot replaces the people array, including reset.
export function indexPeopleById(people) {
  return new Map((people || []).map(person => [person.id, person]));
}

// Preserve the same object identities that UI inspectors and sprites already
// reference. Unknown IDs are not materialized from partial combat/magic data.
export function applyIndexedPersonUpdates(index, updates) {
  let applied = 0;
  for (const update of updates || []) {
    if (!update || !Number.isSafeInteger(update.id)) continue;
    const person = index.get(update.id);
    if (!person) continue;
    Object.assign(person, update);
    applied++;
  }
  return applied;
}
