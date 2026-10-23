

export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

export function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

export function hash01(seed, x, y) {
    let n = (seed ^ Math.imul(x + 1, 0x45d9f3b) ^ Math.imul(y + 1, 0x27d4eb2d)) >>> 0;
    n = Math.imul(n ^ (n >>> 16), 0x7feb352d);
    n = Math.imul(n ^ (n >>> 15), 0x846ca68b);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }

export function species(profileId, list) { return list.find(s => s.id === profileId); }
