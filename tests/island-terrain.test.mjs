import test from 'node:test';
import assert from 'node:assert/strict';
import { WIDTH, HEIGHT } from '../src/config/ecosystem.js';
import { generateIslandTerrain } from '../src/simulation/world/island-terrain.js';
import { createWorld } from '../src/simulation/world/generation.js';

test('square islands retain fixed bounds, connected land and freshwater across seeds', () => {
  const signatures = new Set();
  const lakeCounts = new Set();
  for (const seed of [1, 7, 42, 99, 987, 2026]) {
    const terrain = generateIslandTerrain(WIDTH, HEIGHT, seed);
    lakeCounts.add(terrain.freshwaterLakes.length);
    assert.ok(terrain.freshwaterLakes.length >= 1 && terrain.freshwaterLakes.length <= 4);
    const water = terrain.waterKind;
    const land = Array.from(water, (kind, i) => kind ? -1 : i).filter(i => i >= 0);
    assert.ok(land.length > WIDTH * HEIGHT * .6 && land.length < WIDTH * HEIGHT * .75);
    const inset = Math.floor((Math.min(WIDTH, HEIGHT) - Math.floor(Math.min(WIDTH, HEIGHT) * (6 / 7))) / 2);
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
      const inSquare = x >= inset && x < WIDTH - inset && y >= inset && y < HEIGHT - inset;
      const kind = water[y * WIDTH + x];
      if (inSquare && kind !== 'lake') assert.equal(kind, undefined);
      else if (!inSquare) assert.equal(kind, 'ocean');
    }
    const visited = new Set([land[0]]), queue = [land[0]];
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head], x = i % WIDTH, y = Math.floor(i / WIDTH);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, next = ny * WIDTH + nx;
        if (nx < 0 || ny < 0 || nx >= WIDTH || ny >= HEIGHT || water[next] || visited.has(next)) continue;
        visited.add(next); queue.push(next);
      }
    }
    assert.ok(visited.size / land.length > .99, 'mainland must not fragment into inaccessible patches');
    for (const lake of terrain.freshwaterLakes) {
      assert.equal(water[Math.round(lake.y) * WIDTH + Math.round(lake.x)], 'lake');
    }
    signatures.add(water.map(kind => kind || 'land').join(','));
    assert.deepEqual(water, generateIslandTerrain(WIDTH, HEIGHT, seed).waterKind);
  }
  assert.equal(signatures.size, 6, 'seeds should change lake placement');
  assert.ok(lakeCounts.size > 1, 'lake count must vary across seeded islands');
});

test('default-size islands initialize both kingdoms and their buildings on land', () => {
  assert.equal(WIDTH, 112);
  assert.equal(HEIGHT, 112);
  for (const seed of [1, 42, 987, 2026]) {
    const world = createWorld(seed);
    assert.equal(world.kingdoms.length, 2);
    assert.equal(world.width, WIDTH);
    assert.equal(world.height, HEIGHT);
    for (const structure of world.structures) {
      assert.equal(world.tiles[Math.round(structure.y) * world.width + Math.round(structure.x)].terrain, 'land');
    }
  }
});
