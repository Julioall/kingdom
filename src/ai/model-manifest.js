export const AI_MODEL_MANIFEST_VERSION = 1;

/**
 * Model choices are project decisions. Runtime installation details remain
 * unknown until Ollama reports the locally installed model digest and format.
 */
export const AI_MODEL_MANIFEST = Object.freeze({
  version: AI_MODEL_MANIFEST_VERSION,
  decisionContractVersion: 1,
  provider: 'ollama',
  models: Object.freeze({
    king: Object.freeze({
      role: 'king',
      model: 'qwen2.5:0.5b',
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
      model: 'smollm2:135m',
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
