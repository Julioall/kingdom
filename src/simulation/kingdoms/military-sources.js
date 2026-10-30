export const MILITARY_CLASS_SOURCE_TYPES = Object.freeze({
  guerreiro: 'centro_militar',
  lanceiro: 'centro_militar',
  arqueiro: 'arquearia',
  monge: 'monasterio'
});

export const MILITARY_SOURCE_LABELS = Object.freeze({
  centro_militar: 'centro militar',
  arquearia: 'centro de arquearia',
  monasterio: 'monastério'
});

export function isOperationalMilitarySource(structure, type) {
  return !!structure && structure.type === type && structure.complete === true
    && structure.destroyedDay == null
    && (structure.integrity == null || structure.integrity > 0)
    && (structure.health == null || structure.health > 0);
}

export function militaryClassSource(world, kingdomId, militaryClass) {
  const type = MILITARY_CLASS_SOURCE_TYPES[militaryClass];
  if (!type) return null;
  return (world.structures || []).filter(structure => structure.kingdomId === kingdomId
      && isOperationalMilitarySource(structure, type))
    .sort((a, b) => a.id - b.id)[0] || null;
}

export function militaryClassSourceType(militaryClass) {
  return MILITARY_CLASS_SOURCE_TYPES[militaryClass] || null;
}
