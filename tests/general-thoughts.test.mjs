import test from 'node:test';
import assert from 'node:assert/strict';
import { generalThoughts, thoughtHasFocus } from '../src/ui/king-thoughts.js';

function scenario() {
  return {
    kingdoms: [{ id: 1, militaryCommand: { generalIds: [7] } }],
    people: [{ id: 7, name: 'Artur', role: 'soldier', kingdomId: 1, alive: true, x: 20, y: 30 }],
    campaigns: [{ status: 'marching', attacker: { kingdomId: 1, troopIds: [7],
      formation: { leaderId: 7 }, aiOrder: { reason: 'Eu vou avançar com a tropa.', assignedDay: 4 } },
      defender: { kingdomId: 2, troopIds: [] } }]
  };
}

test('general balloon uses the applied LLM justification and follows the interpolated general', () => {
  const world = scenario();
  const [entry] = generalThoughts(world, (_, person) => ({ x: person.x + 1, y: person.y + 2 }));
  assert.equal(entry.label, 'General Artur');
  assert.equal(entry.thought, 'Eu vou avançar com a tropa.');
  assert.equal(entry.x, 21.5);
  assert.equal(entry.baseY, 33);
});

test('a general in the rear still receives the campaign thought', () => {
  const world = scenario();
  world.campaigns[0].attacker.troopIds = [99];
  world.campaigns[0].attacker.formation.leaderId = 99;
  assert.equal(generalThoughts(world)[0].personId, 7);
});

test('thoughts are shown only for the focused castle, kingdom or general', () => {
  const castle = { key: 1, castleId: 2 }, general = { key: 'general:7', personId: 7 };
  assert.equal(thoughtHasFocus(castle, null), false);
  assert.equal(thoughtHasFocus(castle, { kind: 'structure', id: 2 }), true);
  assert.equal(thoughtHasFocus(castle, { kind: 'kingdom', id: 1 }), true);
  assert.equal(thoughtHasFocus(general, { kind: 'person', id: 7 }), true);
  assert.equal(thoughtHasFocus(general, { kind: 'person', id: 99 }), false);
  assert.equal(thoughtHasFocus(castle, { kind: 'person', id: 7 }), false);
});

test('general balloons disappear after death or campaign completion and never invent a thought', () => {
  const world = scenario();
  world.people[0].alive = false;
  assert.deepEqual(generalThoughts(world), []);
  world.people[0].alive = true;
  world.campaigns[0].status = 'completed';
  assert.deepEqual(generalThoughts(world), []);
  world.campaigns[0].status = 'marching';
  delete world.campaigns[0].attacker.aiOrder;
  assert.deepEqual(generalThoughts(world), []);
});
