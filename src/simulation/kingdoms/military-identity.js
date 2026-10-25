export function clearMilitaryCommand(person) {
  for (const field of ['militaryRank', 'militaryUnitId', 'commanderId', 'generalId', 'fieldCommand']) delete person[field];
}

export function activeLeadershipRank(person, kingdom) {
  if (!person || person.alive === false || person.role !== 'soldier'
      || !kingdom || person.kingdomId !== kingdom.id) return null;
  return ['general', 'comandante'].includes(person.militaryRank) ? person.militaryRank : null;
}
