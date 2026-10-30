export const METAL_KINDS = Object.freeze(['gold', 'silver', 'copper', 'iron']);

// Rendering, interaction and solid collision must agree on which deposit is visible.
export function dominantMetalKind(reserves, oreFields = false) {
  let selected = null, amount = .05;
  for (const kind of METAL_KINDS) {
    const reserve = Number(reserves[kind + (oreFields ? 'Ore' : '')]) || 0;
    if (reserve > amount) { selected = kind; amount = reserve; }
  }
  return selected;
}
