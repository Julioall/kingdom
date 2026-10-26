import { distance } from '../core/math.js';
import { PLANTS } from '../../config/ecosystem.js';
import { collidesWithStructureAt, hitboxesOverlap, mineralHitbox, npcHitbox, resourceCollisionIndex, structureHitbox, treeHitbox, worldCollisionIndex } from '../physics/hitboxes.js';
import { cellAt } from '../world/spatial.js';
import { invalidateNavigation } from '../individuals/navigation-cache.js';

export const MAX_CONSTRUCTION_WORKERS = 2;

const PREFERRED_WORK_PAIRS = [
  [[-1, 1], [1, 1]], [[-2, 1], [2, 1]], [[-1, 2], [1, 2]], [[-2, 2], [2, 2]],
  [[-1, -1], [1, -1]], [[-2, -1], [2, -1]], [[-1, -2], [1, -2]], [[-2, -2], [2, -2]],
  [[2, -1], [2, 1]], [[-2, -1], [-2, 1]], [[1, -2], [1, 2]], [[-1, -2], [-1, 2]]
];

function resourceBlockersAt(world, person, point) {
  const body = npcHitbox(person, point.x, point.y);
  const index = resourceCollisionIndex(world);
  const tileIndex = point.y * world.width + point.x;
  return (index.byTile.get(tileIndex) || []).filter(resource => hitboxesOverlap(body, resource));
}

export function constructionWorkpointHasResources(world, person, point) {
  return resourceBlockersAt(world, person, point).length > 0;
}

export function clearConstructionWorkpointResources(world, person, point) {
  const blockers = resourceBlockersAt(world, person, point);
  if (!blockers.length) return { cleared: false, kinds: [] };
  const kinds = new Set();
  for (const blocker of blockers) {
    const tile = world.tiles[blocker.resourceId];
    if (!tile) continue;
    if (blocker.resourceKind === 'tree') {
      const broadleaf = PLANTS.findIndex(plant => plant.id === 'broadleaf');
      const conifer = PLANTS.findIndex(plant => plant.id === 'conifer');
      const biomass = Math.max(tile.plants[broadleaf] || 0, tile.plants[conifer] || 0);
      if (biomass < 150 || !hitboxesOverlap(npcHitbox(person, point.x, point.y), treeHitbox(world, tile))) continue;
      const type = tile.plants[broadleaf] >= tile.plants[conifer] ? 'broadleaf' : 'conifer';
      tile.plants[broadleaf] = Math.min(tile.plants[broadleaf], Math.max(18, tile.plants[broadleaf] * .075));
      tile.plants[conifer] = Math.min(tile.plants[conifer], Math.max(18, tile.plants[conifer] * .075));
      tile.stump = { type, untilDay: world.day + 95 };
      kinds.add('tree');
    } else {
      const mineral = mineralHitbox(tile);
      if (!mineral || !hitboxesOverlap(npcHitbox(person, point.x, point.y), mineral)) continue;
      if (tile.stoneDeposit > .7) { tile.stoneDeposit = 0; kinds.add('stone'); }
      if (tile.goldOre > .05) { tile.goldOre = 0; kinds.add('gold'); }
    }
  }
  if (kinds.size) invalidateNavigation(world);
  return { cleared: kinds.size > 0, kinds: [...kinds] };
}

function validWorkPosition(world, person, point, collisionIndex, worksiteHitbox) {
  const tile = cellAt(world, point.x, point.y);
  if (!tile || tile.terrain !== 'land' || tile.slope > .8) return false;
  const workerBody = npcHitbox(person, point.x, point.y);
  return !hitboxesOverlap(workerBody, worksiteHitbox)
    && !collidesWithStructureAt(world, person, point.x, point.y, collisionIndex.structures);
}

function findWorkPositions(world, structure, person) {
  const collisionIndex = worldCollisionIndex(world);
  // Include the unfinished building's final footprint even before its first
  // construction point, when the normal collision index still omits it.
  const worksiteHitbox = structureHitbox({ ...structure, complete: true });
  const corralRadius = structure.type === 'curral' ? Math.max(2, Math.round(structure.radius || 3.5)) : 0;
  const preferredPairs = structure.type === 'torre' ? [
    [[0, 1], [2, 1]], [[0, 1], [-2, 1]], ...PREFERRED_WORK_PAIRS
  ] : corralRadius ? [
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

export function constructionWorkpointReachable(world, person, point, reachableTileIndices) {
  const index = point.y * world.width + point.x;
  if (reachableTileIndices.has(index)) return true;
  if (!constructionWorkpointHasResources(world, person, point)) return false;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const tile = cellAt(world, point.x + dx, point.y + dy);
    if (tile && reachableTileIndices.has(tile.i)) return true;
  }
  return false;
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
