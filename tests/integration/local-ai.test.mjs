import test from 'node:test';
import assert from 'node:assert/strict';
import LocalAI from '../../src/ai/local-engine.js';

const actions = ['forage', 'hunt', 'rest'];

test('local AI accepts a JSON decision only when its action is allowed', () => {
  assert.deepEqual(
    LocalAI.parseStrategicDecision('{"action":"forage","confidence":0.8,"reason":"Há alimento próximo."}', actions),
    { action: 'forage', confidence: 0.8, reason: 'Há alimento próximo.' }
  );
  assert.throws(
    () => LocalAI.parseStrategicDecision('{"action":"invent","confidence":0.8,"reason":""}', actions),
    /fora da lista permitida/
  );
});

test('local AI retains its plain-text fallback and rejects ambiguous answers', () => {
  assert.equal(LocalAI.parseStrategicDecision('hunt', actions).action, 'hunt');
  assert.throws(() => LocalAI.parseStrategicDecision('forage or hunt', actions), /mais de uma ação candidata/);
});
