import test from 'node:test';
import assert from 'node:assert/strict';
import { clampCameraPan, zoomCameraAtPoint } from '../src/ui/camera-pan.js';

test('camera pan clamp matches the original map-size and aspect-ratio policy', () => {
  assert.deepEqual(clampCameraPan(1200, 800, 1, 80, -90), { x: 0, y: 0 });
  assert.deepEqual(clampCameraPan(1200, 800, 2, 600, -700), { x: 200, y: -400 });
  assert.deepEqual(clampCameraPan(1200, 800, 2, -600, 700), { x: -200, y: 400 });
  assert.deepEqual(clampCameraPan(500, 500, .5, 200, 200), { x: 0, y: 0 });
  assert.deepEqual(clampCameraPan(1200, 800, 2, 99, -123), { x: 99, y: -123 });
});

test('focal-point zoom keeps the same world point under the cursor', () => {
  const original = {
    left: 100, top: 50, width: 1000, height: 800,
    zoom: 1, panX: 20, panY: -10,
    nextZoom: 2, clientX: 700, clientY: 500,
    minZoom: .5, maxZoom: 4
  };
  const result = zoomCameraAtPoint(original);
  assert.deepEqual(result, { zoom: 2, panX: -60, panY: -70 });
  const centerX = original.left + original.width / 2;
  const centerY = original.top + original.height / 2;
  const before = {
    x: (original.clientX - centerX - original.panX) / original.zoom,
    y: (original.clientY - centerY - original.panY) / original.zoom
  };
  const after = {
    x: (original.clientX - centerX - result.panX) / result.zoom,
    y: (original.clientY - centerY - result.panY) / result.zoom
  };
  assert.deepEqual(after, before);
  assert.equal(original.zoom, 1, 'camera calculation must not mutate caller state');
});

test('zoom bounds and missing pointer coordinates preserve legacy behavior', () => {
  const base = {
    left: 0, top: 0, width: 800, height: 800,
    zoom: 2, panX: 100, panY: 50,
    minZoom: .5, maxZoom: 4
  };
  assert.deepEqual(zoomCameraAtPoint({ ...base, nextZoom: 3 }),
    { zoom: 3, panX: 150, panY: 75 });
  const maximum = zoomCameraAtPoint({ ...base, nextZoom: 100, clientX: NaN, clientY: Infinity });
  assert.deepEqual(maximum, { zoom: 4, panX: 200, panY: 100 });
  const minimum = zoomCameraAtPoint({ ...base, nextZoom: 0 });
  assert.deepEqual(minimum, { zoom: .5, panX: 25, panY: 12.5 });
});
