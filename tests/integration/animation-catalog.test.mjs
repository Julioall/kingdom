import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ANIMATIONS, STATIC_SPRITE_SOURCES, getAnimation, listAnimations,
  getUnitAnimation, getAnimationFrame, createAnimationRenderer } from '../../src/ui/animations.js';
import { CHARACTER_SPRITE_SCALE, MILITARY_SPRITES } from '../../src/ui/military-sprites.js';

test('every catalog entry has a published PNG with exact frame geometry and a unique source', () => {
  const sources = new Set();
  for (const animation of Object.values(ANIMATIONS)) {
    assert.ok(!sources.has(animation.source), animation.source);
    sources.add(animation.source);
    const png = fs.readFileSync(new URL('../../public/' + animation.url, import.meta.url));
    assert.equal(png.readUInt32BE(16), animation.width, animation.id);
    assert.equal(png.readUInt32BE(20), animation.height, animation.id);
    assert.equal(animation.frameWidth * animation.frames, animation.width, animation.id);
    assert.equal(animation.frameHeight, animation.height);
    assert.ok(Number.isFinite(animation.fps) && animation.fps >= 0);
    assert.ok(animation.anchor.x >= 0 && animation.anchor.x <= animation.frameWidth);
    assert.ok(animation.anchor.y >= 0 && animation.anchor.y <= animation.frameHeight);
    assert.equal(typeof animation.loop, 'boolean');
    const original = new URL('../../' + animation.source, import.meta.url);
    if (!animation.source.startsWith('public/') && fs.existsSync(original)) {
      assert.deepEqual(png, fs.readFileSync(original), 'original pixels and transparency: ' + animation.id);
    }
  }
  for (const source of STATIC_SPRITE_SOURCES) {
    assert.ok(!sources.has(source), source);
    sources.add(source);
  }
  // The local art source is optional in a fresh checkout. When installed,
  // prove every PNG is classified, including atlases that are not animations.
  const sourceRoot = new URL('../../Tiny Swords/', import.meta.url);
  if (fs.existsSync(sourceRoot)) {
    const files = fs.readdirSync(sourceRoot, { recursive: true }).filter(file => file.endsWith('.png'));
    for (const file of files) assert.ok(sources.has('Tiny Swords/' + file.replaceAll('\\', '/')), file);
  }
  assert.ok(Object.isFrozen(ANIMATIONS));
});

test('all unit variants and auxiliary combat effects are addressable in all five palettes', () => {
  assert.equal(CHARACTER_SPRITE_SCALE, .75, 'characters render 25% smaller than their source scale');
  for (const palette of ['blue', 'red', 'purple', 'yellow', 'black']) {
    for (const tool of ['axe', 'gold', 'hammer', 'knife', 'meat', 'pickaxe', 'wood']) {
      for (const action of ['idle', 'run']) assert.ok(getUnitAnimation('aldeão', action + '-' + tool, palette));
    }
    assert.equal(getUnitAnimation('pawn', 'interact-pickaxe', palette).frames, 6);
    assert.equal(getUnitAnimation('monge', 'heal-effect', palette).frames, 11);
    assert.equal(getUnitAnimation('arqueiro', 'arrow', palette).frames, 1);
    for (const [name, unit] of Object.entries(MILITARY_SPRITES)) {
      for (const [action, file] of Object.entries(unit.actions)) {
        const mapped = getUnitAnimation(name, action, palette);
        assert.ok(mapped.url.endsWith('/' + unit.prefix + file + '.png'));
        assert.equal(mapped.frameWidth, unit.size);
      }
    }
  }
  assert.equal(listAnimations({ category: 'effect' }).length, 13);
  assert.equal(listAnimations({ unit: 'pawn', palette: 'red' }).length, 20);
  assert.throws(() => getAnimation('missing'), /Unknown animation/);
});

test('looping, one-shot and static frame playback never samples outside the strip', () => {
  const attack = getUnitAnimation('guerreiro', 'attack-2');
  assert.equal(getAnimationFrame(attack, 0).index, 0);
  assert.equal(getAnimationFrame(attack, 100).index, 1);
  assert.equal(getAnimationFrame(attack, 399).done, false);
  assert.equal(getAnimationFrame(attack, 400).done, true);
  assert.equal(getAnimationFrame(attack, 50000).index, 3);
  assert.equal(getAnimationFrame(attack, 400, { loop: true }).index, 0);
  assert.equal(getAnimationFrame(attack, -10).index, 0);
  assert.equal(getAnimationFrame('effect.fire-01', 0, { phase: -1 }).index, 7);
  assert.equal(getAnimationFrame('unit.blue.archer.arrow', 50000).index, 0);
  for (const animation of Object.values(ANIMATIONS)) {
    const frame = getAnimationFrame(animation, 1234567);
    assert.ok(frame.sx + frame.sw <= animation.width, animation.id);
    assert.ok(frame.sy + frame.sh <= animation.height, animation.id);
  }
});

test('the shared renderer loads on demand, caches sheets, and applies crop, anchor and transforms', async () => {
  let created = 0, ready = 0;
  const renderer = createAnimationRenderer({ imageFactory: () => {
    created++;
    return { set src(value) { this.url = value; queueMicrotask(() => this.onload()); } };
  }, onReady: () => ready++ });
  const calls = [];
  const ctx = Object.fromEntries(['save', 'restore', 'translate', 'scale', 'rotate', 'drawImage'].map(name =>
    [name, (...args) => calls.push({ name, args })]));
  const animation = getAnimation('effect.explosion-01');
  assert.equal(created, 0);
  assert.equal(renderer.draw(ctx, animation, 20, 40), false);
  const loading = renderer.load(animation);
  assert.equal(renderer.load(animation.id), loading);
  await loading;
  assert.equal(created, 1);
  assert.equal(ready, 1);
  assert.equal(renderer.draw(ctx, animation, 20, 40, { elapsedMs: 100, flipX: true, scale: 2, rotation: .5 }), true);
  assert.deepEqual(calls.find(call => call.name === 'scale').args, [-2, 2]);
  assert.deepEqual(calls.find(call => call.name === 'drawImage').args.slice(1), [192, 0, 192, 192, -96, -96, 192, 192]);
  assert.equal(calls.at(-1).name, 'restore');
  assert.equal(ctx.imageSmoothingEnabled, false);
});

test('a failed image load reports an error without drawing a broken image', async () => {
  const renderer = createAnimationRenderer({ imageFactory: () => ({
    set src(_value) { queueMicrotask(() => this.onerror()); }
  }) });
  await assert.rejects(renderer.load('effect.dust-01'), /Could not load animation/);
  assert.equal(renderer.draw({}, 'effect.dust-01', 0, 0), false);
});
