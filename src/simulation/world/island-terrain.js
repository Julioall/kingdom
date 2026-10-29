import { clamp } from '../core/math.js';
import { initialSettlementCenters, LAKE_BUILDING_CLEARANCE } from './building-clearance.js';

const AUTOTILE_HILL = { cx: 18.8, cy: 12.2, rx: 2.8, ry: 4.1 };

function autoHash(x, y, seed = 0) {
  let value = Math.imul(x + seed * 33 + 17, 374761393) + Math.imul(y + seed * 7 + 53, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function smooth(value) { return value * value * (3 - 2 * value); }

function valueNoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const tx = smooth(x - xi), ty = smooth(y - yi);
  const top = autoHash(xi, yi, seed) * (1 - tx) + autoHash(xi + 1, yi, seed) * tx;
  const bottom = autoHash(xi, yi + 1, seed) * (1 - tx) + autoHash(xi + 1, yi + 1, seed) * tx;
  return top * (1 - ty) + bottom * ty;
}

function noise(x, y, seed) {
  return .59 * valueNoise(x / 5, y / 5, seed)
    + .29 * valueNoise(x / 2.5, y / 2.5, seed + 19)
    + .12 * valueNoise(x / 1.1, y / 1.1, seed + 46);
}

function terrainIndex(x, y, width) { return y * width + x; }

function squareLandBounds(width, height) {
  const side = Math.floor(Math.min(width, height) * .75);
  const left = Math.floor((width - side) / 2), top = Math.floor((height - side) / 2);
  return { left, top, right: left + side - 1, bottom: top + side - 1, side };
}

function generateLakes(width, height, seed, bounds) {
  const factorX = width / 36, factorY = height / 26;
  const scale = Math.min(factorX, factorY);
  const centers = initialSettlementCenters(width, height);
  const target = 1 + Math.floor(autoHash(47, 71, seed) * 4);
  const candidates = [];
  for (let y = bounds.top + 4; y < bounds.bottom - 4; y += 3) {
    for (let x = bounds.left + 4; x < bounds.right - 4; x += 3) {
      const r = (.45 + autoHash(x, y, seed + 503) * .55) * scale;
      if (x - r - 4 < bounds.left || x + r + 4 > bounds.right
        || y - r - 4 < bounds.top || y + r + 4 > bounds.bottom) continue;
      if (centers.some(center => Math.hypot(x - center.x, y - center.y) < 30 + LAKE_BUILDING_CLEARANCE + r)) continue;
      candidates.push({ x, y, r, rx: r, ry: r * (.65 + autoHash(x, y, seed + 509) * .35),
        rank: autoHash(x, y, seed + 521) });
    }
  }
  candidates.sort((a, b) => b.rank - a.rank || a.y - b.y || a.x - b.x);
  const lakes = [];
  for (const candidate of candidates) {
    if (lakes.some(lake => Math.hypot(lake.x - candidate.x, lake.y - candidate.y) < lake.r + candidate.r + 10)) continue;
    const { rank, ...lake } = candidate;
    lakes.push(lake);
    if (lakes.length === target) break;
  }
  return lakes;
}

function floodWaterDistance(width, height, water) {
  const count = width * height;
  const distances = new Float32Array(count); distances.fill(Infinity);
  const queue = new Int32Array(count);
  let head = 0, tail = 0;
  for (let i = 0; i < count; i++) if (water[i]) { distances[i] = 0; queue[tail++] = i; }
  const offsets = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  while (head < tail) {
    const index = queue[head++], x = index % width, y = Math.floor(index / width), nextDistance = distances[index] + 1;
    for (const [dx, dy] of offsets) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = terrainIndex(nx, ny, width);
      if (distances[next] <= nextDistance) continue;
      distances[next] = nextDistance;
      queue[tail++] = next;
    }
  }
  return distances;
}

function candidatesForLayer(width, height, elevationLevel, waterKind, targetLevel) {
  const candidates = [];
  for (let y = 1; y < height - 2; y++) for (let x = 1; x < width - 1; x++) {
    const lower = terrainIndex(x, y, width), lowerNext = terrainIndex(x, y + 1, width);
    if (waterKind[lower] || waterKind[lowerNext]
      || elevationLevel[lower] !== targetLevel - 1 || elevationLevel[lowerNext] !== targetLevel - 1) continue;
    for (const side of [1, 2]) {
      const highX = x + (side === 1 ? 1 : -1);
      const high = terrainIndex(highX, y, width), highNext = terrainIndex(highX, y + 1, width);
      if (!waterKind[high] && !waterKind[highNext]
        && elevationLevel[high] >= targetLevel && elevationLevel[highNext] < targetLevel) {
        candidates.push({ x, y, side, targetLevel, rank: autoHash(x + targetLevel * 271, y - targetLevel * 83, targetLevel) });
      }
    }
  }
  return candidates;
}

function markRamps(width, height, elevationLevel, waterKind, seed) {
  const rampSide = new Uint8Array(width * height);
  const rampLevel = new Uint8Array(width * height);
  const rampSegment = new Uint8Array(width * height);
  const selected = [];
  for (const targetLevel of [1]) {
    const candidates = candidatesForLayer(width, height, elevationLevel, waterKind, targetLevel)
      .map(candidate => ({ ...candidate, rank: autoHash(candidate.x, candidate.y, seed + targetLevel * 313) }))
      .sort((a, b) => b.rank - a.rank || a.y - b.y || a.x - b.x);
    const picked = [];
    const targetCount = 8;
    while (picked.length < targetCount && candidates.length) {
      let bestIndex = -1, bestScore = -Infinity;
      for (let index = 0; index < candidates.length; index++) {
        const candidate = candidates[index];
        const spacing = [...picked, ...selected].reduce((min, ramp) => Math.min(min,
          Math.hypot(candidate.x - ramp.x, candidate.y - ramp.y)), Infinity);
        if (spacing < 6) continue;
        const score = Math.min(30, spacing) + candidate.rank * .5;
        if (score > bestScore) { bestScore = score; bestIndex = index; }
      }
      if (bestIndex < 0) break;
      const [ramp] = candidates.splice(bestIndex, 1);
      picked.push(ramp);
      const top = terrainIndex(ramp.x, ramp.y, width), bottom = terrainIndex(ramp.x, ramp.y + 1, width);
      for (const [index, segment] of [[top, 1], [bottom, 2]]) {
        rampSide[index] = ramp.side;
        rampLevel[index] = targetLevel;
        rampSegment[index] = segment;
      }
    }
    selected.push(...picked);
  }
  return { rampSide, rampLevel, rampSegment, ramps: selected };
}

/** Generate a fixed square island with freshwater lakes, hills and ramps. */
export function generateIslandTerrain(width, height, seed) {
  const cleanSeed = (Number(seed) >>> 0) || 1;
  const count = width * height;
  const waterKind = new Array(count);
  const elevationLevel = new Uint8Array(count);
  const autoTileVariant = new Uint8Array(count);
  const heightM = new Float32Array(count);
  const factorX = width / 36, factorY = height / 26;
  const bounds = squareLandBounds(width, height);
  const lakes = generateLakes(width, height, cleanSeed, bounds);

  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = terrainIndex(x, y, width);
    const u = x / factorX, v = y / factorY;
    const insideSquare = x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
    if (!insideSquare) { waterKind[index] = 'ocean'; continue; }
    const inLake = lakes.some((lake, lakeIndex) => {
      const centerX = lake.x, centerY = lake.y;
      const edgeVariation = (autoHash(cleanSeed + 337 + lakeIndex, x, y) - .5) * .22;
      return Math.hypot((x - centerX) / lake.rx, (y - centerY) / lake.ry) < 1 + edgeVariation;
    });
    if (inLake) { waterKind[index] = 'lake'; continue; }
    autoTileVariant[index] = v < 6.5 ? 4 : v < 13 ? 0 : v < 19.5 ? 2 : 3;
    const hill = 1 - Math.hypot(
      (u - AUTOTILE_HILL.cx) / AUTOTILE_HILL.rx,
      (v - AUTOTILE_HILL.cy) / AUTOTILE_HILL.ry
    );
    // AutoTile's configured hill ellipse, raised slightly at the cutoff so it
    // remains a single compact plateau instead of a wide band of obstacles.
    const level = hill + (noise(u, v, cleanSeed + 58) - .5) * .26 > .34 ? 1 : 0;
    elevationLevel[index] = level;
    const reliefNoise = noise(u * .42, v * .42, cleanSeed + 127) - .5;
    const squareInterior = Math.min(x - bounds.left, bounds.right - x, y - bounds.top, bounds.bottom - y)
      / Math.max(1, bounds.side / 2);
    heightM[index] = level === 0
      ? 68 + clamp(squareInterior, 0, 1) * 34 + reliefNoise * 18
      : 410 + clamp(squareInterior, 0, 1) * 70 + reliefNoise * 24;
  }

  const waterDistance = floodWaterDistance(width, height, waterKind);
  const { rampSide, rampLevel, rampSegment, ramps } = markRamps(width, height, elevationLevel, waterKind, cleanSeed);
  const slope = new Float32Array(count);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = terrainIndex(x, y, width);
    if (waterKind[index]) continue;
    let maxGradient = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const neighbor = terrainIndex(nx, ny, width);
      if (waterKind[neighbor]) continue;
      maxGradient = Math.max(maxGradient, Math.abs(heightM[index] - heightM[neighbor]) / 480);
    }
    slope[index] = rampSide[index] ? .24 : clamp(maxGradient, .02, 1);
  }

  return {
    waterKind, elevationLevel, autoTileVariant, heightM, slope,
    waterDistance, rampSide, rampLevel, rampSegment, ramps,
    freshwaterLakes: lakes.map(lake => ({ ...lake }))
  };
}

export function canTraverseElevation(from, to) {
  const fromLevel = Number.isInteger(from?.elevationLevel) ? from.elevationLevel : 0;
  const toLevel = Number.isInteger(to?.elevationLevel) ? to.elevationLevel : 0;
  if (fromLevel === toLevel) return true;
  const dx = to.x - from.x, dy = to.y - from.y;
  if (Math.abs(fromLevel - toLevel) !== 1 || dy !== 0 || Math.abs(dx) !== 1) return false;
  const lower = fromLevel < toLevel ? from : to;
  const higher = fromLevel < toLevel ? to : from;
  const expectedDx = lower.rampSide === 1 ? 1 : lower.rampSide === 2 ? -1 : 0;
  return lower.rampSegment === 1 && lower.rampLevel === higher.elevationLevel
    && dx * (fromLevel < toLevel ? 1 : -1) === expectedDx
    && higher.x - lower.x === expectedDx;
}
