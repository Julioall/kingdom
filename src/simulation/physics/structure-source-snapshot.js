// Lightweight, allocation-free check of the source fields that determine
// structure collision geometry and the placement of training dummies.
//
// Call capture ONLY when geometry was reconstructed. Compare against the
// snapshot on every collision lookup to avoid regenerating hitboxes, polygon
// points, training dummy locations and string signatures for static scenes.
// These snapshots are runtime-only; keep them out of world saves/snapshots.

const same = Object.is;
const hitboxPoints = hitbox => Array.isArray(hitbox?.points) ? hitbox.points : null;

function pointValues(point) {
  return Array.isArray(point)
    ? { array: true, x: point[0], y: point[1] }
    : { array: false, x: point?.x, y: point?.y };
}

function captureHitbox(hitbox) {
  const points = hitboxPoints(hitbox);
  return {
    disabled: hitbox === false,
    enabled: hitbox?.enabled,
    halfWidth: hitbox?.halfWidth,
    halfDepth: hitbox?.halfDepth,
    offsetX: hitbox?.offsetX,
    offsetY: hitbox?.offsetY,
    points: points ? points.map(pointValues) : null
  };
}

function sameHitbox(hitbox, saved) {
  if ((hitbox === false) !== saved.disabled
      || !same(hitbox?.enabled, saved.enabled)
      || !same(hitbox?.halfWidth, saved.halfWidth)
      || !same(hitbox?.halfDepth, saved.halfDepth)
      || !same(hitbox?.offsetX, saved.offsetX)
      || !same(hitbox?.offsetY, saved.offsetY)) return false;
  const points = hitboxPoints(hitbox);
  if (!!points !== !!saved.points || points && points.length !== saved.points.length) return false;
  if (!points) return true;
  for (let i = 0; i < points.length; i++) {
    const point = points[i], value = saved.points[i];
    if (Array.isArray(point) !== value.array
        || !same(value.x, Array.isArray(point) ? point[0] : point?.x)
        || !same(value.y, Array.isArray(point) ? point[1] : point?.y)) return false;
  }
  return true;
}

function captureStructure(structure) {
  return {
    ref: structure,
    id: structure.id, type: structure.type, x: structure.x, y: structure.y,
    kingdomId: structure.kingdomId, spriteKey: structure.spriteKey,
    complete: structure.complete, destroyedDay: structure.destroyedDay,
    // Only a positive progress value controls whether an incomplete
    // structure has a hitbox. Subsequent progress increments don't matter.
    hasProgress: Number(structure.progress) > 0,
    hitbox: captureHitbox(structure.hitbox)
  };
}

function sameStructure(structure, saved) {
  return structure === saved.ref && same(structure.id, saved.id)
    && same(structure.type, saved.type)
    && same(structure.x, saved.x) && same(structure.y, saved.y)
    && same(structure.kingdomId, saved.kingdomId)
    && same(structure.spriteKey, saved.spriteKey)
    && same(structure.complete, saved.complete)
    && same(structure.destroyedDay, saved.destroyedDay)
    && (Number(structure.progress) > 0) === saved.hasProgress
    && sameHitbox(structure.hitbox, saved.hitbox);
}

export function captureStructureCollisionSources(world) {
  return {
    structures: (world.structures || []).map(captureStructure),
    // Training dummy geometry depends on the order, identity and palette of
    // kingdoms, not on temporary dummy health or training state.
    kingdoms: (world.kingdoms || []).map(kingdom => ({
      ref: kingdom, id: kingdom.id, palette: kingdom.palette
    }))
  };
}

export function sameStructureCollisionSources(world, saved) {
  if (!saved) return false;
  const structures = world.structures || [], kingdoms = world.kingdoms || [];
  if (saved.structures.length !== structures.length
      || saved.kingdoms.length !== kingdoms.length) return false;
  for (let i = 0; i < structures.length; i++) {
    if (!sameStructure(structures[i], saved.structures[i])) return false;
  }
  for (let i = 0; i < kingdoms.length; i++) {
    const kingdom = kingdoms[i], previous = saved.kingdoms[i];
    if (kingdom !== previous.ref || !same(kingdom.id, previous.id)
        || !same(kingdom.palette, previous.palette)) return false;
  }
  return true;
}
