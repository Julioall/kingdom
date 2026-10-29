import test from 'node:test';
import assert from 'node:assert/strict';
import { Tensor } from '@huggingface/transformers';
import { StructuredOutputProcessor } from '@huggingface/transformers-structured-output';
import { browserDecisionFormat } from '../src/ai/browser-decision-format.js';

const tokenizer = {
  tokens: [...Array.from({ length: 256 }, (_, byte) => Uint8Array.of(byte)), new Uint8Array()],
  eosTokenId: 256
};

function generation(action = 'forage_for_food') {
  const processor = new StructuredOutputProcessor(tokenizer, browserDecisionFormat([action]));
  const ids = [[0n]];
  const scores = () => processor(ids, new Tensor('float32', new Float32Array(257), [1, 257])).data;
  scores(); // Establish the prompt boundary.
  function append(text) {
    for (const byte of new TextEncoder().encode(text)) {
      assert.ok(Number.isFinite(scores()[byte]), 'Grammar rejected byte ' + byte + ' in ' + text);
      ids[0].push(BigInt(byte));
    }
  }
  return { append, scores };
}

test('real constraint closes a maximum-length Portuguese reason and rejects corrupt bytes', () => {
  const run = generation();
  const reason = 'Ação útil. ' + 'a'.repeat(169);
  assert.equal([...reason].length, 180);
  run.append('{"action":"forage_for_food","confidence":0.9,"reason":"' + reason);
  const scores = run.scores();
  assert.equal(scores[0x80], -Infinity, 'Orphan continuation bytes must never loop at the string limit');
  assert.equal(scores['a'.charCodeAt(0)], -Infinity, 'A 181st character must be blocked');
  assert.ok(Number.isFinite(scores['"'.charCodeAt(0)]));
  run.append('"}');
  assert.ok(Number.isFinite(run.scores()[256]), 'A complete JSON must allow EOS');
});

test('action IDs are literal constraints even with regex metacharacters and JSON escapes', () => {
  const action = 'a.+("b")';
  const run = generation(action);
  run.append('{"action":' + JSON.stringify(action) + ',"confidence":1,"reason":"Comida"}');
  assert.ok(Number.isFinite(run.scores()[256]));
  const regex = new RegExp('^(?:' + browserDecisionFormat([action]).regex + ')$');
  assert.equal(regex.test(JSON.stringify({ action: 'axb', confidence: 1, reason: 'Comida' })), false);
});
