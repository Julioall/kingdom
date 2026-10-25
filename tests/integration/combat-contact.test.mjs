import test from 'node:test';
import assert from 'node:assert/strict';
import { createCombatAction, resolveCombatAction, segmentCircle, combatActionPhase } from '../../src/simulation/kingdoms/combat-contact.js';
import { createActivityEffects } from '../../src/ui/person-animations.js';
import { fightTacticalRound } from '../../src/simulation/kingdoms/military.js';

function fixture(weapon = 'guerreiro', distance = 1.5) {
  const actor = { id: 1, x: 0, y: 0, militaryClass: weapon, kingdomId: 1, alive: true };
  const target = { id: 2, x: distance, y: 0, militaryClass: 'guerreiro', kingdomId: 2,
    militaryFacingX: -1, militaryFacingY: 0, alive: true };
  const world = { day: 1, people: [actor, target], kingdoms: [], width: 128, tiles: [] };
  const action = createCombatAction(world, actor, target, 1);
  let count = 0;
  const resolve = (guard = false, candidates = [target]) => resolveCombatAction(world, actor, action, candidates,
    (_, blocked) => { count++; return blocked ? 3 : 10; }, { guarding: new Set(guard ? [target.id] : []) });
  return { world, actor, target, action, resolve, count: () => count };
}

test('active sword sweeps contact once; repeat resolution is idempotent and uses separate IDs', () => {
  const f = fixture(); f.world.nextId = 500; f.world.rngState = 42;
  const result = f.resolve();
  assert.equal(result.kind, 'body');
  assert.ok(result.atMs >= f.action.windupMs);
  assert.equal(f.resolve(), result); assert.equal(f.count(), 1);
  assert.equal(f.world.combatEvents.length, 1);
  assert.equal(f.world.nextId, 500); assert.equal(f.world.rngState, 42);
  assert.deepEqual(f.action.hitTargets, [2]);
  assert.equal(combatActionPhase(f.action, 199), 'windup');
  assert.equal(combatActionPhase(f.action, 200), 'active');
  assert.equal(combatActionPhase(f.action, 300), 'recovery');
  assert.equal(combatActionPhase(f.action, 400), 'complete');
});

test('front shield intercepts before the body with chip damage; rear attack bypasses it', () => {
  const front = fixture(); assert.equal(front.resolve(true).kind, 'shield');
  assert.equal(front.action.result.damageApplied, 3);
  const rear = fixture(); rear.target.militaryFacingX = 1;
  assert.equal(rear.resolve(true).kind, 'body'); assert.equal(rear.count(), 1);
});

test('spear guard can intercept melee, while crossed inactive weapons do not parry', () => {
  const f = fixture('lanceiro', 2); f.target.militaryClass = 'lanceiro';
  assert.equal(f.resolve(true).kind, 'weapon-guard');
  const other = fixture('lanceiro', 2); other.target.militaryClass = 'lanceiro';
  assert.equal(other.resolve().kind, 'body');
});

test('spear tip misses a target behind its origin and a moving dodge leaves the frozen aim', () => {
  const f = fixture('lanceiro', 2); f.target.x = -.8;
  assert.equal(f.resolve().kind, 'miss'); assert.equal(f.count(), 0);
  const dodged = fixture('lanceiro', 2); dodged.target.y = 2;
  assert.equal(dodged.resolve().kind, 'miss'); assert.equal(dodged.count(), 0);
});

test('ground melee cannot hit tower platform; arrows release before contact and intercept first enemy', () => {
  const ground = fixture(); ground.target.towerMounted = true;
  assert.equal(ground.resolve().kind, 'miss');
  const f = fixture('arqueiro', 8);
  const interceptor = { ...f.target, id: 3, x: 4 };
  const hit = f.resolve(false, [f.target, interceptor]);
  assert.equal(hit.targetId, 3); assert.ok(hit.atMs > 500); assert.ok(hit.atMs < 940);
  const elevated = fixture('arqueiro', 8); elevated.target.towerMounted = true;
  // Recreate to capture the elevated aim before the shot.
  elevated.action.targetElevation = 3;
  assert.equal(elevated.resolve().kind, 'body');
});

test('shield intercepts a swept arrow; allies and sheltered people do not absorb it', () => {
  const f = fixture('arqueiro', 8); assert.equal(f.resolve(true).kind, 'shield');
  const g = fixture('arqueiro', 8);
  const ally = { ...g.target, x: 4, id: 3, kingdomId: 1 };
  const resting = { ...g.target, x: 5, id: 4, restingStructureId: 10 };
  assert.equal(g.resolve(false, [ally, resting, g.target]).targetId, 2);
  assert.equal(segmentCircle({ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 10, y: 0 }, .1) > 0, true);
});

test('dead attacker cancels preparation without damage; contacts have finite point and normal', () => {
  const f = fixture(); f.actor.alive = false;
  assert.equal(f.resolve().kind, 'cancelled'); assert.equal(f.count(), 0);
  const g = fixture(); const hit = g.resolve();
  assert.ok(Object.values(hit.point).every(Number.isFinite));
  assert.ok(Object.values(hit.normal).every(Number.isFinite));
});

test('movement during preparation changes contact, while a released arrow survives its caster', () => {
  const f = fixture('lanceiro', 2);
  const result = resolveCombatAction(f.world, f.actor, f.action, [f.target], () => assert.fail('dodge must miss'),
    { beforeStep: elapsed => { f.target.y = Math.min(1, elapsed / 100); } });
  assert.equal(result.kind, 'miss');
  const arrow = fixture('arqueiro', 8);
  const hit = resolveCombatAction(arrow.world, arrow.actor, arrow.action, [arrow.target], () => 10,
    { beforeStep: elapsed => { if (elapsed > 550) arrow.actor.alive = false; } });
  assert.equal(hit.kind, 'body');
});

test('projectile range is bounded and contact history remains bounded', () => {
  const f = fixture('arqueiro', 20); assert.equal(f.resolve().kind, 'miss');
  for (let i = 0; i < 140; i++) {
    const action = createCombatAction(f.world, f.actor, f.target, i + 2);
    resolveCombatAction(f.world, f.actor, action, [], () => 0);
  }
  assert.equal(f.world.combatEvents.length, 128);
  assert.equal(f.world.combatEvents.at(-1).id, f.world.combatSequence);
});

test('actual tactical damage increments the victim impact sequence once', () => {
  const f = fixture('guerreiro', 1.5);
  Object.assign(f.actor, { role: 'soldier', health: 100, stamina: 100 });
  Object.assign(f.target, { role: 'soldier', health: 100, towerMounted: true });
  f.actor.towerMounted = true; f.world.day = 0; f.world.rngState = 42;
  fightTacticalRound(f.world, [f.actor], [f.target], 1);
  assert.ok(f.target.health < 100); assert.equal(f.target.lastAttackSequence, 1);
  assert.equal(f.actor.combatAction.result.targetId, f.target.id);
});

test('presentation waits for release, contact effects wait for impact, redraw and reset do not replay', () => {
  const f = fixture('arqueiro', 8); f.resolve();
  const effects = createActivityEffects(); effects.observe(f.world, 1000);
  assert.equal(effects.active(1499).length, 0);
  assert.equal(effects.active(1500).filter(e => e.projectile).length, 1);
  effects.observe(f.world, 1600);
  assert.equal(effects.active(1600).filter(e => e.projectile).length, 1);
  const at = 1000 + f.action.result.atMs;
  assert.equal(effects.active(at).filter(e => !e.projectile).length, 1);
  effects.observe(f.world, at, true); assert.equal(effects.active(at).length, 0);
});
