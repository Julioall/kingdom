import test from 'node:test';
import assert from 'node:assert/strict';
import { DAILY_FOOD_NEED, FOOD_DAYS_PER_UNIT, MEAT_NUTRITIONAL_VALUE } from '../src/config/ecosystem.js';
import { addHarvestedFood, communityFoodStock } from '../src/simulation/economy/inventories.js';
import {
  communityFoodBufferDays, communityFoodBufferTarget, dailyFoodNeedForMembers, DEPENDENT_DAILY_FOOD_NEED, foodUnitsPerDay
} from '../src/simulation/economy/food-policy.js';
import { PEACETIME_SOLDIER_FOOD_NEED } from '../src/simulation/kingdoms/service.js';

test('one stored food unit equals one person-day and personal reserves are measured in days', () => {
  const person = { x: 0, y: 0, foodReserve: 0, carriedFood: 0, energy: 50 };
  const result = addHarvestedFood(person, null, 1);

  assert.equal(FOOD_DAYS_PER_UNIT, 1);
  assert.equal(DAILY_FOOD_NEED, 1);
  assert.equal(result.eaten, 1);
  assert.equal(person.foodReserve, 1);
  assert.equal(communityFoodBufferDays(1_000, DAILY_FOOD_NEED), 1_000);
});

test('adults, dependents, and peacetime soldiers all consume one person-day per day', () => {
  const members = [
    { id: 1, ageDays: 30 * 365, role: 'pawn' },
    { id: 2, ageDays: 5 * 365, role: 'pawn' },
    { id: 3, ageDays: 30 * 365, role: 'soldier' }
  ];

  assert.equal(DEPENDENT_DAILY_FOOD_NEED, 1);
  assert.equal(PEACETIME_SOLDIER_FOOD_NEED, 1);
  assert.equal(dailyFoodNeedForMembers(members).dailyFoodNeed, 3);
  assert.equal(foodUnitsPerDay(3), 3);
  assert.equal(communityFoodBufferTarget(50, 180), 9_000);
});

test('meat remains a physical stock with an explicit adult-day nutrition conversion', () => {
  assert.equal(MEAT_NUTRITIONAL_VALUE, 2.5);
  assert.equal(communityFoodStock({ stores: { food: 1, meat: 1 } }), 3.5);
});
