import test from 'node:test';
import assert from 'node:assert/strict';
import { createBloodParticles, drawBloodBurst, drawBloodStains, BLOOD_EFFECT_DURATION_MS } from '../src/ui/blood-presentation.js';
import { createActivityEffects } from '../src/ui/person-animations.js';

function fixture(variant = null, damage = 12) {
  const person = { id: 2, alive: true, x: 5, y: 5 };
  const event = { id: 1, actorId: 1, targetId: 2, day: 1, attackVariant: variant,
    angle: 0, origin: { x: 3, y: 5 }, result: { kind: 'body', point: { x: 5, y: 5 }, contactElevation: 0 },
    hitEvents: [{ targetId: 2, kind: 'body', point: { x: 5, y: 5 }, atMs: 200, damageApplied: damage }] };
  return { day: 1, width: 32, tiles: [], people: [person], kingdoms: [], combatEvents: [event] };
}

test('blood follows confirmed damage timing, does not replay, and excludes push-only charges', () => {
  const world = fixture(), effects = createActivityEffects();
  effects.observe(world, 1000);
  assert.equal(effects.active(1199).filter(effect => effect.blood).length, 0);
  assert.equal(effects.active(1200).filter(effect => effect.blood).length, 1);
  effects.observe(world, 1300);
  assert.equal(effects.active(1300).filter(effect => effect.blood).length, 1);
  assert.equal(effects.active(4000).filter(effect => effect.blood).length, 1);
  assert.equal(effects.active(1200 + BLOOD_EFFECT_DURATION_MS).filter(effect => effect.blood).length, 0);
  for (const [variant, damage] of [['shield-bash', 12], ['lance-charge', 12], [null, 0]]) {
    const view = createActivityEffects(); view.observe(fixture(variant, damage), 1000);
    assert.equal(view.active(1200).filter(effect => effect.blood).length, 0);
  }
  const dummy = fixture(); dummy.people = [];
  const view = createActivityEffects(); view.observe(dummy, 1000);
  assert.equal(view.active(1200).filter(effect => effect.blood).length, 0);
});

test('droplets preserve the attack direction with bounded deterministic scatter', () => {
  const right = createBloodParticles(42, 0, 18), left = createBloodParticles(42, Math.PI, 18);
  assert.ok(right.reduce((sum, particle) => sum + particle.vx, 0) > 0);
  assert.ok(left.reduce((sum, particle) => sum + particle.vx, 0) < 0);
  assert.ok(Math.max(...right.map(p => p.landY)) - Math.min(...right.map(p => p.landY)) > .3,
    'splash covers an irregular area instead of a narrow line');
  assert.ok(right.every(particle => particle.size >= .025 && particle.size < .066));
  assert.ok(new Set(right.map(p => p.flightMs)).size > 8);
  assert.deepEqual(right, createBloodParticles(42, 0, 18));
  assert.ok(createBloodParticles(42, 0, 10000).length <= 36);
});

test('blood lands on the ground, leaves temporary stains and fades completely', () => {
  const effect = { x: 5, y: 5, duration: BLOOD_EFFECT_DURATION_MS, particles: createBloodParticles(42, 0, 18) };
  const rects = [];
  const ctx = { globalAlpha: .6, fillRect(x, y, w, h) { rects.push({ x, y, w, h, alpha: this.globalAlpha }); } };
  drawBloodBurst(ctx, effect, 50, 10);
  const airborne = rects.slice(); rects.length = 0;
  drawBloodBurst(ctx, effect, 800, 10);
  assert.equal(rects.length, 0, 'landed blood is drawn only by the ground pass');
  drawBloodStains(ctx, effect, 800, 10);
  assert.ok(airborne[0].y < rects[0].y);
  assert.ok(Math.max(...rects.map(rect => rect.alpha)) < Math.max(...airborne.map(rect => rect.alpha)));
  assert.equal(ctx.globalAlpha, .6);
  const landedAlpha = rects[0].alpha;
  rects.length = 0; drawBloodStains(ctx, effect, BLOOD_EFFECT_DURATION_MS - 500, 10);
  assert.ok(rects[0].alpha < landedAlpha);
  rects.length = 0; drawBloodStains(ctx, effect, BLOOD_EFFECT_DURATION_MS, 10);
  assert.equal(rects.length, 0);
  assert.ok(BLOOD_EFFECT_DURATION_MS - Math.max(...effect.particles.map(p => p.flightMs + p.delayMs)) >= 9900,
    'ground stains remain for approximately ten seconds after landing');
});

test('fast droplets leave short tapered trails along their varied trajectories', () => {
  const effect = { x: 5, y: 5, duration: BLOOD_EFFECT_DURATION_MS, particles: createBloodParticles(42, 0, 18) };
  const rects = [];
  const ctx = { globalAlpha: 1, fillRect(x, y, w, h) { rects.push({ x, y, w, h, alpha: this.globalAlpha }); } };
  drawBloodBurst(ctx, effect, 140, 10);
  assert.ok(effect.particles.length >= 23);
  assert.ok(rects.length > effect.particles.length);
  assert.ok(rects.some(rect => rect.alpha === .35));
  assert.ok(rects.some(rect => rect.alpha === .65));
  assert.ok(rects.some(rect => rect.alpha === 1));
  assert.equal(ctx.globalAlpha, 1);
});
