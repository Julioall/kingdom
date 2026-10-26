// The castle sprite's anchor sits below its physical front wall. Sorting at
// that anchor hides actors already walking in front of the building.
export function structureDepthY(structure, footprint) {
  if (structure.type !== 'castelo' || !footprint) return structure.y;
  const frontY = footprint.shape === 'polygon'
    ? Math.max(...(footprint.points || []).map(point => point.y))
    : footprint.y + footprint.halfDepth;
  return Number.isFinite(frontY) ? frontY : structure.y;
}
