import test from 'node:test';
import assert from 'node:assert/strict';
import { createStaticDepthSpatialIndex } from '../src/ui/depth-spatial-index.js';
import { createVisibleStaticDepthCache } from '../src/ui/visible-static-depth-cache.js';
import { compareDepth, mergeDepthItems } from '../src/ui/depth-order.js';

const bounds = (minX, maxX, minY, maxY) => ({ minX, maxX, minY, maxY });
const makeItems = () => Array.from({ length: 112 * 112 }, (_, i) => ({
  x: i % 112, y: Math.floor(i / 112), id: i,
  kind: i % 5 === 0 ? 'mineral' : i % 7 === 0 ? 'tree' : 'decoration',
  depth: (Math.floor(i / 112) + 1) * 16 * 2048 + i % 11,
  order: i % 3, sequence: i
})).sort(compareDepth);
const showMineral = (item, zoom, highlighted) => highlighted || zoom >= 1 || item.id % 4 === 0;
const expected = (items, view, zoom, mining) => items.filter(item =>
  item.x >= view.minX && item.x <= view.maxX && item.y >= view.minY && item.y <= view.maxY
  && (item.kind !== 'mineral' || showMineral(item, zoom, mining.has(item.x + ':' + item.y))));

test('full-map lookup reuses the existing sorted array and preserves tie breakers', () => {
  const items = makeItems();
  const index = createStaticDepthSpatialIndex(items);
  const full = bounds(-1, 112, -1, 112);
  assert.strictEqual(index.query(full), items, 'full-map query must skip re-sorting static items');
  const narrow = bounds(10, 40, 20, 70);
  assert.deepEqual(index.query(narrow), expected(items, narrow, 1, new Set()));
  assert.ok(index.stats().lastExamined <= items.length);
  const baseline = createStaticDepthSpatialIndex(items, 16, { fullMapFastPath: false });
  assert.deepEqual(index.query(full), baseline.query(full));
  assert.notStrictEqual(index.query(full), baseline.query(full));
});

test('static cache skips 200 repeated full-map queries without changing painter order', () => {
  const items = makeItems(), spatial = createStaticDepthSpatialIndex(items);
  const cache = createVisibleStaticDepthCache(), miningSites = new Set();
  let queries = 0;
  const spatialIndex = { query(view) { queries++; return spatial.query(view); } };
  const view = bounds(-1, 112, -1, 112);
  const get = () => cache.get({ items, spatialIndex, bounds: view,
    zoom: .5, miningSites, showMineral });
  const visible = get();
  assert.deepEqual(visible, expected(items, view, .5, miningSites));
  for (let i = 0; i < 200; i++) assert.strictEqual(get(), visible);
  assert.equal(queries, 1);
  assert.deepEqual(cache.stats(), { hits: 200, misses: 1, cachedItems: visible.length });
  const actors = Array.from({ length: 96 }, (_, id) => ({
    id, x: id % 12, y: Math.floor(id / 12),
    depth: (Math.floor(id / 12) + 1) * 16 * 2048, order: 4, sequence: visible.length + id
  }));
  assert.deepEqual(mergeDepthItems(visible, actors),
    [...expected(items, view, .5, miningSites), ...actors].sort(compareDepth));
});

test('camera pan, zoom, mining highlights, snapshot and explicit reset invalidate precisely', () => {
  const items = makeItems(), cache = createVisibleStaticDepthCache();
  const spatialIndex = createStaticDepthSpatialIndex(items);
  const mining = new Set(), original = bounds(10, 30, 20, 50);
  const fetch = (source, view, zoom, highlights) => cache.get({
    items: source, spatialIndex: source === items ? spatialIndex : createStaticDepthSpatialIndex(source),
    bounds: view, zoom, miningSites: highlights, showMineral
  });
  const first = fetch(items, original, .5, mining);
  assert.deepEqual(first, expected(items, original, .5, mining));
  assert.strictEqual(fetch(items, { ...original }, .5, mining), first);
  const pan = bounds(12, 32, 21, 51);
  const shifted = fetch(items, pan, .5, mining);
  assert.notStrictEqual(shifted, first);
  assert.deepEqual(shifted, expected(items, pan, .5, mining));
  const zoomed = fetch(items, pan, 1, mining);
  assert.deepEqual(zoomed, expected(items, pan, 1, mining));
  const highlighted = new Set(['15:30']);
  const mined = fetch(items, pan, .5, highlighted);
  assert.deepEqual(mined, expected(items, pan, .5, highlighted));
  const nextDay = items.slice();
  assert.deepEqual(fetch(nextDay, pan, .5, highlighted), mined);
  cache.clear();
  const postReset = fetch(items, original, .5, mining);
  assert.deepEqual(postReset, first);
  assert.notStrictEqual(postReset, first);
});

test('invalid and empty camera bounds behave as the existing index, without stale results', () => {
  const items = makeItems(), spatialIndex = createStaticDepthSpatialIndex(items);
  const cache = createVisibleStaticDepthCache(), miningSites = new Set();
  for (const view of [bounds(10, -1, 0, 10), bounds(NaN, 10, 0, 10), bounds(200, 400, 200, 400)]) {
    const visible = cache.get({ items, spatialIndex, bounds: view, zoom: .5, miningSites, showMineral });
    assert.deepEqual(visible, []);
  }
  assert.deepEqual(cache.get({ items, spatialIndex, bounds: bounds(-1, 112, -1, 112),
    zoom: .5, miningSites, showMineral }), expected(items, bounds(-1, 112, -1, 112), .5, miningSites));
});
