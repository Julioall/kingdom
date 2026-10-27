export const DOMESTIC_SHEEP_PER_PEN = 35;

export function activeCommunityPens(world, communityId) {
  return (world.structures || []).filter(structure => structure.complete && structure.destroyedDay == null
    && structure.integrity !== 0 && structure.type === 'curral' && structure.communityId === communityId)
    .sort((a, b) => a.id - b.id);
}

export function communityNeedsAdditionalPen(world, communityId) {
  const summary = communityHerdPenAssignments(world, communityId);
  return summary.animals.length > 0 && summary.animals.length >= summary.pens.length * DOMESTIC_SHEEP_PER_PEN;
}

function communityHerdAnimals(world, communityId) {
  const peopleById = new Map((world.people || []).map(person => [person.id, person]));
  return (world.animals || []).filter(animal => animal.alive && animal.speciesId === 'sheep'
    && (animal.herdCommunityId === communityId
      || (animal.beingLedBy != null && peopleById.get(animal.beingLedBy)?.communityId === communityId)))
    .sort((a, b) => a.id - b.id);
}

export function communityHerdPenAssignments(world, communityId) {
  const pens = activeCommunityPens(world, communityId);
  const animals = communityHerdAnimals(world, communityId);
  const penById = new Map(pens.map(pen => [pen.id, pen]));
  const assignments = new Map();
  const counts = new Map(pens.map(pen => [pen.id, 0]));

  function assign(animal, pen) {
    if (!pen || (counts.get(pen.id) || 0) >= DOMESTIC_SHEEP_PER_PEN) return false;
    assignments.set(animal.id, pen.id);
    counts.set(pen.id, (counts.get(pen.id) || 0) + 1);
    return true;
  }

  // Preserve valid saved assignments first, then place legacy and overflow
  // animals into the nearest pen with room. Anything left over stays outside.
  for (const animal of animals) {
    const savedPen = penById.get(animal.herdPenId);
    if (savedPen) assign(animal, savedPen);
  }
  for (const animal of animals) {
    if (assignments.has(animal.id)) continue;
    const pen = pens.filter(candidate => (counts.get(candidate.id) || 0) < DOMESTIC_SHEEP_PER_PEN)
      .sort((a, b) => Math.hypot(animal.x - a.x, animal.y - a.y) - Math.hypot(animal.x - b.x, animal.y - b.y)
        || a.id - b.id)[0];
    if (pen) assign(animal, pen);
  }
  return { pens, animals, assignments, counts };
}

export function reconcileCommunityHerdPens(world, communityId) {
  const summary = communityHerdPenAssignments(world, communityId);
  for (const animal of summary.animals) {
    animal.herdPenId = summary.assignments.get(animal.id) ?? null;
  }
  return summary;
}

export function availableCommunityPen(world, communityId, from = null) {
  const summary = communityHerdPenAssignments(world, communityId);
  return summary.pens.filter(pen => (summary.counts.get(pen.id) || 0) < DOMESTIC_SHEEP_PER_PEN)
    .sort((a, b) => (from ? Math.hypot(from.x - a.x, from.y - a.y) - Math.hypot(from.x - b.x, from.y - b.y) : 0)
      || a.id - b.id)[0] || null;
}

export function assignedHerdPen(world, animal) {
  if (!animal || animal.herdCommunityId == null) return null;
  const savedPen = activeCommunityPens(world, animal.herdCommunityId).find(pen => pen.id === animal.herdPenId);
  if (savedPen) return savedPen;
  const summary = communityHerdPenAssignments(world, animal.herdCommunityId);
  const penId = summary.assignments.get(animal.id);
  return summary.pens.find(pen => pen.id === penId) || null;
}
