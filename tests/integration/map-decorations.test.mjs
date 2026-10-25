import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MAP_DECORATION_SPRITES, mapDecorationAt } from '../../src/ui/map-decorations.js';

test('all supplied decorative sprites are published as 64px transparent PNG props', () => {
  assert.equal(MAP_DECORATION_SPRITES.length, 7);
  for (const sprite of MAP_DECORATION_SPRITES) {
    const png = fs.readFileSync(new URL('../../public/assets/map-decorations/' + sprite + '.png', import.meta.url));
    assert.equal(png.readUInt32BE(16), 64, sprite);
    assert.equal(png.readUInt32BE(20), 64, sprite);
    assert.equal(png.readUInt8(25), 6, sprite);
  }
});

test('map decorations are deterministic, sparse and limited to ordinary land tiles', () => {
  const counts = Object.fromEntries(MAP_DECORATION_SPRITES.map(sprite => [sprite, 0]));
  let total = 0;
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const tile = { x, y, terrain: 'land', cropFieldId: null };
    const decoration = mapDecorationAt(tile, 42);
    assert.deepEqual(decoration, mapDecorationAt(tile, 42));
    if (!decoration) continue;
    total++;
    counts[decoration.sprite]++;
    assert.ok(decoration.size >= .76 && decoration.size < 1);
  }
  assert.ok(total > 350 && total < 1000, 'decorations should remain sparse on the full map');
  assert.ok(Object.values(counts).every(count => count > 0), 'each supplied sprite should be selected');
  assert.equal(mapDecorationAt({ x: 4, y: 4, terrain: 'water' }, 42), null);
  assert.equal(mapDecorationAt({ x: 4, y: 4, terrain: 'rock' }, 42), null);
  assert.equal(mapDecorationAt({ x: 4, y: 4, terrain: 'land', cropFieldId: 1 }, 42), null);
});
