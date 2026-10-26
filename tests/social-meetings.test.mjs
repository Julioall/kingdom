import test from 'node:test';
import assert from 'node:assert/strict';
import { nearestPerson } from '../src/simulation/individuals/actions.js';
import { resolveSocialMeeting } from '../src/simulation/society/social-meetings.js';

function person(id, x, y, overrides = {}) {
  return {
    id, alive: true, x, y, energy: 60, foodReserve: 50, hydration: 70, health: 100, socialNeed: 70,
    perception: { people: [] },
    ...overrides
  };
}

function meetingFixture() {
  const initiator = person(1, 2, 2);
  const target = person(2, 3.5, 2);
  initiator.perception.people = [{ id: target.id, visible: true, distance: 1.5 }];
  const world = { seed: 42, day: 7, people: [initiator, target] };
  return { world, initiator, target };
}

test('a visible pair completes one meeting and records the confirmed result once', () => {
  const { world, initiator, target } = meetingFixture();
  const participants = new Set();

  const meeting = resolveSocialMeeting(world, initiator, target, participants);

  assert.equal(meeting.completed, true);
  assert.deepEqual([...participants], [initiator.id, target.id]);
  assert.equal(initiator.socialNeed, 53);
  assert.equal(initiator.energy, 59.945);
  assert.equal(world.socialEvidence.facts.length, 1);
  assert.equal(world.socialEvidence.facts[0].type, 'social_meeting');
  assert.deepEqual(world.socialEvidence.facts[0].outcome, { result: 'conversation_completed' });
  assert.equal(initiator.socialMemories[0].source, 'direct');
  assert.equal(target.socialMemories[0].source, 'direct');
  assert.equal(initiator.socialRelations[0].familiarity, 0.02);
  assert.equal(initiator.socialRelations[0].trust, 0);
  assert.equal(target.socialRelations[0].familiarity, 0.02);
  assert.equal(target.socialRelations[0].trust, 0);

  const repeated = resolveSocialMeeting(world, initiator, target, participants);
  assert.equal(repeated.reason, 'participant-busy');
  assert.equal(world.socialEvidence.facts.length, 1);
});

test('a participant cannot be reserved into a second incompatible meeting that day', () => {
  const { world, initiator, target } = meetingFixture();
  const third = person(3, 3.2, 3);
  target.perception.people = [{ id: third.id, visible: true, distance: 1 }];
  world.people.push(third);
  const participants = new Set();

  assert.equal(resolveSocialMeeting(world, initiator, target, participants).completed, true);
  assert.equal(resolveSocialMeeting(world, target, third, participants).reason, 'participant-busy');
  assert.equal(world.socialEvidence.facts.length, 1);
});

test('physical emergency, stale visibility, and distance prevent a meeting without effects', () => {
  const { world, initiator, target } = meetingFixture();
  const participants = new Set();
  target.hydration = 8;

  assert.equal(resolveSocialMeeting(world, initiator, target, participants).reason, 'physical-emergency');
  target.hydration = 70;
  target.x = 8;
  assert.equal(resolveSocialMeeting(world, initiator, target, participants).reason, 'out-of-reach');
  target.x = 3.5;
  initiator.perception.people[0].visible = false;
  assert.equal(resolveSocialMeeting(world, initiator, target, participants).reason, 'not-visible');

  assert.equal(initiator.socialNeed, 70);
  assert.equal(initiator.energy, 60);
  assert.equal(participants.size, 0);
  assert.equal(world.socialEvidence, undefined);
});

test('nearest social target selection skips participants already committed to a meeting', () => {
  const initiator = person(1, 2, 2);
  const first = person(2, 3, 2);
  const second = person(3, 4, 2);
  initiator.perception.people = [
    { id: first.id, visible: true, distance: 1 },
    { id: second.id, visible: true, distance: 2 }
  ];
  const world = { people: [initiator, first, second] };

  assert.equal(nearestPerson(world, initiator, 14).id, first.id);
  assert.equal(nearestPerson(world, initiator, 14, new Set([first.id])).id, second.id);
});
