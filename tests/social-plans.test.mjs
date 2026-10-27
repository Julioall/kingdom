import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acceptSocialCommitment, advanceSocialCommitmentDeadlines, advanceSocialIntention, defineSocialBelief,
  abandonSocialIntentionsForPerson, defineSocialIntention, fulfillSocialCommitment, getSocialCommitment,
  maintainSocialIntentions, proposeSocialCommitment, recordSocialFact, SOCIAL_FACT_LIMIT,
  rememberSocialFact, rejectSocialCommitment
} from '../src/simulation/society/social-evidence.js';
import { enlistSoldier } from '../src/simulation/kingdoms/service.js';

function world() {
  return {
    seed: 7401, day: 10, people: [
      { id: 1, alive: true, foodReserve: 30, hydration: 60, health: 90, energy: 65, socialMemories: [], socialIntentions: [] },
      { id: 2, alive: true, foodReserve: 90, hydration: 60, health: 90, energy: 65, socialMemories: [], socialIntentions: [] }
    ], communities: [], kingdoms: [], structures: [], animals: [], settlements: []
  };
}

function propose(worldState, suffix = 'aid', quantity = 2.5) {
  return proposeSocialCommitment(worldState, {
    idempotencyKey: suffix, proposedBy: 1, parties: [1, 2], object: 'food', quantity,
    dueDay: worldState.day + 2
  });
}

function delivery(worldState, key, amount, commitmentId) {
  const fact = recordSocialFact(worldState, {
    idempotencyKey: key, type: 'food_aid_request_resolved', participantIds: [1, 2], witnessIds: [1, 2],
    outcome: { resource: 'food', result: 'accepted', amount, commitmentId }
  });
  rememberSocialFact(worldState, 1, fact.eventId, { source: 'direct' });
  rememberSocialFact(worldState, 2, fact.eventId, { source: 'direct' });
  return fact;
}

test('promise has no economic effect; only the other party can accept it and delivery needs shared evidence', () => {
  const state = world();
  state.communities.push({ id: 3, stores: { food: 7 } });
  const before = state.communities[0].stores.food;
  const commitment = propose(state);
  assert.equal(commitment.status, 'proposed');
  assert.equal(state.communities[0].stores.food, before);
  assert.throws(() => acceptSocialCommitment(state, 1, commitment.commitmentId), /outra parte/);
  acceptSocialCommitment(state, 2, commitment.commitmentId);
  assert.equal(getSocialCommitment(state, commitment.commitmentId).status, 'accepted');

  const unshared = recordSocialFact(state, {
    idempotencyKey: 'unshared-delivery', type: 'food_aid_request_resolved', participantIds: [1, 2], witnessIds: [1, 2],
    outcome: { resource: 'food', result: 'accepted', amount: 2.5, commitmentId: commitment.commitmentId }
  });
  assert.throws(() => fulfillSocialCommitment(state, commitment.commitmentId, unshared.eventId), /conhecer/);
  const unrelated = recordSocialFact(state, {
    idempotencyKey: 'unrelated-delivery', type: 'food_aid_request_resolved', participantIds: [1, 2], witnessIds: [1, 2],
    outcome: { resource: 'food', result: 'accepted', amount: 2.5, commitmentId: 'another-commitment' }
  });
  rememberSocialFact(state, 1, unrelated.eventId, { source: 'direct' });
  rememberSocialFact(state, 2, unrelated.eventId, { source: 'direct' });
  assert.throws(() => fulfillSocialCommitment(state, commitment.commitmentId, unrelated.eventId), /transferência real/);
  rememberSocialFact(state, 1, unshared.eventId, { source: 'direct' });
  rememberSocialFact(state, 2, unshared.eventId, { source: 'direct' });
  const fulfilled = fulfillSocialCommitment(state, commitment.commitmentId, unshared.eventId);
  assert.equal(fulfilled.status, 'fulfilled');
  assert.equal(fulfilled.deliveredQuantity, 2.5);
});

test('partial delivery remains open, accumulates distinct same-day transfers and resolves exactly once', () => {
  const state = world();
  const commitment = propose(state, 'partial', 2.5);
  acceptSocialCommitment(state, 2, commitment.commitmentId);
  const first = delivery(state, 'delivery-a', 1.25, commitment.commitmentId);
  const partial = fulfillSocialCommitment(state, commitment.commitmentId, first.eventId);
  assert.equal(partial.status, 'accepted');
  assert.equal(partial.deliveredQuantity, 1.25);
  const second = delivery(state, 'delivery-b', 1.25, commitment.commitmentId);
  const complete = fulfillSocialCommitment(state, commitment.commitmentId, second.eventId);
  assert.equal(complete.status, 'fulfilled');
  assert.equal(complete.deliveredQuantity, 2.5);
  assert.equal(fulfillSocialCommitment(state, commitment.commitmentId, second.eventId), complete);
  assert.equal(state.socialEvidence.facts.filter(fact => fact.type === 'social_commitment_delivery').length, 1);
  assert.equal(state.socialEvidence.facts.filter(fact => fact.type === 'social_commitment_fulfilled').length, 1);
});

test('deadlines distinguish an unanswered proposal from an accepted promise that was broken', () => {
  const state = world();
  const unanswered = propose(state, 'unanswered');
  const accepted = propose(state, 'accepted');
  acceptSocialCommitment(state, 2, accepted.commitmentId);
  state.day += 3;
  assert.equal(advanceSocialCommitmentDeadlines(state), 2);
  assert.equal(getSocialCommitment(state, unanswered.commitmentId).status, 'expired');
  assert.equal(getSocialCommitment(state, accepted.commitmentId).status, 'breached');
  assert.equal(advanceSocialCommitmentDeadlines(state), 0);
});

test('commitment deadline shares its transition fact before pruning a full pinned evidence ledger', () => {
  const state = world();
  const commitment = propose(state, 'full-evidence-ledger', 1);
  acceptSocialCommitment(state, 2, commitment.commitmentId);
  const factIds = state.socialEvidence.facts.map(fact => fact.eventId);
  const additionalFacts = SOCIAL_FACT_LIMIT - state.socialEvidence.facts.length;
  for (let index = 0; index < additionalFacts; index++) {
    const fact = recordSocialFact(state, {
      idempotencyKey: 'pinned-fact-' + index, type: 'shared_fact', participantIds: [1, 2], witnessIds: [1, 2],
      outcome: { index }
    });
    factIds.push(fact.eventId);
  }
  for (const personId of [1, 2]) {
    for (const eventId of factIds) rememberSocialFact(state, personId, eventId, { source: 'direct', deferPrune: true });
    defineSocialBelief(state, personId, {
      topic: 'full_evidence_ledger', evaluation: 1, certainty: .5,
      supportingEventIds: factIds
    });
  }
  assert.equal(state.socialEvidence.facts.length, SOCIAL_FACT_LIMIT);
  state.day = commitment.dueDay + 1;

  assert.equal(advanceSocialCommitmentDeadlines(state), 1);
  const breached = getSocialCommitment(state, commitment.commitmentId);
  assert.equal(breached.status, 'breached');
  assert.ok(state.socialEvidence.facts.some(fact => fact.eventId === breached.lastTransitionEventId),
    'the terminal transition remains available while its commitment record is within the retention window');
});

test('plans keep monotonic progress, suspend on emergencies, resume on recovery and retain unknown route blockers', () => {
  const state = world();
  state.people[0].perception = { people: [{ id: 2, visible: true, visibleSignals: { foodSurplus: true } }] };
  const plan = defineSocialIntention(state, 1, {
    type: 'seek_food_aid', targetId: 2, dueDay: 12,
    steps: [{ action: 'approach', targetId: 2 }, { action: 'ask_for_help', targetId: 2 }],
    endsWhen: 'aid_received_or_deadline'
  });
  assert.equal(plan.status, 'active');
  assert.throws(() => advanceSocialIntention(state, 1, plan.intentionId, { progress: -1 }), /monotonicamente/);
  state.people[0].foodReserve = 5;
  maintainSocialIntentions(state, state.people[0]);
  assert.equal(state.people[0].socialIntentions[0].status, 'suspended');
  assert.ok(state.people[0].socialIntentions[0].blockers.includes('critical_hunger'));

  state.people[0].foodReserve = 30;
  maintainSocialIntentions(state, state.people[0]);
  assert.equal(state.people[0].socialIntentions[0].status, 'active');
  const blocked = advanceSocialIntention(state, 1, plan.intentionId, {
    progress: 1, status: 'suspended', blockers: ['route_infeasible']
  });
  maintainSocialIntentions(state, state.people[0]);
  assert.equal(state.people[0].socialIntentions[0].status, 'suspended');
  assert.deepEqual(blocked.blockers, ['route_infeasible']);
  const resumed = advanceSocialIntention(state, 1, plan.intentionId, { status: 'active', blockers: [] });
  assert.equal(resumed.progress, 1);
  assert.equal(resumed.status, 'active');
});

test('migration plans retain their selected destination, route blocker, progress and resolution evidence', () => {
  const state = world();
  const plan = defineSocialIntention(state, 1, {
    type: 'prepare_migration', dueDay: 24, destination: { x: 8, y: 11 },
    steps: [{ action: 'select_viable_destination' }, { action: 'reach_destination' }],
    endsWhen: 'viable_destination_reached_or_deadline'
  });

  const blocked = advanceSocialIntention(state, 1, plan.intentionId, {
    progress: 1, status: 'suspended', blockers: ['route_infeasible']
  });
  assert.equal(blocked.destination.x, 8);
  assert.deepEqual(blocked.blockers, ['route_infeasible']);
  assert.equal(state.socialEvidence.facts.at(-1).outcome.destination.y, 11);

  const resumed = advanceSocialIntention(state, 1, plan.intentionId, {
    status: 'active', blockers: [], destination: { x: 8, y: 11 }
  });
  const completed = advanceSocialIntention(state, 1, plan.intentionId, {
    progress: 2, status: 'completed', blockers: [], terminationReason: 'destination_reached'
  });
  assert.equal(resumed.progress, 1);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.destination.x, 8);
  assert.throws(() => advanceSocialIntention(state, 1, plan.intentionId, { progress: 2 }), /encerrada/);
});

test('an overdue intention is abandoned with a durable reason and evidence', () => {
  const state = world();
  const plan = defineSocialIntention(state, 1, {
    type: 'prepare_migration', dueDay: 10,
    steps: [{ action: 'assess_route' }], endsWhen: 'route_ready_or_deadline'
  });
  state.day++;
  maintainSocialIntentions(state, state.people[0]);
  const ended = state.people[0].socialIntentions[0];
  assert.equal(ended.status, 'abandoned');
  assert.equal(ended.terminationReason, 'deadline_expired');
  assert.equal(state.socialEvidence.facts.at(-1).type, 'social_intention_resolved');
  assert.throws(() => advanceSocialIntention(state, 1, plan.intentionId, { progress: 1 }), /encerrada/);
});

test('a recovered requester cancels the outstanding aid commitment and closes its plan', () => {
  const state = world();
  const commitment = propose(state, 'need-resolved');
  acceptSocialCommitment(state, 2, commitment.commitmentId);
  const plan = defineSocialIntention(state, 1, {
    type: 'seek_food_aid', targetId: 2, commitmentId: commitment.commitmentId, dueDay: 12,
    steps: [{ action: 'approach_helper' }, { action: 'request_food' }, { action: 'receive_food' }],
    endsWhen: 'aid_delivered_or_need_resolved_or_deadline'
  });
  state.people[0].foodReserve = 40;

  assert.equal(maintainSocialIntentions(state, state.people[0]), 1);
  assert.equal(getSocialCommitment(state, commitment.commitmentId).status, 'cancelled');
  assert.equal(state.people[0].socialIntentions[0].intentionId, plan.intentionId);
  assert.equal(state.people[0].socialIntentions[0].status, 'abandoned');
  assert.equal(state.people[0].socialIntentions[0].terminationReason, 'need_satisfied');
  assert.equal(state.socialEvidence.facts.at(-1).outcome.terminationReason, 'need_satisfied');
});

test('enlistment preserves plans, commitments and wallet; death abandons plans with evidence', () => {
  const state = world();
  const plan = defineSocialIntention(state, 1, {
    type: 'evaluate_service', dueDay: 14,
    steps: [{ action: 'inspect_payment' }], endsWhen: 'service_evaluated_or_deadline'
  });
  const commitment = propose(state, 'survives-role-change');
  state.people[0].militaryWallet = { stock: { gold: 15 } };
  const walletBeforeRoleChange = structuredClone(state.people[0].militaryWallet);
  state.people[0].brain = { pending: null };
  state.people[0].kingdomId = 3;
  state.kingdoms.push({ id: 3, treasury: { stock: { gold: 0 } } });
  const center = { id: 5, type: 'centro_militar', complete: true, kingdomId: 3, soldierIds: [] };
  state.structures.push(center);
  enlistSoldier(state, state.people[0], center, state.day);
  assert.equal(state.people[0].role, 'soldier');
  assert.equal(state.people[0].socialIntentions[0].intentionId, plan.intentionId);
  assert.equal(getSocialCommitment(state, commitment.commitmentId).status, 'proposed');
  assert.deepEqual(state.people[0].militaryWallet, walletBeforeRoleChange);
  assert.equal(state.people[0].socialIntentions[0].intentionId, plan.intentionId);
  assert.equal(getSocialCommitment(state, commitment.commitmentId).status, 'proposed');
  state.people[0].alive = false;
  assert.equal(abandonSocialIntentionsForPerson(state, state.people[0]), 1);
  assert.equal(state.people[0].socialIntentions[0].terminationReason, 'owner_dead');
  assert.equal(getSocialCommitment(state, commitment.commitmentId).status, 'proposed');
  assert.equal(state.socialEvidence.facts.at(-1).type, 'social_intention_resolved');
});
