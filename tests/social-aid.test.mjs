import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureFoodAidPlan, performShare, resolveFoodAidRequest } from '../src/simulation/economy/trade.js';
import perception from '../src/simulation/individuals/perception.js';
import { updateCommunityStages } from '../src/simulation/society/communities.js';
import { proposeSocialCommitment } from '../src/simulation/society/social-evidence.js';

function person(id, foodReserve, x = 10) {
  return { id, name: 'Pessoa ' + id, alive: true, communityId: 1, x, y: 10,
    foodReserve, energy: 80, skills: { care: 0 } };
}

function communityFixture() {
  const giver = person(1, 70);
  const recipient = person(2, 0);
  const community = { id: 1, name: 'Valedouro', x: 10, y: 10, memberIds: [1, 2],
    stores: { food: 10, meat: 0 } };
  const world = { seed: 42, day: 15, simulationEpoch: 2, people: [giver, recipient], communities: [community],
    socialLinks: {}, structures: [], animals: [], kingdoms: [], events: [] };
  giver.perception = { people: [{ id: recipient.id, visible: true, visibleSignals: { foodDistress: true } }] };
  return { world, giver, recipient, community };
}

test('community food sharing records one direct fact and a recipient belief only after food moves', () => {
  const { world, giver, recipient, community } = communityFixture();
  const initialFood = community.stores.food;

  assert.equal(performShare(world, giver, community, recipient), true);
  assert.equal(world.socialEvidence.facts.length, 1);
  assert.equal(world.socialEvidence.facts[0].type, 'food_aid_transferred');
  assert.deepEqual(world.socialEvidence.facts[0].participantIds, ['1', '2']);
  assert.equal(world.socialEvidence.facts[0].outcome.method, 'community');
  assert.ok(world.socialEvidence.facts[0].outcome.amount > 0);
  assert.equal(giver.socialMemories[0].source, 'direct');
  assert.equal(recipient.socialMemories[0].source, 'direct');
  assert.equal(giver.socialBeliefs, undefined);
  assert.equal(recipient.socialBeliefs[0].topic, 'food_aid_reliability');
  assert.equal(recipient.socialBeliefs[0].aboutId, '1');
  assert.equal(recipient.socialBeliefs[0].supportingEventIds.length, 1);
  assert.equal(recipient.socialRelations[0].targetId, '1');
  assert.equal(recipient.socialRelations[0].trust, 0.08);
  assert.equal(recipient.socialRelations[0].familiarity, 0);
  assert.ok(community.stores.food < initialFood);

  const failedWorld = { ...world, day: 16, socialEvidence: undefined };
  const failedCommunity = { ...community, stores: { food: 0, meat: 0 } };
  const failedGiver = person(11, 70);
  const failedRecipient = person(12, 0);
  failedCommunity.memberIds = [11, 12];
  failedWorld.people = [failedGiver, failedRecipient];
  failedWorld.communities = [failedCommunity];
  failedWorld.socialLinks = {};
  failedGiver.perception = { people: [{ id: failedRecipient.id, visible: true,
    visibleSignals: { foodDistress: true } }] };
  assert.equal(performShare(failedWorld, failedGiver, failedCommunity, failedRecipient), false);
  assert.equal(failedWorld.socialEvidence, undefined);
  assert.equal(failedGiver.socialMemories, undefined);
  assert.equal(failedRecipient.socialBeliefs, undefined);
});

test('voluntary aid records the actual moved reserve amount in the social fact and relationship ledger', () => {
  const giver = person(1, 90);
  const recipient = person(2, 20, 11);
  giver.perception = { people: [{ id: recipient.id, visible: true, visibleSignals: { foodDistress: true } }] };
  const world = { seed: 43, day: 4, people: [giver, recipient], communities: [], socialLinks: {}, structures: [], animals: [] };

  assert.equal(performShare(world, giver, null, recipient), true);
  assert.equal(world.socialEvidence.facts.length, 1);
  assert.equal(world.socialEvidence.facts[0].outcome.method, 'voluntary');
  assert.equal(world.socialEvidence.facts[0].outcome.amount, 2.5);
  assert.equal(world.socialLinks['1:2'].sharedFood, 2.5);
  assert.equal(recipient.foodReserve, 22.5);
  assert.equal(recipient.socialRelations[0].trust, 0.12);
  assert.equal(recipient.socialRelations[0].familiarity, 0);
});

test('food aid cannot target a hungrier member outside the giver’s current perception', () => {
  const { world, giver, recipient, community } = communityFixture();
  const visibleFedMember = person(3, 80, 11);
  community.memberIds.push(visibleFedMember.id);
  world.people.push(visibleFedMember);
  giver.perception.people = [
    { id: visibleFedMember.id, visible: true, visibleSignals: { foodDistress: false } },
    { id: recipient.id, visible: false }
  ];
  const before = structuredClone(community.stores);

  assert.equal(performShare(world, giver, community, visibleFedMember), false);
  assert.equal(performShare(world, giver, community, recipient), false);
  assert.deepEqual(community.stores, before);
  assert.equal(recipient.foodReserve, 0);
  assert.equal(world.socialEvidence, undefined);
});

test('food distress is a qualitative signal while a person is visible and is not kept in stale memory', () => {
  const observer = { id: 1, alive: true, x: 2, y: 2, headingX: 1, headingY: 0, foodReserve: 80 };
  const target = { id: 2, alive: true, x: 4, y: 2, foodReserve: 20, hydration: 54 };
  const world = {
    width: 24, height: 8, day: 1,
    tiles: Array.from({ length: 24 * 8 }, () => ({ regionId: 0, plants: [] })),
    regions: { 0: {} }, animals: [], people: [observer, target], logs: [], structures: [], communities: [], kingdoms: []
  };

  let seen = perception.observe(world, observer, 'person', []).people.find(item => item.id === target.id);
  assert.equal(seen.visible, true);
  assert.deepEqual(seen.visibleSignals, { foodDistress: true, foodSurplus: false, waterDistress: true, physicalEmergency: false });

  target.foodReserve = 80;
  target.hydration = 70;
  world.day++;
  seen = perception.observe(world, observer, 'person', []).people.find(item => item.id === target.id);
  assert.deepEqual(seen.visibleSignals, { foodDistress: false, foodSurplus: false, waterDistress: false, physicalEmergency: false });

  target.x = 20;
  world.day++;
  seen = perception.observe(world, observer, 'person', []).people.find(item => item.id === target.id);
  assert.equal(seen.visible, false);
  assert.equal(seen.visibleSignals, undefined);
});

test('a local food request is accepted once and records the amount actually transferred', () => {
  const helper = person(1, 90);
  const requester = person(2, 20, 11);
  requester.perception = { people: [{ id: helper.id, visible: true, visibleSignals: { foodSurplus: true } }] };
  const sharedLink = { a: 1, b: 2, meetings: 4, trust: 0.4, sharedFood: 0 };
  const community = { id: 1, name: 'Grupo', memberIds: [1, 2], x: 10, y: 10, stage: 'vínculo', history: [], splitCooldown: 0, stores: { food: 0, meat: 0 } };
  const world = { seed: 44, day: 8, people: [helper, requester], communities: [community], socialLinks: { '1:2': sharedLink }, structures: [], animals: [], kingdoms: [] };
  const participants = new Set();

  const result = resolveFoodAidRequest(world, requester, helper, participants);

  assert.equal(result.accepted, true);
  assert.equal(result.amount, 2.5);
  assert.equal(helper.foodReserve, 87.5);
  assert.equal(requester.foodReserve, 22.5);
  assert.deepEqual(world.socialEvidence.facts.map(fact => fact.type), [
    'food_aid_requested', 'social_commitment_accepted', 'food_aid_transferred',
    'food_aid_request_resolved', 'social_commitment_fulfilled', 'social_intention_resolved'
  ]);
  assert.equal(result.commitment.status, 'fulfilled');
  assert.equal(result.commitment.deliveredQuantity, 2.5);
  assert.equal(result.intention.status, 'completed');
  assert.equal(result.intention.progress, 3);
  assert.equal(result.response.outcome.result, 'accepted');
  assert.equal(result.response.outcome.amount, 2.5);
  assert.equal(requester.socialRelations[0].trust, 0.12);
  assert.equal(requester.socialRelations[0].familiarity, 0);
  assert.deepEqual(world.socialLinks['1:2'], sharedLink);
  updateCommunityStages(world);
  assert.equal(community.cohesion, 0.4);
  assert.deepEqual([...participants], [requester.id, helper.id]);

  const repeated = resolveFoodAidRequest(world, requester, helper, new Set());
  assert.equal(repeated.reason, 'already-requested');
  assert.equal(requester.foodReserve, 22.5);
  assert.equal(world.socialEvidence.facts.length, 6);
});

test('food-aid plan is persistent and idempotent before movement or transfer', () => {
  const requester = person(21, 20, 11);
  const helper = person(22, 90);
  requester.perception = { people: [{ id: helper.id, visible: true, visibleSignals: { foodSurplus: true } }] };
  const community = { id: 5, stores: { food: 4 }, memberIds: [requester.id, helper.id] };
  requester.communityId = helper.communityId = community.id;
  const world = { seed: 76, day: 12, people: [requester, helper], communities: [community], socialEvidence: undefined };
  const plan = ensureFoodAidPlan(world, requester, helper);
  const repeated = ensureFoodAidPlan(world, requester, helper);
  assert.equal(plan.commitment.status, 'proposed');
  assert.equal(plan.intention.status, 'active');
  assert.equal(plan.intention.progress, 0);
  assert.equal(plan.intention.steps[0].action, 'approach_helper');
  assert.equal(repeated.commitment.commitmentId, plan.commitment.commitmentId);
  assert.equal(repeated.intention.intentionId, plan.intention.intentionId);
  assert.equal(community.stores.food, 4);

  requester.role = 'soldier';
  assert.equal(requester.socialIntentions[0].commitmentId, plan.commitment.commitmentId);
  assert.equal(community.stores.food, 4);
});

test('commitment history cap does not block an otherwise valid food transfer', () => {
  const helper = person(31, 90);
  const requester = person(32, 20, 11);
  requester.perception = { people: [{ id: helper.id, visible: true, visibleSignals: { foodSurplus: true } }] };
  const world = { seed: 77, day: 12, people: [helper, requester], communities: [], structures: [], animals: [], kingdoms: [] };
  for (let index = 0; index < 8; index++) proposeSocialCommitment(world, {
    idempotencyKey: 'unrelated-open-' + index, proposedBy: requester.id,
    parties: [requester.id, helper.id], object: 'service_' + index, quantity: 1, dueDay: 15
  });

  const result = resolveFoodAidRequest(world, requester, helper, new Set());

  assert.equal(result.accepted, true);
  assert.equal(result.commitment, null);
  assert.equal(helper.foodReserve, 87.5);
  assert.equal(requester.foodReserve, 22.5);
});

test('a requested transfer can be refused after the helper loses the visible surplus', () => {
  const helper = person(11, 90);
  const requester = person(12, 20, 11);
  requester.perception = { people: [{ id: helper.id, visible: true, visibleSignals: { foodSurplus: true } }] };
  requester.socialRelations = [{ schemaVersion: 1, worldSeed: 45, worldEpoch: 0, observerId: '12', targetId: '11',
    familiarity: 0.2, trust: 0.3, affinity: 0, fear: 0, evidenceIds: [], lastReviewedDay: 3 }];
  helper.foodReserve = 70;
  const sharedLink = { a: 11, b: 12, meetings: 4, trust: 0.4, sharedFood: 1 };
  const community = { id: 1, name: 'Grupo', memberIds: [11, 12], x: 10, y: 10, stage: 'vínculo', history: [], splitCooldown: 0, stores: { food: 0, meat: 0 } };
  helper.communityId = 1; requester.communityId = 1;
  const world = { seed: 45, day: 4, people: [helper, requester], communities: [community], socialLinks: { '11:12': sharedLink }, structures: [], animals: [], kingdoms: [] };
  const initialReserves = [helper.foodReserve, requester.foodReserve];

  const result = resolveFoodAidRequest(world, requester, helper, new Set());

  assert.equal(result.accepted, false);
  assert.equal(result.response.outcome.result, 'refused');
  assert.deepEqual([helper.foodReserve, requester.foodReserve], initialReserves);
  assert.deepEqual(world.socialEvidence.facts.map(fact => fact.type), [
    'food_aid_requested', 'social_commitment_rejected', 'food_aid_request_resolved', 'social_intention_resolved'
  ]);
  assert.equal(result.commitment.status, 'rejected');
  assert.equal(result.intention.status, 'abandoned');
  assert.equal(requester.socialRelations[0].trust, 0.27);
  assert.equal(requester.socialRelations[0].familiarity, 0.2);
  assert.deepEqual(world.socialLinks['11:12'], sharedLink);
  updateCommunityStages(world);
  assert.equal(community.cohesion, 0.4);
  assert.equal(requester.socialBeliefs[0].evaluation, -1);
});
