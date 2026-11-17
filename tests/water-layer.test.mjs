import test from 'node:test';
import assert from 'node:assert/strict';
import { createWaterLayer } from '../src/ui/render/water-layer.js';

function fakeCanvas() {
  const calls = { drawImage: 0, fills: 0, patterns: 0 };
  const canvas = { width: 0, height: 0, calls };
  const context = {
    canvas, fillStyle: null, imageSmoothingEnabled: true,
    fillRect() { calls.fills++; }, drawImage() { calls.drawImage++; },
    clearRect() {}, setTransform() {}, save() {}, restore() {},
    beginPath() {}, rect() {}, clip() {},
    createPattern() { calls.patterns++; return { setTransform() {} }; }
  };
  canvas.getContext = name => {
    assert.equal(name, '2d');
    return context;
  };
  return canvas;
}
const camera = { width: 800, height: 600,
  transform: [2, 0, 0, 2, 15, 22] };
const view = { x: 0, y: 0, width: 640, height: 480, bounds: {
  minX: 0, maxX: 40, minY: 0, maxY: 30
} };

test('water layer caches backdrop and decorations without mutating target dimensions', () => {
  const canvases = [], paintedBounds = [];
  const createCanvas = () => { const canvas = fakeCanvas(); canvases.push(canvas); return canvas; };
  const layer = createWaterLayer({
    tileSize: 8, texture: { complete: false, naturalWidth: 0 },
    createCanvas, drawDecorations(_context, bounds) { paintedBounds.push(bounds); }
  });
  const screen = fakeCanvas(), target = screen.getContext('2d');
  const state = { seed: 42, day: 0, animationTime: 0, assetRevision: 0 };
  layer.drawCached(target, camera, view, state);
  assert.deepEqual(layer.stats(), { backdropBuilds: 1, layerBuilds: 1 });
  assert.equal(paintedBounds[0], view.bounds);
  layer.drawCached(target, camera, view, state);
  assert.deepEqual(layer.stats(), { backdropBuilds: 1, layerBuilds: 1 });
  assert.equal(paintedBounds.length, 1);
  layer.drawCached(target, camera, view, { ...state, animationTime: 110 });
  assert.equal(layer.stats().layerBuilds, 2);
  layer.drawCached(target, camera, view, { ...state, day: 1 });
  assert.equal(layer.stats().layerBuilds, 3);
  layer.drawCached(target, { ...camera, transform: [2, 0, 0, 2, 20, 22] }, view, state);
  assert.equal(layer.stats().backdropBuilds, 1, 'moving the camera reuses the ocean texture');
  assert.equal(layer.stats().layerBuilds, 4);
  assert.ok(screen.calls.drawImage >= 4);
  assert.equal(canvases.length, 2);
});

test('texture patterns are cached per rendering context outside reference mode', () => {
  const texture = { complete: true, naturalWidth: 64 };
  const layer = createWaterLayer({ tileSize: 8, texture, createCanvas: fakeCanvas,
    drawDecorations() {} });
  const canvas = fakeCanvas(), context = canvas.getContext('2d');
  layer.drawBackdrop(context, camera);
  layer.drawBackdrop(context, camera);
  assert.equal(canvas.calls.patterns, 1);
  assert.equal(canvas.calls.fills, 4);
  const reference = createWaterLayer({ tileSize: 8, texture, referenceRendering: true,
    createCanvas: fakeCanvas, drawDecorations() {} });
  reference.drawBackdrop(context, camera);
  reference.drawBackdrop(context, camera);
  assert.equal(canvas.calls.patterns, 3);
});
