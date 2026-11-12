// Terrain-aware LOCAL rank assignment. This never teleports soldiers or
// overrides the world collision/pathing system: it only supplies march targets.
import { cellAt } from '../world/spatial.js';
import { canTraverseElevation } from '../world/island-terrain.js';
import { squadSlot } from './squad-tactics.js';

const square = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const inBounds = p => Number.isFinite(p?.x) && Number.isFinite(p?.y);

export function allocateBattlefieldSlots(world, squads = [], troops = []) {
  const byId = new Map(troops.filter(p => p?.alive).map(p => [p.id, p]));
  const occupied = new Set();
  for (const squad of squads) {
    const commander = byId.get(squad.commanderId);
    if (commander) {
      const tile = cellAt(world, commander.x, commander.y);
      if (tile) occupied.add(tile.i);
    }
  }
  for (const squad of squads) {
    const commander = byId.get(squad.commanderId);
    squad.worldSlots = {};
    squad.terrainBlockedSlots = 0;
    if (!commander) continue;
    const anchor = cellAt(world, commander.x, commander.y);
    for (const id of squad.memberIds) {
      if (id === squad.commanderId || !byId.has(id)) continue;
      const ideal = squadSlot(squad, id, commander);
      if (!inBounds(ideal)) continue;
      const candidates = [];
      // Fewer than two tiles of controlled adjustment: don't pull soldiers
      // across half the battlefield to fill an inaccessible slot.
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const point = { x: Math.round(ideal.x) + dx, y: Math.round(ideal.y) + dy };
        const tile = cellAt(world, point.x, point.y);
        if (!tile || tile.terrain !== 'land' || occupied.has(tile.i)) continue;
        const levelsDiffer = Math.abs((tile.elevationLevel || 0) - (anchor?.elevationLevel || 0));
        if (levelsDiffer > 0 && (levelsDiffer > 1 || !anchor ||
            square(anchor, tile) <= 2 && !canTraverseElevation(anchor, tile))) continue;
        const distance = square(ideal, tile);
        if (distance > 6.5) continue;
        candidates.push({ tile, distance });
      }
      candidates.sort((a, b) => a.distance - b.distance || a.tile.i - b.tile.i);
      if (!candidates.length) {
        squad.terrainBlockedSlots++;
        continue;
      }
      const tile = candidates[0].tile;
      occupied.add(tile.i);
      squad.worldSlots[id] = { x: tile.x, y: tile.y };
    }
  }
  return squads;
}
