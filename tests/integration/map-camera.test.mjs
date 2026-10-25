import test from 'node:test';
import assert from 'node:assert/strict';
import { mapCamera, spriteScale, alignedTileRect, BUILDING_FEET } from '../../src/ui/map-camera.js';

test('all native sprites share the terrain 64-pixel grid without changing their aspect ratio', () => {
  assert.equal(spriteScale(8), .125);
  for (const [width, height] of [[192, 192], [320, 320], [192, 256], [320, 256], [128, 192], [128, 128]]) {
    const scale = spriteScale(8);
    assert.equal(width * scale / (height * scale), width / height);
  }
  assert.equal(BUILDING_FEET.castle, 249);
  assert.equal(BUILDING_FEET.house1, 173);
});

test('a rectangular viewport keeps the world square, centers it and honors physical pixel density', () => {
  const camera = mapCamera(1200, 600, 1, 0, 0, 2);
  assert.equal(camera.width, 2400);
  assert.equal(camera.height, 1200);
  assert.equal(camera.transform[0], camera.transform[3]);
  assert.equal(camera.offsetX, 300);
  assert.equal(camera.offsetY, 0);
  assert.deepEqual(camera.toWorld(600, 300), { x: 512, y: 512 });
  assert.deepEqual(camera.view, { x: 0, y: 0, width: 1024, height: 1024 });
});

test('zoom and pan preserve pointer selection coordinates and keep allocation bounded by the screen', () => {
  for (const zoom of [1, 1.25, 4, 16]) {
    const camera = mapCamera(900, 600, zoom, -25, 80, 2);
    const x = 407, y = 613;
    const recovered = camera.toWorld(x * camera.scale + camera.offsetX, y * camera.scale + camera.offsetY);
    assert.ok(Math.abs(recovered.x - x) < 1e-9);
    assert.ok(Math.abs(recovered.y - y) < 1e-9);
    assert.equal(camera.width * camera.height, 1800 * 1200, 'zoom does not allocate a world-sized bitmap');
    assert.ok(camera.view.x >= 0 && camera.view.x + camera.view.width <= 1024);
    assert.ok(camera.view.y >= 0 && camera.view.y + camera.view.height <= 1024);
  }
});

test('adjacent terrain tiles meet on device pixels at fractional zoom without seams', () => {
  const camera = mapCamera(1265, 653, 1.953125, 13.2, -22.8, 1.5);
  for (let i = 0; i < 127; i++) {
    const a = alignedTileRect(i * 8, 0, 8, camera.transform);
    const b = alignedTileRect((i + 1) * 8, 0, 8, camera.transform);
    assert.ok(Math.abs(a[0] + a[2] - b[0]) < 1e-9);
    const deviceX = a[0] * camera.transform[0] + camera.transform[4];
    assert.ok(Math.abs(deviceX - Math.round(deviceX)) < 1e-9);
  }
});
