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
    modelId: 'onnx-community/Qwen3-0.6B-ONNX',
    revision: '58ca03a5e7b354b480b1a82b34bde8dc7b854cc0',
    dtype: 'q4f16',
    dtypeMode: 'single',
    approximateDownloadBytes: 579000000,
    devicePreference: 'webgpu',
    inferenceTimeoutMs: 30000
  }),
  models: Object.freeze({
    king: Object.freeze({
      role: 'king',
      model: 'qwen3:0.6b',
      think: false,
      contextTokens: 2048,
      outputTokenCandidates: Object.freeze([96, 192, 256]),
      selectedOutputTokens: 192,
      initialOutputTokens: 192,
      outputBudgetStatus: 'provisional',
      quantization: null,
      installedDigest: null,
      status: 'experimental'
    }),
    general: Object.freeze({
      role: 'general',
      model: 'qwen3:0.6b',
      think: false,
      contextTokens: 2048,
      outputTokenCandidates: Object.freeze([96, 192, 256]),
      selectedOutputTokens: 192,
      initialOutputTokens: 192,
      outputBudgetStatus: 'provisional',
      quantization: null,
      installedDigest: null,
      status: 'experimental'
    })
  })
});

export function getAiModelForRole(role) {
  return AI_MODEL_MANIFEST.models[role] || null;
}
