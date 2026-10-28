import test from 'node:test';
import assert from 'node:assert/strict';
import engine from '../src/simulation/engine.js';
import { getSocialLink } from '../src/simulation/society/communities.js';
import { killPerson, reproducePeople } from '../src/simulation/individuals/lifecycle.js';

function makeParents(world) {
  world.day = 29;
  for (const person of world.people) person.birthCooldown = 999;
  const kingdom = world.kingdoms[0];
  const adults = kingdom.memberIds.map(id => world.people.find(person => person.id === id && person.alive
    && person.role === 'resident')).filter(Boolean);
  const mother = adults.find(person => person.sex === 'F');
  const father = adults.find(person => person.sex === 'M');
  assert.ok(mother && father, 'fixture has adult residents of both sexes');
  Object.assign(mother, { ageDays: 24 * 365, energy: 80, hydration: 80, health: 100, foodReserve: 80, birthCooldown: 0 });
  Object.assign(father, { ageDays: 24 * 365, energy: 80, hydration: 80, health: 100, foodReserve: 80, birthCooldown: 0 });
  mother.x = kingdom.x;
  mother.y = kingdom.y;
  father.x = kingdom.x + 1;
  father.y = kingdom.y;
  getSocialLink(world, mother, father).trust = .9;
  return { kingdom, mother, father };
}

function configureHouseSlots(world, kingdom, availableSlots, excludeIds) {
  const homes = kingdom.homeIds.map(id => world.structures.find(structure => structure.id === id)).filter(Boolean);
  const residents = kingdom.memberIds.map(id => world.people.find(person => person.id === id && person.alive))
    .filter(person => person && !excludeIds.has(person.id));
  for (const person of world.people) if (person.kingdomId === kingdom.id) person.homeId = null;
  let occupantIndex = 0;
  for (const [index, home] of homes.entries()) {
    home.complete = true;
    home.destroyedDay = null;
    home.integrity = 1;
    home.capacity = index === 0 ? 1 + availableSlots : 1;
    const occupant = residents[occupantIndex++];
    home.residentIds = occupant ? [occupant.id] : [];
    if (occupant) occupant.homeId = home.id;
  }
  for (const shelter of world.structures.filter(structure => structure.type === 'abrigo')) {
    shelter.complete = false;
  }
  return homes[0];
}

test('a birth reserves one operational house vacancy and transfers the existing food provisions', () => {
  const world = engine.createWorld(42);
  const { kingdom, mother, father } = makeParents(world);
  const home = configureHouseSlots(world, kingdom, 1, new Set([mother.id, father.id]));
  const motherFood = mother.foodReserve;
  const fatherFood = father.foodReserve;
  const motherEnergy = mother.energy;
  const fatherEnergy = father.energy;
  const motherHydration = mother.hydration;
  const fatherHydration = father.hydration;
  const treasury = structuredClone(kingdom.treasury.stock);

  reproducePeople(world);

  const baby = world.people.find(person => person.alive && person.parents?.includes(mother.id));
  assert.ok(baby);
  assert.equal(baby.homeId, home.id);
  assert.ok(home.residentIds.includes(baby.id));
  assert.equal(home.residentIds.length, 2);
  const firstParent = mother.id < father.id ? mother : father;
  const secondParent = mother.id < father.id ? father : mother;
  assert.equal(firstParent.foodReserve, (firstParent === mother ? motherFood : fatherFood) - 7);
  assert.equal(secondParent.foodReserve, (secondParent === mother ? motherFood : fatherFood) - 5);
  assert.equal(firstParent.energy, (firstParent === mother ? motherEnergy : fatherEnergy) - 11 * .55);
  assert.equal(secondParent.energy, (secondParent === mother ? motherEnergy : fatherEnergy) - 8 * .55);
  assert.equal(mother.hydration, motherHydration - 2);
  assert.equal(father.hydration, fatherHydration - 2);
  assert.equal(mother.birthCooldown, 280);
  assert.equal(father.birthCooldown, 280);
  assert.equal(baby.foodReserve, 12);
  assert.deepEqual(kingdom.treasury.stock, treasury, 'birth does not create a second charge after the house was paid for');
  assert.equal(world.birthsByKind.people, 1);

  killPerson(world, baby, 'starvation');
  assert.ok(!home.residentIds.includes(baby.id), 'death releases the reserved home vacancy');
});

test('a completed community shelter can provide the birth residence when houses are unavailable', () => {
  const world = engine.createWorld(42);
  const { kingdom, mother, father } = makeParents(world);
  for (const home of world.structures.filter(structure => structure.type === 'casa')) home.complete = false;
  mother.kingdomId = null;
  father.kingdomId = null;
  mother.communityId = kingdom.communityId;
  father.communityId = kingdom.communityId;
  const shelter = {
    id: world.nextId++, type: 'abrigo', communityId: kingdom.communityId,
    x: kingdom.x + 2, y: kingdom.y, complete: true, integrity: 1, capacity: 13, residentIds: []
  };
  world.structures.push(shelter);

  reproducePeople(world);

  const baby = world.people.find(person => person.alive && person.parents?.includes(mother.id));
  assert.ok(baby);
  assert.equal(baby.kingdomId, null);
  assert.equal(baby.homeId, shelter.id);
  assert.deepEqual(shelter.residentIds, [baby.id]);
  assert.equal(baby.communityId, kingdom.communityId);
  assert.equal(father.birthCooldown, 280);
});

test('no birth occurs or consumes provisions when every residence is full or inactive', () => {
  const world = engine.createWorld(42);
  const { kingdom, mother, father } = makeParents(world);
  configureHouseSlots(world, kingdom, 0, new Set([mother.id, father.id]));
  const before = {
    people: world.people.length, births: world.births, motherFood: mother.foodReserve,
    fatherFood: father.foodReserve, motherEnergy: mother.energy, fatherEnergy: father.energy,
    motherCooldown: mother.birthCooldown, fatherCooldown: father.birthCooldown
  };

  reproducePeople(world);

  assert.equal(world.people.length, before.people);
  assert.equal(world.births, before.births);
  assert.equal(mother.foodReserve, before.motherFood);
  assert.equal(father.foodReserve, before.fatherFood);
  assert.equal(mother.energy, before.motherEnergy);
  assert.equal(father.energy, before.fatherEnergy);
  assert.equal(mother.birthCooldown, before.motherCooldown);
  assert.equal(father.birthCooldown, before.fatherCooldown);
});

test('loss of the last operational home pauses a birth once and reconstruction resumes it without duplicate charges', () => {
  const world = engine.createWorld(42);
  const { kingdom, mother, father } = makeParents(world);
  const home = configureHouseSlots(world, kingdom, 1, new Set([mother.id, father.id]));
  const before = {
    people: world.people.length, births: world.births,
    food: mother.foodReserve + father.foodReserve,
    cooldowns: [mother.birthCooldown, father.birthCooldown]
  };

  // Every alternative home is full. The only spare slot is in this destroyed building.
  home.destroyedDay = world.day;
  reproducePeople(world);

  assert.equal(world.people.length, before.people);
  assert.equal(world.births, before.births);
  assert.equal(mother.foodReserve + father.foodReserve, before.food);
  assert.deepEqual([mother.birthCooldown, father.birthCooldown], before.cooldowns);
  assert.equal(world.birthHousingGate['kingdom:' + kingdom.id], true);
  assert.equal(world.events.filter(event => event.text.startsWith('Nascimento adiado')).length, 1);
  assert.ok(world.chronicle.some(event => event.category === 'Reino'
    && event.text.startsWith('Nascimento adiado')), 'blocked housing is visible in the chronicle');

  reproducePeople(world); // repeated observer/entry must not duplicate warnings
  assert.equal(world.events.filter(event => event.text.startsWith('Nascimento adiado')).length, 1);

  home.destroyedDay = null;
  home.integrity = 1;
  reproducePeople(world);

  const babies = world.people.filter(person => person.alive && person.parents?.includes(mother.id));
  assert.equal(babies.length, 1);
  assert.equal(babies[0].homeId, home.id);
  assert.ok(home.residentIds.includes(babies[0].id));
  assert.equal(world.birthHousingGate, undefined, 'resolved gate does not leave persistent state residue');
  assert.equal(world.events.filter(event => event.text.startsWith('Nascimento retomado')).length, 1);
  assert.ok(world.chronicle.some(event => event.category === 'Reino'
    && event.text.startsWith('Nascimento retomado')), 'recovery is visible in the chronicle');
  assert.equal(mother.foodReserve + father.foodReserve, before.food - 12);
  assert.equal(mother.birthCooldown, 280);
  assert.equal(father.birthCooldown, 280);

  reproducePeople(world);
  assert.equal(world.people.filter(person => person.alive && person.parents?.includes(mother.id)).length, 1);
});
