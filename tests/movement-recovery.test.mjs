import test from 'node:test';
import assert from 'node:assert/strict';
import { createMovementInterpolator } from '../src/ui/movement-interpolation.js';

test('late snapshots resume from the visible position instead of jumping ahead', () => {
  const interpolation = createMovementInterpolator();
  const person = { id: 1, alive: true, x: 0, y: 0 };
  const world = { day: 0, people: [person], animals: [] };
  interpolation.observe(world, 0, { reset: true });
  world.day = 1; person.x = 1;
  interpolation.observe(world, 1000);
  const before = interpolation.pose('person', person, 5000);
  world.day = 2; person.x = 8;
  interpolation.observe(world, 5000);
  const after = interpolation.pose('person', person, 5000);
  assert.equal(after.x, before.x);
  const later = interpolation.pose('person', person, 5500);
  assert.ok(later.x > after.x && later.x < person.x);
});

test('dash completion blends from its endpoint to the latest authoritative position', () => {
  const interpolation = createMovementInterpolator();
  const person = { id: 1, alive: true, x: 8, y: 0 };
  interpolation.observe({ day: 0, people: [person], animals: [] }, 0, { reset: true });
  interpolation.settleActor('person', person, { x: 5, y: 0 }, 2000);
  assert.equal(interpolation.pose('person', person, 2000).x, 5);
  assert.equal(interpolation.pose('person', person, 2250).x, 8);
});
