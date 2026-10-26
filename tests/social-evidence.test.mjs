import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defineDirectedSocialRelationship, defineSocialBelief, defineSocialIntention,
  pruneSocialEvidence, proposeSocialCommitment, recordSocialBeliefEvidence, recordSocialFact, rememberSocialFact,
  SOCIAL_ACTIVE_INTENTION_PER_PERSON_LIMIT, SOCIAL_FACT_LIMIT, SOCIAL_MEMORY_PER_PERSON_LIMIT,
  SOCIAL_RECORD_SCHEMA_VERSIONS, SOCIAL_RELATIONSHIP_PER_PERSON_LIMIT
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
  assert.equal(fact.worldEpoch, 0);
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
  world.animals = [{ id: 90 }];
  assert.throws(() => recordSocialFact(world, { type: 'aid_transferred' }), /idempotencyKey é obrigatório/);
  assert.throws(() => recordSocialFact(world, { type: 'aid_transferred', participantIds: [999] }), /ID inexistente/);
  assert.throws(() => recordSocialFact(world, {
    idempotencyKey: 'animal-participant', type: 'aid_transferred', participantIds: [90]
  }), /só pode apontar para pessoas/);
  const fact = recordSocialFact(world, { idempotencyKey: 'witnessed-aid', type: 'aid_transferred', participantIds: [1], witnessIds: [1] });
  assert.throws(() => rememberSocialFact(world, 2, fact.eventId), /não consta entre as testemunhas/);
  assert.throws(() => rememberSocialFact(world, 3, fact.eventId, { source: 'reported', sourcePersonId: 1 }), /ainda não conhece/);

  const depletedResource = recordSocialFact(world, {
    idempotencyKey: 'unobserved-depletion', type: 'resource_depleted', targetId: 4,
    outcome: { resource: 'food', remaining: 0 }, witnessIds: []
  });
  assert.equal((world.people[0].socialMemories || []).some(memory => memory.rootEventId === depletedResource.eventId), false,
    'world state can record depletion without granting it to an unobserving person');
  assert.throws(() => rememberSocialFact(world, 1, depletedResource.eventId), /não consta entre as testemunhas/);
});

test('social fact identities include the simulation epoch and cannot cross reset epochs', () => {
  const firstWorld = fixture();
  firstWorld.simulationEpoch = 3;
  const first = aidFact(firstWorld, 'epoch-3');
  const secondWorld = fixture();
  secondWorld.simulationEpoch = 4;
  const second = aidFact(secondWorld, 'epoch-4');

  assert.equal(first.worldEpoch, 3);
  assert.equal(second.worldEpoch, 4);
  assert.notEqual(first.eventId, second.eventId);
  firstWorld.simulationEpoch = 4;
  assert.throws(() => recordSocialFact(firstWorld, { type: 'aid_transferred' }), /seed\/época do estado social não corresponde/);
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

test('retention pins evidence needed by beliefs, active plans and open commitments', () => {
  const world = fixture();
  const original = aidFact(world, 'pinned-evidence', 1);
  rememberSocialFact(world, 1, original.eventId, { source: 'direct', acquiredDay: 1 });
  rememberSocialFact(world, 2, original.eventId, { source: 'direct', acquiredDay: 1 });
  defineSocialIntention(world, 1, {
    type: 'repay_food_aid', evidenceIds: [original.eventId],
    steps: [{ action: 'deliver_food', targetId: 2 }], endsWhen: 'commitment_fulfilled'
  });
  recordSocialBeliefEvidence(world, 2, {
    topic: 'food_aid_reliability', aboutId: 1, eventId: original.eventId, polarity: 1
  });
  const commitment = proposeSocialCommitment(world, {
    idempotencyKey: 'open-repayment', parties: [1, 2], object: 'food', quantity: 2,
    dueDay: 20, evidenceEventIds: [original.eventId]
  });

  for (let index = 0; index < SOCIAL_MEMORY_PER_PERSON_LIMIT + 1; index++) {
    const fact = recordSocialFact(world, {
      idempotencyKey: 'unpinned-' + index, day: 10, type: 'aid_transferred',
      participantIds: [1], witnessIds: [1]
    });
    rememberSocialFact(world, 1, fact.eventId);
  }
  assert.equal(world.people[0].socialMemories.length, SOCIAL_MEMORY_PER_PERSON_LIMIT,
    'the 32-item cap includes the pinned intention and open commitment evidence');

  world.day = 500;
  const result = pruneSocialEvidence(world);
  for (const person of world.people.slice(0, 2)) {
    assert.deepEqual(person.socialMemories.map(memory => memory.rootEventId), [original.eventId]);
  }
  assert.deepEqual(world.socialEvidence.facts.map(fact => fact.eventId), [original.eventId]);
  assert.equal(world.people[1].socialBeliefs[0].supportingEventIds[0], original.eventId);
  assert.equal(world.people[0].socialIntentions[0].evidenceIds[0], original.eventId);
  assert.equal(world.socialEvidence.commitments[0].record, commitment);
  assert.equal(commitment.status, 'proposed', 'an open commitment survives evidence consolidation');
  assert.equal(result.retainedMemories, 2);
});

test('world fact retention is enforced as facts are recorded and removes oldest unreferenced records', () => {
  const world = fixture();
  let lastFact;
  for (let index = 0; index <= SOCIAL_FACT_LIMIT; index++) {
    lastFact = recordSocialFact(world, {
      idempotencyKey: 'bounded-fact-' + index,
      type: 'aid_transferred',
      participantIds: [1],
      witnessIds: [1]
    });
  }
  assert.equal(world.socialEvidence.facts.length, SOCIAL_FACT_LIMIT);
  assert.equal(world.socialEvidence.facts.some(fact => fact.sequence === 1), false);
  assert.equal(world.socialEvidence.facts.at(-1).eventId, lastFact.eventId);
  assert.equal(Object.keys(world.socialEvidence.idempotency).length, SOCIAL_FACT_LIMIT);
});

test('a new world fact survives long enough to be remembered when all retained facts are referenced', () => {
  const world = fixture();
  world.people = Array.from({ length: SOCIAL_FACT_LIMIT + 1 }, (_, index) => ({ id: index + 1 }));
  for (let index = 0; index < SOCIAL_FACT_LIMIT; index++) {
    const personId = index + 1;
    const fact = recordSocialFact(world, {
      idempotencyKey: 'pinned-world-fact-' + index,
      type: 'aid_transferred',
      participantIds: [personId],
      witnessIds: [personId]
    });
    rememberSocialFact(world, personId, fact.eventId);
  }
  assert.equal(world.socialEvidence.facts.length, SOCIAL_FACT_LIMIT);

  const personId = SOCIAL_FACT_LIMIT + 1;
  const latest = recordSocialFact(world, {
    idempotencyKey: 'latest-pinned-world-fact',
    type: 'aid_transferred',
    participantIds: [personId],
    witnessIds: [personId]
  });
  const memory = rememberSocialFact(world, personId, latest.eventId);

  assert.equal(memory.rootEventId, latest.eventId);
  assert.equal(world.socialEvidence.facts.length, SOCIAL_FACT_LIMIT + 1,
    'the ledger can exceed its soft budget when every older fact is still referenced');
  assert.ok(world.socialEvidence.facts.some(fact => fact.eventId === latest.eventId));
});

test('beliefs cite only local memories and directed relations do not mutate the other person or shared links', () => {
  const world = fixture();
  const fact = aidFact(world);
  rememberSocialFact(world, 1, fact.eventId, { source: 'direct' });
  const belief = defineSocialBelief(world, 1, {
    topic: 'kingdom_reliability', evaluation: -.4, certainty: .75,
    supportingEventIds: [fact.eventId]
  });
  const relation = defineDirectedSocialRelationship(world, 1, 2, {
    familiarity: .9, trust: .2, affinity: .5, fear: .1, evidenceIds: [fact.eventId]
  });

  assert.equal(belief.schemaVersion, SOCIAL_RECORD_SCHEMA_VERSIONS.belief);
  assert.equal(relation.schemaVersion, SOCIAL_RECORD_SCHEMA_VERSIONS.relationship);
  assert.equal(relation.observerId, '1');
  assert.equal(relation.targetId, '2');
  assert.equal(world.people[1].socialRelations, undefined);
  assert.equal(world.socialLinks, undefined);
  assert.throws(() => defineSocialBelief(world, 2, {
    topic: 'kingdom_reliability', evaluation: .2, certainty: .4, supportingEventIds: [fact.eventId]
  }), /não possui memória da evidência/);
});

test('belief updates ignore repeated roots, accumulate independent evidence, and revise without deleting history', () => {
  const world = fixture();
  const firstFact = aidFact(world, 'first-aid');
  rememberSocialFact(world, 2, firstFact.eventId, { source: 'direct' });
  const first = recordSocialBeliefEvidence(world, 2, {
    topic: 'food_aid_reliability', aboutId: 1, eventId: firstFact.eventId, polarity: 1
  });
  assert.equal(first.evaluation, 1);
  assert.equal(first.revision, 1);

  assert.equal(recordSocialBeliefEvidence(world, 2, {
    topic: 'food_aid_reliability', aboutId: 1, eventId: firstFact.eventId, polarity: 1
  }), first);
  assert.equal(world.people[1].socialBeliefs.length, 1);

  world.day++;
  const secondFact = aidFact(world, 'second-aid', world.day);
  rememberSocialFact(world, 2, secondFact.eventId, { source: 'direct' });
  const revised = recordSocialBeliefEvidence(world, 2, {
    topic: 'food_aid_reliability', aboutId: 1, eventId: secondFact.eventId, polarity: -1
  });
  assert.equal(revised.revision, 2);
  assert.equal(revised.evaluation, 0);
  assert.ok(revised.certainty > first.certainty);
  assert.deepEqual(revised.supportingEventIds, [firstFact.eventId]);
  assert.deepEqual(revised.opposingEventIds, [secondFact.eventId]);
  world.day++;
  const thirdFact = aidFact(world, 'third-aid', world.day);
  rememberSocialFact(world, 2, thirdFact.eventId, { source: 'direct' });
  const withThirdIndependentFact = recordSocialBeliefEvidence(world, 2, {
    topic: 'food_aid_reliability', aboutId: 1, eventId: thirdFact.eventId, polarity: 1
  });
  assert.ok(withThirdIndependentFact.certainty > revised.certainty);
  assert.ok(withThirdIndependentFact.certainty - revised.certainty < revised.certainty - first.certainty,
    'the certainty increase saturates as independent evidence accumulates');
  assert.equal(first.evaluation, 1, 'previous belief snapshots stay immutable');
  assert.equal(world.people[1].socialMemories.length, 3, 'revision preserves each independent event');
});

test('a newly cited belief memory survives pruning when the existing evidence already fills its budget', () => {
  const world = fixture();
  const observer = world.people[1];
  for (let index = 0; index < SOCIAL_MEMORY_PER_PERSON_LIMIT; index++) {
    const fact = aidFact(world, 'bounded-belief-' + index);
    rememberSocialFact(world, observer.id, fact.eventId, { source: 'direct' });
    recordSocialBeliefEvidence(world, observer.id, {
      topic: 'food_aid_reliability', aboutId: 1, eventId: fact.eventId, polarity: 1
    });
  }

  const latestFact = aidFact(world, 'bounded-belief-latest');
  rememberSocialFact(world, observer.id, latestFact.eventId, { source: 'direct', deferPrune: true });
  const latestBelief = recordSocialBeliefEvidence(world, observer.id, {
    topic: 'food_aid_reliability', aboutId: 1, eventId: latestFact.eventId, polarity: 1
  });

  assert.equal(latestBelief.supportingEventIds.length, SOCIAL_MEMORY_PER_PERSON_LIMIT + 1);
  assert.equal(observer.socialMemories.length, SOCIAL_MEMORY_PER_PERSON_LIMIT + 1,
    'evidence cited by a belief stays pinned even when it exceeds the unpinned memory budget');
  assert.ok(observer.socialMemories.some(memory => memory.rootEventId === latestFact.eventId));
});

test('a recipient keeps a reported memory when its source dies', () => {
  const world = fixture();
  const fact = aidFact(world, 'reported-before-death');
  rememberSocialFact(world, 1, fact.eventId, { source: 'direct' });
  const report = rememberSocialFact(world, 2, fact.eventId, { source: 'reported', sourcePersonId: 1 });

  world.people[0].alive = false;
  assert.equal(world.people[1].socialMemories[0], report);
  assert.equal(report.sourcePersonId, '1');
  assert.equal(report.rootEventId, fact.eventId);
});

test('repeating the same report does not duplicate its belief consequence', () => {
  const world = fixture();
  const fact = recordSocialFact(world, {
    idempotencyKey: 'single-event-reported-repeatedly', type: 'food_aid_transferred',
    participantIds: [1, 2], witnessIds: [1], targetId: 4, outcome: { resource: 'food', amount: 2 }
  });
  rememberSocialFact(world, 1, fact.eventId, { source: 'direct' });
  const firstMemory = rememberSocialFact(world, 2, fact.eventId, { source: 'reported', sourcePersonId: 1 });
  const firstBelief = recordSocialBeliefEvidence(world, 2, {
    topic: 'food_aid_reliability', aboutId: 1, eventId: fact.eventId, polarity: 1
  });

  for (let repeat = 0; repeat < 3; repeat++) {
    assert.equal(rememberSocialFact(world, 2, fact.eventId, {
      source: 'reported', sourcePersonId: 1, acquiredDay: world.day
    }), firstMemory);
    assert.equal(recordSocialBeliefEvidence(world, 2, {
      topic: 'food_aid_reliability', aboutId: 1, eventId: fact.eventId, polarity: 1
    }), firstBelief);
  }

  assert.equal(world.people[1].socialMemories.length, 1);
  assert.equal(world.people[1].socialBeliefs.length, 1);
  assert.equal(firstBelief.revision, 1);
  assert.equal(firstBelief.supportingEventIds.length, 1);
});

test('commitment proposal is idempotent and reserves no resource before acceptance', () => {
  const world = fixture();
  world.communities[0].stores = { food: 3 };
  const initialFood = world.communities[0].stores.food;
  const input = {
    idempotencyKey: 'ravi-aid-day-10', parties: [1, 2], object: 'food', quantity: 2, dueDay: 12,
    resourceReferences: [{ kind: 'community', id: 4 }]
  };
  const first = proposeSocialCommitment(world, input);
  const duplicate = proposeSocialCommitment(world, input);

  assert.equal(first, duplicate);
  assert.equal(first.schemaVersion, SOCIAL_RECORD_SCHEMA_VERSIONS.commitment);
  assert.equal(first.status, 'proposed');
  assert.equal(world.communities[0].stores.food, initialFood);
  assert.throws(() => proposeSocialCommitment(world, { ...input, quantity: 5 }), /chave do compromisso foi reutilizada/);
});

test('individual intention stores explicit steps, target and termination condition with valid references', () => {
  const world = fixture();
  const intention = defineSocialIntention(world, 1, {
    type: 'seek_food_aid', priority: .9, targetId: 2,
    steps: [{ action: 'approach', targetId: 2 }, { action: 'ask_for_help' }],
    progress: 1, blockers: ['food_low'], endsWhen: 'aid_received_or_deadline'
  });

  assert.equal(intention.schemaVersion, SOCIAL_RECORD_SCHEMA_VERSIONS.intention);
  assert.equal(intention.status, 'suspended');
  assert.deepEqual(intention.blockers, ['food_low']);
  assert.equal(intention.steps.length, 2);
  assert.throws(() => defineSocialIntention(world, 1, {
    type: 'seek_food_aid', steps: [{ action: 'approach', targetId: 999 }], endsWhen: 'done'
  }), /targetId de um passo não existe/);
});

test('initial social memory, relation and active intention budgets are enforced', () => {
  const world = fixture();
  world.people.push(...Array.from({ length: SOCIAL_RELATIONSHIP_PER_PERSON_LIMIT + 1 }, (_, index) => ({ id: 10 + index })));
  for (const target of world.people.slice(3, 3 + SOCIAL_RELATIONSHIP_PER_PERSON_LIMIT)) {
    defineDirectedSocialRelationship(world, 1, target.id);
  }
  assert.throws(() => defineDirectedSocialRelationship(world, 1, world.people.at(-1).id), /limite de relações detalhadas/);

  for (let index = 0; index < SOCIAL_ACTIVE_INTENTION_PER_PERSON_LIMIT; index++) {
    defineSocialIntention(world, 1, { type: 'seek_help', steps: [{ action: 'approach' }], endsWhen: 'help_or_timeout' });
  }
  assert.throws(() => defineSocialIntention(world, 1, {
    type: 'seek_help', steps: [{ action: 'approach' }], endsWhen: 'help_or_timeout'
  }), /limite de intenções ativas/);
  assert.equal(SOCIAL_MEMORY_PER_PERSON_LIMIT, 32);
});
