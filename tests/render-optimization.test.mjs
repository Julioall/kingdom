import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerrainChunkCache } from '../src/ui/terrain-chunks.js';
import { createPixelTileCache } from '../src/ui/pixel-tile-cache.js';
import { compareDepth, mergeDepthItems } from '../src/ui/depth-order.js';
import { alignedTileRect, mapCamera } from '../src/ui/map-camera.js';
import view from '../src/ui/simulation-view.js';
import engine from '../src/simulation/engine.js';

test('UI facade exposes the exact engine metadata and geometry functions it consumes', () => {
  for (const key of ['width', 'height', 'plants', 'animals', 'seasons', 'actions', 'inspectTile']) assert.equal(view[key], engine[key]);
  assert.equal(view.kingdomCommands.timing, engine.kingdomCommands.timing);
  assert.equal(view.modules.Collision.structureHitbox, engine.modules.Collision.structureHitbox);
  assert.equal(view.modules.Collision.structureInteractionPoint, engine.modules.Collision.structureInteractionPoint);
  assert.equal(view.modules.Cosmos.calendarDate, engine.modules.Cosmos.calendarDate);
  assert.equal(view.modules.Cosmos.seasonIndex, engine.modules.Cosmos.seasonIndex);
  assert.equal(view.modules.SocietyExperiment.corralGate, engine.modules.SocietyExperiment.corralGate);
  assert.equal(view.modules.Biosphere.Botany.isTreeAnchor, engine.modules.Biosphere.Botany.isTreeAnchor);
});

function fixture({ width = 32, height = 32, ...options } = {}) {
  const canvases = [], paints = [], draws = [];
  const world = { seed: 42, width, height, tiles: Array.from({ length: width * height }, (_, i) => ({
    x: i % width, y: Math.floor(i / width), value: 0 })) };
  const cache = createTerrainChunkCache({ width, height, tileSize: 8, ...options,
    createCanvas: () => {
      const canvas = { width: 0, height: 0, getContext: () => ({ setTransform() {}, clearRect() {} }) };
      canvases.push(canvas); return canvas;
    } });
  const sync = () => cache.sync(world, tile => tile.value);
  const camera = { transform: [1, 0, 0, 1, 0, 0], view: { x: 0, y: 0, width: width * 8, height: height * 8 } };
  const paint = (_context, bounds, transform) => paints.push({ bounds, transform });
  const draw = (style = 'spring') => cache.draw({ drawImage: (canvas, x, y) => draws.push({ x, y, width: canvas.width, height: canvas.height }) }, camera, style, paint);
  return { world, cache, camera, sync, draw, paints, draws, canvases };
}

test('terrain chunks reuse raster pixels across pan and cull offscreen chunks', () => {
  const f = fixture(); f.sync();
  f.camera.view.width = 128;
  f.draw(); assert.equal(f.paints.length, 2);
  f.camera.transform[4] = 3; f.draw();
  assert.equal(f.paints.length, 2);
  assert.equal(f.cache.stats().lastDraw.hits, 2);
  f.camera.view.x = 128; f.draw();
  assert.equal(f.paints.length, 4);
  assert.equal(f.cache.stats().lastDraw.visible, 2);
  assert.ok(f.paints.every(paint => paint.bounds.maxX - paint.bounds.minX <= 19));
});

test('terrain invalidation is local and includes neighboring chunk bleed', () => {
  const f = fixture(); f.sync(); f.draw();
  f.world.tiles[5 * 32 + 5].value = 1; f.sync(); f.draw();
  assert.equal(f.cache.stats().lastDraw.rebuilds, 1);
  assert.equal(f.cache.stats().lastDraw.hits, 3);
  f.world.tiles[15 * 32 + 15].value = 1; f.sync(); f.draw();
  assert.equal(f.cache.stats().lastDraw.rebuilds, 4);
});

test('unchanged snapshots reuse chunks; season, reset and asset changes invalidate them', () => {
  const f = fixture(); f.sync(); f.draw();
  const revision = f.cache.revision;
  f.world.day = 1;
  assert.equal(f.sync(), false); assert.equal(f.cache.revision, revision);
  f.draw(); assert.equal(f.cache.stats().lastDraw.rebuilds, 0);
  f.draw('autumn'); assert.equal(f.cache.stats().lastDraw.rebuilds, 4);
  f.cache.invalidateAll(); f.draw('autumn'); assert.equal(f.cache.stats().lastDraw.rebuilds, 4);
  f.world.tiles = f.world.tiles.map(tile => ({ ...tile }));
  f.sync(); f.draw('autumn'); assert.equal(f.cache.stats().lastDraw.rebuilds, 4);
});

test('fractional scale preserves the exact rounded tile grid across chunk seams', () => {
  const f = fixture(); f.sync();
  f.camera.transform = [1.3, 0, 0, 1.3, -7, 11]; f.draw();
  for (let i = 0; i < f.paints.length; i++) {
    const paint = f.paints[i], draw = f.draws[i];
    for (let x = paint.bounds.minX; x <= paint.bounds.maxX; x++) {
      const [localX] = alignedTileRect(x * 8, 0, 8, paint.transform);
      const backingX = localX * 1.3 + paint.transform[4] + draw.x;
      assert.ok(Math.abs(backingX - Math.round(x * 8 * 1.3 - 7)) < 1e-9);
    }
  }
  const camera = mapCamera(811, 603, 1.37, .123, -19.713, 1.5);
  assert.ok(Number.isInteger(camera.transform[4])); assert.ok(Number.isInteger(camera.transform[5]));
  const point = camera.toWorld(123, 456);
  assert.ok(Math.abs(point.x * camera.scale + camera.offsetX - 123) < 1e-9);
});

test('terrain cache evicts LRU surfaces within its memory budget and handles tiny viewports', () => {
  const f = fixture({ width: 64, height: 64, maxBytes: 128 * 128 * 4 * 2 }); f.sync(); f.draw();
  assert.ok(f.cache.stats().bytes <= f.cache.stats().maxBytes);
  assert.ok(f.cache.stats().evictions > 0);
  assert.ok(f.canvases.some(canvas => canvas.width === 0));
  f.camera.transform = [.0001, 0, 0, .0001, 0, 0]; f.draw();
  assert.ok(f.draws.every(draw => draw.width > 0 && draw.height > 0));
});

test('pixel tile cache reuses identical rasterizations and evicts within its budget', () => {
  const canvases = [];
  const cache = createPixelTileCache({ maxBytes: 2 * 2 * 4, createCanvas: () => {
    const canvas = { width: 0, height: 0, draw: null, getContext: () => ({
      set imageSmoothingEnabled(_value) {},
      drawImage(...args) { canvas.draw = args; },
    }) };
    canvases.push(canvas); return canvas;
  } });
  const image = {};
  const first = cache.get(image, 0, 0, 64, 64, 2, 2);
  assert.equal(cache.get(image, 0, 0, 64, 64, 2, 2), first);
  assert.deepEqual(first.draw, [image, 0, 0, 64, 64, 0, 0, 2, 2]);
  assert.equal(cache.stats().hits, 1);
  cache.get(image, 64, 0, 64, 64, 2, 2);
  assert.equal(cache.stats().bytes, cache.stats().maxBytes);
  assert.equal(cache.stats().evictions, 1);
  assert.equal(canvases[0].width, 0);
});

test('merging cached static depth with actors exactly matches a full sort', () => {
  let state = 42;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state; };
  for (let repeat = 0; repeat < 20; repeat++) {
    const statics = Array.from({ length: 700 }, (_, sequence) => ({ depth: random() % 90, order: random() % 5, sequence, id: sequence }));
    const dynamics = Array.from({ length: 100 }, (_, index) => ({ depth: random() % 90, order: random() % 5, sequence: index + 700, id: index }));
    const expected = [...statics, ...dynamics].sort(compareDepth);
    statics.sort(compareDepth);
    const original = statics.slice();
    assert.deepEqual(mergeDepthItems(statics, dynamics), expected);
    assert.deepEqual(statics, original);
  }
});
