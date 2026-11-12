import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../src/simulation/engine.js';
import { prepareKingdomCampaigns } from '../src/simulation/kingdoms/campaigns.js';

function mobilizedWorld(mode) {
  const world = Sim.createWorld(42, { tacticalCombat: mode });
  const [attacker, defender] = world.kingdoms;
  const location = { x: defender.x, y: defender.y };
  const key = Math.min(attacker.id, defender.id) + ':' + Math.max(attacker.id, defender.id);
  world.kingdomRelations[key] = {
    a: Math.min(attacker.id, defender.id), b: Math.max(attacker.id, defender.id),
    status: 'at-war', tension: 1, borderIncidents: 1, startedDay: 1,
    resolvedDay: -1, ceasefireUntilDay: -1, warId: 900301
  };
  world.wars = [{
    id: 900301, a: attacker.id, b: defender.id,
    attackerId: attacker.id, defenderId: defender.id,
    status: 'active', startedDay: 1, cause: 'test field recovery',
    forceMobilization: true,
    evidence: { location, attacker: { source: 'patrulha', location },
      defender: { source: 'guarnição', location } }
  }];
  world.campaigns = [];
  prepareKingdomCampaigns(world, 1);
  assert.ok(world.campaigns.length);
  return world;
}

test('tired medieval troops recover in the field instead of walking to their homes', () => {
  const world = mobilizedWorld('hierarchical');
  const side = world.campaigns[0].attacker;
  const enlisted = side.troopIds.map(id => world.people.find(p => p.id === id))
    .filter(p => p && p.militaryRank !== 'general' && !p.playerControlled);
  assert.ok(enlisted.length >= 2);
  for (const soldier of enlisted) {
    Object.assign(soldier, {
      energy: 32, health: 80, hydration: 80, foodReserve: 85, injury: 0,
      tacticalRecovering: false, militaryRestTargetId: null, restingStructureId: null
    });
  }
  Sim.stepDay(world);
  const rest = enlisted.filter(person => person.lastDecision?.action === 'field_rest');
  assert.ok(rest.length >= 1, 'the exhausted unit should rest with the army');
  for (const soldier of rest) {
    assert.equal(soldier.militaryRestTargetId, null,
      'healthy battlefield fatigue must not assign a distant house');
    assert.ok(!soldier.state.includes('descansar na casa'), 'field duty remains near the army');
  }
});

test('severely wounded combatants can still evacuate rather than being forced into the line', () => {
  const world = mobilizedWorld('hierarchical');
  const soldier = world.campaigns[0].attacker.troopIds.map(id => world.people.find(p => p.id === id))
    .find(p => p && p.militaryRank !== 'general');
  assert.ok(soldier);
  Object.assign(soldier, {
    health: 20, tacticalRecovering: true, energy: 25,
    hydration: 80, foodReserve: 85, injury: 8, restingStructureId: null
  });
  Sim.stepDay(world);
  assert.notEqual(soldier.lastDecision?.action, 'field_rest',
    'field rest cannot replace serious wound evacuation');
});

test('legacy warfare retains its original home recovery behavior', () => {
  const world = mobilizedWorld('legacy');
  const soldier = world.campaigns[0].attacker.troopIds.map(id => world.people.find(p => p.id === id))
    .find(p => p && p.militaryRank !== 'general');
  assert.ok(soldier);
  Object.assign(soldier, {
    health: 85, tacticalRecovering: false, energy: 20,
    hydration: 80, foodReserve: 85, injury: 0, restingStructureId: null
  });
  Sim.stepDay(world);
  assert.notEqual(soldier.lastDecision?.action, 'field_rest');
});
