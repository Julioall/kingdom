// JUL-293: exact guarded territory reuse, restricted to the materialized world.
// The cache never enters save games or Worker snapshots. This is a read-only
// guard: full ownership and its side effects are computed by territories.js.
// Checking actual tile values protects external tile edits, not just named events.
const perWorld = new WeakMap();
const perWorldMode = new WeakMap();

function equalScalars(a, b) {
  return a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
}

function sourcesFor(world, structureRadius) {
  const sources = [world.width, world.height, world.seed, world.epoch || 0];
  // Keep source ORDER: equidistant influence resolves to the first structure.
  for (const kingdom of world.kingdoms || []) sources.push('kingdom', kingdom.id);
  for (const structure of world.structures || []) {
    if (!structure.complete || !structure.kingdomId) continue;
    const radius = structureRadius(structure);
    if (!radius) continue;
    sources.push('structure', structure.x, structure.y, radius, structure.kingdomId);
  }
  // An expired annexation must be removed on the day it expires, even when no
  // structure changes. Only effective claims participate in the signature.
  for (const claim of world.territoryClaims || []) {
    if (claim.status !== 'annexed' || claim.expiresDay != null && claim.expiresDay < world.day) continue;
    sources.push('claim', claim.ownerId, claim.x, claim.y, claim.radius);
  }
  return sources;
}

function worldTilesMatch(world, cache) {
  if (cache.tileArray !== world.tiles || world.tiles.length !== cache.tileStates.length)
    return false;
  for (let i = 0; i < world.tiles.length; i++) {
    const tile = world.tiles[i], previous = cache.tileStates[i];
    if (tile !== previous.ref || !Object.is(tile.x, previous.x) ||
        !Object.is(tile.y, previous.y) || !Object.is(tile.terrain, previous.terrain) ||
        !Object.is(tile.kingdomId, previous.owner)) return false;
  }
  const kingdoms = world.kingdoms || [];
  if (cache.kingdomCounts.length !== kingdoms.length) return false;
  for (let i = 0; i < kingdoms.length; i++) {
    const row = cache.kingdomCounts[i], kingdom = kingdoms[i];
    if (row.ref !== kingdom || !Object.is(row.count, kingdom.territoryTileCount))
      return false;
  }
  return true;
}

/**
 * Use explicit "always" for deterministic A/B, unknown integrations or
 * debugging. Default "cached" remains fail-closed against all changed inputs.
 */
export function setTerritoryRecomputeMode(world, mode) {
  if (!['always', 'cached'].includes(mode))
    throw new RangeError('Unknown territory recompute mode.');
  perWorldMode.set(world, mode);
}

export function territoryRecomputeDiagnostics(world) {
  const cache = perWorld.get(world);
  return cache ? { calls: cache.calls, skipped: cache.skipped,
    recomputed: cache.recomputed, lastComputedDay: cache.day }
    : { calls: 0, skipped: 0, recomputed: 0, lastComputedDay: null };
}

export function tryReuseTerritories(world, context, structureRadius) {
  const old = perWorld.get(world);
  if (!old) return false;
  old.calls++;
  if (perWorldMode.get(world) === 'always' || context != null
      || world.day < old.day || world.seed !== old.seed || (world.epoch || 0) !== old.epoch)
    return false;
  if (!equalScalars(old.sources, sourcesFor(world, structureRadius))) return false;
  if (!worldTilesMatch(world, old)) return false;
  old.skipped++;
  return true;
}

export function rememberTerritories(world, structureRadius) {
  const previous = perWorld.get(world);
  perWorld.set(world, {
    calls: (previous?.calls || 0) + (previous ? 0 : 1),
    skipped: previous?.skipped || 0,
    recomputed: (previous?.recomputed || 0) + 1,
    day: world.day, epoch: world.epoch || 0, seed: world.seed,
    sources: sourcesFor(world, structureRadius),
    tileArray: world.tiles,
    tileStates: world.tiles.map(tile => ({
      ref: tile, x: tile.x, y: tile.y,
      terrain: tile.terrain, owner: tile.kingdomId
    })),
    kingdomCounts: (world.kingdoms || []).map(kingdom => ({
      ref: kingdom, count: kingdom.territoryTileCount
    }))
  });
}
