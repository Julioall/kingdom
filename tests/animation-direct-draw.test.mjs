import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnimationRenderer } from '../src/ui/animations.js';

const sprite = {
  id: 'unit.test.pawn.idle', url: '/assets/test-sheet.png', fps: 8, frames: 4,
  loop: true, frameWidth: 32, frameHeight: 48, anchor: { x: 16, y: 44 },
};

function createFakeCanvas({ smoothing = false, camera = [.40234375, 0, 0, .40234375, 514, 206] } = {}) {
  const commands = [], saved = [];
  let matrix = camera.slice(), smoothingEnabled = smoothing;
  let saves = 0;
  const multiply = ([a, b, c, d, e, f], [A, B, C, D, E, F]) =>
    [a * A + c * B, b * A + d * B, a * C + c * D,
      b * C + d * D, a * E + c * F + e, b * E + d * F + f];
  const apply = (x, y) => [matrix[0] * x + matrix[2] * y + matrix[4],
    matrix[1] * x + matrix[3] * y + matrix[5]];
  const ctx = {
    get imageSmoothingEnabled() { return smoothingEnabled; },
    set imageSmoothingEnabled(value) { smoothingEnabled = !!value; },
    save() { saves++; saved.push([matrix.slice(), smoothingEnabled]); },
    restore() {
      const state = saved.pop();
      if (!state) throw Error('Canvas state underflow');
      [matrix, smoothingEnabled] = state;
    },
    translate(x, y) { matrix = multiply(matrix, [1, 0, 0, 1, x, y]); },
    scale(x, y) { matrix = multiply(matrix, [x, 0, 0, y, 0, 0]); },
    rotate(a) { matrix = multiply(matrix, [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]); },
    drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh) {
      commands.push({ source: [image.src, sx, sy, sw, sh],
        corners: [apply(dx, dy), apply(dx + dw, dy), apply(dx + dw, dy + dh), apply(dx, dy + dh)] });
    },
  };
  return { ctx, commands, get saves() { return saves; },
    get matrix() { return matrix.slice(); }, get stack() { return saved.length; } };
}

async function loadTestRenderer() {
  const renderer = createAnimationRenderer({ imageFactory: () => {
    const image = {};
    Object.defineProperty(image, 'src', {
      get() { return this._src; },
      set(value) { this._src = value; this.onload?.(); },
    });
    return image;
  } });
  await renderer.load(sprite);
  return renderer;
}

function assertPixelEquivalent(actual, expected, tolerance = 1e-8) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < actual.length; i++) {
    assert.deepEqual(actual[i].source, expected[i].source);
    for (let corner = 0; corner < 4; corner++) {
      for (let coordinate = 0; coordinate < 2; coordinate++) {
        assert.ok(Math.abs(actual[i].corners[corner][coordinate] - expected[i].corners[corner][coordinate]) <= tolerance,
          `Mismatched pixel geometry at ${i}:${corner}:${coordinate}`);
      }
    }
  }
}

test('direct draw matches sprite geometry and animation frames without Canvas save/restore', async () => {
  const renderer = await loadTestRenderer();
  for (const elapsedMs of [0, 125, 500, 1300]) {
    for (const scale of [.34, .72, 1]) {
      const legacy = createFakeCanvas(), optimized = createFakeCanvas();
      const options = { elapsedMs, scale, flipX: false, rotation: 0, loop: true };
      const x = 57.125, y = 103.5;
      assert.equal(renderer.draw(legacy.ctx, sprite, x, y, options), true);
      assert.equal(renderer.draw(optimized.ctx, sprite, x, y, { ...options, directDraw: true }), true);
      assertPixelEquivalent(optimized.commands, legacy.commands);
      assert.equal(optimized.saves, 0);
      assert.equal(legacy.saves, 1);
      assert.equal(optimized.stack, 0);
      assert.equal(legacy.stack, 0);
      assert.deepEqual(optimized.matrix, legacy.matrix);
      assert.equal(optimized.ctx.imageSmoothingEnabled, false);
    }
  }
});

test('mirrored/rotated sprites and smoothing-enabled contexts preserve the old transformed path', async () => {
  const renderer = await loadTestRenderer();
  for (const options of [
    { flipX: true, rotation: 0, scale: .5 },
    { flipX: false, rotation: .08, scale: .5 },
    { flipX: false, rotation: 0, scale: -1 },
  ]) {
    const sample = createFakeCanvas();
    assert.equal(renderer.draw(sample.ctx, sprite, 77, 28, { ...options, directDraw: true }), true);
    assert.equal(sample.saves, 1, 'complex transforms must use the legacy path');
    assert.equal(sample.stack, 0);
  }
  const smooth = createFakeCanvas({ smoothing: true });
  renderer.draw(smooth.ctx, sprite, 77, 28, { scale: .5, directDraw: true });
  assert.equal(smooth.saves, 1);
  assert.equal(smooth.ctx.imageSmoothingEnabled, true, 'renderer must restore smoothing state');
});

test('fast path remains an explicit opt-in and does not change sprites without a loaded image', async () => {
  const renderer = await loadTestRenderer();
  const normal = createFakeCanvas();
  renderer.draw(normal.ctx, sprite, 80, 120, { scale: .5 });
  assert.equal(normal.saves, 1);
  const fresh = createAnimationRenderer({ imageFactory: () => ({}) });
  const missing = createFakeCanvas();
  assert.equal(fresh.draw(missing.ctx, sprite, 80, 120, { scale: .5, directDraw: true }), false);
  assert.equal(missing.commands.length, 0);
});
