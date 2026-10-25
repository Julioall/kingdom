import test from 'node:test';
import assert from 'node:assert/strict';
import { CLOUD_CONFIG, cloudOpacityAtZoom, cloudShadowOpacity, createCloudSystem } from '../../src/ui/cloud-system.js';

test('cloud distribution uses a stable seed and moves with a consistent prevailing wind', () => {
  const first = createCloudSystem([], 81);
  const second = createCloudSystem([], 81);
  assert.deepEqual(first.getClouds(), second.getClouds());

  const initial = first.getClouds();
  assert.equal(initial.length, CLOUD_CONFIG.count);
  for (const cloud of initial) {
    assert.ok(cloud.width >= CLOUD_CONFIG.minWidth && cloud.width <= CLOUD_CONFIG.maxWidth);
  }
  first.update(10);
  const moved = first.getClouds();
  assert.equal(moved.length, CLOUD_CONFIG.count);
  for (let index = 0; index < moved.length; index++) {
    const nextX = initial[index].x + initial[index].speedX * 10;
    const expectedX = nextX > CLOUD_CONFIG.worldSize + CLOUD_CONFIG.worldPadding
      ? -CLOUD_CONFIG.worldPadding - initial[index].width : nextX;
    assert.ok(Math.abs(moved[index].x - expectedX) < 1e-9);
    assert.ok(Math.abs(moved[index].speedX - initial[index].speedX) < 1e-12);
  }
});

test('cloud opacity fades continuously with zoom and when camera moves into a cloud', () => {
  const zoomSamples = [1, 1.5, 2, 3, 4].map(zoom => cloudOpacityAtZoom(zoom));
  for (let index = 1; index < zoomSamples.length; index++) {
    assert.ok(zoomSamples[index] <= zoomSamples[index - 1]);
  }
  assert.ok(zoomSamples[0] > .8);
  assert.equal(zoomSamples.at(-1), 0);

  const near = cloudOpacityAtZoom(2, 0, 300);
  const far = cloudOpacityAtZoom(2, 600, 300);
  assert.ok(near < far);
  assert.ok(near > 0, 'camera proximity fades gradually rather than hiding clouds abruptly');
});

test('cloud-sprite shadows stay hidden until the atmosphere is practically transparent', () => {
  assert.equal(cloudShadowOpacity(CLOUD_CONFIG.opacity), 0);
  assert.ok(cloudShadowOpacity(CLOUD_CONFIG.shadowRevealOpacity / 2) > 0);
  assert.equal(cloudShadowOpacity(0), CLOUD_CONFIG.shadowOpacity);
});
