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

test('changing camera height preserves every common ore sprite without modifying reserves', () => {
  const deposits = Array.from({ length: 64 * 64 }, (_, i) => ({
    x: i % 64, y: Math.floor(i / 64), copper: 2, iron: 1
  }));
  const count = zoom => deposits.filter(item => shouldDrawMineralAtZoom(item, zoom)).length;
  for (const zoom of [.5, .99, 1, 1.99, 2, 2.99, 3, 3.99, 4, 8, 16])
    assert.equal(count(zoom), deposits.length, 'every vein stays visible at zoom ' + zoom);
  assert.deepEqual(deposits[0], { x: 0, y: 0, copper: 2, iron: 1 });
});

test('only exhausted deposits lose their mineral sprite', () => {
  assert.equal(shouldDrawMineralAtZoom({ x: 5, y: 9, copper: 0, iron: 0 }, .5), false);
  assert.equal(shouldDrawMineralAtZoom({ x: 5, y: 9, stone: 0 }, 8), false);
});
