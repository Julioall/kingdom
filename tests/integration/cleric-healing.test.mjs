import test from 'node:test';
import assert from 'node:assert/strict';
import { castAreaHealing, fightTacticalRound, selectHealingTarget, updateClericHealing } from '../../src/simulation/kingdoms/military.js';
import { createActivityEffects } from '../../src/ui/person-animations.js';
import { getAnimation } from '../../src/ui/animations.js';

const person = (id, values = {}) => ({ id, alive: true, role: 'soldier', kingdomId: 1,
  x: 0, y: 0, health: 100, injury: 0, maxCombatHealth: 300, ...values });
function fixture() {
  const cleric = person(1, { militaryClass: 'monge' });
  const critical = person(2, { x: 5, health: 15, injury: 2 });
  const nearby = person(3, { x: 4, health: 60, injury: .1 });
  const closeToCleric = person(4, { x: 1, health: 80 });
  const enemy = person(5, { x: 5, health: 5, kingdomId: 2 });
  const dead = person(6, { x: 5, health: 0, alive: false });
  const healthy = person(7, { x: 5 });
  const outside = person(8, { x: 10, health: 30 });
  const world = { day: 9, width: 16, people: [cleric, critical, nearby, closeToCleric, enemy, dead, healthy, outside],
    tiles: Array.from({ length: 256 }, () => ({ terrain: 'land' })), kingdoms: [{ id: 1, palette: 'blue' }] };
  return { world, cleric, critical, nearby, closeToCleric, enemy, dead, healthy, outside };
}

test('area healing centers on the most injured reachable ally and heals only injured friends in its radius', () => {
  const { world, cleric, critical, nearby, closeToCleric, enemy, dead, healthy, outside } = fixture();
  assert.equal(selectHealingTarget(cleric, world.people).id, critical.id);
  const recipients = castAreaHealing(world, cleric, world.people, 10);
  assert.deepEqual(recipients, [critical.id, nearby.id]);
  assert.equal(critical.health, 23);
  assert.ok(Math.abs(nearby.health - (60 + 16 / 3)) < 1e-8);
  assert.equal(nearby.injury, 0);
  assert.equal(closeToCleric.health, 80, 'area is centered on the priority patient, not the caster');
  assert.equal(enemy.health, 5);
  assert.equal(dead.health, 0);
  assert.equal(healthy.lastHealingSequence, undefined);
  assert.equal(outside.health, 30);
  assert.equal(critical.lastHealing.casterId, cleric.id);
  assert.equal(nearby.lastHealing.primaryTargetId, critical.id);
  assert.deepEqual(cleric.lastHealingCast.recipientIds, recipients);
});

test('cooldown prevents repeated spells and healing respects full health and death', () => {
  const { world, cleric, critical, nearby } = fixture();
  castAreaHealing(world, cleric, world.people, 10);
  const health = critical.health;
  assert.deepEqual(castAreaHealing(world, cleric, world.people, 11), []);
  assert.equal(critical.health, health);
  assert.ok(castAreaHealing(world, cleric, world.people, 16).length);
  for (const p of world.people) if (p.kingdomId === 1 && p.alive) p.health = 100;
  critical.health = 99;
  assert.deepEqual(castAreaHealing(world, cleric, world.people, 22), []);
  assert.equal(critical.health, 99);
  assert.equal(nearby.health, 100);
  assert.deepEqual(castAreaHealing(world, cleric, world.people, 28), []);
});

test('clerics ignore minor residual health loss instead of repeating healing effects', () => {
  const { world, cleric, healthy } = fixture();
  healthy.health = 99;
  const minorWounds = [cleric, healthy];
  assert.equal(selectHealingTarget(cleric, minorWounds), null);
  assert.deepEqual(castAreaHealing(world, cleric, minorWounds, 10), []);
  assert.equal(healthy.lastHealingSequence, undefined);
});

test('nearby soldiers assist a wounded ally by engaging the enemy that attacked them', () => {
  const ally = person(10, { x: 2.5, y: 0, health: 60, stamina: 0, lastAttackedDay: 3, lastAttackedById: 12 });
  const soldier = person(11, { militaryClass: 'guerreiro', x: 0, y: 0 });
  const distantEnemy = person(12, { kingdomId: 2, x: 1.7, y: 0 });
  const nearbyEnemy = person(13, { kingdomId: 2, x: .5, y: 1.2 });
  const world = { day: 4, width: 16, people: [soldier, ally, distantEnemy, nearbyEnemy],
    tiles: Array.from({ length: 256 }, () => ({ terrain: 'land' })), structures: [],
    kingdoms: [{ id: 1, palette: 'blue' }], rngState: 2 };

  fightTacticalRound(world, [soldier, ally], [distantEnemy, nearbyEnemy], 4);

  assert.equal(soldier.combatAction.targetId, distantEnemy.id, 'support prioritizes the wounded ally’s attacker');
  assert.equal(distantEnemy.lastAttackSequence, 1, 'a confirmed supporting strike counts as one impact');
  assert.equal(nearbyEnemy.lastAttackSequence, undefined);
});

test('clerics heal without enemies present, both in tactical rounds and during daily support', () => {
  const first = fixture();
  fightTacticalRound(first.world, first.world.people.filter(p => p.kingdomId === 1), [], 10);
  assert.equal(first.critical.health, 23);
  const second = fixture();
  updateClericHealing(second.world, 10);
  assert.equal(second.critical.health, 23);
  assert.equal(second.cleric.militaryAnimation, 'heal');
});

test('each spell recipient receives its own non-looping particles, without replaying on redraws or reset', () => {
  const { world, cleric, critical, nearby } = fixture();
  const effects = createActivityEffects();
  effects.observe(world, 0, true);
  castAreaHealing(world, cleric, world.people, 10);
  world.day = 10;
  effects.observe(world, 100);
  const healing = () => effects.active(100).filter(effect => effect.animation.endsWith('heal-effect'));
  assert.deepEqual(healing().map(effect => effect.personId), [critical.id, nearby.id]);
  assert.ok(healing().every(effect => effect.personId !== cleric.id));
  assert.ok(healing().every(effect => getAnimation(effect.animation).loop === false));
  effects.observe(world, 200);
  assert.equal(healing().length, 2);
  assert.equal(effects.active(2000).length, 0);
  effects.observe(world, 2100, true);
  assert.equal(effects.active(2100).length, 0);
});
