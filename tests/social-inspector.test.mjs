import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSocialInspectorSections } from '../src/ui/social-inspector.js';

test('social inspector distinguishes observed facts, reported facts and personal interpretations', () => {
  const person = {
    id: 2,
    socialMemories: [
      { rootEventId: 'direct-aid', eventType: 'food_aid_transferred', eventDay: 20, acquiredDay: 20, source: 'direct' },
      { rootEventId: 'reported-aid', eventType: 'food_aid_transferred', eventDay: 21, acquiredDay: 22,
        source: 'reported', sourcePersonId: '10' }
    ],
    socialBeliefs: [{ topic: 'food_aid_reliability', aboutId: '10', evaluation: 1, certainty: .28,
      supportingEventIds: ['direct-aid'], opposingEventIds: [] }]
  };
  const world = {
    people: [person, { id: 10, name: 'Mira <A>' }],
    kingdoms: [],
    socialEvidence: { facts: [
      { eventId: 'direct-aid', day: 20, outcome: { resource: 'food', amount: 3 } },
      { eventId: 'reported-aid', day: 21, outcome: { resource: 'food', amount: 2 } }
    ] }
  };

  const sections = renderSocialInspectorSections(person, world);

  assert.match(sections.memorySection, /<h3>Fatos e relatos conhecidos<\/h3>/);
  assert.match(sections.memorySection, /Observado diretamente/);
  assert.match(sections.memorySection, /Relato recebido de Mira &lt;A&gt;/);
  assert.match(sections.memorySection, /recebido no dia 22/);
  assert.match(sections.beliefSection, /<h3>Interpretações pessoais<\/h3>/);
  assert.match(sections.beliefSection, /Confiabilidade na ajuda alimentar sobre Mira &lt;A&gt;/);
  assert.match(sections.beliefSection, /Avaliação 100% · certeza 28%/);
});

test('social inspector shows the confirmed outcome and observed position of a completed meeting', () => {
  const person = {
    id: 1,
    socialMemories: [{ rootEventId: 'meeting-42', eventType: 'social_meeting', eventDay: 7, acquiredDay: 7, source: 'direct' }],
    socialBeliefs: []
  };
  const world = {
    people: [person, { id: 2, name: 'Ravi' }],
    kingdoms: [],
    socialEvidence: { facts: [{
      eventId: 'meeting-42', type: 'social_meeting', day: 7, location: { x: 4.5, y: 6 },
      outcome: { result: 'conversation_completed' }
    }] }
  };

  const sections = renderSocialInspectorSections(person, world);

  assert.match(sections.memorySection, /conversa presencial/);
  assert.match(sections.memorySection, /resultado confirmado/);
  assert.match(sections.memorySection, /posição \(4,5, 6\)/);
});

test('social inspector shows who reported a known water reference and its observed position', () => {
  const person = {
    id: 2,
    socialMemories: [{ rootEventId: 'water-7', eventType: 'water_source_indicated', eventDay: 9, acquiredDay: 9,
      source: 'reported', sourcePersonId: '1' }],
    socialBeliefs: []
  };
  const world = {
    people: [person, { id: 1, name: 'Lia' }],
    kingdoms: [],
    socialEvidence: { facts: [{
      eventId: 'water-7', type: 'water_source_indicated', day: 9, location: { x: 10, y: 11 },
      outcome: { resource: 'water', result: 'reference_received', source: 'lake' }
    }] }
  };

  const sections = renderSocialInspectorSections(person, world);

  assert.match(sections.memorySection, /Relato recebido de Lia/);
  assert.match(sections.memorySection, /indicação de água/);
  assert.match(sections.memorySection, /referência de água recebida/);
  assert.match(sections.memorySection, /posição \(10, 11\)/);
});

test('social inspector shows the accepted or refused food request result', () => {
  const person = {
    id: 2,
    socialMemories: [
      { rootEventId: 'request-1', eventType: 'food_aid_requested', eventDay: 9, acquiredDay: 9, source: 'direct' },
      { rootEventId: 'response-1', eventType: 'food_aid_request_resolved', eventDay: 9, acquiredDay: 9, source: 'direct' }
    ],
    socialBeliefs: []
  };
  const world = {
    people: [person, { id: 1, name: 'Nara' }],
    kingdoms: [],
    socialEvidence: { facts: [
      { eventId: 'request-1', type: 'food_aid_requested', day: 9, targetId: '1', outcome: { resource: 'food', result: 'request_made' } },
      { eventId: 'response-1', type: 'food_aid_request_resolved', day: 9, targetId: '2',
        outcome: { resource: 'food', result: 'accepted', amount: 2.5 } }
    ] }
  };

  const sections = renderSocialInspectorSections(person, world);

  assert.match(sections.memorySection, /pedido de alimento/);
  assert.match(sections.memorySection, /resposta ao pedido de ajuda/);
  assert.match(sections.memorySection, /pedido aceito/);
  assert.match(sections.memorySection, /2,5 pontos de alimento/);

  world.socialEvidence.facts[1].outcome = { resource: 'food', result: 'refused', reason: 'no-transferable-surplus' };
  const refused = renderSocialInspectorSections(person, world);
  assert.match(refused.memorySection, /pedido recusado/);
});
