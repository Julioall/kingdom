import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchCommand } from '../src/simulation/commands.js';
import { advanceMagic, magicHasActivity } from '../src/simulation/magic/system.js';
import { moveOne } from '../src/simulation/individuals/movement.js';
import { isCombatStunned, stunCombatPerson } from '../src/simulation/kingdoms/combat-status.js';
import { launchCombatPerson } from '../src/simulation/kingdoms/military.js';
import { knockbackPose } from '../src/ui/knockback-presentation.js';
import { spendAttackStamina } from '../src/simulation/kingdoms/combat-resources.js';

function fixture(weapon = 'guerreiro') {
  const actor = { id: 1, x: 10, y: 10, alive: true, role: 'soldier', militaryClass: weapon, militaryLevel: 7,
    kingdomId: 1, health: 100, stamina: 400, maxStamina: 400 };
  const victims = [12, 13, 14].map((x, i) => ({ ...actor, id: i + 2, x,
    militaryClass: 'arqueiro', kingdomId: 2, playerControlled: true, militaryFacingX: 1 }));
  const world = { day: 1, width: 32, height: 32, nextId: 100, rngState: 42, magicTimeMs: 0,
    combatEvents: [], kingdoms: [], people: [actor, ...victims], structures: [],
    tiles: Array.from({ length: 1024 }, (_, i) => ({ i, x: i % 32, y: Math.floor(i / 32),
      terrain: 'land', elevationLevel: 0, slope: 0, plants: [] })) };
  dispatchCommand(world, { type: 'player-control', personId: actor.id, enabled: true });
  return { world, actor, victims };
}

for (const weapon of ['guerreiro', 'lanceiro']) test(`${weapon}: charge throws every contacted body and blocks commands until recovery`, () => {
  const { world, actor, victims } = fixture(weapon);
  const origins = victims.map(victim => ({ x: victim.x, y: victim.y }));
  dispatchCommand(world, { type: 'player-action', personId: actor.id, actionKey: '3', aimX: 15, aimY: 10 });
  assert.equal(actor.combatAction.hitTargets.length, 3);
  for (const [index, victim] of victims.entries()) {
    assert.ok(Math.hypot(victim.x - origins[index].x, victim.y - origins[index].y) > 2);
    assert.equal(victim.health, 100, 'push-only charges do not remove health');
    assert.ok(isCombatStunned(victim, world.day, world.magicTimeMs));
    assert.equal(victim.combatLaunch.durationMs, 600);
    assert.equal(victim.combatStunnedUntilMs, victim.combatLaunch.atMs + 3600);
  }
  const victim = victims[0];
  dispatchCommand(world, { type: 'player-control', personId: victim.id, enabled: true });
  const position = { x: victim.x, y: victim.y }, stamina = victim.stamina;
  const input = { type: 'player-input', personId: victim.id, moveX: 0, moveY: 1, dt: .1, defending: false };
  assert.equal(dispatchCommand(world, input).reason, 'stunned');
  assert.equal(dispatchCommand(world, { type: 'player-action', personId: victim.id, actionKey: '1', aimX: 10, aimY: 10 }).reason, 'stunned');
  assert.deepEqual({ x: victim.x, y: victim.y }, position);
  assert.equal(victim.stamina, stamina);
  victim.playerControlled = false;
  assert.equal(moveOne(world, victim, { x: victim.x, y: victim.y + 2 }, false), false);
  victim.playerControlled = true;
  assert.equal(magicHasActivity(world), true, 'stun timers advance even without priests');
  advanceMagic(world, victim.combatStunnedUntilMs - 1);
  assert.equal(dispatchCommand(world, input).reason, 'stunned');
  advanceMagic(world, 1);
  assert.equal(isCombatStunned(victim, world.day, world.magicTimeMs), false);
  assert.equal(dispatchCommand(world, input).ok, true);
});

test('shield dash limits distinct victims by earned level even inside a dense formation', () => {
  for (const level of [4, 7]) {
    const { world, actor, victims } = fixture();
    actor.militaryLevel = level;
    world.people = [actor, ...Array.from({ length: 12 }, (_, i) => ({ ...victims[0],
      id: i + 2, x: 11.2 + i * .25, y: 10 }))];
    dispatchCommand(world, { type: 'player-action', personId: actor.id, actionKey: '3', aimX: 15, aimY: 10 });
    assert.equal(actor.combatAction.hitTargets.length, Math.min(7, level + 1));
    assert.equal(world.people.filter(person => person.combatLaunch).length, Math.min(7, level + 1));
  }
});

test('airborne knockback sweeps solid obstacles and lands before water or walls', () => {
  const { world, actor, victims } = fixture();
  const victim = victims[0]; world.people = [actor, victim];
  for (let y = 0; y < 32; y++) world.tiles[y * 32 + 14].terrain = 'water';
  launchCombatPerson(world, victim, actor, { id: 1, angle: 0, origin: actor, attackVariant: 'shield-bash' });
  assert.ok(victim.x < 14);
  assert.ok(victim.x > 12);
});

test('parry stun rejects movement and all manual actions for three simulated seconds', () => {
  const { world, actor } = fixture();
  stunCombatPerson(world, actor, 2, 3000);
  assert.equal(spendAttackStamina(actor, world.day + 10, { nowMs: 0 }), false,
    'fast-forwarding the day does not bypass the simulated-second stun');
  for (const key of ['1', '2', '3', '4', '5']) assert.equal(dispatchCommand(world,
    { type: 'player-action', personId: actor.id, actionKey: key, aimX: 12, aimY: 10 }).reason, 'stunned');
  assert.equal(dispatchCommand(world, { type: 'player-input', personId: actor.id,
    moveX: 1, moveY: 0, dt: .1, defending: true }).reason, 'stunned');
  assert.equal(actor.playerDefending, false);
  advanceMagic(world, 3000);
  assert.equal(isCombatStunned(actor, world.day, world.magicTimeMs), false);
});

test('impact visual hops and lands without rotating the sprite sideways', () => {
  const launch = { from: { x: 0, y: 0 }, to: { x: 3, y: 1 }, atMs: 100,
    durationMs: 600, height: .8 };
  const before = knockbackPose(launch, 0), middle = knockbackPose(launch, 400), after = knockbackPose(launch, 700);
  assert.equal(before.lift, 0);
  assert.ok(middle.x > 0 && middle.x < 3);
  assert.equal(middle.lift, .8);
  assert.deepEqual([after.x, after.y, after.lift], [3, 1, 0]);
  assert.ok([before, middle, after].every(pose => pose.rotation === 0));
});
