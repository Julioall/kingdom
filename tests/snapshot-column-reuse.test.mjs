import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../src/simulation/engine.js';
import { createWorldSnapshot } from '../src/simulation/render-snapshot.js';

test('snapshot ID/type reuse copies before live mutations and matches fresh packing', () => {
  const world = Sim.createWorld(42);
  const first = createWorldSnapshot(world).tileColumns;
  const unchanged = createWorldSnapshot(world, { previousTileColumns: first }).tileColumns;
  assert.equal(unchanged.ids, first.ids);
  assert.equal(unchanged.types, first.types);
  const oldId = first.ids[0], oldType = first.types[0];
  world.tiles[0].regionId = 2 ** 40 + 777;
  world.tiles[0].terrain = world.tiles[0].terrain === 'rock' ? 'land' : 'rock';
  const changed = createWorldSnapshot(world, { previousTileColumns: first }).tileColumns;
  assert.notEqual(changed.ids, first.ids);
  assert.notEqual(changed.types, first.types);
  assert.equal(first.ids[0], oldId);
  assert.equal(first.types[0], oldType);
  assert.deepEqual(changed, createWorldSnapshot(world).tileColumns);
  const reset = createWorldSnapshot(world, { reset: true, previousTileColumns: changed }).tileColumns;
  assert.notEqual(reset.ids, changed.ids);
  assert.notEqual(reset.types, changed.types);
  structuredClone(changed, { transfer: [changed.ids.buffer, changed.types.buffer] });
  assert.deepEqual(createWorldSnapshot(world, { previousTileColumns: changed }).tileColumns,
    createWorldSnapshot(world).tileColumns);
});
