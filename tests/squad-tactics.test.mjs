import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../src/simulation/engine.js';
import { campaignOrderFor, prepareKingdomCampaigns } from '../src/simulation/kingdoms/campaigns.js';
import { observedInfluence, planSquadTactics, squadSlot } from '../src/simulation/kingdoms/squad-tactics.js';

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
    assert.ok(slot.x < 10);
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
