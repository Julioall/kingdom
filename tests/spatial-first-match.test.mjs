import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersonSpatialIndex, firstPersonNear, peopleNear }
  from '../src/simulation/individuals/spatial-index.js';

function seededRandom(seed) {
  let state = seed;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

test('first-match keeps original population order even when buckets are visited out of order', () => {
  const people = [
    { id: 1, x: 17, y: 8, alive: true, restingStructureId: null },
    { id: 2, x: 9, y: 8, alive: true, restingStructureId: null },
    { id: 3, x: 1, y: 8, alive: true, restingStructureId: null }
  ];
  const index = createPersonSpatialIndex(people, 8);
  assert.equal(index.findFirst(8, 8, 16, person => person.alive), people[0]);
  assert.deepEqual(index.query(8, 8, 16), people);
  people[0].x = -27;
  index.move(people[0]);
  assert.equal(index.findFirst(8, 8, 16, person => person.alive), people[1]);
  people[1].alive = false;
  assert.equal(index.findFirst(8, 8, 16, person => person.alive), people[2]);
  assert.equal(index.findFirst(8, 8, 0, person => person.alive), undefined);
});

test('allocation-free first match is exactly equivalent to sorted query across movements and predicates', () => {
  const rand = seededRandom(121003);
  const people = Array.from({ length: 1700 }, (_, id) => ({
    id, alive: id % 17 !== 0,
    x: Math.floor(rand() * 160) - 30 + (rand() - .5) / 4,
    y: Math.floor(rand() * 140) - 40 + (rand() - .5) / 4,
    restingStructureId: id % 11 ? null : id + 1
  }));
  const index = createPersonSpatialIndex(people);
  const world = { people, peopleSpatialIndex: index };
  const radii = [0, .25, 1, 7, 8, 21];
  for (let step = 0; step < 900; step++) {
    if (step % 3 === 0) {
      const who = people[Math.floor(rand() * people.length)];
      who.x = Math.floor(rand() * 160) - 30;
      who.y = Math.floor(rand() * 140) - 40;
      index.move(who);
    }
    if (step % 13 === 0) people[Math.floor(rand() * people.length)].alive = false;
    const x = Math.floor(rand() * 160) - 30;
    const y = Math.floor(rand() * 140) - 40;
    const radius = radii[Math.floor(rand() * radii.length)];
    const exclude = Math.floor(rand() * people.length);
    const predicate = person => person.id !== exclude && person.alive
      && person.restingStructureId == null && person.id % 3 !== 2;
    const expected = index.query(x, y, radius).find(predicate);
    assert.equal(index.findFirst(x, y, radius, predicate), expected, 'query ' + step);
    assert.equal(firstPersonNear(world, x, y, radius, predicate), expected, 'world ' + step);
  }
});

test('fallback supports standalone worlds and foreign/old spatial indexes', () => {
  const people = [{ id: 2, alive: true }, { id: 4, alive: true }];
  const plain = { people };
  assert.equal(firstPersonNear(plain, 0, 0, 1, person => person.id === 4), people[1]);
  assert.equal(firstPersonNear({ people, peopleSpatialIndex: {
    query() { return [people[1], people[0]]; }
  } }, 0, 0, 1, () => true), people[1]);
  assert.equal(firstPersonNear(plain, 0, 0, 1, () => false), undefined);
  assert.deepEqual(peopleNear(plain, 0, 0, 1), people);
});

test('dead or sleeping occupants are not returned by a movement occupancy predicate', () => {
  const people = [
    { id: 1, x: 9, y: 9, alive: false },
    { id: 2, x: 9, y: 9, alive: true, restingStructureId: 15 },
    { id: 3, x: 9, y: 9, alive: true, restingStructureId: null }
  ];
  const world = { people, peopleSpatialIndex: createPersonSpatialIndex(people) };
  const predicate = person => person.alive && person.restingStructureId == null;
  assert.equal(firstPersonNear(world, 9, 9, 1, predicate), people[2]);
});
