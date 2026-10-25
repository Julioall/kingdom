

export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

export function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

export function hash01(seed, x, y) {
    let n = (seed ^ Math.imul(x + 1, 0x45d9f3b) ^ Math.imul(y + 1, 0x27d4eb2d)) >>> 0;
    n = Math.imul(n ^ (n >>> 16), 0x7feb352d);
    n = Math.imul(n ^ (n >>> 15), 0x846ca68b);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }

export function spatialNoise(seed, x, y, patchSize) {
    const gridX = Math.floor(x / patchSize), gridY = Math.floor(y / patchSize);
    const localX = x / patchSize - gridX, localY = y / patchSize - gridY;
    const smoothX = localX * localX * (3 - 2 * localX), smoothY = localY * localY * (3 - 2 * localY);
    const northwest = hash01(seed, gridX, gridY), northeast = hash01(seed, gridX + 1, gridY);
    const southwest = hash01(seed, gridX, gridY + 1), southeast = hash01(seed, gridX + 1, gridY + 1);
    const north = northwest + (northeast - northwest) * smoothX;
    const south = southwest + (southeast - southwest) * smoothX;
    return north + (south - north) * smoothY;
  }

export function species(profileId, list) { return list.find(s => s.id === profileId); }
