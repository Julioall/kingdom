import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseContinuingUtilityIndex } from '../src/controllers/individual/utility-continuity.js';

const actions = ['forage', 'build', 'socialize', 'migrate'];
function previous(action, day = 5, scores = [1, 1, 1, 1]) {
  return { action, day, scores };
}
test('normal strict winner is preserved when there is no continuation record', () => {
  const scores = [2, 2, 1, 0];
  assert.equal(chooseContinuingUtilityIndex(actions, scores, null, 6, [1, 1, 1, 1]), 0);
  assert.equal(chooseContinuingUtilityIndex(actions, [0, 1, 2, 3], null, 6, [1, 1, 1, 1]), 3);
});
test('minor score fluctuations keep a productive voluntary objective', () => {
  assert.equal(chooseContinuingUtilityIndex(actions, [1.01, 1.11, .2, 0],
    previous('forage'), 6, [.7, .9, .2, .1]), 0);
  assert.equal(chooseContinuingUtilityIndex(actions, [1.01, 1.131, .2, 0],
    previous('forage'), 6, [.7, .9, .2, .1]), 1);
});
test('forced or stale decisions are never retained', () => {
  const scores = [1, 1.1, .5, 0], utility = [1, 1, 0, 0];
  assert.equal(chooseContinuingUtilityIndex(actions, scores, previous('forage', 4), 6, utility), 1);
  assert.equal(chooseContinuingUtilityIndex(actions, scores, { action: 'forage', day: 5, scores: null }, 6, utility), 1);
  assert.equal(chooseContinuingUtilityIndex(actions, scores, previous('campaign'), 6, utility), 1);
});
test('nonviable/negative old action is never revived, no matter the stored score', () => {
  assert.equal(chooseContinuingUtilityIndex(actions, [1, 1.01, 0, 0],
    previous('forage'), 6, [-.1, 1, 0, 0]), 1);
  assert.equal(chooseContinuingUtilityIndex(actions, [1, 1.01, 0, 0],
    previous('forage'), 6, [NaN, 1, 0, 0]), 1);
});
test('invalid hysteresis parameter preserves strict winner', () => {
  assert.equal(chooseContinuingUtilityIndex(actions, [1, 1.1, 0, 0],
    previous('forage'), 6, [1, 1, 0, 0], 0), 1);
  assert.equal(chooseContinuingUtilityIndex(actions, [1, 1.1, 0, 0],
    previous('forage'), 6, [1, 1, 0, 0], 9), 1);
});
