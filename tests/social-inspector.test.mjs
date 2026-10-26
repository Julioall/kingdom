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
