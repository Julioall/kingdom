import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldDrawMineralAtZoom } from '../src/ui/mineral-lod.js';

test('LOD preserves every deposit at inspection zoom and active mining at any zoom', () => {
  for (const zoom of [4, 8, 16]) {
    for (let x = 0; x < 32; x++) assert.equal(shouldDrawMineralAtZoom({ x, y: 7, copper: 1 }, zoom), true);
  }
  assert.equal(shouldDrawMineralAtZoom({ x: 1, y: 3, iron: 2 }, .5, true), true);
});

test('LOD never hides rare gold/silver or stone-only resources', () => {
  for (const zoom of [.5, 1, 2, 3]) {
    for (const ore of [{ gold: 1 }, { silver: 1 }, { stone: 10 }]) {
      assert.equal(shouldDrawMineralAtZoom({ x: 5, y: 9, ...ore }, zoom), true);
    }
  }
});

test('LOD is deterministic, independent of world seed or rendering order, and only affects visibility', () => {
  const deposits = Array.from({ length: 64 * 64 }, (_, i) => ({
    x: i % 64, y: Math.floor(i / 64), copper: 2, iron: 1
  }));
  const count = zoom => deposits.filter(item => shouldDrawMineralAtZoom(item, zoom)).length;
  const atHalf = count(.5), atTwo = count(2), atFour = count(4);
  assert.ok(atHalf > 0 && atHalf < atTwo && atTwo < atFour);
  assert.equal(atFour, deposits.length);
  assert.equal(count(2), atTwo);
  assert.deepEqual(deposits[0], { x: 0, y: 0, copper: 2, iron: 1 });
});
