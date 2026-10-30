import test from 'node:test';
import assert from 'node:assert/strict';
import { createMagicPresentation } from '../src/ui/magic/presentation.js';
import { SPELL_VISUAL_STYLES } from '../src/ui/magic/spell-styles.js';
import { SPELLS } from '../src/simulation/magic/catalog.js';

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

test('area seals stay on their ground point during preparation and activation', () => {
  const view = createMagicPresentation({ tileSize: 10 });
  const person = { id: 1, alive: true, x: 3, y: 3, magicCast: {
    spellId: 'area-heal', startedAt: 0, completesAt: 2000, targetId: 1, x: 5, y: 6 } };
  const world = { people: [person], magicTimeMs: 0, magicEvents: [] };
  view.sync(world);
  view.prepare(world, 100, bounds, () => ({ x: 15, y: 15 }));
  const seal = view.instances()[0].config;
  assert.deepEqual(seal.position, { x: 55, y: 70 });
  person.magicCast = null;
  world.magicTimeMs = 2000;
  world.magicEvents = [{ id: 1, kind: 'activated', spellId: 'area-heal', at: 2000, x: 5, y: 6, targetIds: [1] }];
  view.sync(world, 2000);
  view.prepare(world, 2000, bounds, () => ({ x: 15, y: 15 }));
  assert.ok(view.instances().every(instance => !String(instance.entityId).startsWith('pulse:')));
  const burst = view.instances().find(instance => instance.entityId === 'burst:1');
  assert.deepEqual(burst.config.position, { x: 55, y: 70 });
});

test('energy selection renders fine pixel details and bright spell rings retain contrast', () => {
  const view = createMagicPresentation({ tileSize: 10 });
  const blocks = [];
  const ctx = { fillRect(x, y, w, h) { blocks.push({ x, y, w, h, color: this.fillStyle }); } };
  view.drawIndicator(ctx, 12.5, 20, 1000);
  assert.ok(blocks.some(block => block.w === .25 && block.h === .25),
    'highlights use quarter-map-pixel resolution rather than whole map pixels');
  assert.ok(blocks.some(block => block.color === 'rgba(81,230,255,1)'));
  const person = { id: 1, alive: true, x: 3, y: 3,
    magicCast: { spellId: 'heal', startedAt: 0, targetId: 1, x: 3, y: 3 } };
  const world = { people: [person], magicTimeMs: 0 };
  view.sync(world);
  view.prepare(world, 100, bounds, () => person);
  const config = view.instances()[0].config;
  assert.equal(config.colors.main, '#00ff48');
  assert.equal(config.ringOpacity, .95);
  assert.equal(config.particleOpacity, .9);
  assert.equal(config.magicPattern, true);
  assert.equal(config.ringCount, 2);
  assert.equal(config.ringThickness, .375);
});

test('named lab families assign deliberate, distinct seals to each spell', () => {
  assert.deepEqual(Object.keys(SPELL_VISUAL_STYLES).sort(), Object.keys(SPELLS).sort());
  assert.equal(SPELL_VISUAL_STYLES.heal.circleStyle, 'arcane');
  assert.equal(SPELL_VISUAL_STYLES.protection.circleStyle, 'rune');
  assert.equal(SPELL_VISUAL_STYLES['greater-heal'].circleStyle, 'summon');
  assert.equal(SPELL_VISUAL_STYLES.curse.circleStyle, 'debuff');
  const geometry = Object.values(SPELL_VISUAL_STYLES).map(style => JSON.stringify([
    style.circleStyle, style.ringCount, style.ringSegments, style.glyphCount, style.centerSymbol]));
  assert.equal(new Set(geometry).size, 16);
});

test('rings end after activation while zone and character particles persist until effect expiry', () => {
  const view = createMagicPresentation({ tileSize: 10 });
  const person = { id: 1, alive: true, x: 3, y: 3,
    magicEffects: [{ id: 'protection', spellId: 'protection', expiresAt: 8000 }] };
  const world = { people: [person], magicTimeMs: 0,
    magicZones: [{ id: 1, spellId: 'sanctuary', x: 5, y: 6, radius: 3, expiresAt: 8000 }],
    magicEvents: [{ id: 1, kind: 'activated', spellId: 'sanctuary', at: 0, x: 5, y: 6, targetIds: [1] }] };
  view.sync(world); view.prepare(world, 0, bounds, () => person);
  assert.ok(view.instances().some(instance => instance.config.ringOpacity > 0));
  world.magicTimeMs = 700;
  view.sync(world, 700); view.prepare(world, 700, bounds, () => person);
  assert.ok(view.instances().every(instance => instance.config.ringOpacity === 0));
  world.magicTimeMs = 2000;
  view.sync(world, 2000); view.prepare(world, 2000, bounds, () => person);
  const persistent = view.instances();
  assert.equal(persistent.length, 2);
  assert.ok(persistent.every(instance => instance.config.particleOpacity > 0));
  assert.ok(persistent.every(instance => instance.config.groundCount + instance.config.auraCount === 17));
  assert.equal(view.stats().maxParticles, 1800);
  world.magicTimeMs = 8000;
  view.sync(world, 8000); view.prepare(world, 8250, bounds, () => person);
  assert.equal(view.stats().effects, 0);
});

test('detailed circles reuse high resolution images while rotating on the ground plane', () => {
  const previous = globalThis.document;
  let images = 0, draws = 0;
  const scales = [], rotations = [];
  globalThis.document = { createElement() {
    images++;
    return { getContext: () => ({ scale() {}, fillRect() {} }) };
  } };
  const ctx = { globalAlpha: 1, save() {}, restore() {}, translate() {},
    scale(x, y) { scales.push([x, y]); }, rotate(angle) { rotations.push(angle); },
    drawImage(canvas) { assert.ok(canvas.width >= 128); draws++; } };
  try {
    const view = createMagicPresentation({ tileSize: 10 });
    view.drawIndicator(ctx, 20, 30, 1000, { color: '#12abde' });
    view.drawIndicator(ctx, 22, 32, 2000, { color: '#12abde' });
    assert.equal(images, 2, 'two rings are rasterized only once, despite movement and rotation');
    assert.equal(draws, 4);
    assert.ok(scales.every(([x, y]) => x === 1 && y === .53));
    assert.notEqual(rotations[0], rotations[2]);
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
});

test('casting intensity increases toward completion and activation produces a fading light burst', () => {
  const view = createMagicPresentation({ tileSize: 10 });
  const person = { id: 1, alive: true, x: 3, y: 3, magicCast: {
    spellId: 'heal', startedAt: 0, completesAt: 2000, targetId: 1, x: 3, y: 3 } };
  const world = { people: [person], magicTimeMs: 0, magicEvents: [] };
  view.sync(world);
  view.prepare(world, 0, bounds, () => person);
  const cast = view.instances()[0].config;
  const startIntensity = cast.lightIntensity, startOpacity = cast.ringOpacity;
  world.magicTimeMs = 1900;
  view.prepare(world, 1900, bounds, () => person);
  assert.ok(cast.lightIntensity > startIntensity);
  assert.ok(cast.ringOpacity > startOpacity);
  assert.equal(cast.castProgress, .95);
  person.magicCast = null;
  world.magicTimeMs = 2000;
  world.magicEvents = [{ id: 1, kind: 'activated', spellId: 'heal', at: 2000, x: 3, y: 3, targetIds: [1] }];
  view.sync(world, 2000);
  view.prepare(world, 2000, bounds, () => person);
  const burst = view.instances().find(instance => instance.entityId === 'burst:1').config;
  assert.equal(burst.lightIntensity, 2.4);
  world.magicTimeMs = 2700;
  view.prepare(world, 2700, bounds, () => person);
  assert.equal(burst.lightIntensity, 0);
  assert.equal(burst.ringOpacity, 0);
});
