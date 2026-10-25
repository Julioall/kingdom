import { distance } from '../core/math.js';
import { cellAt } from '../world/spatial.js';

const productiveActions = new Set(['forage', 'hunt', 'deliver', 'gather', 'build', 'collect_log', 'collect_feed', 'trade', 'lead_sheep']);

export function updateResidencyAbsence(world, person, community, { action, assignment, moved = false, deliveredToOwnCommunity = false } = {}) {
  const kingdom = (world.kingdoms || []).find(item => item.id === person.kingdomId);
  const home = person.homeId == null ? null : world.structures.find(s => s.id === person.homeId && s.complete
    && s.destroyedDay == null && s.integrity !== 0 && s.kingdomId === person.kingdomId);
  const tile = cellAt(world, person.x, person.y);
  const atHome = home && distance(person, home) <= 4;
  const inOwnTerritory = kingdom && tile?.kingdomId === kingdom.id;
  const workingAway = moved && productiveActions.has(action)
    && (deliveredToOwnCommunity || assignment && assignment.communityId === community.id && assignment.expiresDay >= world.day);
  const connected = person.role === 'soldier' || atHome || inOwnTerritory || workingAway || distance(person, community) <= 10;
  const distress = person.foodReserve < 28 || person.hydration < 22 || person.health < 35 || person.socialNeed > 78;
  person.awayDays = connected ? Math.max(0, (person.awayDays || 0) - 2) : (person.awayDays || 0) + 1;
  if (person.role === 'soldier' || atHome || inOwnTerritory || workingAway) {
    person.awayDays = 0;
    person.dissatisfactionDays = 0;
  } else if (community.satisfaction < .28 && person.awayDays > 12 && distress) {
    person.dissatisfactionDays = (person.dissatisfactionDays || 0) + 1;
  } else person.dissatisfactionDays = Math.max(0, (person.dissatisfactionDays || 0) - 2);
  return {
    leftAfterLongAbsence: person.role !== 'soldier' && distress && person.awayDays > 45 && community.satisfaction < .4,
    leftAfterAccumulatedDissatisfaction: person.role !== 'soldier' && person.dissatisfactionDays > 20 && person.awayDays > 20
  };
}
