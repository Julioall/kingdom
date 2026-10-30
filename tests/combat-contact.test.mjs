import test from 'node:test';
import assert from 'node:assert/strict';
import { createCombatAction, resolveCombatAction, combatActionPhase } from '../src/simulation/kingdoms/combat-contact.js';
import { fightTacticalRound } from '../src/simulation/kingdoms/military.js';
import { attackStructure } from '../src/simulation/kingdoms/fortifications.js';
import { createActivityEffects } from '../src/ui/person-animations.js';
import { createMovementInterpolator } from '../src/ui/movement-interpolation.js';

function fixture(weapon = 'guerreiro', x = 1.5) {
  const actor = { id: 1, x: 0, y: 0, alive: true, role: 'soldier', militaryClass: weapon,
    kingdomId: 1, health: 100, stamina: 100, maxCombatHealth: 360 };
  const target = { ...actor, id: 2, kingdomId: 2, x, militaryClass: 'guerreiro', militaryFacingX: -1, militaryFacingY: 0 };
  const world = { day: 1, nextId: 1000, rngState: 42, people: [actor, target], kingdoms: [],
    width: 128, height: 128, structures: [], campaigns: [], tiles: [] };
  const action = createCombatAction(world, actor, target, 1);
  let count = 0;
  const resolve = (options = {}, candidates = [target]) => resolveCombatAction(world, actor, action, candidates,
    (_, blocked) => { count++; return blocked ? 3 : 10; }, options);
  return { actor, target, world, action, resolve, count: () => count };
}

function aimInEightDirections(attack, angle, targetDistance) {
  const center = 64;
  attack.world.tiles = Array.from({ length: attack.world.width * attack.world.height }, (_, i) => ({
    i, x: i % attack.world.width, y: Math.floor(i / attack.world.width), terrain: 'land',
    slope: 0, plants: []
  }));
  attack.actor.x = center; attack.actor.y = center;
  attack.target.x = center + Math.cos(angle) * targetDistance;
  attack.target.y = center + Math.sin(angle) * targetDistance;
  attack.action.origin = { x: attack.actor.x, y: attack.actor.y };
  attack.action.aim = { x: attack.target.x, y: attack.target.y };
  attack.action.angle = angle;
}

for (const weapon of ['guerreiro', 'lanceiro', 'arqueiro']) {
  test(`${weapon}: confirmed contact is consistent in eight world directions`, () => {
    const radius = weapon === 'guerreiro' ? 1.4 : weapon === 'lanceiro' ? 2.5 : 6.2;
    for (let direction = 0; direction < 8; direction++) {
      const angle = direction * Math.PI / 4;
      const f = fixture(weapon, radius);
      aimInEightDirections(f, angle, radius);
      const result = f.resolve();
      assert.equal(result.kind, 'body', `${weapon}, direction ${direction}`);
      assert.equal(result.targetId, f.target.id);
      assert.equal(result.hitbox.shape, 'circle');
      assert.ok(Number.isFinite(result.point.x) && Number.isFinite(result.point.y));
      assert.deepEqual(f.action.timing, { windupStartMs: 0, releaseMs: f.action.windupMs,
        activeEndMs: f.action.windupMs + f.action.activeMs, contactMs: result.atMs,
        recoveryStartMs: f.action.windupMs + f.action.activeMs, completionMs: f.action.durationMs });
      assert.equal(f.world.combatEvents.at(-1).result.targetId, f.target.id);
    }
  });
}

for (const weapon of ['guerreiro', 'lanceiro', 'arqueiro']) {
  test(`${weapon}: a low attack cannot pass through rock or damage the target behind it`, () => {
    const radius = weapon === 'guerreiro' ? 1.4 : weapon === 'lanceiro' ? 2.5 : 6.2;
    const f = fixture(weapon, radius);
    aimInEightDirections(f, 0, radius);
    const rock = f.world.tiles[64 * f.world.width + 65];
    rock.terrain = 'rock';

    const result = f.resolve();

    assert.equal(result.kind, 'obstructed');
    assert.equal(result.obstruction.terrain, 'rock');
    assert.equal(f.target.health, 100);
    assert.equal(f.count(), 0);
    assert.deepEqual(f.action.hitTargets, []);
  });
}

test('phases, confirmed damage, independent IDs and idempotent resolution', () => {
  const f = fixture();
  assert.deepEqual([199, 200, 300, 400].map(t => combatActionPhase(f.action, t)), ['windup', 'active', 'recovery', 'complete']);
  const hit = f.resolve();
  assert.equal(hit.kind, 'body'); assert.ok(hit.atMs >= 200 && hit.atMs <= 300);
  assert.equal(f.resolve(), hit); assert.equal(f.count(), 1);
  assert.equal(f.world.nextId, 1000); assert.equal(f.world.rngState, 42);
  assert.equal(f.world.combatEvents.length, 1); assert.deepEqual(f.action.hitTargets, [2]);
  assert.ok(Object.values(hit.point).every(Number.isFinite));
  assert.ok(Math.abs(Math.hypot(hit.normal.x, hit.normal.y) - 1) < 1e-8);
});

test('manual archer target lock preserves the hovered character as the shot aim', () => {
  const { actor, target, world } = fixture('arqueiro', 7);
  const aim = { x: target.x, y: target.y + .2 };
  const action = createCombatAction(world, actor, target, 1, { aim, reach: 8, targetLock: true });
  assert.deepEqual(action.aim, aim);
});

for (const weapon of ['guerreiro', 'lanceiro', 'arqueiro']) {
  test(`${weapon}: front shield blocks, rear bypasses, inactive guard does not block`, () => {
    const front = fixture(weapon, weapon === 'arqueiro' ? 8 : 1.5);
    assert.equal(front.resolve({ guarding: new Set([2]) }).kind, 'shield');
    assert.equal(front.action.result.damageApplied, 3);
    const rear = fixture(weapon, weapon === 'arqueiro' ? 8 : 1.5); rear.target.militaryFacingX = 1;
    assert.equal(rear.resolve({ guarding: new Set([2]) }).kind, 'body');
    const none = fixture(weapon, weapon === 'arqueiro' ? 8 : 1.5);
    assert.equal(none.resolve().kind, 'body');
  });
  test(`${weapon}: misses outside range and after lateral dodge`, () => {
    const outOfRange = fixture(weapon, 20);
    assert.equal(outOfRange.resolve().kind, 'miss');
    assert.equal(outOfRange.count(), 0, 'a visual or range miss cannot call the damage function');
    const f = fixture(weapon, weapon === 'arqueiro' ? 8 : 2);
    assert.equal(f.resolve({ beforeStep: t => { f.target.y = Math.min(2, t / f.action.windupMs * 2); } }).kind, 'miss');
    assert.equal(f.count(), 0, 'a target that moved out of the swept contact volume receives no damage');
  });
}

test('spear only hits in front; its guard intercepts melee but does not block arrows', () => {
  const rear = fixture('lanceiro', 2); rear.target.x = -.8; assert.equal(rear.resolve().kind, 'miss');
  const f = fixture('lanceiro', 2); f.target.militaryClass = 'lanceiro';
  assert.equal(f.resolve({ guarding: new Set([2]) }).kind, 'weapon-guard');
  const arrow = fixture('arqueiro', 8); arrow.target.militaryClass = 'lanceiro';
  assert.equal(arrow.resolve({ guarding: new Set([2]) }).kind, 'body');
});

test('sword chooses the earliest angular contact, rather than the closest body later in the same step', () => {
  const f = fixture();
  const earlier = { ...f.target, id: 3, x: 1.1495660704228228, y: -1.1836375499842124 };
  const later = { ...f.target, id: 4, x: .7829018449024522, y: -.33100559096235305 };
  assert.equal(f.resolve({}, [later, earlier]).targetId, earlier.id);
});

test('projectile hits the first enemy along the flight and never an ally or sheltered person', () => {
  const f = fixture('arqueiro', 8);
  // Put the interceptor late enough in the descent that the arcing arrow can reach a ground target.
  const intercepted = { ...f.target, id: 3, x: f.action.aim.x * .85, y: f.action.aim.y * .85 };
  const ally = { ...intercepted, id: 4, x: 2, kingdomId: 1 };
  const resting = { ...intercepted, id: 5, x: 3, restingStructureId: 10 };
  const hit = f.resolve({}, [f.target, ally, resting, intercepted]);
  assert.equal(hit.targetId, 3);
  assert.ok(hit.atMs > f.action.windupMs && hit.atMs < f.action.windupMs + f.action.flightMs);
});

test('ground melee misses the tower platform, arrows reach the platform', () => {
  const f = fixture(); f.target.towerMounted = true; assert.equal(f.resolve().kind, 'miss');
  const arrow = fixture('arqueiro', 8); arrow.target.towerMounted = true; arrow.action.targetElevation = 3;
  assert.equal(arrow.resolve().kind, 'body');
});

test('tower arrow elevation clears a low rock screen and still resolves its aimed platform contact', () => {
  const f = fixture('arqueiro', 6.2);
  aimInEightDirections(f, 0, 6.2);
  f.actor.towerMounted = true; f.target.towerMounted = true;
  f.action.sourceElevation = 3; f.action.targetElevation = 3;
  f.world.tiles[64 * f.world.width + 66].terrain = 'rock';

  const result = f.resolve();

  assert.equal(result.kind, 'body');
  assert.equal(result.targetId, f.target.id);
  assert.ok(Math.abs(result.contactElevation - 3) <= .65,
    'the projectile should contact within the tower platform hitbox height');
});

test('melee contact uses the physical building footprint as line-of-sight obstruction', () => {
  const f = fixture('lanceiro', 2.5);
  aimInEightDirections(f, 0, 2.5);
  f.world.structures.push({ id: 90, type: 'casa', x: 65, y: 64.75746727747703,
    complete: true, builtDay: 1, integrity: 1, kingdomId: 1 });

  const result = f.resolve();

  assert.equal(result.kind, 'obstructed');
  assert.equal(result.obstruction.kind, 'structure');
  assert.equal(result.obstruction.structureId, 90);
  assert.equal(f.count(), 0);
});

test('descending arrows cannot hit a body while still above it, even across a substep', () => {
  const f = fixture('arqueiro', 8); f.actor.towerMounted = true;
  f.action.sourceElevation = 3;
  const underFlight = { ...f.target, id: 3, x: 5.7 };
  const hit = f.resolve({}, [underFlight, f.target]);
  assert.equal(hit.targetId, f.target.id, 'arrow clears the intermediate body before descending to body height');
});

test('earliest sword contact remains consistent through rotations and reversed candidate order', () => {
  for (let i = 0; i < 24; i++) {
    const angle = i / 24 * Math.PI * 2;
    const f = fixture();
    f.action.angle = angle;
    const rotate = (id, x, y) => ({ ...f.target, id,
      x: x * Math.cos(angle) - y * Math.sin(angle), y: x * Math.sin(angle) + y * Math.cos(angle) });
    const earlier = rotate(3, 1.1495660704228228, -1.1836375499842124);
    const later = rotate(4, .7829018449024522, -.33100559096235305);
    const hit = f.resolve({}, i % 2 ? [earlier, later] : [later, earlier]);
    assert.equal(hit.targetId, 3, `rotation ${i}`);
    assert.ok(hit.atMs > 200 && hit.atMs < 210);
  }
});

test('death cancels preparation, but death immediately after arrow release does not cancel the flight', () => {
  const f = fixture(); f.actor.alive = false; assert.equal(f.resolve().kind, 'cancelled'); assert.equal(f.count(), 0);
  const arrow = fixture('arqueiro', 8);
  assert.equal(arrow.resolve({ beforeStep: t => { if (t > arrow.action.windupMs) arrow.actor.alive = false; } }).kind, 'body');
});

test('history is bounded and bodies already dead cannot receive another contact', () => {
  const f = fixture(); f.target.alive = false; assert.equal(f.resolve().kind, 'miss');
  for (let i = 0; i < 140; i++) resolveCombatAction(f.world, f.actor,
    createCombatAction(f.world, f.actor, f.target, i + 2), [], () => assert.fail());
  assert.equal(f.world.combatEvents.length, 128);
});

test('tactical attack counts one impact and pays stamina once despite repeated rounds', () => {
  const f = fixture(); f.actor.towerMounted = true; f.target.towerMounted = true;
  f.world.day = 0; f.world.combatSequence = 0;
  fightTacticalRound(f.world, [f.actor], [f.target], 1);
  assert.ok(f.target.health < 100); assert.equal(f.target.lastAttackSequence, 1);
  const health = f.target.health, stamina = f.actor.stamina;
  fightTacticalRound(f.world, [f.actor], [f.target], 1);
  assert.equal(f.target.health, health); assert.equal(f.actor.stamina, stamina);
});

test('siege applies contact damage, cooldown and allegiance restrictions', () => {
  const f = fixture(); f.actor.x = 5; f.actor.y = 5;
  const tower = { id: 10, type: 'torre', kingdomId: 2, x: 7, y: 5, complete: true, health: 6000, maxHealth: 6000 };
  f.world.structures = [tower];
  assert.equal(attackStructure(f.world, f.actor, tower, 1), 24);
  assert.equal(tower.lastAttackSequence, 1);
  assert.equal(attackStructure(f.world, f.actor, tower, 1), 0);
  tower.kingdomId = 1; assert.equal(attackStructure(f.world, f.actor, tower, 3), 0);
});

test('effects wait for release/contact, expire, and do not replay on redraw or reset', () => {
  const f = fixture('arqueiro', 8); f.resolve(); const effects = createActivityEffects();
  effects.observe(f.world, 1000);
  const releaseAt = 1000 + f.action.windupMs;
  assert.equal(effects.active(releaseAt - 1).filter(e => e.projectile).length, 0);
  assert.equal(effects.active(releaseAt).filter(e => e.projectile).length, 1);
  effects.observe(f.world, releaseAt + 100);
  assert.equal(effects.active(releaseAt + 100).filter(e => e.projectile).length, 1);
  assert.equal(effects.active(1000 + f.action.result.atMs).filter(e => !e.projectile).length, 1);
  effects.observe(f.world, 2000, true); assert.equal(effects.active(2000).length, 0);
});

test('body impact presentation is anchored to the confirmed contact point and simulated contact time', () => {
  const f = fixture('guerreiro');
  f.resolve();
  const effects = createActivityEffects();
  effects.observe(f.world, 1000);

  const impact = effects.active(1000 + f.action.result.atMs).find(effect => !effect.projectile);

  assert.ok(impact);
  assert.equal(impact.startedAt, 1000 + f.action.result.atMs);
  assert.equal(impact.x, f.action.result.point.x);
  assert.equal(impact.y, f.action.result.point.y - f.action.result.contactElevation);
});

test('movement must use snapshot arrival time even while the animation clock pauses or accelerates', () => {
  const movement = createMovementInterpolator();
  const person = { id: 1, alive: true, x: 0, y: 0 };
  const world = { day: 0, people: [person], animals: [] };
  movement.observe(world, 10000, { reset: true });
  person.x = 1; world.day = 1; movement.observe(world, 11000);
  assert.ok(movement.pose('person', person, 11560).x > .4);
  person.x = 2; world.day = 2; movement.observe(world, 12000, { speed: 3 });
  assert.ok(movement.pose('person', person, 12560).x > 1.4);
});
