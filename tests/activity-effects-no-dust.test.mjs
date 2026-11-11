import test from 'node:test';
import assert from 'node:assert/strict';
import { createActivityEffects } from '../src/ui/person-animations.js';

const actor = () => ({ id: 1, alive: true, x: 3, y: 4, kingdomId: 1,
  militaryAnimationDay: 0, visualActivity: null, lastArrowSequence: 0 });
const victim = () => ({ id: 2, alive: true, x: 7, y: 4, kingdomId: 2,
  militaryAnimationDay: 0, visualActivity: null, lastArrowSequence: 0 });
const fixture = () => ({ day: 1, combatSequence: 0, combatEvents: [], width: 112,
  tiles: [], people: [actor(), victim()],
  kingdoms: [{ id: 1, palette: 'blue' }, { id: 2, palette: 'red' }] });
const noDust = items => assert.ok(items.every(effect => !effect.animation.startsWith('effect.dust-')),
  'walking, working and combat must never emit character dust');

test('moving, mining, chopping, building and battle animation do not generate dust', () => {
  const fx = createActivityEffects(), world = fixture();
  fx.observe(world, 100, true);
  for (const [kind, x] of [['mine', 5], ['chop', 6], ['build', 7]]) {
    const p = world.people[0];
    p.x = x;
    p.visualActivity = { day: 1, kind, x, y: 4 };
    p.militaryAnimationDay = 1;
    fx.observe(world, 100 + x * 10);
    noDust(fx.active(100 + x * 10));
  }
  assert.equal(fx.active(200).length, 0);
});

test('water splash and combat blood/impact/parry are retained while dust is removed', () => {
  const fx = createActivityEffects(), world = fixture();
  fx.observe(world, 100, true);
  world.people[0].visualActivity = { day: 1, kind: 'fish', x: 3, y: 4 };
  fx.observe(world, 200);
  const splash = fx.active(201);
  assert.ok(splash.some(e => e.animation === 'effect.water-splash'));
  noDust(splash);

  world.combatSequence = 1;
  world.combatEvents = [{ id: 1, day: 1, actorId: 1, manualControl: true,
    attackVariant: 'shield-bash', weapon: 'guerreiro', origin: { x: 3, y: 4 },
    angle: 0, windupMs: 40, activeMs: 300, endPosition: { x: 6, y: 4 },
    hitEvents: [{ targetId: 2, kind: 'body', point: { x: 7, y: 4 },
      atMs: 50, damageApplied: 12, parried: false }],
    result: { kind: 'body', point: { x: 7, y: 4 }, contactElevation: 0 } }];
  fx.observe(world, 300);
  const shield = fx.active(355);
  assert.ok(shield.some(e => e.animation === 'shield-dash'));
  assert.ok(shield.some(e => e.animation === 'combat-damage-number'));
  assert.ok(shield.some(e => e.animation === 'effect.explosion-01'));
  noDust(shield);

  world.combatSequence = 2;
  world.combatEvents = [{ id: 2, day: 1, actorId: 1,
    attackVariant: 'sword', weapon: 'guerreiro', origin: { x: 3, y: 4 },
    angle: 0, windupMs: 20,
    hitEvents: [{ targetId: 2, kind: 'body', point: { x: 7, y: 4 }, atMs: 30, damageApplied: 9 }],
    result: { kind: 'body', point: { x: 7, y: 4 }, contactElevation: 0 } }];
  fx.observe(world, 500);
  const blood = fx.active(540);
  assert.ok(blood.some(e => e.animation === 'combat-blood'));
  noDust(blood);
});

test('reset clears prior activity effects without restoring dust emission', () => {
  const fx = createActivityEffects(), world = fixture();
  fx.observe(world, 100, true);
  world.people[0].visualActivity = { day: 1, kind: 'drink', x: 3, y: 4 };
  fx.observe(world, 150);
  assert.ok(fx.active(151).some(e => e.animation === 'effect.water-splash'));
  fx.observe(world, 200, true);
  assert.deepEqual(fx.active(200), []);
  world.people[0].x += 2;
  fx.observe(world, 250);
  noDust(fx.active(250));
});
