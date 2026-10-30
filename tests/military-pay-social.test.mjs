import test from 'node:test';
import assert from 'node:assert/strict';
import { payMilitarySalaries, resolveMilitaryServiceEvaluation } from '../src/simulation/kingdoms/service.js';
import { renderSocialInspectorSections } from '../src/ui/social-inspector.js';

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
  assert.equal(delay.outcome.amount, 1);
  assert.deepEqual(soldier.socialMemories.map(memory => memory.rootEventId), [delay.eventId]);
  assert.equal(soldier.socialBeliefs[0].evaluation, -1);
  const certaintyBeforeRecovery = soldier.socialBeliefs[0].certainty;

  world.day = 11;
  world.kingdoms[0].treasury.stock.gold = 1;
  payMilitarySalaries(world, 11);

  const recovery = world.socialEvidence.facts.find(fact => fact.type === 'military_pay_recovered');
  const belief = soldier.socialBeliefs[0];
  assert.ok(recovery);
  assert.equal(recovery.outcome.amount, 1);
  assert.equal(soldier.militaryPayArrears, 0);
  assert.deepEqual(belief.opposingEventIds, [delay.eventId]);
  assert.deepEqual(belief.supportingEventIds, [recovery.eventId]);
  assert.equal(belief.evaluation, 0, 'recovery revises the interpretation without erasing the missed-pay event');
  assert.equal(soldier.socialMemories.length, 2);
  assert.ok(belief.certainty > certaintyBeforeRecovery, 'independent recovery evidence raises certainty with saturation');
});

test('verified pay history drives a persistent service review without charging the treasury twice', () => {
  const world = fixture();
  const soldier = world.people[0];
  payMilitarySalaries(world, 10);
  const delay = world.socialEvidence.facts.find(fact => fact.type === 'military_pay_delayed');
  const plan = soldier.socialIntentions.find(item => item.type === 'evaluate_service');
  assert.ok(plan);
  assert.equal(plan.status, 'active');
  assert.equal(plan.progress, 0);
  assert.deepEqual(plan.evidenceIds, [delay.eventId]);
  assert.equal(world.kingdoms[0].treasury.stock.gold, 0);
  assert.equal(soldier.militaryPayArrearsCopper, 100);

  resolveMilitaryServiceEvaluation(world, soldier);
  assert.equal(soldier.socialIntentions[0].progress, 1);
  assert.equal(world.kingdoms[0].treasury.stock.gold, 0);
  world.day = 11;
  world.kingdoms[0].treasury.stock.gold = 1;
  payMilitarySalaries(world, 11);
  assert.equal(world.kingdoms[0].treasury.stock.gold, 0);
  assert.equal(soldier.militaryWallet.stock.gold, 1);

  const result = resolveMilitaryServiceEvaluation(world, soldier);
  assert.equal(result.plan.status, 'completed');
  assert.equal(result.plan.terminationReason, 'remuneration_evaluated');
  assert.equal(result.evaluation.type, 'military_service_evaluated');
  assert.equal(result.evaluation.outcome.status, 'paid_to_date');
  assert.equal(result.evaluation.outcome.outstandingArrears, 0);
  assert.deepEqual(result.evaluation.outcome.reviewedPaymentEventIds, [delay.eventId,
    world.socialEvidence.facts.find(fact => fact.type === 'military_pay_recovered').eventId]);
  assert.match(renderSocialInspectorSections(soldier, world).memoryRows, /avaliação do serviço militar.*soldo em dia/);
  assert.equal(resolveMilitaryServiceEvaluation(world, soldier), null);
  assert.equal(world.socialEvidence.facts.filter(fact => fact.type === 'military_service_evaluated').length, 1);
});
