function countCauses(entities) {
  const counts = {};
  for (const entity of entities) {
    if (entity?.alive !== false) continue;
    const cause = entity.deathCause || 'unattributed';
    counts[cause] = (counts[cause] || 0) + 1;
  }
  return counts;
}

export function summarizeFoodDeaths(world) {
  const deadPeople = (world?.people || []).filter(person => person?.alive === false);
  const deadAnimals = (world?.animals || []).filter(animal => animal?.alive === false);
  const domesticAnimals = deadAnimals.filter(animal => animal.herdCommunityId != null);
  const wildAnimals = deadAnimals.filter(animal => animal.herdCommunityId == null);
  return {
    people: { total: deadPeople.length, byCause: countCauses(deadPeople) },
    animals: { total: deadAnimals.length, byCause: countCauses(deadAnimals) },
    domesticatedAnimals: { total: domesticAnimals.length, byCause: countCauses(domesticAnimals) },
    wildAnimals: { total: wildAnimals.length, byCause: countCauses(wildAnimals) }
  };
}
