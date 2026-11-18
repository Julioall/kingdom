// Read-only diagnosis of NPC route congestion in authoritative worlds.
// This is deliberately NOT part of movement or AI decision-making.
// A populated next GRID tile is suggestive, NOT collision-hitbox proof.
export function inspectNpcCongestion(world) {
  const people = (world.people || []).filter(person => person.alive);
  const occupied = new Map();
  const width = world.width;
  for (const person of people) {
    if (!Number.isFinite(person.x) || !Number.isFinite(person.y)) continue;
    const tile = Math.round(person.y) * width + Math.round(person.x);
    let list = occupied.get(tile);
    if (!list) occupied.set(tile, list = []);
    list.push(person.id);
  }
  const summary = {
    peopleAlive: people.length,
    withCongestionRecord: 0,
    blockedThisDay: 0, staleCongestionRecords: 0,
    sameStartTile: 0, movedSinceBlockedStart: 0,
    nextRouteTileOccupied: 0, nextRouteTileUnoccupied: 0,
    nextRouteTileUnavailable: 0,
    retryScheduledAfterToday: 0,
    byBlockedDays: {one: 0, two: 0, threeToFive: 0, sixPlus: 0},
    byRole: {}, byAction: {},
    maxBlockedDays: 0
  };
  for (const person of people) {
    const congestion = person.navigationCongestion;
    if (!congestion) continue;
    summary.withCongestionRecord++;
    const blockedDays = Math.max(0, Number(congestion.blockedDays) || 0);
    summary.maxBlockedDays = Math.max(summary.maxBlockedDays, blockedDays);
    const bucket = blockedDays <= 1 ? 'one'
      : blockedDays === 2 ? 'two' : blockedDays <= 5 ? 'threeToFive' : 'sixPlus';
    summary.byBlockedDays[bucket]++;
    if (congestion.lastBlockedDay === world.day) summary.blockedThisDay++;
    else summary.staleCongestionRecords++;
    if (congestion.nextSearchDay > world.day) summary.retryScheduledAfterToday++;
    const current = Math.round(person.y) * width + Math.round(person.x);
    if (congestion.startIndex === current) summary.sameStartTile++;
    else summary.movedSinceBlockedStart++;
    const role = person.role || 'unknown';
    const action = person.brain?.lastAction || person.lastDecision?.action || 'unknown';
    summary.byRole[role] = (summary.byRole[role] || 0) + 1;
    summary.byAction[action] = (summary.byAction[action] || 0) + 1;
    const route = person.navigationRoute;
    if (!route || route.completed || !Array.isArray(route.path)) {
      summary.nextRouteTileUnavailable++;
      continue;
    }
    let cursor = route.cursor;
    if (!Number.isInteger(cursor) || route.path[cursor] !== current)
      cursor = route.path.indexOf(current);
    const next = cursor < 0 ? null : route.path[cursor + 1];
    if (!Number.isInteger(next)) {
      summary.nextRouteTileUnavailable++;
      continue;
    }
    const occupants = occupied.get(next) || [];
    if (occupants.some(id => id !== person.id)) summary.nextRouteTileOccupied++;
    else summary.nextRouteTileUnoccupied++;
  }
  return summary;
}
