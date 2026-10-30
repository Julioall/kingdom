import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../src/simulation/engine.js';
import { dispatchCommand } from '../src/simulation/commands.js';
import { manualAttackProfile } from '../src/simulation/kingdoms/military.js';
import { moveOne } from '../src/simulation/individuals/movement.js';
import { createSimulationWorkerRuntime } from '../src/simulation/worker-runtime.js';
import { SIMULATION_PROTOCOL_VERSION } from '../src/simulation/protocol-version.js';

function fixture(militaryClass) {
  const world = Sim.createWorld(42);
  const actor = world.people.find(p => p.militaryClass === militaryClass);
  assert.ok(actor);
  world.people = [actor]; world.structures = [];
  world.peopleSpatialIndex = null;
  for (const tile of world.tiles) {
    tile.terrain = 'land'; tile.elevationLevel = 0; tile.slope = 0;
    tile.plants.fill(0); tile.stoneDeposit = 0; tile.goldOre = 0;
  }
  Object.assign(actor, { x: 30, y: 30, stamina: 100, health: 100 });
  dispatchCommand(world, { type: 'player-control', personId: actor.id, enabled: true });
  return { world, actor };
}

test('manual spear flurry turns with aim, charges once and stops after a second without contact', () => {
  const { world, actor } = fixture('lanceiro');
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  try {
    dispatchCommand(world, { type: 'player-action', personId: actor.id, actionKey: '2', aimX: 34, aimY: 30 });
    assert.equal(actor.stamina, 76);
    assert.equal(actor.playerFlurryUntil, now + 3000);
    const firstId = actor.combatAction.id;
    now += 250;
    dispatchCommand(world, { type: 'player-input', personId: actor.id, moveX: 1, moveY: 0,
      dt: .1, defending: false, aimX: 30, aimY: 34 });
    assert.ok(actor.combatAction.id > firstId);
    assert.ok(Math.abs(actor.combatAction.angle - Math.PI / 2) < .001);
    assert.equal(actor.stamina, 76);
    assert.equal(actor.x, 30);
    now += 800;
    dispatchCommand(world, { type: 'player-input', personId: actor.id, moveX: 0, moveY: 0,
      defending: false, aimX: 26, aimY: 30 });
    assert.equal(actor.playerFlurryUntil, 0);
  } finally { Date.now = originalNow; }
});

for (const militaryClass of ['guerreiro', 'lanceiro', 'arqueiro']) {
  test(`${militaryClass}: manual movement responds without advancing the calendar and AI cannot move it`, () => {
    const { world, actor } = fixture(militaryClass);
    const day = world.day;
    dispatchCommand(world, { type: 'player-input', personId: actor.id, moveX: 1, moveY: 0,
      dt: .1, defending: false, aimX: 34, aimY: 30 });
    assert.ok(actor.x > 30 && actor.x < 31);
    assert.equal(world.day, day);
    const x = actor.x, y = actor.y;
    assert.equal(moveOne(world, actor, { x: 28, y: 30 }, false), false);
    assert.deepEqual([actor.x, actor.y], [x, y]);
    dispatchCommand(world, { type: 'player-control', personId: actor.id, enabled: false });
    assert.equal(actor.playerControlled, false);
  });
  test(`${militaryClass}: basic attack works toward empty ground without waiting for a day`, () => {
    const { world, actor } = fixture(militaryClass);
    const day = world.day;
    dispatchCommand(world, { type: 'player-action', personId: actor.id, actionKey: '1', aimX: 34, aimY: 30 });
    assert.ok(actor.combatAction);
    assert.equal(actor.combatAction.weapon, militaryClass);
    assert.ok(actor.stamina < 100);
    assert.equal(world.day, day);
    assert.ok(actor.combatAction.aim.x > actor.x);
    const attackId = actor.combatAction.id;
    const stamina = actor.stamina;
    dispatchCommand(world, { type: 'player-action', personId: actor.id, actionKey: '1', aimX: 34, aimY: 30 });
    assert.equal(actor.combatAction.id, attackId);
    assert.equal(actor.stamina, stamina);
  });
}

test('controlled warrior enters and leaves shield defense from F input', () => {
  const { world, actor } = fixture('guerreiro');
  dispatchCommand(world, { type: 'player-input', personId: actor.id, moveX: 0, moveY: 0,
    dt: 0, defending: true, aimX: actor.x + 1, aimY: actor.y });
  assert.equal(actor.playerDefending, true);
  assert.equal(actor.state, 'mantendo posição defensiva');
  assert.equal(actor.militaryAnimation, 'defend');
  dispatchCommand(world, { type: 'player-input', personId: actor.id, moveX: 0, moveY: 0,
    dt: 0, defending: false, aimX: actor.x + 1, aimY: actor.y });
  assert.equal(actor.playerDefending, false);
  assert.equal(actor.state, 'controlado pelo jogador');
});

test('controlled warrior chains distinct attack animations in 1-2-1-2 order', () => {
  const { world, actor } = fixture('guerreiro');
  for (const [key, comboIndex] of [['1', 1], ['2', 2], ['1', 3], ['2', 4]]) {
    actor.playerNextAttackAt = 0;
    if (actor.playerWarriorCombo) actor.playerWarriorCombo.lastAttackAt = Date.now() - 200;
    dispatchCommand(world, { type: 'player-action', personId: actor.id, actionKey: key,
      aimX: actor.x + 1, aimY: actor.y });
    assert.equal(actor.combatAction.comboIndex, comboIndex);
    assert.equal(actor.combatAction.comboIndex % 2 === 0, key === '2');
  }
});

test('controlled monk can use E or 1 to heal the selected nearby ally', () => {
  const world = Sim.createWorld(42);
  const monk = world.people.find(p => p.militaryClass === 'monge');
  const ally = world.people.find(p => p.kingdomId === monk.kingdomId && p.id !== monk.id && p.role === 'soldier');
  world.people = [monk, ally]; world.structures = [];
  world.peopleSpatialIndex = null;
  Object.assign(monk, { x: 30, y: 30, mana: 60, maxMana: 200 });
  Object.assign(ally, { x: 31, y: 30, health: 40, alive: true });
  dispatchCommand(world, { type: 'player-control', personId: monk.id, enabled: true });
  const result = dispatchCommand(world, { type: 'player-action', personId: monk.id, actionKey: '1',
    aimX: ally.x, aimY: ally.y, targetId: ally.id });
  assert.equal(result.ok, true);
  assert.equal(ally.health, 40, 'healing waits for the cast to finish');
  dispatchCommand(world, { type: 'magic-tick', elapsedMs: 350 });
  assert.ok(ally.health > 40);
  assert.equal(monk.mana, 48);
  assert.equal(monk.lastHealingCast.primaryTargetId, ally.id);
});

test('archer arrow rain deals a strong area hit over its three-second duration', () => {
  const rain = manualAttackProfile({ role: 'soldier', militaryClass: 'arqueiro' }, '2');
  assert.equal(rain.rainDurationMs, 3000);
  assert.equal(rain.arrowCount, 36);
  assert.ok(rain.splashMultiplier >= 3);
});

test('manual arrow rain damages the enemy inside its impact circle', () => {
  const world = Sim.createWorld(42);
  const archer = world.people.find(p => p.militaryClass === 'arqueiro');
  const enemy = world.people.find(p => p.kingdomId !== archer.kingdomId && p.role === 'soldier');
  world.people = [archer, enemy]; world.structures = [];
  world.peopleSpatialIndex = null;
  Object.assign(archer, { x: 30, y: 30, stamina: 400, playerControlled: true });
  Object.assign(enemy, { x: 34, y: 30, health: 100, alive: true });
  world.playerControlledPersonId = archer.id;
  const healthBefore = enemy.health;
  dispatchCommand(world, { type: 'player-action', personId: archer.id, actionKey: '2',
    aimX: enemy.x, aimY: enemy.y, targetId: enemy.id });
  assert.ok(enemy.health < healthBefore, 'the area rain must remove health from its aimed target');
  assert.ok(archer.combatAction.result.areaHitTargets.includes(enemy.id));
  assert.equal(archer.combatAction.arrowCount, 36);
});

test('manual movement respects a solid tile instead of navigating around it', () => {
  const { world, actor } = fixture('guerreiro');
  world.tiles[30 * world.width + 31].terrain = 'rock';
  for (let i = 0; i < 10; i++) dispatchCommand(world, { type: 'player-input', personId: actor.id,
    moveX: 1, moveY: 0, dt: .1, defending: false });
  assert.ok(actor.x < 31);
  assert.equal(actor.y, 30);
});

test('Worker sends small authoritative updates for movement and attacks, preserving full snapshots for simulation', () => {
  const { world, actor } = fixture('arqueiro');
  const runtime = createSimulationWorkerRuntime({ createWorldImpl: () => world });
  let id = 0;
  const request = (type, body) => runtime.handle({ type, requestId: ++id, epoch: 1,
    protocolVersion: SIMULATION_PROTOCOL_VERSION, ...body });
  const initial = request('initialize', { config: { scenario: 'kingdom' }, seed: 42 });
  assert.equal(initial.type, 'snapshot');
  const movement = request('dispatch', { command: { type: 'player-input', personId: actor.id,
    moveX: 1, moveY: 0, dt: .05, defending: false } });
  assert.equal(movement.type, 'player-update');
  assert.equal(movement.person.id, actor.id);
  assert.ok(movement.person.x > 30);
  assert.equal(movement.snapshot, undefined);
  assert.ok(JSON.stringify(movement).length < JSON.stringify(initial).length / 100);
  const attack = request('dispatch', { command: { type: 'player-action', personId: actor.id,
    actionKey: '1', aimX: 34, aimY: 30 } });
  assert.equal(attack.type, 'player-update');
  assert.ok(attack.people.find(person => person.id === actor.id).combatAction);
  assert.ok(attack.combatEvents.length > 0);
  const release = request('dispatch', { command: { type: 'player-control', personId: actor.id, enabled: false } });
  assert.equal(release.type, 'snapshot');
  assert.equal(release.snapshot.base.people[0].x, movement.person.x);
});
