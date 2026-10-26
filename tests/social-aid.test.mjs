import test from 'node:test';
import assert from 'node:assert/strict';
import { performShare } from '../src/simulation/economy/trade.js';

function person(id, foodReserve, x = 10) {
  return { id, name: 'Pessoa ' + id, alive: true, communityId: 1, x, y: 10,
    foodReserve, energy: 80, skills: { care: 0 } };
}

function communityFixture() {
  const giver = person(1, 70);
  const recipient = person(2, 0);
  const community = { id: 3, name: 'Valedouro', x: 10, y: 10, memberIds: [1, 2],
    stores: { food: 10, meat: 0 } };
  const world = { seed: 42, day: 15, simulationEpoch: 2, people: [giver, recipient], communities: [community],
    socialLinks: {}, structures: [], animals: [], kingdoms: [], events: [] };
  return { world, giver, recipient, community };
}

test('community food sharing records one direct fact and a recipient belief only after food moves', () => {
  const { world, giver, recipient, community } = communityFixture();
  const initialFood = community.stores.food;

  assert.equal(performShare(world, giver, community, null), true);
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
  assert.ok(community.stores.food < initialFood);

  const failedWorld = { ...world, day: 16, socialEvidence: undefined };
  const failedCommunity = { ...community, stores: { food: 0, meat: 0 } };
  const failedGiver = person(11, 70);
  const failedRecipient = person(12, 0);
  failedCommunity.memberIds = [11, 12];
  failedWorld.people = [failedGiver, failedRecipient];
  failedWorld.communities = [failedCommunity];
  failedWorld.socialLinks = {};
  assert.equal(performShare(failedWorld, failedGiver, failedCommunity, null), false);
  assert.equal(failedWorld.socialEvidence, undefined);
  assert.equal(failedGiver.socialMemories, undefined);
  assert.equal(failedRecipient.socialBeliefs, undefined);
});

test('voluntary aid records the actual moved reserve amount in the social fact and relationship ledger', () => {
  const giver = person(1, 90);
  const recipient = person(2, 20, 11);
  const world = { seed: 43, day: 4, people: [giver, recipient], communities: [], socialLinks: {}, structures: [], animals: [] };

  assert.equal(performShare(world, giver, null, recipient), true);
  assert.equal(world.socialEvidence.facts.length, 1);
  assert.equal(world.socialEvidence.facts[0].outcome.method, 'voluntary');
  assert.equal(world.socialEvidence.facts[0].outcome.amount, 2.5);
  assert.equal(world.socialLinks['1:2'].sharedFood, 2.5);
  assert.equal(recipient.foodReserve, 22.5);
});
