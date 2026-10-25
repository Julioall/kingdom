const worldCaches = new WeakMap();
const MAX_DESTINATIONS = 64;
const MAX_ROUTES_PER_DESTINATION = 3;
const MAX_PATH_LENGTH = 256;
const ROUTE_LIFETIME_DAYS = 14;

// Runtime caches stay outside save files and Worker snapshots.
export function invalidateNavigation(world) {
  world.navigationRevision = (world.navigationRevision || 0) + 1;
}

function cacheFor(world) {
  let cache = worldCaches.get(world);
  const revision = world.navigationRevision || 0;
  if (!cache || cache.revision !== revision || cache.tiles !== world.tiles) {
    cache = { revision, tiles: world.tiles, destinations: new Map() };
    worldCaches.set(world, cache);
  }
  return cache.destinations;
}

export function rememberCommonRoute(world, key, path) {
  if (path.length < 5 || path.length > MAX_PATH_LENGTH) return;
  const cache = cacheFor(world);
  const routes = (cache.get(key) || []).filter(route => route.expiresDay > (world.day || 0)
    && route.path[0] !== path[0]);
  const copy = path.slice();
  routes.unshift({ path: copy, positions: new Map(copy.map((index, position) => [index, position])),
    expiresDay: (world.day || 0) + ROUTE_LIFETIME_DAYS });
  cache.delete(key);
  cache.set(key, routes.slice(0, MAX_ROUTES_PER_DESTINATION));
  if (cache.size > MAX_DESTINATIONS) cache.delete(cache.keys().next().value);
}

export function commonRouteFrom(world, key, start, canStep) {
  const cache = cacheFor(world);
  const routes = (cache.get(key) || []).filter(route => route.expiresDay > (world.day || 0));
  if (!routes.length) { cache.delete(key); return null; }
  cache.delete(key);
  cache.set(key, routes);
  // A common corridor can be joined from a neighboring tile. Every edge of
  // the adopted suffix is checked using the receiving person's permissions.
  const candidates = [];
  for (const route of routes) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = start.x + dx, y = start.y + dy;
      if (x < 0 || y < 0 || x >= world.width || y >= world.height) continue;
      const position = route.positions.get(y * world.width + x);
      if (position === undefined || position === route.path.length - 1) continue;
      const connector = dx || dy;
      const length = route.path.length - position + (connector ? 1 : 0);
      if (connector && !canStep(start, world.tiles[route.path[position]])) continue;
      candidates.push({ route, position, connector, length });
    }
  }
  candidates.sort((a, b) => a.length - b.length);
  for (const { route, position, connector } of candidates) {
    let valid = true;
    for (let i = position; i < route.path.length - 1; i++) {
      if (!canStep(world.tiles[route.path[i]], world.tiles[route.path[i + 1]])) { valid = false; break; }
    }
    if (!valid) continue;
    const suffix = route.path.slice(position);
    return connector ? [start.i, ...suffix] : suffix;
  }
  return null;
}
