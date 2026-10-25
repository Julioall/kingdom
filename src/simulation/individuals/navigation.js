import { isRoadTile } from '../world/roads.js';
import { commonRouteFrom, rememberCommonRoute } from './navigation-cache.js';

const routeWorkspaces = new WeakMap();

function makeWorkspace(size) {
  const heapCapacity = Math.max(64, size);
  return {
    size,
    generation: 0,
    visited: new Uint32Array(size),
    costs: new Float64Array(size),
    previous: new Int32Array(size),
    heapIndexes: new Int32Array(heapCapacity),
    heapCosts: new Float64Array(heapCapacity),
    heapPriorities: new Float64Array(heapCapacity),
    heapSize: 0,
    poppedCost: 0
  };
}

function workspaceFor(world) {
  let workspace = routeWorkspaces.get(world);
  if (!workspace || workspace.size < world.tiles.length) {
    workspace = makeWorkspace(world.tiles.length);
    routeWorkspaces.set(world, workspace);
  }
  return workspace;
}

function nextGeneration(workspace) {
  workspace.generation = (workspace.generation + 1) >>> 0;
  if (workspace.generation === 0) {
    workspace.visited.fill(0);
    workspace.generation = 1;
  }
  return workspace.generation;
}

function ensureHeapCapacity(workspace) {
  if (workspace.heapSize < workspace.heapIndexes.length) return;
  const capacity = workspace.heapIndexes.length * 2;
  const indexes = new Int32Array(capacity);
  const costs = new Float64Array(capacity);
  const priorities = new Float64Array(capacity);
  indexes.set(workspace.heapIndexes);
  costs.set(workspace.heapCosts);
  priorities.set(workspace.heapPriorities);
  workspace.heapIndexes = indexes;
  workspace.heapCosts = costs;
  workspace.heapPriorities = priorities;
}

function pushHeap(workspace, index, cost, priority) {
  ensureHeapCapacity(workspace);
  let position = workspace.heapSize++;
  while (position > 0) {
    const parent = (position - 1) >> 1;
    if (workspace.heapPriorities[parent] <= priority) break;
    workspace.heapIndexes[position] = workspace.heapIndexes[parent];
    workspace.heapCosts[position] = workspace.heapCosts[parent];
    workspace.heapPriorities[position] = workspace.heapPriorities[parent];
    position = parent;
  }
  workspace.heapIndexes[position] = index;
  workspace.heapCosts[position] = cost;
  workspace.heapPriorities[position] = priority;
}

function popHeap(workspace) {
  const firstIndex = workspace.heapIndexes[0];
  workspace.poppedCost = workspace.heapCosts[0];
  const lastPosition = --workspace.heapSize;
  if (lastPosition === 0) return firstIndex;

  const lastIndex = workspace.heapIndexes[lastPosition];
  const lastCost = workspace.heapCosts[lastPosition];
  const lastPriority = workspace.heapPriorities[lastPosition];
  let position = 0;
  while (position * 2 + 1 < lastPosition) {
    let child = position * 2 + 1;
    if (child + 1 < lastPosition && workspace.heapPriorities[child + 1] < workspace.heapPriorities[child]) child++;
    if (workspace.heapPriorities[child] >= lastPriority) break;
    workspace.heapIndexes[position] = workspace.heapIndexes[child];
    workspace.heapCosts[position] = workspace.heapCosts[child];
    workspace.heapPriorities[position] = workspace.heapPriorities[child];
    position = child;
  }
  workspace.heapIndexes[position] = lastIndex;
  workspace.heapCosts[position] = lastCost;
  workspace.heapPriorities[position] = lastPriority;
  return firstIndex;
}

function measureRouteSearch(world, action) {
  const profile = world.peopleProfile;
  if (!profile || typeof profile.recordDetail !== 'function') return action();
  const startedAt = profile.now();
  try { return action(); }
  finally { profile.recordDetail('people.routeSearch', profile.now() - startedAt); }
}

// A* minimizes travel effort, so a modest detour along an established road can
// beat crossing open ground. Every edge still obeys the normal movement rules.
export function findPreferredRoute(world, start, destination, canEnter, canStep, preferRoads = false, arrivalRadius = 0) {
  const workspace = workspaceFor(world);
  const generation = nextGeneration(workspace);
  const at = (x, y) => x < 0 || y < 0 || x >= world.width || y >= world.height
    ? null : world.tiles[y * world.width + x];
  const goal = at(Math.round(destination.x), Math.round(destination.y));
  const exact = !arrivalRadius && goal && canEnter(goal);
  const radius = arrivalRadius || 1.5;
  const heuristic = tile => Math.max(0, Math.hypot(tile.x - destination.x, tile.y - destination.y) - (exact ? 0 : radius)) * .4;
  workspace.heapSize = 0;
  workspace.visited[start.i] = generation;
  workspace.costs[start.i] = 0;
  workspace.previous[start.i] = -1;
  pushHeap(workspace, start.i, 0, heuristic(start));
  while (workspace.heapSize) {
    const index = popHeap(workspace), costAtPop = workspace.poppedCost, tile = world.tiles[index];
    if (workspace.visited[index] !== generation || costAtPop !== workspace.costs[index]) continue;
    if (exact ? tile.i === goal.i : Math.hypot(tile.x - destination.x, tile.y - destination.y) <= radius && canEnter(tile)) {
      const path = [];
      let pathIndex = tile.i;
      while (pathIndex >= 0) {
        path.push(pathIndex);
        if (pathIndex === start.i) break;
        pathIndex = workspace.previous[pathIndex];
      }
      if (path.at(-1) !== start.i) return null;
      return path.reverse();
    }
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const next = at(tile.x + dx, tile.y + dy);
      if (!next || !canStep(tile, next)) continue;
      const roadCost = isRoadTile(next, true) ? .4 : isRoadTile(next) ? (preferRoads ? .55 : .7) : 1;
      const cost = costAtPop + Math.hypot(dx, dy) * roadCost + Math.max(0, next.slope || 0) * .08;
      const previousCost = workspace.visited[next.i] === generation ? workspace.costs[next.i] : Infinity;
      if (cost >= previousCost) continue;
      workspace.visited[next.i] = generation;
      workspace.costs[next.i] = cost;
      workspace.previous[next.i] = tile.i;
      pushHeap(workspace, next.i, cost, cost + heuristic(next));
    }
  }
  return null;
}

function routeKey(destination, preferRoads, arrivalRadius) {
  return Math.round(destination.x) + ':' + Math.round(destination.y)
    + (arrivalRadius ? ':r' + arrivalRadius : '') + (preferRoads ? ':roads' : '');
}

function localExitMask(world, start, canStep) {
  let mask = 0, bit = 1;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const x = start.x + dx, y = start.y + dy;
    const tile = x >= 0 && y >= 0 && x < world.width && y < world.height ? world.tiles[y * world.width + x] : null;
    if (tile && canStep(start, tile)) mask |= bit;
    bit <<= 1;
  }
  return mask;
}

export function rememberedRouteStep(world, agent, from, destination, canEnter, canStep, preferRoads = false, arrivalRadius = 0, options = {}) {
  const start = world.tiles[from.y * world.width + from.x];
  if (!start) return null;
  const key = routeKey(destination, preferRoads, arrivalRadius);
  const contextKey = options.contextKey || '';
  const revision = world.navigationRevision || 0;
  const goalX = Math.round(destination.x), goalY = Math.round(destination.y);
  const goal = goalX >= 0 && goalY >= 0 && goalX < world.width && goalY < world.height
    ? world.tiles[goalY * world.width + goalX] : null;
  const exact = !arrivalRadius && goal && canEnter(goal);
  if (exact ? start.i === goal.i : Math.hypot(start.x - destination.x, start.y - destination.y) <= (arrivalRadius || 1.5) && canEnter(start)) {
    agent.navigationRoute = null;
    delete agent.navigationFailure;
    return null;
  }
  const failure = agent.navigationFailure;
  if (options.cacheable && failure && failure.key === key && failure.contextKey === contextKey
      && failure.revision === revision && failure.startIndex === start.i && failure.exact === !!exact
      && failure.retryDay > (world.day || 0) && failure.exitMask === localExitMask(world, start, canStep)) {
    agent.navigationFailureCacheHits = (agent.navigationFailureCacheHits || 0) + 1;
    return null;
  }
  let route = agent.navigationRoute;
  const matches = route && route.key === key && (route.contextKey || '') === contextKey;
  let index = matches ? route.cursor ?? -1 : -1;
  if (matches && route.path[index] !== start.i) {
    if (route.path[index + 1] === start.i) index++;
    else if (route.path[index + 2] === start.i) index += 2;
    else index = route.path.indexOf(start.i);
  }
  if (!matches || index < 0) {
    route = null;
    index = -1;
    for (const known of agent.knownRoutes || []) {
      if ((known.contextKey || '') !== contextKey) continue;
      const position = known.path.indexOf(start.i);
      if (position < 0) continue;
      if (known.key === key) route = { key, path: known.path.slice(position) };
      else if (!arrivalRadius && !known.arrivalRadius && !!known.preferRoads === preferRoads
          && key === routeKey({ x: known.path[0] % world.width, y: Math.floor(known.path[0] / world.width) }, preferRoads, 0))
        route = { key, path: known.path.slice(0, position + 1).reverse() };
      if (route) { index = 0; agent.navigationCacheHits = (agent.navigationCacheHits || 0) + 1; break; }
    }
  }
  let next = index >= 0 ? world.tiles[route.path[index + 1]] : null;
  if (!next || !canStep(start, next)) {
    const sharedKey = contextKey + '|' + key + '|' + (exact ? 'exact' : 'near');
    let path = options.cacheable ? commonRouteFrom(world, sharedKey, start, canStep) : null;
    if (path) agent.navigationSharedCacheHits = (agent.navigationSharedCacheHits || 0) + 1;
    else {
      path = measureRouteSearch(world, () => findPreferredRoute(world, start, destination, canEnter, canStep, preferRoads, arrivalRadius));
      agent.navigationReplans = (agent.navigationReplans || 0) + 1;
      if (path && options.cacheable) rememberCommonRoute(world, sharedKey, path);
    }
    route = path?.length > 1 ? { key, path, cursor: 0 } : null;
    index = 0; next = route ? world.tiles[route.path[1]] : null;
    if (!path && options.cacheable) agent.navigationFailure = { key, contextKey, revision, startIndex: start.i,
      exact: !!exact, exitMask: localExitMask(world, start, canStep),
      retryDay: (world.day || 0) + 2 + Math.abs(agent.id || 0) % 2 };
    else delete agent.navigationFailure;
  }
  if (route) Object.assign(route, { cursor: index, contextKey, preferRoads, arrivalRadius });
  agent.navigationRoute = route;
  return next;
}

export function rememberRouteArrival(agent, tileIndex) {
  const route = agent.navigationRoute;
  if (!route || route.completed || route.path.at(-1) !== tileIndex || route.path.length > 160) return;
  route.completed = true;
  const known = (agent.knownRoutes || []).filter(item => item.key !== route.key);
  agent.knownRoutes = [...known, { key: route.key, path: route.path.slice(), contextKey: route.contextKey,
    preferRoads: route.preferRoads, arrivalRadius: route.arrivalRadius }].slice(-3);
}

export function congestionRouteStep(world, agent, start, destination, canEnter, canStep, preferRoads = false, arrivalRadius = 0) {
  const path = measureRouteSearch(world, () => findPreferredRoute(world, start, destination, canEnter, canStep, preferRoads, arrivalRadius));
  agent.navigationReplans = (agent.navigationReplans || 0) + 1;
  agent.navigationCongestionReplans = (agent.navigationCongestionReplans || 0) + 1;
  // A failed occupancy search leaves the terrain route intact. Temporary
  // occupants must never populate the failed-terrain or shared-route caches.
  if (!path || path.length < 2) return null;
  agent.navigationRoute = { ...agent.navigationRoute, key: routeKey(destination, preferRoads, arrivalRadius),
    path, cursor: 0, completed: false, preferRoads, arrivalRadius };
  return world.tiles[path[1]];
}
