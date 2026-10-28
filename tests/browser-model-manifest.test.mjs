import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_MODEL_MANIFEST, getAiModelForRole } from '../src/ai/model-manifest.js';

test('Qwen3.5 browser candidate is pinned, quantized, shared, and experimental', () => {
  assert.equal(AI_MODEL_MANIFEST.provider, 'transformers-js-browser');
  assert.equal(AI_MODEL_MANIFEST.browser.modelId, 'onnx-community/Qwen3.5-0.8B-ONNX-OPT');
  assert.equal(AI_MODEL_MANIFEST.browser.revision, '9a4c21d8f724176b0a7edaaed36303044451886e');
  assert.equal(AI_MODEL_MANIFEST.browser.generationApi, 'qwen3_5');
  assert.equal(AI_MODEL_MANIFEST.browser.contextTokens, 2048);
  assert.equal(AI_MODEL_MANIFEST.browser.devicePreference, 'webgpu');
  assert.ok(AI_MODEL_MANIFEST.browser.approximateDownloadBytes < 1_250_000_000);
  assert.deepEqual(AI_MODEL_MANIFEST.browser.dtype, {
    embed_tokens: 'fp16',
    decoder_model_merged: 'q4f16',
    vision_encoder: 'fp16'
  });
  assert.deepEqual(AI_MODEL_MANIFEST.browser.fallbackDtype, {
    embed_tokens: 'q4', decoder_model_merged: 'q4', vision_encoder: 'q4'
  });
  assert.ok(AI_MODEL_MANIFEST.browser.recoveryTimeoutMs > AI_MODEL_MANIFEST.browser.inferenceTimeoutMs);

  const king = getAiModelForRole('king');
  const general = getAiModelForRole('general');
  assert.equal(king.model, 'qwen3.5:0.8b');
  assert.equal(general.model, king.model);
  assert.equal(king.status, 'experimental');
  assert.equal(general.status, 'experimental');
});
