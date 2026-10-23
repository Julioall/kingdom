

export function rand(w) {
    w.rngState = (w.rngState + 0x6D2B79F5) >>> 0;
    let t = w.rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
