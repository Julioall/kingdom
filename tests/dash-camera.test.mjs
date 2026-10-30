import test from 'node:test';
import assert from 'node:assert/strict';
import { dashPosition, dashGhosts, DASH_TRAIL_FADE_MS } from '../src/ui/dash-presentation.js';
import { followCameraPan, mapCamera } from '../src/ui/map-camera.js';

for (const attackVariant of ['shield-bash', 'lance-charge']) {
  test(`${attackVariant}: preparation, full travel and fading ghosts share the actual endpoint`, () => {
    const action = { attackVariant, origin: { x: 10, y: 10 }, endPosition: { x: 22, y: 16 },
      advanceDistance: 3, windupMs: 1000, activeMs: 600 };
    assert.deepEqual(dashPosition(action, 999), action.origin);
    assert.deepEqual(dashPosition(action, 1600), action.endPosition);
    const midpoint = dashPosition(action, 1300);
    const progress = attackVariant === 'shield-bash' ? .25 : .5;
    assert.equal(midpoint.x, 10 + 12 * progress);
    assert.equal(midpoint.y, 10 + 6 * progress);
    const ghosts = dashGhosts(action, 1500);
    assert.equal(ghosts.length, 4);
    assert.ok(ghosts.every(ghost => ghost.x >= 10 && ghost.x < dashPosition(action, 1500).x));
    assert.ok(ghosts[0].x > ghosts[3].x);
    assert.ok(ghosts[0].alpha > ghosts[3].alpha);
    assert.equal(dashGhosts(action, 1700).length, 4);
    assert.equal(dashGhosts(action, 1600 + DASH_TRAIL_FADE_MS).length, 0);
    // A collision shortens the actual route; neither the actor nor the ghosts pass its endpoint.
    action.endPosition = { x: 11, y: 10 };
    assert.equal(dashPosition(action, 1600).x, 11);
    assert.ok(dashGhosts(action, 1500).every(ghost => ghost.x <= 11));
  });
}

test('follow camera centers the displayed actor, follows a dash and stops at world edges', () => {
  for (const position of [{ x: 50, y: 55 }, { x: 60, y: 60 }, { x: 70, y: 65 }]) {
    const pan = followCameraPan(800, 800, 2, position, 8);
    const camera = mapCamera(800, 800, 2, pan.x, pan.y);
    assert.ok(Math.abs((position.x + .5) * 8 * camera.scale + camera.offsetX - 400) <= .5);
    assert.ok(Math.abs((position.y + .5) * 8 * camera.scale + camera.offsetY - 400) <= .5);
  }
  const edge = followCameraPan(800, 800, 2, { x: 0, y: 127 }, 8);
  assert.deepEqual(edge, { x: 400, y: -400 });
});
