import test from 'node:test';
import assert from 'node:assert/strict';
import { atmosphereZoomProfile, cloudOpacityAtZoom, cloudShadowOpacity, createCloudSystem } from '../src/ui/cloud-system.js';
import { mapCamera } from '../src/ui/map-camera.js';

test('fog and foreground clouds thin between 50% and 75%, and disappear at 100%', () => {
  const high = atmosphereZoomProfile(.5);
  const middle = atmosphereZoomProfile(.75);
  const normal = atmosphereZoomProfile(1);
  assert.equal(high.cloudLayerOpacity, .75);
  assert.ok(middle.cloudLayerOpacity > high.cloudLayerOpacity && middle.cloudLayerOpacity < 1);
  assert.equal(normal.cloudLayerOpacity, 1);
  assert.ok(high.fogOpacity > middle.fogOpacity && middle.fogOpacity > 0);
  assert.ok(high.foregroundOpacity > middle.foregroundOpacity && middle.foregroundOpacity > 0);
  assert.equal(normal.fogOpacity, 0);
  assert.equal(normal.foregroundOpacity, 0);
  assert.equal(atmosphereZoomProfile(2).fogOpacity, 0);
});

test('cloud bodies remain visible at 100% and give way to shadows at 200%', () => {
  assert.ok(cloudOpacityAtZoom(.5) > 0);
  assert.ok(cloudOpacityAtZoom(1) > 0);
  assert.equal(cloudOpacityAtZoom(2), 0);
  assert.equal(cloudOpacityAtZoom(16), 0);
  assert.ok(cloudShadowOpacity(cloudOpacityAtZoom(2)) > 0);
  assert.ok(cloudShadowOpacity(cloudOpacityAtZoom(1.5)) > 0);
});

test('renderer adds large foreground clouds when elevated and draws no cloud bodies at 200%', () => {
  const images = Array.from({ length: 8 }, () => ({ complete: true, naturalWidth: 800, naturalHeight: 300 }));
  const drawsAt = zoom => {
    const system = createCloudSystem(images, 2026);
    const draws = [];
    let transform = [];
    const context = {
      save() {}, restore() {},
      setTransform(...next) { transform = next; },
      drawImage(_image, x, y, width, height) { draws.push({ x, y, width, height, scale: transform[0] }); },
    };
    const camera = mapCamera(1600, 1000, zoom);
    system.drawAtmosphere(context, camera, 1600, 1000, { x: 512, y: 512 }, zoom);
    return draws;
  };
  const high = drawsAt(.5);
  const middle = drawsAt(.75);
  const normal = drawsAt(1);
  assert.ok(high.length > middle.length && middle.length > normal.length);
  const foreground = high.filter(draw => draw.scale === 1);
  assert.equal(foreground.length, 3);
  assert.ok(foreground.some(draw => draw.width > 1600 * .5));
  assert.equal(normal.filter(draw => draw.scale === 1).length, 0);
  assert.equal(drawsAt(2).length, 0);
});

test('extra clouds fade in after zoom changes instead of appearing at full opacity', () => {
  const system = createCloudSystem([], 2026);
  const camera = mapCamera(1600, 900, 1);
  system.update(0, { camera, viewportWidth: 1600, viewportHeight: 900, zoom: 1 });
  const extras = system.getClouds().filter(cloud => cloud.visibility === 0).map(cloud => cloud.id);
  assert.ok(extras.length > 0);
  const elevatedCamera = mapCamera(1600, 900, .5);
  system.update(.1, { camera: elevatedCamera, viewportWidth: 1600, viewportHeight: 900, zoom: .5 });
  for (const id of extras) {
    const cloud = system.getClouds()[id];
    assert.ok(cloud.visibility > 0 && cloud.visibility < 1);
  }
});

test('world and foreground clouds leave the viewport completely before recycling outside it', () => {
  const images = Array.from({ length: 8 }, () => ({ complete: true, naturalWidth: 800, naturalHeight: 300 }));
  for (const [width, height, zoom, panX, panY] of [[2400, 800, .5, 0, 0], [800, 1400, .5, 0, 0], [1600, 900, 2, -800, 500]]) {
    const system = createCloudSystem(images, 2026);
    const camera = mapCamera(width, height, zoom, panX, panY);
    system.update(0, { camera, viewportWidth: width, viewportHeight: height, zoom });
    const topLeft = camera.toWorld(0, 0), bottomRight = camera.toWorld(width, height);
    const scale = zoom === .5 ? 2 : 1;
    const box = cloud => {
      const scaledWidth = cloud.width * scale;
      const scaledHeight = scaledWidth * 300 / 800;
      const left = cloud.x + (cloud.width - scaledWidth) / 2;
      const top = cloud.y + (cloud.width * 300 / 800 - scaledHeight) / 2;
      return { left, top, right: left + scaledWidth * 1.025, bottom: top + scaledHeight + scaledWidth * .16 };
    };
    const outside = rect => rect.right < topLeft.x || rect.left > bottomRight.x || rect.bottom < topLeft.y || rect.top > bottomRight.y;
    const nearBox = cloud => {
      const cloudWidth = width * cloud.width * atmosphereZoomProfile(zoom).foregroundScale;
      const left = (cloud.x + cloud.drift) * width + panX * .24 - cloudWidth * .3;
      return { left, right: left + cloudWidth };
    };
    let worldRecycles = 0, foregroundRecycles = 0;
    for (let tick = 0; tick < 600; tick++) {
      const before = system.getClouds();
      const beforeNear = system.getForegroundClouds();
      system.update(5);
      for (const cloud of system.getClouds()) {
        const previous = before[cloud.id];
        const advanced = { ...previous, x: previous.x + previous.speedX * 5, y: previous.y + previous.speedY * 5 };
        if (Math.abs(cloud.x - advanced.x) > .001 || Math.abs(cloud.y - advanced.y) > .001) {
          worldRecycles++;
          assert.ok(outside(box(advanced)), 'a cloud was recycled while its body or shadow was still onscreen');
          assert.ok(outside(box(cloud)), 'a recycled cloud or shadow appeared inside the viewport');
        }
      }
      system.getForegroundClouds().forEach((cloud, index) => {
        if (cloud.drift < beforeNear[index].drift) {
          foregroundRecycles++;
          const advanced = { ...beforeNear[index], drift: beforeNear[index].drift + cloud.speed * 5 };
          assert.ok(nearBox(advanced).left > width, 'foreground cloud disappeared before clearing the screen');
          assert.ok(nearBox(cloud).right < 0, 'foreground cloud respawned onscreen');
        }
      });
    }
    assert.ok(worldRecycles > 0);
    assert.ok(foregroundRecycles > 0);
  }
});
