import test from 'node:test';
import assert from 'node:assert/strict';
import { PLANTS } from '../src/config/ecosystem.js';
import { corralFenceRadius } from '../src/simulation/ecology/herd.js';
import {
  CORRAL_NATURAL_CLEARANCE, CORRAL_CLEARANCE_GEOMETRY_REFRESH_DAYS,
  corralNaturalClearanceTiles, corralClearanceCacheDiagnostics,
  clearWildVegetationNearCorrals
} from '../src/simulation/ecology/corral-clearance.js';

function miniatureWorld() {
  const width = 32, height = 32;
  const tiles = Array.from({ length: width * height }, (_, i) => ({
    i, x: i % width, y: Math.floor(i / width), terrain: 'land',
    plants: new Float32Array(PLANTS.length), plantResourceMask: 0, stump: null
  }));
  return {
    width, height, day: 0, tiles,
    structures: [
      { id: 1, type: 'curral', x: 12, y: 11, radius: 3.5, complete: true, integrity: 100 },
      { id: 2, type: 'casa', x: 20, y: 20, radius: 4, integrity: 100 }
    ],
    navigationRevision: 0
  };
}

// Frozen historical geometry rule for parity testing. This implementation
// recomputes from scratch, independent of the new cache.
function referenceClearance(world) {
  const indices = new Set();
  for (const pen of world.structures) {
    if (pen.type !== 'curral' || pen.destroyedDay != null || pen.integrity === 0) continue;
    const radius = Math.max(Number(pen.radius) || 3.5, corralFenceRadius(pen)) + CORRAL_NATURAL_CLEARANCE;
    const minX = Math.max(0, Math.floor(pen.x - radius));
    const maxX = Math.min(world.width - 1, Math.ceil(pen.x + radius));
    const minY = Math.max(0, Math.floor(pen.y - radius));
    const maxY = Math.min(world.height - 1, Math.ceil(pen.y + radius));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const dx = x - pen.x, dy = y - pen.y;
      if (dx * dx + dy * dy <= radius * radius) indices.add(y * world.width + x);
    }
  }
  return indices;
}
function expectSameCells(world) {
  assert.deepEqual([...corralNaturalClearanceTiles(world)], [...referenceClearance(world)]);
}

test('monthly geometry cache is exact for every day and rebuilds at day 30', () => {
  const w = miniatureWorld();
  assert.equal(CORRAL_CLEARANCE_GEOMETRY_REFRESH_DAYS, 30);
  for (let day = 0; day <= 65; day++) {
    w.day = day;
    expectSameCells(w);
    const state = corralClearanceCacheDiagnostics(w);
    assert.equal(state.rebuilds, 1 + Math.floor(day / 30));
    assert.equal(state.lastRebuildDay, Math.floor(day / 30) * 30);
  }
  assert.equal(corralClearanceCacheDiagnostics(w).hits, 63);
  // Public API must not leak the internal cached mutable Set.
  const returned = corralNaturalClearanceTiles(w);
  returned.clear();
  assert.ok(corralNaturalClearanceTiles(w).size > 0);
});

test('building, movement, resizing, destruction and grid reset invalidate immediately', () => {
  const w = miniatureWorld();
  w.day = 4;
  expectSameCells(w);
  assert.equal(corralClearanceCacheDiagnostics(w).rebuilds, 1);
  w.structures[0].x += 3;
  expectSameCells(w);
  assert.equal(corralClearanceCacheDiagnostics(w).rebuilds, 2);
  w.structures[0].radius = 6.5;
  expectSameCells(w);
  assert.equal(corralClearanceCacheDiagnostics(w).rebuilds, 3);
  w.structures.push({ id: 3, type: 'curral', x: 2, y: 2, radius: 3, integrity: 100 });
  expectSameCells(w);
  assert.equal(corralClearanceCacheDiagnostics(w).rebuilds, 4);
  w.structures[0].destroyedDay = 4;
  expectSameCells(w);
  assert.equal(corralClearanceCacheDiagnostics(w).rebuilds, 5);
  w.structures[2].integrity = 0;
  expectSameCells(w);
  assert.equal(corralClearanceCacheDiagnostics(w).rebuilds, 6);
  w.tiles = w.tiles.slice();
  expectSameCells(w);
  assert.equal(corralClearanceCacheDiagnostics(w).rebuilds, 7);
  w.day = 1; // Same world rewound by a debug/replay control.
  expectSameCells(w);
  assert.equal(corralClearanceCacheDiagnostics(w).rebuilds, 8);
});

test('vegetation is still cleared EVERY day even when geometry cache hits', () => {
  const w = miniatureWorld();
  const grass = PLANTS.findIndex(p => p.id === 'grass');
  const berry = PLANTS.findIndex(p => p.id === 'berry');
  const conifer = PLANTS.findIndex(p => p.id === 'conifer');
  const index = 11 * w.width + 12;
  const tile = w.tiles[index];
  for (let day = 1; day <= 3; day++) {
    w.day = day;
    tile.plants[berry] = 40 + day;
    tile.plants[conifer] = 240;
    tile.plants[grass] = 12;
    tile.plantResourceMask |= (1 << berry) | (1 << conifer) | (1 << grass);
    tile.stump = { untilDay: 90 };
    const previousRevision = w.navigationRevision;
    const { changed, clearance } = clearWildVegetationNearCorrals(w);
    assert.equal(changed, true);
    assert.ok(clearance.has(index));
    assert.equal(tile.plants[berry], 0);
    assert.equal(tile.plants[conifer], 0);
    assert.equal(tile.plants[grass], 12, 'non-clearable grass is unchanged');
    assert.equal(tile.stump, null);
    assert.equal(w.navigationRevision, previousRevision + 1);
  }
  assert.equal(corralClearanceCacheDiagnostics(w).rebuilds, 1);
  assert.equal(corralClearanceCacheDiagnostics(w).hits, 2);
  w.structures[0].integrity = 0;
  w.day = 4;
  tile.plants[berry] = 20;
  tile.plantResourceMask |= 1 << berry;
  assert.equal(clearWildVegetationNearCorrals(w).changed, false);
  assert.equal(tile.plants[berry], 20, 'removed corral no longer clears vegetation');
});
