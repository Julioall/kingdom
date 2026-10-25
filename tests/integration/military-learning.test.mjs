import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../../src/simulation/engine.js';
import { enlistSoldier } from '../../src/simulation/kingdoms/service.js';
import { militaryTrainingPairs, trainMilitaryPair, chooseMilitaryAction, learnMilitaryOutcome } from '../../src/simulation/kingdoms/military-learning.js';
import { updatePeople } from '../../src/simulation/individuals/actions.js';

function fixture() {
  const world = Sim.createWorld(42);
  const kingdom = world.kingdoms[0];
  const center = world.structures.find(s => s.id === kingdom.militaryCenterIds[0]);
  const soldiers = world.people.filter(p => p.kingdomId === kingdom.id && p.role === 'resident' && p.ageDays >= 18 * 365).slice(0, 6);
  for (const p of soldiers) {
    enlistSoldier(world, p, center);
    Object.assign(p, { energy: 95, health: 100, injury: 0, hydration: 90, foodReserve: 90,
      x: center.x, y: center.y, towerDutyId: null, towerMounted: false, campaignId: null });
  }
  world.people = soldiers;
  return { world, soldiers };
}

test('military training rotates a minority of healthy troops and causes no combat damage', () => {
  const { world, soldiers } = fixture();
  const pairs = militaryTrainingPairs(world);
  assert.equal(pairs.size, 2);
  const originalIds = [...pairs.keys()];
  for (const p of soldiers.filter(p => pairs.has(p.id))) {
    const health = p.health, injury = p.injury;
    assert.equal(trainMilitaryPair(world, p, pairs.get(p.id)), true);
    assert.equal(p.health, health);
    assert.equal(p.injury, injury);
    assert.ok(p.militaryTraining > 0);
    assert.equal(p.simulatedCombatDays, 1);
  }
  world.day = 10;
  assert.notDeepEqual([...militaryTrainingPairs(world).keys()], originalIds);
  for (const p of soldiers) p.campaignId = 1;
  assert.equal(militaryTrainingPairs(world).size, 0);
});

test('military decisions learn on a separate network and mask unavailable orders', () => {
  const { world, soldiers } = fixture();
  const p = soldiers[0], civilianUpdates = p.brain.updates;
  assert.equal(chooseMilitaryAction(world, p, { training: true }), 'train');
  learnMilitaryOutcome(p, .3);
  assert.equal(p.militaryBrain.updates, 1);
  assert.equal(p.brain.updates, civilianUpdates);
  assert.equal(chooseMilitaryAction(world, p, { campaign: true, training: true }), 'campaign');
  assert.equal(chooseMilitaryAction(world, p, { resupply: true, training: true }), 'return_garrison');
});

test('daily service executes and learns simulated training while keeping other troops on duty', () => {
  const { world, soldiers } = fixture();
  updatePeople(world);
  const training = soldiers.filter(p => p.brain.lastAction === 'train');
  assert.equal(training.length, 2);
  assert.ok(training.every(p => p.simulatedCombatDays === 1 && p.militaryBrain.updates === 1));
  assert.ok(soldiers.every(p => p.health === 100 && p.injury === 0));
  assert.ok(soldiers.filter(p => !training.includes(p)).every(p => ['guard', 'patrol'].includes(p.brain.lastAction)));
});
