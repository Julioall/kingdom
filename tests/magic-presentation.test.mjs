import test from 'node:test';
import assert from 'node:assert/strict';
import { createMagicPresentation } from '../src/ui/magic/presentation.js';

const bounds = { minX: 0, minY: 0, maxX: 20, maxY: 20 };
const effect = { id: 'slow', spellId: 'slow', expiresAt: 7000, color: '#687da7' };

test('native circles and auras follow interpolated feet, cull offscreen and fade after removal', () => {
  const view = createMagicPresentation({ tileSize: 10 });
  const person = { id: 1, x: 5, y: 6, alive: true, magicEffects: [effect] };
  const world = { people: [person], magicZones: [], magicTimeMs: 0 };
  view.sync(world, 0);
  view.prepare(world, 100, bounds, () => ({ x: 5.5, y: 6.5 }));
  const instance = view.instances()[0];
  assert.equal(instance.config.position.x, 60);
  assert.equal(instance.config.position.y, 75);
  view.prepare(world, 200, bounds, () => ({ x: 99, y: 99 }));
  assert.equal(instance.config.enabled, false);
  let draws = 0;
  const ctx = { fillRect() { draws++; } };
  view.drawGround(ctx); view.drawAura(ctx);
  assert.equal(draws, 0);
  person.magicEffects = [];
  view.sync(world, 300);
  view.prepare(world, 420, bounds, () => ({ x: 5, y: 6 }));
  assert.ok(instance.config.particleOpacity > 0 && instance.config.particleOpacity < .6);
  view.prepare(world, 550, bounds, () => person);
  assert.equal(view.stats().effects, 0);
});

test('100 units with simultaneous statuses stay under emission limits and preserve all logical effects', () => {
  const view = createMagicPresentation({ tileSize: 10, maxParticles: 800 });
  const people = Array.from({ length: 100 }, (_, id) => ({ id, alive: true, x: id % 10, y: Math.floor(id / 10),
    magicEffects: ['slow', 'curse', 'protection', 'fortitude'].map(id => ({ ...effect, id, spellId: id })) }));
  const world = { people, magicZones: [], magicTimeMs: 0 };
  view.sync(world, 0);
  view.prepare(world, 100, bounds, id => people[id]);
  assert.equal(view.stats().effects, 300);
  assert.ok(view.stats().particles <= 800);
  assert.ok(view.instances().every(instance => instance.config.groundCount + instance.config.auraCount > 0),
    'all visible affected units retain particles under the default 100-unit budget');
  assert.equal(people.reduce((sum, person) => sum + person.magicEffects.length, 0), 400);
});

test('spell palettes, rotation and speed are independently configurable', () => {
  const view = createMagicPresentation({ tileSize: 10 });
  assert.equal(view.setSpellStyle('slow', { color: '#123456', rotationSpeed: -.3, particleSpeed: 2 }), true);
  const person = { id: 1, alive: true, x: 3, y: 3, magicEffects: [effect] };
  view.sync({ people: [person], magicZones: [] });
  const config = view.instances()[0].config;
  assert.equal(config.colors.main, '#123456');
  assert.equal(config.rotationSpeed, -.3);
  assert.equal(config.particleSpeed, 2);
});
