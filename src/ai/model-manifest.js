export const AI_MODEL_MANIFEST_VERSION = 1;

/**
 * The browser loads this pinned ONNX model on demand and caches it in the
 * browser. Ollama is not required for strategic decisions.
 */
export const AI_MODEL_MANIFEST = Object.freeze({
  version: AI_MODEL_MANIFEST_VERSION,
  decisionContractVersion: 1,
  provider: 'transformers-js-browser',
  browser: Object.freeze({
    modelId: 'onnx-community/Qwen3.5-0.8B-ONNX-OPT',
    revision: '9a4c21d8f724176b0a7edaaed36303044451886e',
    generationApi: 'qwen3_5',
    dtype: Object.freeze({
      embed_tokens: 'fp16',
      decoder_model_merged: 'q4f16',
      vision_encoder: 'fp16'
    }),
    approximateDownloadBytes: 1170000000,
    devicePreference: 'webgpu',
    inferenceTimeoutMs: 30000
  }),
  models: Object.freeze({
    king: Object.freeze({
      role: 'king',
      model: 'qwen3.5:0.8b',
      think: false,
      contextTokens: 2048,
      outputTokenCandidates: Object.freeze([96, 192, 256]),
      selectedOutputTokens: 192,
      initialOutputTokens: 192,
      outputBudgetStatus: 'provisional',
      quantization: 'ONNX fp16 embeddings / q4f16 decoder / fp16 vision',
      installedDigest: null,
      status: 'experimental'
    }),
    general: Object.freeze({
      role: 'general',
      model: 'qwen3.5:0.8b',
      think: false,
      contextTokens: 2048,
      outputTokenCandidates: Object.freeze([96, 192, 256]),
      selectedOutputTokens: 192,
      initialOutputTokens: 192,
      outputBudgetStatus: 'provisional',
      quantization: 'ONNX fp16 embeddings / q4f16 decoder / fp16 vision',
      installedDigest: null,
      status: 'experimental'
    })
  })
});

export function getAiModelForRole(role) {
  return AI_MODEL_MANIFEST.models[role] || null;
}
