import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/simulation/world/generation.js';
import { createWorldSnapshot, applyWorldSnapshot } from '../src/simulation/render-snapshot.js';

test('browser simulation snapshot preserves every live metallic ore deposit', () => {
  const world = createWorld(42);
  const snapshot = createWorldSnapshot(world);
  const rendered = applyWorldSnapshot(snapshot);
  assert.equal(rendered.tiles.length, world.tiles.length);
  for (const metal of ['gold', 'copper', 'silver', 'iron']) {
    const field = metal + 'Ore';
    const expected = world.tiles.map(tile => tile[field]);
    const actual = rendered.tiles.map(tile => tile[field]);
    assert.ok(expected.some(value => value > .05), metal + ' should appear on this map');
    assert.ok(actual.every(value => Number.isFinite(value) && value >= 0));
    for (let i = 0; i < expected.length; i++)
      assert.ok(Math.abs(actual[i] - expected[i]) < 1e-5,
        field + ' tile ' + i + ' survived Float32 worker transport');
  }
  const copper = rendered.tiles.find(tile => tile.copperOre > .05 && tile.goldOre <= .05);
  assert.ok(copper && copper.copperOre > 0, 'Copper-only site is visible to the game renderer');
  assert.ok(snapshot.tileColumns.scalars.buffer.byteLength > 0);
});
