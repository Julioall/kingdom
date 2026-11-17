// Population lookup for the building planner. During the normal NPC day,
// the authoritative simulation already owns a temporary person ID index.
// Outside that day, use one local live-ID set instead of a nested O(n*m) scan.
// This observer never mutates individuals, community membership or world state.
export function activeCommunityMemberCount(world, community) {
  const ids = community?.memberIds || [];
  if (!ids.length) return 0;
  const peopleById = world.peopleById;
  let aliveIds = null;
  if (!(peopleById instanceof Map)) {
    aliveIds = new Set();
    for (const person of world.people || []) if (person.alive) aliveIds.add(person.id);
  }
  let count = 0;
  for (const id of ids) {
    if (peopleById instanceof Map ? !!peopleById.get(id)?.alive : aliveIds.has(id)) count++;
  }
  return count;
}
