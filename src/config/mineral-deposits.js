export const METAL_KINDS = Object.freeze(['gold', 'silver', 'copper', 'iron']);
const ORE_FIELDS = Object.freeze(METAL_KINDS.map(kind => kind + 'Ore'));

// Rendering, interaction and solid collision must agree on which deposit is visible.
export function dominantMetalKind(reserves, oreFields = false) {
  let selected = null, amount = .05;
  const fields = oreFields ? ORE_FIELDS : METAL_KINDS;
  for (let index = 0; index < fields.length; index++) {
    const reserve = Number(reserves[fields[index]]) || 0;
    if (reserve > amount) { selected = METAL_KINDS[index]; amount = reserve; }
  }
  return selected;
}
