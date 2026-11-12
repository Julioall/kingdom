import test from 'node:test';
import assert from 'node:assert/strict';
import {
  consumePersonEnergy, PERSON_ENERGY_COST_SCALE, CAMPAIGN_SOLDIER_ENDURANCE_FACTOR
} from '../src/simulation/individuals/energy.js';
import { initializeCombatResources, updateCombatResources,
  spendAttackStamina } from '../src/simulation/kingdoms/combat-resources.js';

test('campaign infantry expends 38% less movement and daily energy than civilians', () => {
  const civilian = { role: 'citizen', energy: 100 };
  const guard = { role: 'soldier', campaignId: null, energy: 100 };
  const marching = { role: 'soldier', campaignId: 123, energy: 100 };
  const baseCost = consumePersonEnergy(civilian, 30);
  const guardCost = consumePersonEnergy(guard, 30);
  const fieldCost = consumePersonEnergy(marching, 30);
  assert.ok(Math.abs(baseCost - 30 * PERSON_ENERGY_COST_SCALE) < 1e-10);
  assert.equal(guardCost, baseCost, 'peacetime training and civilians stay unchanged');
  assert.ok(Math.abs(fieldCost / baseCost - CAMPAIGN_SOLDIER_ENDURANCE_FACTOR) < 1e-10);
  assert.ok(marching.energy > guard.energy);
});

test('soldiers keep the standard 0–100 energy bounds even with added endurance', () => {
  const soldier = { role: 'soldier', campaignId: 9, energy: 100 };
  assert.equal(consumePersonEnergy(soldier, 0), 0);
  assert.equal(soldier.energy, 100);
  consumePersonEnergy(soldier, 9999);
  assert.equal(soldier.energy, 0);
});

test('battlefield veterans recover combat stamina faster without free attacks', () => {
  const veteran = {
    id: 7, alive: true, role: 'soldier', campaignId: 123, militaryClass: 'guerreiro',
    stamina: 200, maxStamina: 400, lastMilitaryAttackDay: 9
  };
  const guard = { ...veteran, id: 8, campaignId: null };
  updateCombatResources({ people: [veteran, guard] }, 10);
  assert.equal(veteran.stamina, 206);
  assert.equal(guard.stamina, 202);
  veteran.lastMilitaryAttackDay = 1;
  updateCombatResources({ people: [veteran] }, 11);
  assert.equal(veteran.stamina, 216);
  veteran.brain = { lastAction: 'rest' };
  updateCombatResources({ people: [veteran] }, 12);
  assert.equal(veteran.stamina, 234);
  assert.equal(spendAttackStamina(veteran, 13), true);
  assert.equal(veteran.stamina, 220, 'attack costs remain unchanged');
  veteran.stamina = 399;
  updateCombatResources({ people: [veteran] }, 14);
  assert.equal(veteran.stamina, 400, 'stamina cap remains unchanged');
});
