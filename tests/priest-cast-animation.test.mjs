import test from 'node:test';
import assert from 'node:assert/strict';
import { priestCastAnimationPose } from '../src/ui/person-animations.js';
import { getUnitAnimation, getAnimationFrame } from '../src/ui/animations.js';

const animation = getUnitAnimation('monge', 'heal');
const frame = (world, person) => {
  const pose = priestCastAnimationPose(world, person, animation);
  return pose ? getAnimationFrame(animation, pose.elapsedMs, { loop: pose.loop }).index : null;
};

test('priest plays the opening once then loops exactly frames 4–7 until activation', () => {
  const person = { id: 1, alive: true, militaryClass: 'monge', magicCast: { startedAt: 0 } };
  const world = { magicTimeMs: 0, magicEvents: [] };
  const indices = [];
  for (let ms = 0; ms <= 1700; ms += 100) {
    world.magicTimeMs = ms; world.day = Math.floor(ms / 500);
    indices.push(frame(world, person));
  }
  assert.deepEqual(indices, [0, 1, 2, 3, 4, 5, 6, 3, 4, 5, 6, 3, 4, 5, 6, 3, 4, 5]);
  world.magicTimeMs = 10000;
  assert.ok(frame(world, person) >= 3 && frame(world, person) <= 6,
    'an ongoing cast never reaches the release frames, even across day changes');
  assert.equal(frame(world, person), frame(world, person), 'paused magic time holds the same pose');
});

test('activation releases the final frames; interruption and death do not play a release', () => {
  const person = { id: 1, alive: true, militaryClass: 'monge', magicCast: null };
  const world = { magicTimeMs: 2000, magicEvents: [{ kind: 'activated', casterId: 1, at: 2000 }] };
  const indices = [];
  for (let ms = 2000; ms <= 2400; ms += 100) {
    world.magicTimeMs = ms; indices.push(frame(world, person));
  }
  assert.deepEqual(indices, [7, 8, 9, 10, null]);
  world.magicTimeMs = 2000;
  world.magicEvents = [{ kind: 'cancelled', casterId: 1, at: 2000 }];
  assert.equal(frame(world, person), null);
  person.alive = false; person.magicCast = { startedAt: 0 };
  assert.equal(frame(world, person), null);
});
