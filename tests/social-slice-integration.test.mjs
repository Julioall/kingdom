import test from 'node:test';
import assert from 'node:assert/strict';
import { WIDTH, HEIGHT } from '../src/config/ecosystem.js';
import { resolveFoodAidRequest } from '../src/simulation/economy/trade.js';
import { resolveSocialMeeting } from '../src/simulation/society/social-meetings.js';
import { indicateKnownWaterReference } from '../src/simulation/society/water-indication.js';
import { renderSocialInspectorSections } from '../src/ui/social-inspector.js';

function person(id, name, x, y, communityId = null) {
  return {
    id, name, alive: true, x, y, communityId, foodReserve: 50, energy: 60, hydration: 70,
    health: 100, socialNeed: 70, perception: { people: [] }, skills: { care: 0 }
  };
}

function socialSliceFixture() {
  const people = [
    person(1, 'Mira', 2, 2), person(2, 'Ravi', 3.5, 2),
    person(3, 'Lina', 4, 4), person(4, 'Kai', 5, 4),
    person(5, 'Nilo', 10, 10, 1), person(6, 'Cora', 11, 10, 1),
    person(7, 'Bela', 14, 10), person(8, 'Noa', 15, 10)
  ];
  const tiles = Array.from({ length: WIDTH * HEIGHT }, () => ({ terrain: 'land', plants: [] }));
  tiles[10 * WIDTH + 10] = { terrain: 'water', waterKind: 'lake', plants: [] };
  const community = { id: 1, name: 'Valedouro', x: 10, y: 10, memberIds: [5, 6],
    stores: { food: 100, meat: 0 } };
  const world = { seed: 42, day: 7, simulationEpoch: 0, width: WIDTH, height: HEIGHT,
    tiles, people, communities: [community], kingdoms: [], structures: [], animals: [] };

  people[0].perception.people = [{ id: 2, visible: true, distance: 1.5 }];
  people[2].perception = {
    people: [{ id: 4, visible: true, visibleSignals: { waterDistress: true, physicalEmergency: false } }],
    knownWater: [{ x: 10, y: 10, source: 'lake', lastSeenDay: 6, confidence: .9 }]
  };
  people[3].sensoryMemory = { actors: {}, water: [], logs: {} };
  people[5].foodReserve = 20;
  people[4].foodReserve = 90;
  people[5].perception.people = [{ id: 5, visible: true, visibleSignals: { foodSurplus: true } }];
  people[7].foodReserve = 20;
  people[6].foodReserve = 70;
  people[7].perception.people = [{ id: 7, visible: true, visibleSignals: { foodSurplus: true } }];

  return { world, people, community };
}

function inspectorText(person, world) {
  return renderSocialInspectorSections(person, world).memoryRows
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function playSocialSlice() {
  const { world, people, community } = socialSliceFixture();
  const meeting = resolveSocialMeeting(world, people[0], people[1]);
  const water = indicateKnownWaterReference(world, people[2], people[3]);
  const accepted = resolveFoodAidRequest(world, people[5], people[4]);
  const refused = resolveFoodAidRequest(world, people[7], people[6]);

  return { world, people, community, meeting, water, accepted, refused };
}

test('a deterministic production replay carries social outcomes into the live inspector', () => {
  const first = playSocialSlice();
  const repeated = playSocialSlice();
  const { world, people, community, meeting, water, accepted, refused } = first;
  assert.deepEqual({
    facts: world.socialEvidence.facts,
    memories: people.map(person => person.socialMemories),
    communityFood: community.stores.food,
    reserves: people.map(person => person.foodReserve)
  }, {
    facts: repeated.world.socialEvidence.facts,
    memories: repeated.people.map(person => person.socialMemories),
    communityFood: repeated.community.stores.food,
    reserves: repeated.people.map(person => person.foodReserve)
  });

  assert.equal(meeting.completed, true);
  assert.equal(water.transferred, true);
  assert.deepEqual(water.fact.location, { x: 10, y: 10 });
  assert.equal(accepted.accepted, true);
  assert.ok(Math.abs(accepted.amount - 4.2) < 1e-9);
  assert.ok(Math.abs(community.stores.food - 95.8) < 1e-9);
  assert.ok(Math.abs(people[5].foodReserve - 24.2) < 1e-9);

  assert.equal(refused.accepted, false);
  assert.equal(people[7].foodReserve, 20);
  assert.equal(people[6].foodReserve, 70);

  assert.match(inspectorText(people[0], world), /conversa presencial.*resultado confirmado.*posição \(2,8, 2\)/);
  assert.match(inspectorText(people[3], world), /Relato recebido de Lina.*referência de água recebida.*posição \(10, 10\)/);
  assert.match(inspectorText(people[5], world), /resposta ao pedido de ajuda.*pedido aceito.*partilha de alimento.*pedido de alimento/);
  assert.match(inspectorText(people[7], world), /resposta ao pedido de ajuda.*pedido recusado.*pedido de alimento/);

  assert.deepEqual(world.socialEvidence.facts.map(fact => fact.type), [
    'social_meeting', 'water_source_indicated', 'food_aid_requested', 'social_commitment_accepted',
    'food_aid_transferred', 'food_aid_request_resolved', 'social_commitment_fulfilled', 'social_intention_resolved',
    'food_aid_requested', 'social_commitment_rejected', 'food_aid_request_resolved', 'social_intention_resolved'
  ]);
});
