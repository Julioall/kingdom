import { distance } from '../core/math.js';
import { cellAt } from '../world/spatial.js';

export function rearProjection(world, kingdom, point) {
  const enemy = world.kingdoms.find(k => k.id !== kingdom.id);
  const dx = (enemy?.x ?? world.width / 2) - kingdom.x;
  const dy = (enemy?.y ?? world.height / 2) - kingdom.y;
  const length = Math.hypot(dx, dy) || 1;
  return -((point.x - kingdom.x) * dx + (point.y - kingdom.y) * dy) / length;
}

export function safeCorralFootprint(world, tile) {
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
    const cell = cellAt(world, tile.x + dx, tile.y + dy);
    if (!cell || cell.terrain !== 'land' || cell.elevationLevel !== tile.elevationLevel) return false;
  }
  return true;
}

export function chooseRearCorralSite(world, kingdom, reserved = []) {
  return world.tiles.filter(tile => tile.terrain === 'land' && rearProjection(world, kingdom, tile) >= 6
    && distance(tile, kingdom) <= 24 && safeCorralFootprint(world, tile)
    && !world.structures.concat(reserved).some(s => s.destroyedDay == null && distance(tile, s) < 7.1))
    .sort((a, b) => (rearProjection(world, kingdom, b) - Math.abs(distance(b, kingdom) - 16) * .7)
      - (rearProjection(world, kingdom, a) - Math.abs(distance(a, kingdom) - 16) * .7) || a.i - b.i)[0] || null;
}
