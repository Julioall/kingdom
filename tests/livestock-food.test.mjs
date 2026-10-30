import test from 'node:test';
import assert from 'node:assert/strict';
import { attemptHumanHunt, huntForFood, nearestEmergencyHerdSheep } from '../src/simulation/individuals/actions.js';
import { feedCommunalHerds } from '../src/simulation/ecology/animals.js';
import { DOMESTIC_SHEEP_DAILY_FEED } from '../src/config/ecosystem.js';
import engine from '../src/simulation/engine.js';

function herdFixture(adultCount = 3) {
  const community = { id: 1, name: 'Valedouro', stores: { food: 0, meat: 0 }, memberIds: [1], history: [] };
  const person = { id: 1, alive: true, name: 'Ayo', communityId: community.id, ageDays: 25 * 365,
    x: 10, y: 10, foodReserve: 8, carriedMeat: 0, energy: 80, hydration: 80, injury: 0,
    physicalStrength: 1, skills: { hunt: 1 } };
  const sheep = Array.from({ length: adultCount }, (_, index) => ({ id: index + 11, speciesId: 'sheep', alive: true,
    x: 10.3 + index * .2, y: 10, ageDays: 600, massKg: 48, herdCommunityId: community.id, beingLedBy: null }));
  person.perception = { animals: sheep.map(animal => ({ id: animal.id, speciesId: animal.speciesId, visible: true,
    distance: Math.hypot(person.x - animal.x, person.y - animal.y) })) };
  const shelter = { id: 50, complete: true, type: 'abrigo', communityId: community.id, x: 10, y: 10,
    integrity: 100, health: 100, meatStored: 0 };
  const world = { day: 15, people: [person], animals: sheep, structures: [shelter], communities: [community], tiles: [],
    events: [], chronicle: [], rngState: 7, deaths: 0, deathsByCause: { harvest: 0 },
    harvests: { hunting: 0, livestock: 0, livestockMeat: 0 } };
  return { world, community, person, sheep, shelter };
}

test('emergency herd harvest creates carried meat from a sheep and preserves two mature breeders', () => {
  const { world, community, person, sheep } = herdFixture();

  assert.equal(nearestEmergencyHerdSheep(world, person, community), sheep[0]);
  assert.equal(huntForFood(world, person, community), true);

  assert.equal(sheep[0].alive, false);
  assert.deepEqual(sheep.slice(1).map(animal => animal.alive), [true, true]);
  assert.equal(person.carriedMeat, 23);
  assert.equal(world.deaths, 1);
  assert.equal(world.deathsByCause.harvest, 1);
  assert.equal(world.harvests.livestock, 1);
  assert.ok(Math.abs(world.harvests.livestockMeat - person.carriedMeat) < 1e-9);
  assert.equal(world.harvests.hunting, 0);
  assert.match(world.events[0].text, /abateu uma ovelha adulta excedente/);
});

test('emergency harvest stops when only the two mature breeding sheep remain', () => {
  const { world, community, person, sheep } = herdFixture(2);

  assert.equal(nearestEmergencyHerdSheep(world, person, community), null);
  assert.equal(attemptHumanHunt(world, person, sheep[0], community), false);
  assert.deepEqual(sheep.map(animal => animal.alive), [true, true]);
  assert.equal(world.deaths, 0);
  assert.equal(person.carriedMeat, 0);
});

test('a nearly full meat yield cannot create cargo while leaving the sheep alive', () => {
  const { world, community, person, sheep } = herdFixture();
  person.carriedMeat = .01;
  sheep[0].massKg = 67;

  assert.equal(attemptHumanHunt(world, person, sheep[0], community), false);
  assert.equal(person.carriedMeat, .01, 'insufficient capacity leaves existing cargo untouched');
  assert.equal(sheep[0].alive, true);
  assert.equal(world.deaths, 0);
  assert.equal(world.harvests.livestock, 0);
  assert.equal(person.energy, 80);
  assert.equal(person.hydration, 80);
  assert.equal(world.rngState, 7);
});

test('a maximum yield is collected when the whole load fits', () => {
  const { world, community, person, sheep } = herdFixture();
  sheep[0].massKg = 67;

  assert.equal(attemptHumanHunt(world, person, sheep[0], community), true);
  assert.equal(person.carriedMeat, 28);
  assert.equal(sheep[0].alive, false);
  assert.equal(world.harvests.livestockMeat, 28);
});

test('stored food and shelter meat cover the daily need before a herd is harvested', () => {
  const { world, community, person, sheep, shelter } = herdFixture();
  community.stores.food = 1;

  assert.equal(nearestEmergencyHerdSheep(world, person, community), null);

  community.stores.food = 0;
  community.stores.meat = .1;
  shelter.meatStored = .1;
  assert.equal(nearestEmergencyHerdSheep(world, person, community), null,
    '0.1 physical meat units cover the one-day emergency threshold');
  community.stores.meat = .08;
  shelter.meatStored = .08;
  assert.equal(nearestEmergencyHerdSheep(world, person, community), sheep[0]);

  community.stores.meat = 0;
  shelter.meatStored = .32;
  assert.equal(nearestEmergencyHerdSheep(world, person, community), sheep[0]);
  assert.equal(sheep.every(animal => animal.alive), true);
});

test('a lamb does not count as an adult breeder or emergency meat target', () => {
  const { world, community, person, sheep } = herdFixture(2);
  sheep.push({ id: 99, speciesId: 'sheep', alive: true, x: 10.4, y: 10, ageDays: 30,
    massKg: 12, herdCommunityId: community.id, beingLedBy: null });

  assert.equal(nearestEmergencyHerdSheep(world, person, community), null);
  assert.equal(sheep.every(animal => animal.alive), true);
});

test('a hungry resident cannot harvest a herd animal outside local perception', () => {
  const { world, community, person, sheep } = herdFixture();
  person.perception.animals = [];

  assert.equal(nearestEmergencyHerdSheep(world, person, community), null);
  assert.equal(attemptHumanHunt(world, person, sheep[0], community), false);
  assert.equal(sheep.every(animal => animal.alive), true);
});

test('communal herd feed is debited from stores and recorded as a livestock input', () => {
  const { world, community, sheep } = herdFixture();
  world.ecologyFlows = { livestockFeedConsumed: 0 };
  community.stores.feed = sheep.length * DOMESTIC_SHEEP_DAILY_FEED;

  const before = community.stores.feed;
  const consumed = feedCommunalHerds(world);

  assert.ok(Math.abs(consumed - before) < 1e-9);
  assert.ok(Math.abs(community.stores.feed) < 1e-9);
  assert.ok(Math.abs(world.ecologyFlows.livestockFeedConsumed - consumed) < 1e-9);
  assert.ok(sheep.every(animal => Math.abs(animal.lastFeedAmount - DOMESTIC_SHEEP_DAILY_FEED) < 1e-9));
});

test('resident under food pressure delivers carried meat to a nearby shelter', () => {
  const world = engine.createWorld(42);
  const community = world.communities[0];
  const person = world.people.find(item => item.alive && item.communityId === community.id
    && item.role !== 'soldier' && item.ageDays >= 12 * 365);
  const shelter = { id: world.nextId++, type: 'abrigo', complete: true, destroyedDay: null,
    communityId: community.id, x: person.x, y: person.y, integrity: 100, health: 100, meatStored: 0 };
  world.structures.push(shelter);
  world.day = 1;
  community.stores.food = 0;
  community.stores.meat = 0;
  person.foodReserve = 8;
  person.carriedMeat = 5.2;
  person.carriedFood = 0;
  person.carriedFruit = 0;
  world.people = [person];
  community.memberIds = [person.id];

  engine.modules.SocietyExperiment.updatePeople(world);

  assert.ok(Math.abs(person.carriedMeat) < 1e-9);
  assert.ok(Math.abs(community.stores.meat - 5.2) < 1e-9);
  assert.ok(Math.abs(shelter.meatStored - 5.2) < 1e-9);
  assert.equal(person.state, 'carne armazenada no abrigo');
});

test('a residual fraction of meat can be delivered before a full-yield hunt', () => {
  const world = engine.createWorld(42);
  const community = world.communities[0];
  const person = world.people.find(item => item.alive && item.communityId === community.id
    && item.role !== 'soldier' && item.ageDays >= 12 * 365);
  const shelter = { id: world.nextId++, type: 'abrigo', complete: true, destroyedDay: null,
    communityId: community.id, x: person.x, y: person.y, integrity: 100, health: 100, meatStored: 0 };
  world.structures.push(shelter);
  world.day = 1;
  community.stores.meat = 0;
  person.foodReserve = 80;
  person.hydration = 80;
  person.energy = 80;
  person.carriedMeat = .01;
  person.carriedFood = 0;
  person.carriedFruit = 0;
  world.people = [person];
  community.memberIds = [person.id];

  engine.modules.SocietyExperiment.updatePeople(world);

  assert.equal(person.carriedMeat, 0);
  assert.equal(community.stores.meat, .01);
  assert.equal(shelter.meatStored, .01);
});

test('emergency herd decision ignores unregistered shelter subrecords and compares units correctly', () => {
  const { world, community, person, sheep, shelter } = herdFixture();
  shelter.meatStored = 100;
  assert.equal(nearestEmergencyHerdSheep(world, person, community), sheep[0],
    'shelter metadata is not edible stock without a community balance');
  shelter.meatStored = 0;
  community.stores.food = 1;
  assert.equal(nearestEmergencyHerdSheep(world, person, community), null,
    'one food unit covers one person-day, so the emergency herd stays protected');
});
