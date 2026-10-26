import { distance } from '../core/math.js';
import { collidesWithWorldAt, hitboxesOverlap, npcHitbox, structureHitbox, worldCollisionIndex } from '../physics/hitboxes.js';
import { cellAt } from '../world/spatial.js';

export const MAX_CONSTRUCTION_WORKERS = 2;

const PREFERRED_WORK_PAIRS = [
  [[-1, 1], [1, 1]], [[-2, 1], [2, 1]], [[-1, 2], [1, 2]], [[-2, 2], [2, 2]],
  [[-1, -1], [1, -1]], [[-2, -1], [2, -1]], [[-1, -2], [1, -2]], [[-2, -2], [2, -2]],
  [[2, -1], [2, 1]], [[-2, -1], [-2, 1]], [[1, -2], [1, 2]], [[-1, -2], [-1, 2]]
];

function validWorkPosition(world, person, point, collisionIndex, worksiteHitbox) {
  const tile = cellAt(world, point.x, point.y);
  if (!tile || tile.terrain !== 'land' || tile.slope > .8) return false;
  const workerBody = npcHitbox(person, point.x, point.y);
  return !hitboxesOverlap(workerBody, worksiteHitbox)
    && !collidesWithWorldAt(world, person, point.x, point.y, collisionIndex);
}

function findWorkPositions(world, structure, person) {
  const collisionIndex = worldCollisionIndex(world);
  // Include the unfinished building's final footprint even before its first
  // construction point, when the normal collision index still omits it.
  const worksiteHitbox = structureHitbox({ ...structure, complete: true });
  const corralRadius = structure.type === 'curral' ? Math.max(2, Math.round(structure.radius || 3.5)) : 0;
  const preferredPairs = corralRadius ? [
    [[-1, corralRadius + 1], [1, corralRadius + 1]],
    [[-2, corralRadius + 1], [2, corralRadius + 1]],
    [[-1, -corralRadius - 1], [1, -corralRadius - 1]],
    [[corralRadius + 1, -1], [corralRadius + 1, 1]],
    [[-corralRadius - 1, -1], [-corralRadius - 1, 1]]
  ] : PREFERRED_WORK_PAIRS;
  const pairAt = offsets => offsets.map(([dx, dy]) => ({
    x: Math.round(structure.x) + dx,
    y: Math.round(structure.y) + dy
  }));

  for (const offsets of preferredPairs) {
    const pair = pairAt(offsets);
    if (pair.every(point => validWorkPosition(world, person, point, collisionIndex, worksiteHitbox))) return pair;
  }

  // A tree, slope or neighboring building can block the preferred front side.
  // Search a small ring and keep two separate, nearby points around the site.
  const candidates = [];
  const searchRadius = corralRadius ? corralRadius + 1.8 : 3.2;
  for (let dy = -Math.ceil(searchRadius); dy <= Math.ceil(searchRadius); dy++)
    for (let dx = -Math.ceil(searchRadius); dx <= Math.ceil(searchRadius); dx++) {
    const radius = Math.hypot(dx, dy);
    if (radius < 1 || radius > searchRadius || corralRadius && radius <= corralRadius + .5) continue;
    const point = { x: Math.round(structure.x) + dx, y: Math.round(structure.y) + dy };
    if (!validWorkPosition(world, person, point, collisionIndex, worksiteHitbox)) continue;
    const distanceFromFence = corralRadius ? Math.abs(radius - (corralRadius + 1)) : radius;
    candidates.push({ point, score: distanceFromFence + (dy < 0 ? 1.5 : 0) + Math.abs(dx) * .03 });
  }
  let best = null;
  for (let first = 0; first < candidates.length; first++) for (let second = first + 1; second < candidates.length; second++) {
    const a = candidates[first], b = candidates[second];
    const separation = distance(a.point, b.point);
    if (separation < 1.4) continue;
    const score = a.score + b.score + Math.abs(a.point.y - b.point.y) * .04;
    if (!best || score < best.score) best = { score, points: [a.point, b.point] };
  }
  return best?.points || null;
}

export function constructionWorkPositions(world, structure, person) {
  if (Array.isArray(structure.workPositions) && structure.workPositions.length === MAX_CONSTRUCTION_WORKERS
      && structure.workPositions.every(point => validWorkPosition(world, person, point,
        worldCollisionIndex(world), structureHitbox({ ...structure, complete: true })))) {
    return structure.workPositions;
  }
  const positions = findWorkPositions(world, structure, person);
  if (positions) structure.workPositions = positions;
  return positions;
}

export function claimConstructionWorkstation(world, structure, person) {
  const positions = constructionWorkPositions(world, structure, person);
  if (!positions) return null;

  structure.constructionWorkerIds ||= [];
  structure.constructionWorkerLastSeen ||= {};
  if (structure.constructionWorkersPrunedDay !== world.day) {
    structure.constructionWorkerIds = structure.constructionWorkerIds.filter(id => {
      const worker = world.people.find(candidate => candidate.id === id && candidate.alive);
      return !!worker && (structure.constructionWorkerLastSeen[id] ?? -Infinity) >= world.day - 1;
    });
    structure.constructionWorkersPrunedDay = world.day;
  }
  let slot = structure.constructionWorkerIds.indexOf(person.id);
  if (slot < 0) {
    if (structure.constructionWorkerIds.length >= MAX_CONSTRUCTION_WORKERS) return null;
    slot = structure.constructionWorkerIds.length;
    structure.constructionWorkerIds.push(person.id);
  }
  structure.constructionWorkerLastSeen[person.id] = world.day;

  const position = positions[slot];
  person.constructionProjectId = structure.id;
  person.constructionWorkPosition = { structureId: structure.id, slot, x: position.x, y: position.y, day: world.day };
  return { slot, position, arrived: distance(person, position) <= .1 };
}

export function constructionContactPoint(structure) {
  if (structure.type === 'curral') {
    return { x: structure.x, y: structure.y + Math.max(2, Math.round(structure.radius || 3.5)) };
  }
  return { x: structure.x, y: structure.y + 1 };
}
