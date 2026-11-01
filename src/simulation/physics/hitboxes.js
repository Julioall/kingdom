import { PLANTS, SHEEP_ADULT_AGE_DAYS, SHEEP_JUVENILE_MIN_SCALE } from '../../config/ecosystem.js';
import { isTreeAnchor } from '../ecology/plants.js';
import { STRUCTURE_COLLISION_PROFILES } from './collision-profiles.js';
import { dominantMetalKind } from '../../config/mineral-deposits.js';
import { trainingDummiesForWorld } from '../world/training-dummies.js';

// Collision masks live on the ground plane. Building artwork rises above
// these footprints, so its full sprite rectangle must never block movement.
const BUILDING_FOOTPRINTS = Object.freeze({
  castle: Object.freeze({ halfWidth: 1.45, halfDepth: .7 }),
  tower: Object.freeze({ halfWidth: .48, halfDepth: .42 }),
  barracks: Object.freeze({ halfWidth: 1.08, halfDepth: .58 }),
  archery: Object.freeze({ halfWidth: 1.02, halfDepth: .56 }),
  monastery: Object.freeze({ halfWidth: 1.12, halfDepth: .68 }),
  house1: Object.freeze({ halfWidth: .64, halfDepth: .44 }),
  house2: Object.freeze({ halfWidth: .68, halfDepth: .46 }),
  house3: Object.freeze({ halfWidth: .62, halfDepth: .42 }),
  farmhouse: Object.freeze({ halfWidth: .72, halfDepth: .48 })
});

const STRUCTURE_SPRITES = Object.freeze({
  castelo: 'castle', torre: 'tower', centro_militar: 'barracks',
  arquearia: 'archery', monasterio: 'monastery', casa: 'house1',
  abrigo: 'house1', roça: 'farmhouse', 'posto de coleta': 'house2'
});

const DEFAULT_NPC_RADIUS = .22;
const CHILD_NPC_RADIUS = .17;
const DEFAULT_ANIMAL_RADIUS = .18;
const NPC_COLLISION_RAISE = .25;
const TREE_COLLISION_RAISE = .1;
const SPATIAL_INDEX_MARGIN = .35;
const BROADLEAF_INDEX = PLANTS.findIndex(plant => plant.id === 'broadleaf');
const CONIFER_INDEX = PLANTS.findIndex(plant => plant.id === 'conifer');
let structureIndexCache = new WeakMap();
let resourceIndexCache = new WeakMap();
let worldIndexCache = new WeakMap();

function structureProfile(sprite) {
  return STRUCTURE_COLLISION_PROFILES[sprite] || {};
}

export function npcHitbox(person, x = person?.x, y = person?.y) {
  if (!person || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const custom = person.hitbox && typeof person.hitbox === 'object' ? person.hitbox : null;
  const defaultRadius = Number.isFinite(person.ageDays) && person.ageDays < 12 * 365
    ? CHILD_NPC_RADIUS : DEFAULT_NPC_RADIUS;
  return {
    shape: 'circle',
    x: x + (Number(custom?.offsetX) || 0),
    y: y - NPC_COLLISION_RAISE + (Number(custom?.offsetY) || 0),
    radius: Math.max(0, Number.isFinite(custom?.radius) ? custom.radius : defaultRadius),
    entityId: person.id ?? null
  };
}

function actorHitbox(actor, x, y) {
  if (actor?.speciesId == null) return npcHitbox(actor, x, y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const custom = actor.hitbox && typeof actor.hitbox === 'object' ? actor.hitbox : null;
  const sheepGrowth = actor.speciesId === 'sheep'
    ? Math.max(0, Math.min(1, (actor.ageDays || 0) / SHEEP_ADULT_AGE_DAYS)) : 1;
  const juvenileScale = actor.speciesId === 'sheep'
    ? SHEEP_JUVENILE_MIN_SCALE + (1 - SHEEP_JUVENILE_MIN_SCALE) * sheepGrowth : 1;
  return {
    shape: 'circle', x: x + (Number(custom?.offsetX) || 0),
    y: y + (Number(custom?.offsetY) || 0),
    radius: Math.max(0, Number.isFinite(custom?.radius) ? custom.radius : DEFAULT_ANIMAL_RADIUS * juvenileScale),
    entityId: actor.id ?? null
  };
}

export function animalHitbox(actor, x = actor?.x, y = actor?.y) { return actorHitbox(actor, x, y); }

export function structureHitbox(structure) {
  if (!structure || structure.destroyedDay != null || structure.type === 'curral'
      || structure.type === 'divisa' || !Number.isFinite(structure.x) || !Number.isFinite(structure.y)) return null;
  if (!structure.complete && !(Number(structure.progress) > 0)) return null;

  const sprite = structure.spriteKey || STRUCTURE_SPRITES[structure.type] || 'house3';
  const profile = structureProfile(sprite);
  const custom = structure.hitbox;
  if (custom === false || custom?.enabled === false) return null;
  const footprint = BUILDING_FOOTPRINTS[sprite] || BUILDING_FOOTPRINTS.house3;
  const finalHalfWidth = Number.isFinite(custom?.halfWidth) ? Math.max(0, custom.halfWidth)
    : Number.isFinite(profile.halfWidth) ? profile.halfWidth : footprint.halfWidth;
  const finalHalfDepth = Number.isFinite(custom?.halfDepth) ? Math.max(0, custom.halfDepth)
    : Number.isFinite(profile.halfDepth) ? profile.halfDepth : footprint.halfDepth;
  const x = structure.x + (Number(profile.offsetX) || 0) + (Number(custom?.offsetX) || 0);
  const y = structure.y + (Number(profile.offsetY) || 0) + (Number(custom?.offsetY) || 0);
  const sourcePoints = Array.isArray(custom?.points) ? custom.points : profile.points;
  const points = Array.isArray(sourcePoints) ? sourcePoints.map(point => Array.isArray(point)
    ? { x: Number(point[0]), y: Number(point[1]) }
    : { x: Number(point?.x), y: Number(point?.y) }).filter(point => Number.isFinite(point.x) && Number.isFinite(point.y)) : [];
  return {
    shape: points.length >= 3 ? 'polygon' : 'rectangle',
    x,
    y,
    halfWidth: finalHalfWidth,
    halfDepth: finalHalfDepth,
    halfHeight: finalHalfDepth,
    points: points.length >= 3 ? points.map(point => ({ x: x + point.x, y: y + point.y })) : undefined,
    structureId: structure.id ?? null
  };
}

export function structureInteractionPoint(structure) {
  if (!structure || !Number.isFinite(structure.x) || !Number.isFinite(structure.y)) return null;
  const sprite = structure.spriteKey || STRUCTURE_SPRITES[structure.type] || 'house3';
  const profile = structureProfile(sprite);
  const entry = structure.entryTile;
  return {
    x: (Number.isFinite(entry?.x) ? Math.round(entry.x) : Math.round(structure.x)) + (Number(profile.entryOffsetX) || 0),
    y: (Number.isFinite(entry?.y) ? Math.round(entry.y) : Math.round(structure.y) + 1) + (Number(profile.entryOffsetY) || 0)
  };
}

// Tree masks cover only the trunk at ground contact; canopy size stays visual.
export function treeHitbox(world, tile) {
  if (!tile || !tile.plants || BROADLEAF_INDEX < 0 || CONIFER_INDEX < 0
      || tile.terrain === 'water' || tile.cropFieldId != null || !isTreeAnchor(world, tile)) return null;
  const broadleaf = tile.plants[BROADLEAF_INDEX] || 0;
  const conifer = tile.plants[CONIFER_INDEX] || 0;
  const type = broadleaf >= conifer ? 'broadleaf' : 'conifer';
  const mass = Math.max(broadleaf, conifer);
  const scale = mass > 760 ? 1 : mass > 420 ? .84 : .68;
  const halfSize = (type === 'conifer' ? .22 : .2) * scale;
  return { shape: 'rectangle', x: tile.x, y: tile.y - TREE_COLLISION_RAISE,
    halfWidth: halfSize, halfDepth: halfSize,
    resourceKind: 'tree', resourceId: tile.i };
}

// Mineral artwork and mining effects are centered in each tile. Convert that
// center to the actor collision plane, whose rendered ground anchor is y + 1.
// Large stone outcrops get a wider base; small deposits stay compact.
export function mineralHitbox(tile) {
  if (!tile || tile.terrain === 'water' || tile.cropFieldId != null) return null;
  const stone = Number(tile.stoneDeposit) || 0;
  const collisionY = tile.y - .5;
  const kind = dominantMetalKind(tile, true) || (stone > .7 ? 'stone' : null);
  if (!kind) return null;
  const halfSize = kind !== 'stone' ? .24 : stone >= 8 ? .3 : .23;
  return { shape: 'rectangle', x: tile.x, y: collisionY,
    halfWidth: halfSize, halfDepth: halfSize,
    resourceKind: kind, resourceId: tile.i };
}

// Interaction-only reach mask for visible berry/browse shrubs. Keep this out
// of resourceCollisionIndex so pawns can walk through the bush tile.
export function bushHarvestHitbox(world, tile, plantId) {
  const hiddenUntilField = plantId === 'browse' ? 'browseBushHiddenUntilDay' : 'berryBushHiddenUntilDay';
  if (!world || !tile || tile.terrain === 'water' || tile.cropFieldId != null
      || !['berry', 'browse'].includes(plantId)
      || (tile[hiddenUntilField] ?? -1) >= world.day) return null;
  const plantIndex = PLANTS.findIndex(plant => plant.id === plantId);
  if (plantIndex < 0 || (tile.plants[plantIndex] || 0) < 18) return null;
  return { shape: 'circle', x: tile.x, y: tile.y - NPC_COLLISION_RAISE, radius: .82,
    resourceKind: 'bush-harvest', plantId, resourceId: tile.i };
}

function rectangleDimensions(hitbox) {
  return {
    halfWidth: hitbox.halfWidth,
    halfDepth: Number.isFinite(hitbox.halfDepth) ? hitbox.halfDepth : hitbox.halfHeight
  };
}

function polygonPoints(hitbox) {
  if (hitbox.shape === 'polygon') return hitbox.points || [];
  if (hitbox.shape !== 'rectangle') return [];
  const size = rectangleDimensions(hitbox);
  return [
    { x: hitbox.x - size.halfWidth, y: hitbox.y - size.halfDepth },
    { x: hitbox.x + size.halfWidth, y: hitbox.y - size.halfDepth },
    { x: hitbox.x + size.halfWidth, y: hitbox.y + size.halfDepth },
    { x: hitbox.x - size.halfWidth, y: hitbox.y + size.halfDepth }
  ];
}

function pointInPolygon(point, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    const crosses = (a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / ((b.y - a.y) || Number.EPSILON) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointSegmentDistanceSquared(point, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return (point.x - a.x) ** 2 + (point.y - a.y) ** 2;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  const x = a.x + t * dx, y = a.y + t * dy;
  return (point.x - x) ** 2 + (point.y - y) ** 2;
}

function orient(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsIntersect(a, b, c, d) {
  const abC = orient(a, b, c), abD = orient(a, b, d), cdA = orient(c, d, a), cdB = orient(c, d, b);
  const onSegment = (start, point, end) => point.x >= Math.min(start.x, end.x) - 1e-9
    && point.x <= Math.max(start.x, end.x) + 1e-9 && point.y >= Math.min(start.y, end.y) - 1e-9
    && point.y <= Math.max(start.y, end.y) + 1e-9;
  if (Math.abs(abC) < 1e-9 && onSegment(a, c, b)) return true;
  if (Math.abs(abD) < 1e-9 && onSegment(a, d, b)) return true;
  if (Math.abs(cdA) < 1e-9 && onSegment(c, a, d)) return true;
  if (Math.abs(cdB) < 1e-9 && onSegment(c, b, d)) return true;
  return (abC < 0) !== (abD < 0) && (cdA < 0) !== (cdB < 0);
}

function segmentIntersectionFraction(from, to, edgeStart, edgeEnd) {
  const rx = to.x - from.x, ry = to.y - from.y;
  const sx = edgeEnd.x - edgeStart.x, sy = edgeEnd.y - edgeStart.y;
  const denominator = rx * sy - ry * sx;
  const qx = edgeStart.x - from.x, qy = edgeStart.y - from.y;
  if (Math.abs(denominator) < 1e-10) {
    if (Math.abs(qx * ry - qy * rx) >= 1e-9) return null;
    const lengthSquared = rx * rx + ry * ry;
    if (!lengthSquared) return null;
    const first = (qx * rx + qy * ry) / lengthSquared;
    const second = ((edgeEnd.x - from.x) * rx + (edgeEnd.y - from.y) * ry) / lengthSquared;
    const fraction = Math.max(0, Math.min(first, second));
    return fraction <= Math.min(1, Math.max(first, second)) ? fraction : null;
  }
  const fraction = (qx * sy - qy * sx) / denominator;
  const edgeFraction = (qx * ry - qy * rx) / denominator;
  return fraction >= 0 && fraction <= 1 && edgeFraction >= 0 && edgeFraction <= 1 ? fraction : null;
}

function segmentHitboxFraction(from, to, hitbox) {
  if (hitbox.shape === 'circle') {
    const dx = to.x - from.x, dy = to.y - from.y;
    const lengthSquared = dx * dx + dy * dy;
    const ox = from.x - hitbox.x, oy = from.y - hitbox.y;
    const c = ox * ox + oy * oy - hitbox.radius * hitbox.radius;
    if (c <= 0) return 0;
    if (!lengthSquared) return null;
    const b = 2 * (ox * dx + oy * dy), discriminant = b * b - 4 * lengthSquared * c;
    if (discriminant < 0) return null;
    const fraction = (-b - Math.sqrt(discriminant)) / (2 * lengthSquared);
    return fraction >= 0 && fraction <= 1 ? fraction : null;
  }
  const points = polygonPoints(hitbox);
  if (!points.length) return null;
  if (pointInPolygon(from, points)) return 0;
  let first = null;
  for (let index = 0; index < points.length; index++) {
    const fraction = segmentIntersectionFraction(from, to, points[index], points[(index + 1) % points.length]);
    if (fraction != null && (first == null || fraction < first)) first = fraction;
  }
  return first;
}

// Combat reuses ground-plane collision masks, but terrain and physical height
// still decide whether a low swing or projectile has a clear path. Sampling the
// spatial indexes keeps this bounded to the cells crossed by the weapon.
export function combatPathObstruction(world, from, to, {
  sourceElevation = 0, targetElevation = sourceElevation, ignoreStructureId = null, collisionIndex = null
} = {}) {
  if (!world || !from || !to || !Number.isFinite(from.x) || !Number.isFinite(from.y)
      || !Number.isFinite(to.x) || !Number.isFinite(to.y)) return null;
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length < 1e-8) return null;
  const steps = Math.max(2, Math.ceil(length * 4));
  const index = collisionIndex || worldCollisionIndex(world);
  const candidates = new Set();
  let first = null;
  for (let step = 1; step < steps; step++) {
    const fraction = step / steps;
    const x = from.x + (to.x - from.x) * fraction;
    const y = from.y + (to.y - from.y) * fraction;
    const height = sourceElevation + (targetElevation - sourceElevation) * fraction;
    const tileX = Math.round(x), tileY = Math.round(y);
    const tile = world.tiles?.[tileY * world.width + tileX];
    const terrainHeight = tile?.terrain === 'rock' ? Math.max(.65, (tile.elevationLevel || 0) * 1) : 0;
    if (tile && (tile.terrain === 'water' || tile.terrain === 'rock') && height <= terrainHeight) {
      first = { fraction, kind: 'terrain', terrain: tile.terrain, tileId: tile.i ?? tileY * world.width + tileX,
        point: { x, y } };
      break;
    }
    const key = tileY * world.width + tileX;
    for (const collisionIndex of [index.structures, index.resources]) {
      for (const hitbox of collisionIndex?.byTile.get(key) || []) candidates.add(hitbox);
    }
  }
  for (const hitbox of candidates) {
    if (ignoreStructureId != null && hitbox.structureId === ignoreStructureId) continue;
    const fraction = segmentHitboxFraction(from, to, hitbox);
    if (fraction == null || fraction <= .01 || fraction >= .99) continue;
    const height = sourceElevation + (targetElevation - sourceElevation) * fraction;
    if (height > .65 || first && fraction >= first.fraction) continue;
    first = { fraction, kind: hitbox.structureId != null ? 'structure' : 'resource',
      structureId: hitbox.structureId ?? null, resourceKind: hitbox.resourceKind ?? null,
      resourceId: hitbox.resourceId ?? null, point: { x: from.x + (to.x - from.x) * fraction,
        y: from.y + (to.y - from.y) * fraction } };
  }
  return first;
}

function polygonsOverlap(a, b) {
  if (!a.length || !b.length) return false;
  if (a.some(point => pointInPolygon(point, b)) || b.some(point => pointInPolygon(point, a))) return true;
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) {
    if (segmentsIntersect(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true;
  }
  return false;
}

function pointPolygonDistanceSquared(point, points) {
  if (!points.length || pointInPolygon(point, points)) return 0;
  let distance = Infinity;
  for (let index = 0; index < points.length; index++) {
    distance = Math.min(distance, pointSegmentDistanceSquared(point, points[index], points[(index + 1) % points.length]));
  }
  return distance;
}

function polygonDistance(a, b) {
  if (polygonsOverlap(a, b)) return 0;
  let distanceSquared = Infinity;
  for (const point of a) distanceSquared = Math.min(distanceSquared, pointPolygonDistanceSquared(point, b));
  for (const point of b) distanceSquared = Math.min(distanceSquared, pointPolygonDistanceSquared(point, a));
  return Math.sqrt(distanceSquared);
}

export function hitboxesOverlap(a, b) {
  if (!a || !b) return false;
  if (a.shape === 'circle' && b.shape === 'circle') {
    const radius = a.radius + b.radius;
    const dx = a.x - b.x, dy = a.y - b.y;
    return dx * dx + dy * dy < radius * radius;
  }
  if (a.shape === 'rectangle' && b.shape === 'rectangle') {
    const aSize = rectangleDimensions(a), bSize = rectangleDimensions(b);
    return Math.abs(a.x - b.x) < aSize.halfWidth + bSize.halfWidth
      && Math.abs(a.y - b.y) < aSize.halfDepth + bSize.halfDepth;
  }
  if (a.shape === 'circle' || b.shape === 'circle') {
    const circle = a.shape === 'circle' ? a : b, other = circle === a ? b : a;
    if (other.shape === 'polygon') return pointPolygonDistanceSquared(circle, other.points || []) < circle.radius * circle.radius;
    if (other.shape !== 'rectangle') return false;
    const size = rectangleDimensions(other);
    const dx = Math.max(Math.abs(circle.x - other.x) - size.halfWidth, 0);
    const dy = Math.max(Math.abs(circle.y - other.y) - size.halfDepth, 0);
    return dx * dx + dy * dy < circle.radius * circle.radius;
  }
  return polygonsOverlap(polygonPoints(a), polygonPoints(b));
}

// Distance between the surfaces (zero while touching or overlapping), useful
// for weapon reach and contact rules that will share NPC collision masks.
export function hitboxSurfaceDistance(a, b) {
  if (!a || !b) return Infinity;
  if (a.shape === 'circle' && b.shape === 'circle') {
    return Math.max(0, Math.hypot(a.x - b.x, a.y - b.y) - a.radius - b.radius);
  }
  if (a.shape === 'rectangle' && b.shape === 'rectangle') {
    const aSize = rectangleDimensions(a), bSize = rectangleDimensions(b);
    const dx = Math.max(0, Math.abs(a.x - b.x) - aSize.halfWidth - bSize.halfWidth);
    const dy = Math.max(0, Math.abs(a.y - b.y) - aSize.halfDepth - bSize.halfDepth);
    return Math.hypot(dx, dy);
  }
  if (a.shape === 'circle' || b.shape === 'circle') {
    const circle = a.shape === 'circle' ? a : b, other = circle === a ? b : a;
    if (other.shape !== 'rectangle' && other.shape !== 'polygon') return Infinity;
    return Math.max(0, Math.sqrt(pointPolygonDistanceSquared(circle, polygonPoints(other))) - circle.radius);
  }
  if (!['rectangle', 'polygon'].includes(a.shape) || !['rectangle', 'polygon'].includes(b.shape)) return Infinity;
  return polygonDistance(polygonPoints(a), polygonPoints(b));
}

export function hitboxSignature(hitboxes) {
  // JUL-285 experiment: preserve every delimiter and null/undefined slot
  // in the original navigation key, while avoiding a nested field-array
  // allocation for every hitbox. Do not hash/truncate collision identity.
  const slots = new Array(hitboxes.length);
  for (let i = 0; i < hitboxes.length; i++) {
    const h = hitboxes[i];
    const points = h.points?.map(point => point.x + ',' + point.y).join(';');
    slots[i] = `${h.structureId ?? ''}:${h.x ?? ''}:${h.y ?? ''}:${h.shape ?? ''}:${h.halfWidth ?? ''}:${h.halfDepth ?? ''}:${h.radius ?? ''}:${h.resourceKind ?? ''}:${h.entityId ?? ''}:${h.trainingDummyId ?? ''}:${points ?? ''}`;
  }
  return slots.join('|');
}

function spatialIndex(world, hitboxes, signature) {
  const width = world.width, height = world.height, byTile = new Map();
  for (const hitbox of hitboxes) {
    const points = hitbox.shape === 'polygon' ? hitbox.points || [] : null;
    const minX = Math.max(0, Math.floor(points?.length ? Math.min(...points.map(point => point.x)) - SPATIAL_INDEX_MARGIN
      : hitbox.x - (hitbox.shape === 'circle' ? hitbox.radius : rectangleDimensions(hitbox).halfWidth) - SPATIAL_INDEX_MARGIN));
    const maxX = Math.min(width - 1, Math.ceil(points?.length ? Math.max(...points.map(point => point.x)) + SPATIAL_INDEX_MARGIN
      : hitbox.x + (hitbox.shape === 'circle' ? hitbox.radius : rectangleDimensions(hitbox).halfWidth) + SPATIAL_INDEX_MARGIN));
    const minY = Math.max(0, Math.floor(points?.length ? Math.min(...points.map(point => point.y)) - SPATIAL_INDEX_MARGIN
      : hitbox.y - (hitbox.shape === 'circle' ? hitbox.radius : rectangleDimensions(hitbox).halfDepth) - SPATIAL_INDEX_MARGIN));
    const maxY = Math.min(height - 1, Math.ceil(points?.length ? Math.max(...points.map(point => point.y)) + SPATIAL_INDEX_MARGIN
      : hitbox.y + (hitbox.shape === 'circle' ? hitbox.radius : rectangleDimensions(hitbox).halfDepth) + SPATIAL_INDEX_MARGIN));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const index = y * width + x;
      let candidates = byTile.get(index);
      if (!candidates) byTile.set(index, candidates = []);
      candidates.push(hitbox);
    }
  }
  return { signature, width, height, byTile, hitboxes: Object.freeze(hitboxes) };
}

export function structureCollisionIndex(world) {
  const buildingHitboxes = (world.structures || []).map(structureHitbox).filter(Boolean);
  const trainingDummyHitboxes = trainingDummiesForWorld(world).map(dummy => ({
    ...npcHitbox(dummy), structureId: dummy.id, trainingDummyId: dummy.id
  }));
  const hitboxes = [...buildingHitboxes, ...trainingDummyHitboxes];
  const signature = hitboxSignature(hitboxes);
  const cached = structureIndexCache.get(world);
  if (cached?.signature === signature && cached.width === world.width && cached.height === world.height) return cached;
  const result = spatialIndex(world, hitboxes, signature);
  structureIndexCache.set(world, result);
  return result;
}

export function resourceCollisionIndex(world) {
  const revision = world.navigationRevision || 0;
  const cached = resourceIndexCache.get(world);
  if (cached?.revision === revision && cached.tiles === world.tiles) return cached;
  const hitboxes = [];
  for (const tile of world.tiles || []) {
    const tree = treeHitbox(world, tile);
    if (tree) hitboxes.push(tree);
    const mineral = mineralHitbox(tile);
    // Copper/silver/iron seams are frequently scattered like forest resources.
    // Keep their visual and mining hitboxes, but do not turn whole regions into
    // impassable collision mazes: these small deposits are walkable ground.
    if (mineral && (mineral.resourceKind === 'gold' || mineral.resourceKind === 'stone'))
      hitboxes.push(mineral);
  }
  const signature = 'resources:' + revision + ':' + hitboxSignature(hitboxes);
  const result = { ...spatialIndex(world, hitboxes, signature), revision, tiles: world.tiles };
  resourceIndexCache.set(world, result);
  return result;
}

export function worldCollisionIndex(world) {
  const structures = structureCollisionIndex(world);
  const resources = resourceCollisionIndex(world);
  const cached = worldIndexCache.get(world);
  if (cached?.structures === structures && cached.resources === resources) return cached;
  const result = { structures, resources, signature: structures.signature + '|' + resources.signature };
  worldIndexCache.set(world, result);
  return result;
}

function collidesWithIndexAt(actor, x, y, index) {
  if (!index || !Number.isInteger(x) || !Number.isInteger(y)) return false;
  const body = actorHitbox(actor, x, y);
  if (!body) return false;
  const candidates = body.radius > SPATIAL_INDEX_MARGIN
    ? index.hitboxes
    : index.byTile.get(y * index.width + x) || [];
  return candidates.some(hitbox => hitboxesOverlap(body, hitbox));
}

export function collidesWithStructureAt(world, actor, x, y, index = structureCollisionIndex(world)) {
  return collidesWithIndexAt(actor, x, y, index);
}

export function collidesWithWorldAt(world, actor, x, y, index = worldCollisionIndex(world)) {
  return collidesWithIndexAt(actor, x, y, index?.structures)
    || collidesWithIndexAt(actor, x, y, index?.resources);
}

function hitboxesNearBody(body, index) {
  if (!index || !body) return [];
  const minX = Math.max(0, Math.floor(body.x - body.radius));
  const maxX = Math.min(index.width - 1, Math.floor(body.x + body.radius));
  const minY = Math.max(0, Math.floor(body.y - body.radius));
  const maxY = Math.min(index.height - 1, Math.floor(body.y + body.radius));
  const candidates = new Set();
  for (let tileY = minY; tileY <= maxY; tileY++) for (let tileX = minX; tileX <= maxX; tileX++) {
    for (const hitbox of index.byTile.get(tileY * index.width + tileX) || []) candidates.add(hitbox);
  }
  return Array.from(candidates);
}

function collidesWithIndexAtPosition(actor, x, y, index) {
  if (!index || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  const body = actorHitbox(actor, x, y);
  return hitboxesNearBody(body, index).some(hitbox => hitboxesOverlap(body, hitbox));
}

export function collidesWithWorldPositionAt(world, actor, x, y, index = worldCollisionIndex(world)) {
  return collidesWithIndexAtPosition(actor, x, y, index?.structures)
    || collidesWithIndexAtPosition(actor, x, y, index?.resources);
}

function signedClearance(body, obstacle) {
  if (obstacle.shape === 'circle')
    return Math.hypot(body.x - obstacle.x, body.y - obstacle.y) - body.radius - obstacle.radius;
  const points = polygonPoints(obstacle);
  let distanceSquared = Infinity;
  for (let i = 0; i < points.length; i++)
    distanceSquared = Math.min(distanceSquared, pointSegmentDistanceSquared(body, points[i], points[(i + 1) % points.length]));
  const distance = Math.sqrt(distanceSquared);
  return (pointInPolygon(body, points) ? -distance : distance) - body.radius;
}

// Existing overlaps may be left only by reducing penetration. New obstacles
// still block, including a second obstacle encountered during the escape.
export function worldMovementBlocked(world, actor, from, to, index = worldCollisionIndex(world)) {
  const before = actorHitbox(actor, from.x, from.y), after = actorHitbox(actor, to.x, to.y);
  if (!before || !after) return true;
  for (const layer of [index.structures, index.resources]) {
    for (const obstacle of hitboxesNearBody(after, layer)) {
      if (!hitboxesOverlap(after, obstacle)) continue;
      if (!hitboxesOverlap(before, obstacle)
          || signedClearance(after, obstacle) <= signedClearance(before, obstacle) + 1e-7) return true;
    }
  }
  return false;
}
