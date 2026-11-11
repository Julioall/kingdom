// JUL-284: pure 18-dimensional observation feature extraction.
// Its inputs reflect the authoritative world at the exact decision point.
// Separating this mapping does not reorder perception, survival or actions.
import { clamp, distance } from '../core/math.js';

export function buildPeoplePolicyInputs({
  person, food, waterTarget, groupFood, groupMaterial,
  risk, huntAccess, deliveryNeed, preyNearby, browseAccess,
  feedNeed, materialNeed, looseLog, community
}) {
  return [
    clamp((68 - person.foodReserve) / 68, 0, 1),
    clamp((70 - person.hydration) / 70, 0, 1),
    clamp((70 - person.energy) / 70, 0, 1),
    clamp(person.socialNeed / 100, 0, 1),
    food ? clamp(1 - distance(person, food) / 5, 0, 1) : 0,
    waterTarget ? clamp(1 - distance(person, waterTarget) / 32, 0, 1) : 0,
    clamp(groupFood / 45, 0, 1),
    clamp(groupMaterial / 90, 0, 1),
    risk,
    clamp(person.injury / 12, 0, 1),
    huntAccess, deliveryNeed,
    preyNearby ? clamp(1 - distance(person, preyNearby) / 8, 0, 1) : 0,
    browseAccess, feedNeed, materialNeed,
    looseLog ? clamp(1 - looseLog.distance / 7, 0, 1) : 0,
    community ? clamp((community.stores.gold || 0) / 55, 0, 1) : 0
  ];
}
