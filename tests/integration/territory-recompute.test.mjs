import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../../src/simulation/engine.js';
import { recomputeKingdomTerritories } from '../../src/simulation/kingdoms/territories.js';

function referenceRadius(structure) {
  if (Number.isFinite(structure.integrity) && structure.integrity <= 0) return 0;
  const condition = Number.isFinite(structure.integrity) ? Math.max(.25, Math.min(1, structure.integrity)) : 1;
  if (structure.type === 'castelo') return (structure.territoryRadius || 18) * condition;
  if (structure.type === 'torre') return (structure.territoryRadius || 13) * condition;
  return 0;
}

function referenceRecompute(world) {
  for (const kingdom of world.kingdoms || []) kingdom.territoryTileCount = 0;
  for (const tile of world.tiles) {
    tile.kingdomId = null;
    if (tile.terrain === 'water') continue;
    let bestKingdom = null, bestDistance = Infinity;
    for (const structure of world.structures) {
      if (!structure.complete || !structure.kingdomId) continue;
      const radius = referenceRadius(structure);
      if (!radius) continue;
      const distance = Math.hypot(tile.x - structure.x, tile.y - structure.y);
      if (distance > radius || distance >= bestDistance) continue;
      bestKingdom = world.kingdoms.find(kingdom => kingdom.id === structure.kingdomId) || null;
      bestDistance = distance;
    }
    if (bestKingdom) {
      tile.kingdomId = bestKingdom.id;
      bestKingdom.territoryTileCount++;
    }
  }
  for (const claim of world.territoryClaims || []) {
    if (claim.status !== 'annexed' || claim.expiresDay != null && claim.expiresDay < world.day) continue;
    const owner = world.kingdoms.find(kingdom => kingdom.id === claim.ownerId);
    if (!owner) continue;
    for (const tile of world.tiles) {
      if (tile.terrain === 'water' || Math.hypot(tile.x - claim.x, tile.y - claim.y) > claim.radius) continue;
      if (tile.kingdomId != null) {
        const previousOwner = world.kingdoms.find(kingdom => kingdom.id === tile.kingdomId);
        if (previousOwner) previousOwner.territoryTileCount = Math.max(0, previousOwner.territoryTileCount - 1);
      }
      tile.kingdomId = owner.id;
      owner.territoryTileCount++;
    }
  }
}

function addCoverageCases(world) {
  world.day = 20;
  const castle = world.structures.find(structure => structure.type === 'castelo' && structure.kingdomId);
  const tower = world.structures.find(structure => structure.type === 'torre' && structure.kingdomId === castle.kingdomId);
  tower.integrity = .55;
  world.structures.push(
    { type: 'torre', x: castle.x + 2, y: castle.y, kingdomId: castle.kingdomId, complete: false },
    { type: 'torre', x: castle.x + 1, y: castle.y, kingdomId: 999999, complete: true },
    { type: 'casa', x: castle.x, y: castle.y, kingdomId: castle.kingdomId, complete: true }
  );
  world.territoryClaims.push(
    { status: 'annexed', ownerId: castle.kingdomId, x: castle.x + 4, y: castle.y, radius: 2.5, expiresDay: 21 },
    { status: 'annexed', ownerId: castle.kingdomId, x: castle.x, y: castle.y, radius: 30, expiresDay: 19 },
    { status: 'pending', ownerId: castle.kingdomId, x: castle.x, y: castle.y, radius: 30, expiresDay: 21 }
  );
}

test('optimized territory recomputation matches the previous map and counts', () => {
  const expected = Sim.createWorld(42);
  const actual = Sim.createWorld(42);
  addCoverageCases(expected);
  addCoverageCases(actual);

  referenceRecompute(expected);
  recomputeKingdomTerritories(actual);

  assert.deepEqual(actual.tiles.map(tile => tile.kingdomId), expected.tiles.map(tile => tile.kingdomId));
  assert.deepEqual(actual.kingdoms.map(kingdom => kingdom.territoryTileCount), expected.kingdoms.map(kingdom => kingdom.territoryTileCount));
});
