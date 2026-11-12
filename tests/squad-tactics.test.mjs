import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../src/simulation/engine.js';
import { campaignOrderFor, prepareKingdomCampaigns } from '../src/simulation/kingdoms/campaigns.js';
import { fightTacticalRound } from '../src/simulation/kingdoms/military.js';
import { medievalSlotAssignments, observedInfluence, planSquadTactics, squadSlot } from '../src/simulation/kingdoms/squad-tactics.js';

function pureFixture(mode = 'hierarchical', previous = null, day = 2, sideMorale = 85) {
  const troops = Array.from({ length: 20 }, (_, i) => ({
    id: i + 1, alive: true, x: i < 10 ? 10 : 9, y: 10, stamina: 75,
    militaryRank: i === 0 || i === 10 ? 'comandante' : 'soldado'
  }));
  const units = [0, 1].map(i => ({
    id: 'unit' + i, commanderId: 1 + i * 10, generalId: 99,
    memberIds: troops.slice(i * 10, (i + 1) * 10).map(p => p.id)
  }));
  return planSquadTactics({ mode, previous, day, sideMorale, units, troops,
    generalOrder: { issuerId: 99, action: 'advance' },
    destination: { x: 20, y: 10 }, home: { x: 0, y: 10 },
    observedThreats: [{ id: 44, x: 21, y: 10, militaryClass: 'arqueiro' }] });
}

test('commanders anchor stable squads with unique relative soldier slots', () => {
  const plan = pureFixture();
  assert.equal(plan.squads.length, 2);
  assert.deepEqual(plan.squads.map(squad => squad.commanderId), [1, 11]);
  assert.equal(plan.memberToSquad[15], 1);
  const positions = new Set();
  for (let id = 12; id <= 20; id++) {
    const slot = squadSlot(plan.squads[1], id, { x: 10, y: 10 });
    assert.ok(Number.isFinite(slot.x) && Number.isFinite(slot.y));
    positions.add(JSON.stringify(slot));
  }
  assert.equal(positions.size, 9);
  assert.equal(squadSlot(plan.squads[1], 11, { x: 10, y: 10 }), null);
});

test('observed tactical influence never scans more than twelve visible enemies', () => {
  assert.equal(observedInfluence({ x: 1, y: 1 }, []), 0);
  assert.equal(observedInfluence({ x: 0, y: 0 },
    Array.from({ length: 1000 }, () => ({ x: 0, y: 0, militaryClass: 'arqueiro' }))), 12);
  assert.equal(pureFixture().observedThreatCount, 1);
});

test('group rout follows morale in hierarchical mode, but not commander-only baseline', () => {
  const previous = pureFixture();
  const routed = pureFixture('hierarchical', previous, 3, 15);
  assert.equal(routed.squads[0].mission, 'rout');
  assert.equal(routed.squads[0].target.x, 0);
  assert.equal(pureFixture('commanders', previous, 3, 15).squads[0].routed, false);
});

test('deterministic plan and commander succession do not consume RNG', () => {
  assert.deepEqual(pureFixture(), pureFixture());
  const troops = [
    { id: 2, alive: true, militaryRank: 'soldado', x: 0, y: 0, stamina: 50 },
    { id: 3, alive: true, militaryRank: 'soldado', x: 0, y: 0, stamina: 50 }
  ];
  const p = planSquadTactics({
    units: [{ id: 'survivors', memberIds: [1, 2, 3], commanderId: 1, generalId: 9 }],
    troops, destination: { x: 5, y: 0 }, home: { x: 0, y: 0 }, day: 3
  });
  assert.equal(p.squads[0].commanderId, 2);
  assert.deepEqual(p.squads[0].memberIds, [2, 3]);
});

test('campaigns expose actual commander-led groups while legacy mode remains available', () => {
  const world = Sim.createWorld(42, { tacticalCombat: 'hierarchical' });
  const attacker = world.kingdoms[0], defender = world.kingdoms[1];
  const key = Math.min(attacker.id, defender.id) + ':' + Math.max(attacker.id, defender.id);
  world.kingdomRelations[key] = { a: attacker.id, b: defender.id, status: 'at-war',
    tension: 1, borderIncidents: 1, startedDay: 1, resolvedDay: -1, ceasefireUntilDay: -1, warId: 90001 };
  const location = { x: defender.x, y: defender.y };
  world.wars = [{ id: 90001, a: attacker.id, b: defender.id, attackerId: attacker.id,
    defenderId: defender.id, status: 'active', startedDay: 1,
    cause: 'incidente observado', forceMobilization: true, evidence: {
      location, attacker: { source: 'patrulha', location }, defender: { source: 'guarda', location }
    } }];
  world.campaigns = [];
  prepareKingdomCampaigns(world, 1);
  assert.equal(world.campaigns.length, 1);
  const side = world.campaigns[0].attacker;
  assert.ok(side.squadTactics.squads.length > 0);
  const squad = side.squadTactics.squads.find(group => group.memberIds.length > 1);
  assert.ok(squad);
  const person = world.people.find(p => p.id === squad.memberIds.find(id => id !== squad.commanderId));
  const order = campaignOrderFor(world, person);
  assert.ok(order?.target && Number.isFinite(order.target.x));
  assert.equal(order.squadLeader, false);
});


test('ten-person marching units use three files rather than a long single file', () => {
  const troops = Array.from({ length: 30 }, (_, i) => ({
    id: i + 1, alive: true, x: 0, y: 0, stamina: 80,
    militaryRank: i % 10 === 0 ? 'comandante' : 'soldado'
  }));
  const units = [0, 1, 2].map(i => ({ id: 'u' + i, commanderId: 1 + i * 10,
    memberIds: troops.slice(i * 10, i * 10 + 10).map(p => p.id) }));
  const result = planSquadTactics({ units, troops, destination: { x: 60, y: 0 },
    home: { x: 0, y: 0 }, day: 1, mode: 'commanders' });
  assert.deepEqual(result.squads.map(squad => squad.role), ['vanguard', 'flank-left', 'flank-right']);
  const squad = result.squads[0];
  assert.equal(squad.formationType, 'column');
  const slots = squad.memberIds.slice(1).map(id => squadSlot(squad, id, { x: 0, y: 0 }));
  assert.equal(slots.length, 9);
  assert.equal(Math.min(...slots.map(slot => slot.x)), -4.5,
    'three files should fit nine followers into three short rows');
  assert.deepEqual(slots.slice(0, 3).map(slot => slot.y), [-1.5, 0, 1.5]);
});

test('medieval shield wall places melee in the front and keeps archers/clerics protected', () => {
  const troops = [
    { id: 1, militaryClass: 'guerreiro' },
    { id: 2, militaryClass: 'guerreiro' },
    { id: 3, militaryClass: 'guerreiro' },
    { id: 4, militaryClass: 'lanceiro' },
    { id: 5, militaryClass: 'lanceiro' },
    { id: 6, militaryClass: 'arqueiro' },
    { id: 7, militaryClass: 'arqueiro' },
    { id: 8, militaryClass: 'monge' }
  ];
  const slots = medievalSlotAssignments(troops, 1, 'shield_wall');
  assert.ok(slots[2].forward > slots[4].forward, 'shield infantry shields spearmen');
  assert.ok(slots[4].forward > slots[6].forward, 'spears screen archers');
  assert.ok(slots[6].forward > slots[8].forward, 'cleric stays behind the bows');
  const points = Object.values(slots).map(p => JSON.stringify(p));
  assert.equal(new Set(points).size, points.length);
});

test('general coordinates two real wing maneuvers before flanking strike', () => {
  const troops = Array.from({ length: 30 }, (_, i) => ({
    id: i + 1, alive: true, x: 16, y: 10, stamina: 100,
    militaryClass: 'guerreiro',
    militaryRank: i % 10 === 0 ? 'comandante' : 'soldado'
  }));
  const units = [0,1,2].map(i => ({
    id: 'u' + i, commanderId: i * 10 + 1,
    memberIds: troops.slice(i * 10, i * 10 + 10).map(p => p.id)
  }));
  const args = { units, troops, day: 3, destination: { x: 20, y: 10 },
    home: { x: 0, y: 10 }, observedThreats: [{
      id: 100, x: 20, y: 10, militaryClass: 'guerreiro'
    }], mode: 'hierarchical', generalOrder: { action: 'engage', formationType: 'line' } };
  const first = planSquadTactics(args);
  const wings = first.squads.filter(s => s.role.startsWith('flank'));
  assert.equal(wings.length, 2);
  assert.ok(wings.every(s => s.phase === 'flanking' && s.flankStage === 'swing'));
  assert.ok(wings[0].target.y < 10 && wings[1].target.y > 10);
  const wingCommander = troops.find(p => p.id === wings[0].commanderId);
  Object.assign(wingCommander, wings[0].target);
  const second = planSquadTactics({ ...args, day: 4, previous: first });
  assert.equal(second.squads[1].flankStage, 'swing',
    'commander alone cannot trigger a medieval flanking charge');
  assert.equal(second.squads[1].phase, 'reforming');
  for (const follower of troops.slice(11, 20)) Object.assign(follower,
    { x: wingCommander.x - 2, y: wingCommander.y });
  const assembled = planSquadTactics({ ...args, day: 5, previous: second });
  assert.equal(assembled.squads[1].flankStage, 'strike');
  assert.equal(assembled.squads[1].phase, 'striking');
  assert.equal(assembled.squads[1].formationType, 'wedge');
});

test('reserves hold behind the center until the vanguard is under pressure', () => {
  const troops = Array.from({ length: 50 }, (_, i) => ({
    id: i + 1, alive: true, x: 17, y: 10, stamina: 100,
    militaryRank: i % 10 === 0 ? 'comandante' : 'soldado'
  }));
  const units = [0,1,2,3,4].map(i => ({
    id: 'u' + i, commanderId: i * 10 + 1,
    memberIds: troops.slice(i * 10, i * 10 + 10).map(p => p.id)
  }));
  const args = { units, troops, day: 5, destination: { x: 20, y: 10 },
    home: { x: 0, y: 10 }, observedThreats: [{ id: 91, x: 20, y: 10 }],
    mode: 'hierarchical' };
  const first = planSquadTactics(args);
  const reserve = first.squads.find(s => s.role === 'reserve');
  assert.equal(reserve.mission, 'reserve');
  assert.equal(reserve.phase, 'holding');
  const previous = structuredClone(first);
  previous.squads[0].morale = 40;
  const next = planSquadTactics({ ...args, day: 6, previous });
  assert.equal(next.squads.find(s => s.role === 'reserve').mission, 'reinforce');
});




test('reserve joins after sustained contact and does not immediately retreat when orders fluctuate', () => {
  const troops = Array.from({ length: 50 }, (_, i) => ({
    id: i + 1, alive: true, x: 17, y: 10, stamina: 95,
    militaryRank: i % 10 === 0 ? 'comandante' : 'soldado'
  }));
  const units = [0, 1, 2, 3, 4].map(i => ({
    id: 'u' + i, commanderId: i * 10 + 1,
    memberIds: troops.slice(i * 10, i * 10 + 10).map(p => p.id)
  }));
  const args = { units, troops, destination: { x: 20, y: 10 }, home: { x: 0, y: 10 },
    observedThreats: [{ id: 100, x: 20, y: 10 }], mode: 'hierarchical' };
  const first = planSquadTactics({ ...args, day: 2 });
  assert.equal(first.squads[4].mission, 'reserve');
  const contact = structuredClone(first);
  contact.squads[0].phase = 'contact';
  contact.squads[0].contactSinceDay = 3;
  // First contact is not enough to order an immediate reserve charge.
  const firstContact = planSquadTactics({ ...args, previous: contact, day: 4 });
  assert.equal(firstContact.squads[4].mission, 'reserve');
  const committed = planSquadTactics({ ...args, previous: contact, day: 6 });
  assert.equal(committed.squads[4].mission, 'reinforce');
  assert.equal(committed.squads[4].reserveCommittedDay, 6);
  const quiet = structuredClone(committed);
  quiet.squads[0].phase = 'deploying';
  const stillAdvancing = planSquadTactics({ ...args, previous: quiet, day: 7 });
  assert.equal(stillAdvancing.squads[4].mission, 'reinforce');
  assert.equal(stillAdvancing.squads[4].reserveCommittedDay, 6);
});

test('commanders pace their march when followers fall too far behind', () => {
  const troops = Array.from({ length: 10 }, (_, i) => ({
    id: i + 1, alive: true, x: i === 0 ? 15 : 0, y: 10, stamina: 100,
    militaryClass: 'guerreiro',
    militaryRank: i === 0 ? 'comandante' : 'soldado'
  }));
  const args = {
    units: [{ id: 'infantry', commanderId: 1, memberIds: troops.map(p => p.id) }],
    troops, destination: { x: 60, y: 10 }, home: { x: 0, y: 10 },
    day: 2, mode: 'hierarchical', observedThreats: []
  };
  const gathering = planSquadTactics(args).squads[0];
  assert.equal(gathering.phase, 'reforming');
  assert.deepEqual(gathering.target, { x: 15, y: 10 });
  const advancing = planSquadTactics({ ...args, day: 3 }).squads[0];
  assert.equal(advancing.phase, 'marching');
  assert.ok(advancing.target.x > 15);
  for (const follower of troops.slice(1)) follower.x = 14;
  const together = planSquadTactics({ ...args, day: 4 }).squads[0];
  assert.equal(together.phase, 'marching');
});

test('a broken formation flees instead of performing offensive actions', () => {
  const world = Sim.createWorld(42);
  const person = world.people.find(p => p.alive && p.role === 'soldier' && p.militaryClass === 'guerreiro');
  const opponent = world.people.find(p => p.alive && p.role === 'soldier'
    && p.kingdomId !== person.kingdomId);
  assert.ok(person && opponent);
  person.tacticalRouted = true;
  person.health = 100;
  person.stamina = 100;
  person.restingStructureId = null;
  person.militaryRestTargetId = null;
  opponent.health = 100;
  const before = world.combatSequence || 0;
  fightTacticalRound(world, [person], [opponent], 10);
  assert.equal(world.combatSequence || 0, before);
  assert.equal(opponent.health, 100);
});
