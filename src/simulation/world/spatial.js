import { HEIGHT, WIDTH } from '../../config/ecosystem.js';

export function idx(x, y) { return y * WIDTH + x; }

export function cellAt(w, x, y) {
    // Actors and community centers can have fractional coordinates; resolve them to
    // the nearest tile before indexing the grid.
    const tileX = Math.round(x), tileY = Math.round(y);
    return tileX < 0 || tileY < 0 || tileX >= WIDTH || tileY >= HEIGHT ? null : w.tiles[idx(tileX, tileY)];
  }

export function riverX(y) { return 18 + .42 * y + 2.2 * Math.sin(y * .17); }

export function nearby(w, x, y, radius, predicate) {
    let best = null, bestScore = -Infinity;
    const r = Math.ceil(radius);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const d = Math.hypot(dx, dy);
      if (d > radius) continue;
      const t = cellAt(w, x + dx, y + dy);
      if (!t || !predicate(t)) continue;
      const score = -d;
      if (score > bestScore) { best = t; bestScore = score; }
    }
    return best;
  }

export function cellsWithin(w, x, y, radius, predicate) {
    const cells = [], r = Math.ceil(radius);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.hypot(dx, dy) > radius) continue;
      const t = cellAt(w, Math.round(x) + dx, Math.round(y) + dy);
      if (t && predicate(t)) cells.push(t);
    }
    return cells;
  }
