import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pruneSocialEvidence, recordSocialFact, rememberSocialFact,
  SOCIAL_FACT_LIMIT, SOCIAL_MEMORY_PER_PERSON_LIMIT
} from '../src/simulation/society/social-evidence.js';

function fixture() {
  return {
    seed: 42,
    day: 10,
    people: [{ id: 1 }, { id: 2 }, { id: 3 }],
    communities: [{ id: 4 }],
    socialEvidence: undefined
  };
}

function aidFact(world, idempotencyKey = 'aid-1', day = world.day) {
  return recordSocialFact(world, {
    idempotencyKey,
    day,
    type: 'food_aid_transferred',
    participantIds: [1, 2],
    witnessIds: [1, 2, 3],
    targetId: 4,
    outcome: { resource: 'food', amount: 2 },
    references: [{ kind: 'community', id: 4 }]
  });
}

test('world facts stay separate from participant memories until each witness observes them', () => {
  const world = fixture();
  const fact = aidFact(world);

  assert.equal(fact.schemaVersion, 1);
  assert.equal(fact.worldSeed, 42);
  assert.equal(Object.isFrozen(fact), true);
  assert.equal(Object.isFrozen(fact.outcome), true);
  assert.equal(world.people[0].socialMemories, undefined);
  assert.equal(world.people[2].socialMemories, undefined);

  const memory = rememberSocialFact(world, 3, fact.eventId, { source: 'direct' });
  assert.equal(memory.rootEventId, fact.eventId);
  assert.equal(memory.source, 'direct');
  assert.equal(Object.isFrozen(memory), true);
  assert.equal(world.people[0].socialMemories, undefined);
  assert.equal(world.people[1].socialMemories, undefined);
  assert.equal(world.people[2].socialMemories.length, 1);
});

test('reports preserve the source chain and cannot transmit a fact the source does not know', () => {
  const world = fixture();
  const fact = aidFact(world);
  rememberSocialFact(world, 1, fact.eventId, { source: 'direct' });

  const report = rememberSocialFact(world, 2, fact.eventId, { source: 'reported', sourcePersonId: 1 });
  assert.equal(report.sourcePersonId, '1');
  assert.throws(() => rememberSocialFact(world, 3, 'missing:event', { source: 'reported', sourcePersonId: 1 }), /fato de origem não existe/);
});

test('fact writes and memories are idempotent; conflicting reuse of a key is rejected', () => {
  const world = fixture();
  const first = aidFact(world);
  const duplicate = aidFact(world);
  assert.equal(first, duplicate);
  assert.equal(world.socialEvidence.facts.length, 1);

  const memory = rememberSocialFact(world, 1, first.eventId);
  assert.equal(rememberSocialFact(world, 1, first.eventId), memory);
  assert.equal(world.people[0].socialMemories.length, 1);
  assert.throws(() => recordSocialFact(world, {
    idempotencyKey: 'aid-1', day: world.day, type: 'food_aid_transferred', participantIds: [1, 2],
    witnessIds: [1, 2, 3], targetId: 4, outcome: { resource: 'food', amount: 9 },
    references: [{ kind: 'community', id: 4 }]
  }), /chave de idempotência foi usada para fatos diferentes/);
});

test('unknown references and unobserved direct memories are rejected', () => {
  const world = fixture();
  assert.throws(() => recordSocialFact(world, { type: 'aid_transferred', participantIds: [999] }), /ID inexistente/);
  const fact = recordSocialFact(world, { type: 'aid_transferred', participantIds: [1], witnessIds: [1] });
  assert.throws(() => rememberSocialFact(world, 2, fact.eventId), /não consta entre as testemunhas/);
  assert.throws(() => rememberSocialFact(world, 3, fact.eventId, { source: 'reported', sourcePersonId: 1 }), /ainda não conhece/);
});

test('retention bounds memories and facts while preserving references inside the window', () => {
  const world = fixture();
  for (let index = 0; index < SOCIAL_MEMORY_PER_PERSON_LIMIT + 1; index++) {
    const fact = recordSocialFact(world, {
      idempotencyKey: 'event-' + index,
      day: world.day,
      type: 'aid_transferred',
      participantIds: [1],
      witnessIds: [1]
    });
    rememberSocialFact(world, 1, fact.eventId);
  }
  const result = pruneSocialEvidence(world);
  assert.equal(world.people[0].socialMemories.length, SOCIAL_MEMORY_PER_PERSON_LIMIT);
  assert.ok(result.retainedFacts <= SOCIAL_FACT_LIMIT);
  const facts = new Set(world.socialEvidence.facts.map(fact => fact.eventId));
  assert.ok(world.people[0].socialMemories.every(memory => facts.has(memory.rootEventId)));

  world.day += SOCIAL_FACT_LIMIT + 400;
  const expired = pruneSocialEvidence(world);
  assert.equal(expired.retainedFacts, 0);
  assert.equal(expired.retainedMemories, 0);
});
