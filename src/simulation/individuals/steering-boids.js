// Deterministic, bounded local steering over EXISTING grid movement.
// It chooses among already permitted next tiles. A* plans global paths;
// canStep/collision/territory/corral rules remain the final authority.
// No RNG, velocities in snapshots, global all-pairs scans or per-frame work.

const RADIUS = 2.8;
const MAX_NEIGHBORS = 12;
const MAX_CANDIDATES = 8;

function magnitude(x, y) { return Math.hypot(x, y); }
function unit(x, y) {
  const length = magnitude(x, y);
  return length > .00001 ? {x: x / length, y: y / length} : {x: 0, y: 0};
}
function neighborsNear(world, actor, radius) {
  const collection = actor.speciesId != null ? world.animals : world.people;
  const index = actor.speciesId != null ? world.animalsSpatialIndex : world.peopleSpatialIndex;
  return typeof index?.query === 'function'
    ? index.query(actor.x, actor.y, radius) : collection || [];
}

function sameFlock(actor, neighbor) {
  return actor.speciesId === 'sheep' && neighbor.speciesId === 'sheep'
    && (actor.herdCommunityId ?? null) === (neighbor.herdCommunityId ?? null);
}

export function localSteering(world, actor, destination, {
  radius = RADIUS, maxNeighbors = MAX_NEIGHBORS
} = {}) {
  if (!actor || !destination || !Number.isFinite(actor.x)
      || !Number.isFinite(actor.y) || !Number.isFinite(destination.x)
      || !Number.isFinite(destination.y)) return null;
  const isSheep = actor.speciesId === 'sheep';
  const isHuman = actor.speciesId == null;
  if (!isSheep && !isHuman) return null;
  const seek = unit(destination.x - actor.x, destination.y - actor.y);
  if (!seek.x && !seek.y) return null;
  let sepX = 0, sepY = 0, alignX = 0, alignY = 0, cohX = 0, cohY = 0;
  let count = 0, aligned = 0;
  const nearby = [];
  const maxRadiusSquared = radius * radius;
  for (const neighbor of neighborsNear(world, actor, radius)) {
    if (!neighbor?.alive || neighbor === actor || neighbor.id === actor.id) continue;
    if (isSheep && neighbor.speciesId !== 'sheep') continue;
    if (isHuman && neighbor.speciesId != null) continue;
    const dx = neighbor.x - actor.x, dy = neighbor.y - actor.y;
    const squared = dx * dx + dy * dy;
    if (squared > maxRadiusSquared) continue;
    // Deterministic sign breaks the symmetry of exact overlapping centers.
    const repelX = squared < .000001 ? (actor.id < neighbor.id ? -1 : 1) : -dx;
    const repelY = squared < .000001 ? 0 : -dy;
    const weight = 1 / Math.max(.1, squared);
    sepX += repelX * weight;
    sepY += repelY * weight;
    nearby.push(neighbor);
    count++;
    const formationPeer = isSheep ? sameFlock(actor, neighbor)
      : actor.role === 'soldier' && neighbor.role === 'soldier'
        && actor.kingdomId === neighbor.kingdomId
        && actor.campaignId != null && actor.campaignId === neighbor.campaignId;
    if (formationPeer) {
      cohX += neighbor.x;
      cohY += neighbor.y;
      alignX += neighbor.headingX || 0;
      alignY += neighbor.headingY || 0;
      aligned++;
    }
    if (count >= maxNeighbors) break;
  }
  if (!count) return null;
  const separation = unit(sepX, sepY);
  const cohesion = aligned ? unit(cohX / aligned - actor.x, cohY / aligned - actor.y) : {x: 0, y: 0};
  const alignment = aligned ? unit(alignX, alignY) : {x: 0, y: 0};
  // Coherence is weak for soldiers: their commander/route defines formation.
  const sepWeight = isSheep ? .9 : actor.role === 'soldier' ? .58 : .7;
  const cohesionWeight = isSheep ? .18 : actor.role === 'soldier' ? .1 : 0;
  const alignmentWeight = isSheep ? .23 : actor.role === 'soldier' ? .12 : 0;
  const direction = unit(
    seek.x + separation.x * sepWeight + cohesion.x * cohesionWeight + alignment.x * alignmentWeight,
    seek.y + separation.y * sepWeight + cohesion.y * cohesionWeight + alignment.y * alignmentWeight
  );
  return {
    x: direction.x, y: direction.y, neighbors: count,
    groupNeighbors: aligned, nearby
  };
}

/**
 * Return undefined when steering should not interfere with legacy routing;
 * return null when sheep have neighbors and all progress tiles are occupied.
 * Only choose among candidates that a caller already checked with canStep.
 */
export function chooseSteeredTile(world, actor, from, destination, allowedTiles,
  {requireProgress = true, avoidPrevious = true} = {}) {
  const steering = localSteering(world, actor, destination);
  if (!steering || !allowedTiles?.length) return undefined;
  const isSheep = actor.speciesId === 'sheep';
  const originDistance = magnitude(from.x - destination.x, from.y - destination.y);
  let best = undefined, bestScore = Infinity;
  let forwardCandidates = 0, occupiedCandidates = 0;
  for (let i = 0; i < Math.min(MAX_CANDIDATES, allowedTiles.length); i++) {
    const tile = allowedTiles[i];
    if (!tile) continue;
    const distance = magnitude(tile.x - destination.x, tile.y - destination.y);
    if (requireProgress && !(distance < originDistance - .001)) continue;
    if (avoidPrevious && tile.x === actor.lastStepFromX && tile.y === actor.lastStepFromY
        && originDistance > 1.5) continue;
    forwardCandidates++;
    // Sheep must not choose a tile already occupied by another sheep.
    // Neighbors here are bounded to the same spatial hash radius, not all
    // world animals. Physical movement validation still runs afterwards.
    if (isSheep && steering.nearby.some(other =>
      Math.round(other.x) === tile.x && Math.round(other.y) === tile.y)) {
      occupiedCandidates++;
      continue;
    }
    const heading = unit(tile.x - from.x, tile.y - from.y);
    const alignment = heading.x * steering.x + heading.y * steering.y;
    const score = distance - .32 * alignment;
    // Stable tie-break by original candidate sequence; no random noise.
    if (score < bestScore) { best = tile; bestScore = score; }
  }
  if (best) return best;
  if (isSheep && forwardCandidates > 0 && forwardCandidates === occupiedCandidates) return null;
  return undefined;
}
