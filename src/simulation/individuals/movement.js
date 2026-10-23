import { cellAt } from '../world/spatial.js';
import { distance } from '../core/math.js';
import { carriedResources } from '../economy/inventories.js';
import { isTreeAnchor } from '../ecology/plants.js';
import { markTerritoryStep } from '../kingdoms/territories.js';
import { isRoadTile, recordFootstep } from '../world/roads.js';

function insideCorral(x, y, structure, radius) {
  return x > structure.x - radius && x < structure.x + radius
    && y > structure.y - radius && y < structure.y + radius;
}

export function corralGate(w, structure, radiusOverride) {
  const radius = Math.max(2, Math.round(radiusOverride || structure.radius || 3.5));
  const centerX = Math.round(structure.x), centerY = Math.round(structure.y);
  const candidates = [];
  for (let offset = -radius; offset <= radius; offset++) {
    candidates.push({ x: centerX + offset, y: centerY + radius, priority: Math.abs(offset), corner: Math.abs(offset) === radius });
  }
  for (let offset = -radius + 1; offset < radius; offset++) {
    candidates.push({ x: centerX - radius, y: centerY + offset, priority: radius + Math.abs(offset) + 2, corner: false });
    candidates.push({ x: centerX + radius, y: centerY + offset, priority: radius + Math.abs(offset) + 2, corner: false });
  }
  for (let offset = -radius; offset <= radius; offset++) {
    candidates.push({ x: centerX + offset, y: centerY - radius, priority: radius * 2 + Math.abs(offset) + 4, corner: Math.abs(offset) === radius });
  }
  candidates.sort((a, b) => Number(a.corner) - Number(b.corner) || a.priority - b.priority || a.y - b.y || a.x - b.x);
  const walkableGates = candidates.filter(candidate => !candidate.corner && (() => {
    const tile = cellAt(w, candidate.x, candidate.y);
    return tile && tile.terrain === 'land' && !isTreeAnchor(w, tile);
  })());
  if (walkableGates.length) return walkableGates[0];
  return candidates.find(candidate => !candidate.corner && cellAt(w, candidate.x, candidate.y)?.terrain === 'land')
    || candidates.find(candidate => cellAt(w, candidate.x, candidate.y)?.terrain === 'land') || candidates[0];
}

function activeCorrals(w) {
  return w.structures.filter(structure => structure.complete && structure.type === 'curral').map(structure => {
    const radius = Math.max(2, Math.round(structure.radius || 3.5));
    return { structure, radius, gate: corralGate(w, structure, radius) };
  });
}

function isCorralGateCell(corrals, x, y) {
  return corrals.some(corral => corral.gate.x === x && corral.gate.y === y);
}

function isCorralFenceCell(corrals, x, y) {
  for (const { structure, radius, gate } of corrals) {
    const dx = x - Math.round(structure.x), dy = y - Math.round(structure.y);
    const onPerimeter = Math.abs(dx) <= radius && Math.abs(dy) <= radius
      && (Math.abs(dx) === radius || Math.abs(dy) === radius);
    if (onPerimeter && !(gate.x === x && gate.y === y)) return true;
  }
  return false;
}

function corralWaypoint(agent, target, corrals) {
  for (const corral of corrals) {
    const { structure, radius, gate } = corral;
    const targetIsInside = insideCorral(target.x, target.y, structure, radius);
    if (distance(agent, gate) <= .01) {
      const centerX = Math.round(structure.x), centerY = Math.round(structure.y);
      const outwardX = Math.abs(gate.x - centerX) === radius ? Math.sign(gate.x - centerX) : 0;
      const outwardY = Math.abs(gate.y - centerY) === radius ? Math.sign(gate.y - centerY) : 0;
      return { x: gate.x + (targetIsInside ? -outwardX : outwardX), y: gate.y + (targetIsInside ? -outwardY : outwardY) };
    }
    if (insideCorral(agent.x, agent.y, structure, radius) === targetIsInside) continue;
    if (distance(agent, gate) > .01) return gate;
  }
  return target;
}

function canEnter(w, agent, tile, aquatic, pen, corrals, movementOptions) {
  if (!tile || (aquatic ? tile.terrain !== 'water' : tile.terrain === 'water' || tile.terrain === 'rock')) return false;
  if (movementOptions?.allowedTile && !movementOptions.allowedTile(tile)) return false;
  if (!aquatic && ((isTreeAnchor(w, tile) && !isCorralGateCell(corrals, tile.x, tile.y)) || isCorralFenceCell(corrals, tile.x, tile.y))) return false;
  return !pen || distance(tile, pen) <= (pen.radius || 3.5);
}

function canStep(w, agent, from, to, aquatic, pen, corrals, movementOptions) {
  if (!to || !canEnter(w, agent, to, aquatic, pen, corrals, movementOptions)) return false;
  const dx = to.x - from.x, dy = to.y - from.y;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) return false;
  if (dx && dy) {
    const horizontal = cellAt(w, from.x + dx, from.y);
    const vertical = cellAt(w, from.x, from.y + dy);
    if (!canEnter(w, agent, horizontal, aquatic, pen, corrals, movementOptions)
      || !canEnter(w, agent, vertical, aquatic, pen, corrals, movementOptions)) return false;
  }
  return true;
}

function findRouteStep(w, agent, destination, aquatic, pen, corrals, startOverride = null, movementOptions = null) {
  const start = startOverride || cellAt(w, Math.round(agent.x), Math.round(agent.y));
  if (!start) return null;
  const count = w.tiles.length, startIndex = start.y * w.width + start.x;
  const previous = new Int32Array(count); previous.fill(-2);
  const queue = new Int32Array(count); let head = 0, tail = 0;
  previous[startIndex] = -1; queue[tail++] = startIndex;
  const goalTile = cellAt(w, Math.round(destination.x), Math.round(destination.y));
  const goalIsEnterable = goalTile && canEnter(w, agent, goalTile, aquatic, pen, corrals, movementOptions);
  const offsets = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]];
  let goalIndex = -1;
  while (head < tail) {
    const index = queue[head++], tile = w.tiles[index];
    if (goalIsEnterable ? index === goalTile.i : distance(tile, destination) <= 1.5 && canEnter(w, agent, tile, aquatic, pen, corrals, movementOptions)) {
      goalIndex = index; break;
    }
    for (const [dx, dy] of offsets) {
      const next = cellAt(w, tile.x + dx, tile.y + dy);
      if (!next || previous[next.i] !== -2 || !canStep(w, agent, tile, next, aquatic, pen, corrals, movementOptions)) continue;
      previous[next.i] = index; queue[tail++] = next.i;
    }
  }
  if (goalIndex < 0 || goalIndex === startIndex) return null;
  let stepIndex = goalIndex;
  while (previous[stepIndex] !== startIndex && previous[stepIndex] >= 0) stepIndex = previous[stepIndex];
  return w.tiles[stepIndex];
}

export function moveOne(w, agent, target, aquatic, movementOptions = null) {
    if (!target) return false;
    const currentTile = cellAt(w, Math.round(agent.x), Math.round(agent.y));
    if (Number.isFinite(agent.kingdomId) && currentTile && (currentTile.kingdomId == null || currentTile.kingdomId === agent.kingdomId)
        && !Number.isFinite(agent.lastSafeX)) {
      agent.lastSafeX = currentTile.x; agent.lastSafeY = currentTile.y;
    }
    const corrals = activeCorrals(w);
    const destination = corralWaypoint(agent, target, corrals);
    const current = { x: Math.round(agent.x), y: Math.round(agent.y) };
    const pen = agent.speciesId === 'sheep' && agent.herdCommunityId !== null
      ? w.structures.find(s => s.complete && s.type === 'curral' && s.communityId === agent.herdCommunityId) : null;
    function stepToward(from) {
      const choices = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const tile = cellAt(w, from.x + dx, from.y + dy);
        if (!canStep(w, agent, from, tile, aquatic, pen, corrals, movementOptions)) continue;
        choices.push(tile);
      }
      const roadBias = agent.speciesId == null ? (movementOptions?.preferRoads ? 1.2 : .42) : 0;
      choices.sort((a, b) => {
        const scoreA = distance(a, destination) + a.slope * .08 - (isRoadTile(a) ? roadBias : 0);
        const scoreB = distance(b, destination) + b.slope * .08 - (isRoadTile(b) ? roadBias : 0);
        return scoreA - scoreB;
      });
      const next = choices.find(tile => distance(tile, destination) < distance(from, destination) - .001);
      return next || findRouteStep(w, agent, destination, aquatic, pen, corrals, from, movementOptions);
    }
    const first = stepToward(current);
    let route = first ? [first] : [];
    if (route.length && agent.speciesId == null && isRoadTile(currentTile, true) && isRoadTile(first, true)) {
      // Established, straight road segments carry a person two cells in one daily action.
      const dx = first.x - current.x, dy = first.y - current.y;
      const second = cellAt(w, first.x + dx, first.y + dy);
      if (isRoadTile(second, true) && canStep(w, agent, first, second, aquatic, pen, corrals, movementOptions)
          && distance(second, destination) < distance(first, destination) - .001) route.push(second);
    }
    if (!route.length) return false;
    for (const next of route) {
      let boundaryCost = 0;
      if (agent.communityId !== undefined && agent.communityId !== null) {
        for (const fence of w.structures) {
          if (!fence.complete || fence.type !== 'divisa' || fence.communityId === agent.communityId) continue;
          const radius = fence.radius || 4;
          const before = distance(agent, fence) < radius, after = distance(next, fence) < radius;
          if (before !== after) boundaryCost += .58;
        }
      }
      const carryingCost = carriedResources(agent) > .01 ? Math.min(1.2, carriedResources(agent) / 24) * .14 : 0;
      const foreignBorderCost = agent.kingdomId != null && next.kingdomId != null && next.kingdomId !== agent.kingdomId ? .85 : 0;
      const onRoad = isRoadTile(cellAt(w, Math.round(agent.x), Math.round(agent.y)), true) && isRoadTile(next, true);
      const travelCost = (.18 + next.slope * .12 + boundaryCost + carryingCost + foreignBorderCost) * (onRoad ? .78 : 1);
      agent.energy = Math.max(0, agent.energy - travelCost);
      agent.travelCost = (agent.travelCost || 0) + travelCost;
      agent.headingX = next.x - agent.x; agent.headingY = next.y - agent.y;
      agent.x = next.x; agent.y = next.y;
      markTerritoryStep(w, agent, next);
      recordFootstep(next, agent);
    }
    return true;
  }
