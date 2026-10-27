import test from 'node:test';
import assert from 'node:assert/strict';
import { FOOD_DAYS_PER_UNIT } from '../src/config/ecosystem.js';
import { addHarvestedFood } from '../src/simulation/economy/inventories.js';
import { attemptHumanFishing } from '../src/simulation/individuals/actions.js';

test('a harvest cannot silently discard surplus when a personal food load is full', () => {
  const person = { x: 0, y: 0, foodReserve: 90, carriedFood: 24, energy: 50 };
  const before = { foodReserve: person.foodReserve, carriedFood: person.carriedFood };
  const result = addHarvestedFood(person, null, 4);
  const accepted = (person.foodReserve - before.foodReserve) / FOOD_DAYS_PER_UNIT + person.carriedFood - before.carriedFood;
  assert.equal(result.eaten + result.surplus, accepted, 'reported yield must equal the food actually received');
});

test('a fish remains alive when the entire catch cannot be received', () => {
  const person = { x: 0, y: 0, foodReserve: 90, carriedFood: 23, energy: 50 };
  const fish = { alive: true, massKg: 1 };
  const world = { day: 1, rngState: 7, deaths: 0, deathsByCause: { harvest: 0 } };
  assert.equal(attemptHumanFishing(world, person, fish, null), false);
  assert.equal(fish.alive, true);
  assert.equal(world.deaths, 0);
  assert.equal(world.rngState, 7);
  assert.equal(person.carriedFood, 23);
  assert.equal(person.foodReserve, 90);
});

test('a harvest fitting personal and cargo capacity is fully accounted for', () => {
  const person = { x: 0, y: 0, foodReserve: 89, carriedFood: 21, energy: 50 };
  const result = addHarvestedFood(person, null, 4);
  assert.ok(Math.abs(result.eaten - 1) < 1e-9);
  assert.ok(Math.abs(result.surplus - 3) < 1e-9);
  assert.ok(Math.abs(person.foodReserve - 90) < 1e-9);
  assert.ok(Math.abs(person.carriedFood - 24) < 1e-9);
});

test('a nearby valid community receives surplus even when the personal load is full', () => {
  const person = { x: 0, y: 0, foodReserve: 90, carriedFood: 24, energy: 50 };
  const community = { x: 0, y: 0, stores: { food: 2 } };
  const result = addHarvestedFood(person, community, 4);
  assert.equal(result.eaten, 0);
  assert.equal(result.surplus, 4);
  assert.equal(community.stores.food, 6);
  assert.equal(person.carriedFood, 24);
});
