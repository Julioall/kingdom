import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RENDER_HZ, parseRenderHz, shouldPaintFrame, nextPaintTimestamp }
  from '../src/ui/frame-cadence.js';

test('the default limit remains 60 Hz, while 144 Hz and display cadence are opt-in', () => {
  assert.equal(DEFAULT_RENDER_HZ, 60);
  assert.equal(parseRenderHz(null), 60);
  assert.equal(parseRenderHz('bad'), 60);
  assert.equal(parseRenderHz('0'), 60);
  assert.equal(parseRenderHz('999'), 60);
  assert.equal(parseRenderHz('144'), 144);
  assert.equal(parseRenderHz('display'), 'display');
});

test('a 144 Hz render target allows consecutive 6.95 ms display callbacks', () => {
  const hz = parseRenderHz('144');
  assert.equal(shouldPaintFrame(106.95, 100, false, hz), true);
  assert.equal(shouldPaintFrame(106, 100, false, hz), false);
  assert.equal(shouldPaintFrame(106.95, 100, false, 60), false);
  assert.equal(shouldPaintFrame(102, 100, true, 60), true);
  assert.equal(shouldPaintFrame(106.95, 100, false, 'display'), true);
});

test('frame stamps retain bounded cadence drift and never replay missed frames', () => {
  const prior = 100, now = 121;
  const next = nextPaintTimestamp(now, prior, 60);
  assert.ok(next <= now && next > prior);
  assert.equal(nextPaintTimestamp(now, prior, 'display'), now);
  assert.equal(nextPaintTimestamp(200, 0, 144), 200);
  assert.equal(shouldPaintFrame(90, 100, false, 144), false);
  assert.equal(nextPaintTimestamp(NaN, prior, 60), prior);
});

test('pending map events are not hidden behind a cadence limit', () => {
  assert.equal(shouldPaintFrame(102, 100, true, 30), true);
  assert.equal(shouldPaintFrame(101, 100, false, 30), false);
});
