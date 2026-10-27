import test from 'node:test';
import assert from 'node:assert/strict';
import engine from '../src/simulation/engine.js';
import { restPersonInHouse } from '../src/simulation/kingdoms/service.js';
import { structureInteractionPoint } from '../src/simulation/physics/hitboxes.js';

function fixture() {
  const world = engine.createWorld(42);
  const person = world.people.find(item => item.id === 87);
  const home = world.structures.find(item => item.id === person.homeId);
  Object.assign(person, { x: 62, y: 26, energy: 0, hydration: 80, foodReserve: 80,
    health: 90, injury: 0, campaignId: null, militaryRestTargetId: null, restingStructureId: null });
  world.people = [person];
  world.peopleSpatialIndex = null;
  world.day = 1;
  return { world, person, home, entry: structureInteractionPoint(home) };
}

test('a soldier diagonal to a blocked house entry approaches the actual rest radius', () => {
  const { world, person, home, entry } = fixture();
  assert.deepEqual(entry, { x: 61, y: 25 });
  assert.equal(restPersonInHouse(world, person), false);
  assert.ok(Math.hypot(person.x - entry.x, person.y - entry.y) <= 1.25,
    'the route must not treat the diagonal position as already within the narrower rest radius');
  assert.equal(restPersonInHouse(world, person), true);
  assert.equal(person.restingStructureId, home.id);
});

test('a person with no route to rest recovers outdoors without entering the house', () => {
  for (const role of ['soldier', 'resident']) {
    const { world, person } = fixture();
    person.role = role;
    person.homeRestTargetId = null;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dx || dy) world.tiles[(person.y + dy) * world.width + person.x + dx].terrain = 'rock';
    }

    engine.modules.SocietyExperiment.updatePeople(world);

    assert.equal(person.restingStructureId, null);
    assert.equal(role === 'soldier' ? person.militaryRestTargetId : person.homeRestTargetId, null);
    assert.deepEqual({ x: person.x, y: person.y }, { x: 62, y: 26 });
    assert.ok(person.energy > 0, 'a blocked route must not trap the exhausted person at zero energy');
    assert.ok(person.foodReserve <= 80, 'outdoor rest must not create a ration');
    assert.equal(person.restingOutdoors, true);
  }
});
