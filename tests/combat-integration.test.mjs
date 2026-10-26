import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../src/simulation/engine.js';
import { attackStructure } from '../src/simulation/kingdoms/fortifications.js';
import { fightTacticalRound, castAreaHealing } from '../src/simulation/kingdoms/military.js';
import { advanceTowerCapture } from '../src/simulation/kingdoms/tower-capture.js';
import { createCombatAction, resolveCombatAction } from '../src/simulation/kingdoms/combat-contact.js';
import { createActivityEffects } from '../src/ui/person-animations.js';

function siegeFixture() {
  const world = Sim.createWorld(42);
  const own = world.kingdoms[0], enemy = world.kingdoms[1];
  const tower = world.structures.find(s => s.kingdomId === enemy.id && s.type === 'torre');
  const actor = world.people.find(p => p.kingdomId === own.id && p.militaryClass === 'guerreiro');
  Object.assign(actor, { x: tower.x - 2, y: tower.y, health: 100, stamina: 100, militaryRestTargetId: null, restingStructureId: null });
  return { world, tower, actor, own, enemy };
}

test('capture damage stops at 25%, then five days of uncontested occupation transfer ownership without destruction', () => {
  const { world, tower, actor, own, enemy } = siegeFixture();
  tower.maxHealth = 6000; tower.health = 1501;
  const campaign = { id: 99999, attackerId: own.id, defenderId: enemy.id, status: 'engaged',
    evidence: { structureId: tower.id, mission: 'capture-tower' } };
  world.campaigns = [campaign]; actor.campaignId = campaign.id;
  assert.equal(attackStructure(world, actor, tower, 1), 1);
  assert.equal(tower.health, 1500); assert.equal(tower.kingdomId, enemy.id);
  const stamina = actor.stamina; assert.equal(attackStructure(world, actor, tower, 3), 0);
  assert.equal(actor.stamina, stamina); assert.equal(tower.destroyedDay, undefined);
  const second = world.people.find(p => p.kingdomId === own.id && p.militaryClass === 'lanceiro');
  Object.assign(second, { x: tower.x - 1, y: tower.y, health: 100 });
  for (const defender of world.people.filter(p => p.kingdomId === enemy.id && p.role === 'soldier')) {
    defender.x = tower.x + 20; defender.y = tower.y;
  }
  for (let day = 3; day < 7; day++) assert.equal(advanceTowerCapture(world, campaign, tower, [actor, second], [], day), false);
  assert.equal(advanceTowerCapture(world, campaign, tower, [actor, second], [], 7), true);
  assert.equal(tower.kingdomId, own.id); assert.equal(tower.complete, true); assert.equal(tower.destroyedDay, undefined);
});

test('lethal siege destroys once, releases the sentry and does not duplicate loot or attack damage', () => {
  const { world, tower, actor } = siegeFixture(); tower.health = 1;
  const sentry = world.people.find(p => p.kingdomId === tower.kingdomId && p.militaryClass === 'arqueiro');
  Object.assign(sentry, { towerDutyId: tower.id, towerMounted: true });
  assert.equal(attackStructure(world, actor, tower, 1), 1);
  assert.equal(tower.health, 0); assert.equal(tower.complete, false); assert.equal(tower.destroyedDay, 1);
  assert.equal(sentry.towerMounted, false);
  const loot = structuredClone(world.loot), sequence = tower.lastAttackSequence;
  assert.equal(attackStructure(world, actor, tower, 3), 0);
  assert.deepEqual(world.loot, loot); assert.equal(tower.lastAttackSequence, sequence);
});

test('lethal tactical hit records one casualty, victory and health impact', () => {
  const { world, actor, tower, enemy } = siegeFixture();
  const victim = world.people.find(p => p.kingdomId === enemy.id && p.role === 'soldier');
  Object.assign(actor, { towerMounted: true, x: tower.x - 1, y: tower.y });
  Object.assign(victim, { towerMounted: true, x: tower.x, y: tower.y, health: .01, maxCombatHealth: 220 });
  const deaths = world.deaths;
  assert.equal(fightTacticalRound(world, [actor], [victim], 1), 1);
  assert.equal(world.deaths, deaths + 1); assert.equal(actor.combatVictories, 1);
  assert.equal(victim.lastAttackSequence, 1); assert.equal(actor.combatAction.result.fatal, true);
  assert.equal(fightTacticalRound(world, [actor], [victim], 1), 0);
  assert.equal(world.deaths, deaths + 1);
});

test('exhausted soldiers cannot create attacks; area healing spends mana once and respects cooldown', () => {
  const { world, actor, enemy } = siegeFixture();
  const target = world.people.find(p => p.kingdomId === enemy.id && p.role === 'soldier');
  actor.stamina = 0; target.x = actor.x + 1; target.y = actor.y;
  const sequence = world.combatSequence || 0;
  fightTacticalRound(world, [actor], [target], 1);
  assert.equal(world.combatSequence || 0, sequence);
  const cleric = world.people.find(p => p.kingdomId === actor.kingdomId && p.militaryClass === 'monge');
  Object.assign(cleric, { x: actor.x, y: actor.y, mana: 30 });
  actor.health = 10;
  assert.ok(castAreaHealing(world, cleric, [actor], 1).includes(actor.id));
  assert.equal(cleric.mana, 0); assert.ok(actor.health > 10);
  assert.deepEqual(castAreaHealing(world, cleric, [actor], 1), []);
});

test('projectile presentation stops at actual interception height and skips obsolete batched events', () => {
  const actor = { id: 1, kingdomId: 1, x: 0, y: 0, militaryClass: 'arqueiro', alive: true };
  const intended = { id: 2, kingdomId: 2, x: 8, y: 0, towerMounted: true, alive: true };
  const interceptor = { id: 3, kingdomId: 2, x: 1, y: 0, alive: true };
  const world = { day: 1, people: [actor, intended, interceptor], kingdoms: [], tiles: [], width: 128 };
  const action = createCombatAction(world, actor, intended, 1);
  resolveCombatAction(world, actor, action, [intended, interceptor], () => 10);
  assert.equal(action.result.targetId, 3); assert.ok(action.result.contactElevation < .65);
  const effects = createActivityEffects(); effects.observe(world, 0);
  const arrow = effects.active(500).find(e => e.projectile);
  assert.equal(arrow.targetY, -action.result.contactElevation);
  const caughtUp = createActivityEffects(); world.day = 5; caughtUp.observe(world, 1000);
  assert.deepEqual(caughtUp.active(2000), []);
});
