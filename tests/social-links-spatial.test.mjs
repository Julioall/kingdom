import test from 'node:test';
import assert from 'node:assert/strict';
import { updateSocialLinks } from '../src/simulation/society/communities.js';
import { clamp, distance } from '../src/simulation/core/math.js';

test('invalid coordinates preserve the legacy distance predicate and pair order', () => {
  const person = (id, x) => ({ id, x, y: 0, alive: true, foodReserve: 70,
    sociability: .5, socialNeed: 50, state: 'conversando', kingdomId: null, communityId: null });
  const world = { people: [person(9, NaN), person(3, 0), person(7, 100)], socialLinks: {}, communities: [] };
  updateSocialLinks(world);
  // Legacy distance(NaN, actor) > radius is false; retain that behavior.
  assert.deepEqual(Object.keys(world.socialLinks), ['9:3', '9:7']);
  assert.deepEqual(world.people.map(p => p.socialNeed), [44, 47, 47]);
});

test('spatial social links match ordered all-pairs interactions across cell boundaries', () => {
  const people = Array.from({ length: 400 }, (_, i) => ({
    id: 500 - i, alive: i % 17 !== 0,
    x: (i % 20) * 1.1 - 11, y: Math.floor(i / 20) * 1.1 - 11,
    foodReserve: i % 3 ? 70 : 20, sociability: (i % 11) / 10,
    socialNeed: 90, state: i % 2 ? 'conversando' : 'descansando',
    kingdomId: null, communityId: null
  }));
  const actual = { people, socialLinks: {}, communities: [] };
  const expected = structuredClone(actual);
  const living = expected.people.filter(p => p.alive);
  for (let day = 0; day < 5; day++) {
    for (let i = 0; i < living.length; i++) for (let j = i + 1; j < living.length; j++) {
      const a = living[i], b = living[j];
      if (distance(a, b) > 2.2) continue;
      const key = a.id + ':' + b.id;
      const link = expected.socialLinks[key] ||= { a: a.id, b: b.id, meetings: 0, trust: 0, sharedFood: 0 };
      link.meetings++;
      link.trust = clamp(link.trust + .045 * Math.min(a.sociability, b.sociability)
        + (a.foodReserve > 48 && b.foodReserve > 48 ? .018 : .004), 0, 1);
      if (a.state === 'conversando' && b.state === 'conversando') {
        a.socialNeed = Math.max(0, a.socialNeed - 3);
        b.socialNeed = Math.max(0, b.socialNeed - 3);
      }
    }
    updateSocialLinks(actual);
    assert.deepEqual(actual, expected);
    assert.deepEqual(Object.keys(actual.socialLinks), Object.keys(expected.socialLinks));
  }
});
