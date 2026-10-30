import test from 'node:test';
import assert from 'node:assert/strict';
import { ARROW_RAIN_TIMING, createCombatAction, resolveCombatAction } from '../src/simulation/kingdoms/combat-contact.js';
import { createActivityEffects } from '../src/ui/person-animations.js';

function fixture() {
  const actor = { id: 1, alive: true, x: 10, y: 10, kingdomId: 1, role: 'soldier', militaryClass: 'arqueiro' };
  const target = { id: 2, alive: true, x: 16, y: 10, kingdomId: 2, role: 'soldier' };
  const world = { day: 1, width: 32, height: 32, rngState: 42, people: [actor, target], structures: [], kingdoms: [],
    tiles: Array.from({ length: 1024 }, (_, i) => ({ i, x: i % 32, y: Math.floor(i / 32), terrain: 'land', plants: [] })) };
  world.tiles[10 * 32 + 13].terrain = 'rock';
  const action = createCombatAction(world, actor, target, 1,
    { attackVariant: 'rain', reach: 7, arrowCount: 24, rainDurationMs: 3000, areaRadius: 2.8 });
  return { world, actor, target, action };
}

test('rain signal does not hit an enemy or an obstacle between the archer and the aimed area', () => {
  const { world, actor, target, action } = fixture();
  let contacts = 0;
  resolveCombatAction(world, actor, action, [target], () => { contacts++; return 10; });
  assert.equal(contacts, 0);
  assert.equal(action.result.kind, 'miss');
  assert.deepEqual(action.result.point, action.aim);
  assert.equal(action.result.atMs, action.windupMs + ARROW_RAIN_TIMING.ascentMs + ARROW_RAIN_TIMING.descentMs);
});

test('one arrow rises from the archer, followed by vertical sky arrows across the target circle for three seconds', () => {
  const { world, actor, action } = fixture();
  const effects = createActivityEffects();
  effects.observe({ ...world, combatSequence: 0 }, 0, true);
  resolveCombatAction(world, actor, action, [], () => 0);
  effects.observe(world, 0);
  const launch = effects.active(action.windupMs).filter(effect => effect.projectile);
  assert.equal(launch.length, 1);
  assert.equal(launch[0].rainSignal, true);
  assert.equal(launch[0].x, actor.x);
  assert.equal(launch[0].targetX, actor.x);
  assert.ok(launch[0].targetY < launch[0].y);
  const firstFallAt = action.windupMs + ARROW_RAIN_TIMING.ascentMs;
  const falling = new Map();
  for (let time = firstFallAt; time <= firstFallAt + 3000; time += 50) {
    for (const arrow of effects.active(time).filter(effect => effect.projectile)) {
      assert.notEqual(arrow.rainSignal, true);
      assert.equal(arrow.x, arrow.targetX);
      assert.equal(arrow.targetY - arrow.y, ARROW_RAIN_TIMING.skyHeight);
      assert.ok(Math.hypot(arrow.targetX - action.aim.x, arrow.targetY - action.aim.y) <= action.areaRadius);
      falling.set(arrow.id, arrow);
    }
  }
  assert.equal(falling.size, 24);
  const starts = [...falling.values()].map(arrow => arrow.startedAt);
  assert.equal(Math.min(...starts), firstFallAt);
  assert.equal(Math.max(...starts) - Math.min(...starts), 3000);
});
