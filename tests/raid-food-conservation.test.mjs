import test from 'node:test';
import assert from 'node:assert/strict';
import { attemptRaid } from '../src/simulation/individuals/actions.js';

test('raid cannot remove food that does not fit in the raider load', () => {
  const attacker = { id: 1, name: 'A', history: [] };
  const target = { id: 2, name: 'B', stores: { food: 100, meat: 0 }, history: [] };
  const shelter = { id: 3, type: 'abrigo', complete: true, communityId: 2, x: 1, y: 1, fruitStored: 100 };
  const person = { id: 4, name: 'P', alive: true, communityId: 1, x: 1, y: 1, energy: 100, hydration: 100,
    physicalStrength: 10, skills: { diplomacy: 0 }, carriedFruit: 24, carriedMeat: 28 };
  const world = { day: 1, people: [person], structures: [shelter], communityRelations: { '1:2':
    { a: 1, b: 2, tension: 1, trust: 0, conflicts: 0 } }, raidAttempts: 0, successfulRaids: 0,
    conflicts: 0, events: [], chronicle: [] };
  assert.equal(attemptRaid(world, person, attacker, { community: target, shelter }), false);
  assert.equal(target.stores.food, 100);
  assert.equal(person.carriedFruit, 24);
  assert.equal(person.carriedMeat, 28);
});

test('raid debits only food and meat fitting their separate remaining capacities', () => {
  const attacker = { id: 1, name: 'A', history: [] };
  const target = { id: 2, name: 'B', stores: { food: 100, meat: 10 }, history: [] };
  const shelter = { id: 3, type: 'abrigo', complete: true, communityId: 2, x: 1, y: 1, fruitStored: 100, meatStored: 10 };
  const person = { id: 4, name: 'P', alive: true, communityId: 1, x: 1, y: 1, energy: 100, hydration: 100,
    physicalStrength: 10, skills: { diplomacy: 0 }, carriedFruit: 22, carriedMeat: 27 };
  const ally = { id: 5, name: 'R', alive: true, communityId: 1, x: 1, y: 1, energy: 100, hydration: 100,
    physicalStrength: 10, skills: { diplomacy: 0 } };
  const world = { day: 1, people: [person, ally], structures: [shelter], communityRelations: { '1:2':
    { a: 1, b: 2, tension: 1, trust: 0, conflicts: 0 } }, raidAttempts: 0, successfulRaids: 0,
    conflicts: 0, events: [], chronicle: [] };
  assert.equal(attemptRaid(world, person, attacker, { community: target, shelter }), true);
  assert.equal(target.stores.food, 98);
  assert.equal(target.stores.meat, 9);
  assert.equal(person.carriedFruit, 24);
  assert.equal(person.carriedMeat, 28);
  assert.equal(shelter.fruitStored, 98);
  assert.equal(shelter.meatStored, 9);
});
