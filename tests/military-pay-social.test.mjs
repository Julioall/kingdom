import test from 'node:test';
import assert from 'node:assert/strict';
import { payMilitarySalaries } from '../src/simulation/kingdoms/service.js';

function fixture() {
  const soldier = {
    id: 7, alive: true, role: 'soldier', kingdomId: 1, campaignId: 9,
    nextMilitaryPayDay: 10, militaryPayArrears: 0,
    militaryWallet: { stock: { gold: 0 } }, x: 12, y: 18
  };
  const kingdom = { id: 1, treasury: { stock: { gold: 0 } } };
  return { seed: 42, day: 10, people: [soldier], kingdoms: [kingdom], communities: [] };
}

test('a soldier remembers delayed and recovered pay as separate evidence', () => {
  const world = fixture();
  const soldier = world.people[0];

  payMilitarySalaries(world, 10);
  const delay = world.socialEvidence.facts.find(fact => fact.type === 'military_pay_delayed');
  assert.ok(delay);
  assert.equal(delay.outcome.amount, 15);
  assert.deepEqual(soldier.socialMemories.map(memory => memory.rootEventId), [delay.eventId]);
  assert.equal(soldier.socialBeliefs[0].evaluation, -1);
  const certaintyBeforeRecovery = soldier.socialBeliefs[0].certainty;

  world.day = 11;
  world.kingdoms[0].treasury.stock.gold = 15;
  payMilitarySalaries(world, 11);

  const recovery = world.socialEvidence.facts.find(fact => fact.type === 'military_pay_recovered');
  const belief = soldier.socialBeliefs[0];
  assert.ok(recovery);
  assert.equal(recovery.outcome.amount, 15);
  assert.equal(soldier.militaryPayArrears, 0);
  assert.deepEqual(belief.opposingEventIds, [delay.eventId]);
  assert.deepEqual(belief.supportingEventIds, [recovery.eventId]);
  assert.equal(belief.evaluation, 0, 'recovery revises the interpretation without erasing the missed-pay event');
  assert.equal(soldier.socialMemories.length, 2);
  assert.ok(belief.certainty > certaintyBeforeRecovery, 'independent recovery evidence raises certainty with saturation');
});
