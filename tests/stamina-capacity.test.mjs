import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeCombatResources, updateCombatResources, spendAttackStamina } from '../src/simulation/kingdoms/combat-resources.js';

test('soldiers start with 400 stamina, keep attack costs and recover to the new cap', () => {
  const person = { alive: true, role: 'soldier', militaryClass: 'arqueiro' };
  initializeCombatResources(person);
  assert.equal(person.stamina, 400);
  assert.equal(person.maxStamina, 400);
  assert.equal(spendAttackStamina(person, 1), true);
  assert.equal(person.stamina, 392);
  updateCombatResources({ people: [person] }, 10);
  assert.equal(person.stamina, 398);
  updateCombatResources({ people: [person] }, 11);
  assert.equal(person.stamina, 400);
  updateCombatResources({ people: [person] }, 12);
  assert.equal(person.stamina, 400);
});

test('existing stamina migrates to 400 once while preserving its percentage', () => {
  const person = { maxStamina: 100, stamina: 40 };
  initializeCombatResources(person);
  assert.equal(person.maxStamina, 400);
  assert.equal(person.stamina, 160);
  initializeCombatResources(person);
  assert.equal(person.stamina, 160);
});

test('existing 200 stamina and 100 mana migrate to 400 and 200 once', () => {
  const soldier = { maxStamina: 200, stamina: 150 };
  const monk = { militaryClass: 'monge', maxStamina: 200, stamina: 150, maxMana: 100, mana: 45 };
  initializeCombatResources(soldier);
  initializeCombatResources(monk);
  assert.equal(soldier.stamina, 300);
  assert.equal(soldier.maxStamina, 400);
  assert.equal(monk.mana, 90);
  assert.equal(monk.maxMana, 200);
  initializeCombatResources(monk);
  assert.equal(monk.mana, 90);
});

test('monk mana regenerates ten times faster and respects the doubled maximum', () => {
  const monk = { alive: true, role: 'soldier', militaryClass: 'monge', mana: 100, maxMana: 200 };
  updateCombatResources({ people: [monk] }, 10);
  assert.equal(monk.mana, 110);
  monk.brain = { lastAction: 'rest' };
  updateCombatResources({ people: [monk] }, 11);
  assert.equal(monk.mana, 140);
  monk.mana = 199;
  monk.brain = null;
  updateCombatResources({ people: [monk] }, 12);
  assert.equal(monk.mana, 200);
});
