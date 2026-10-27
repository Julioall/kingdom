import { pipeline, env } from '@huggingface/transformers';
import { StructuredOutputProcessor } from '@huggingface/transformers-structured-output';
import { buildKingdomStrategySystemPrompt } from './kingdom-strategy-prompt.js';

const GENERAL_SYSTEM_PROMPT = 'Você é o general de um reino simulado. Use somente os fatos observados da campanha. Escolha exatamente um ID permitido. A simulação controla recursos, alvos e resultados; não invente informações nem emita ordens fora da lista. Responda com um único JSON contendo action, confidence e reason curta em português.';
let generator = null;
let currentModel = null;
let currentDevice = null;
let currentModelConfig = null;
let loading = null;
const cancelled = new Set();

function postStatus(text, progress) {
  self.postMessage({ type: 'status', status: { phase: 'loading', text, progress } });
}

function reportProgress(event) {
  const info = event || {};
  const file = String(info.file || info.name || '').split('/').pop();
  const loaded = Number(info.loaded || 0);
  const total = Number(info.total || 0);
  const mb = value => (value / 1_000_000).toFixed(0);
  let text = 'Baixando e preparando o modelo no navegador…';
  if (info.status === 'progress' && file && total > 0) {
    text = 'Baixando ' + file + ' · ' + mb(loaded) + ' / ' + mb(total) + ' MB';
  } else if (file) {
    text = 'Preparando ' + file + ' no navegador…';
  }
  const progress = Number.isFinite(info.progress)
    ? info.progress / 100
    : total > 0 ? loaded / total : 0;
  postStatus(text, progress);
}

function modelOptions(model, device) {
  const dtype = model.dtypeMode === 'single' ? model.dtype : {
    embed_tokens: model.dtype,
    decoder_model_merged: model.dtype,
    vision_encoder: model.dtype
  };
  return {
    revision: model.revision,
    device,
    dtype,
    progress_callback: reportProgress
  };
}

async function loadModel(model) {
  env.allowRemoteModels = true;
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  const supportsWebGpu = !!self.navigator?.gpu;
  if (supportsWebGpu) {
    postStatus('Preparando o modelo Qwen no navegador com WebGPU…', 0);
    try {
      generator = await pipeline('text-generation', model.modelId, modelOptions(model, 'webgpu'));
      currentDevice = 'WebGPU';
    } catch (error) {
      postStatus('WebGPU não pôde carregar este modelo; tentando CPU/WASM no navegador…', 0);
      generator = await pipeline('text-generation', model.modelId, modelOptions(model, 'wasm'));
      currentDevice = 'CPU/WASM';
      self.postMessage({ type: 'status', status: { phase: 'loading', text: 'Modelo carregado em CPU/WASM no navegador.', progress: 1, device: currentDevice, detail: String(error?.message || error).slice(0, 220) } });
    }
  } else {
    postStatus('WebGPU indisponível; carregando o modelo em CPU/WASM no navegador…', 0);
    generator = await pipeline('text-generation', model.modelId, modelOptions(model, 'wasm'));
    currentDevice = 'CPU/WASM';
  }
  StructuredOutputProcessor.warmup(generator.tokenizer);
  currentModel = model.modelId;
  currentModelConfig = model;
  return generator;
}

async function ensureModel(model) {
  if (generator && currentModel === model.modelId) return generator;
  if (!loading) {
    loading = loadModel(model).finally(() => { loading = null; });
  }
  return loading;
}

function getDecisionSchema(candidateActions) {
  return {
    type: 'object',
    properties: {
      action: { type: 'string', enum: candidateActions },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      reason: { type: 'string' }
    },
    required: ['action', 'confidence', 'reason'],
    additionalProperties: false
  };
}

function getMessages(request) {
  const system = request.role === 'general'
    ? GENERAL_SYSTEM_PROMPT + ' Ações permitidas: ' + request.candidateActions.join(', ') + '.'
    : buildKingdomStrategySystemPrompt(request.candidateActions);
  return [
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify(request.context) }
  ];
}

async function decide(requestId, request, model) {
  let modelPipeline = await ensureModel(model);
  if (cancelled.delete(requestId)) return;
  let schemaProcessor = new StructuredOutputProcessor(modelPipeline.tokenizer, {
    type: 'json_schema',
    json_schema: getDecisionSchema(request.candidateActions)
  });
  const startedAt = performance.now();
  const runGeneration = activePipeline => activePipeline(getMessages(request), {
    max_new_tokens: 96,
    do_sample: false,
    temperature: 0,
    tokenizer_encode_kwargs: { enable_thinking: false },
    logits_processor: [schemaProcessor]
  });
  let result;
  try {
    result = await runGeneration(modelPipeline);
  } catch (error) {
    if (currentDevice !== 'WebGPU') throw error;
    postStatus('A geração WebGPU falhou; transferindo a decisão para CPU/WASM…', 0);
    try { modelPipeline.dispose(); } catch { /* Release partial GPU state when supported. */ }
    generator = null;
    currentModel = null;
    currentModelConfig = null;
    modelPipeline = await pipeline('text-generation', model.modelId, modelOptions(model, 'wasm'));
    generator = modelPipeline;
    currentModel = model.modelId;
    currentModelConfig = model;
    currentDevice = 'CPU/WASM';
    StructuredOutputProcessor.warmup(modelPipeline.tokenizer);
    schemaProcessor = new StructuredOutputProcessor(modelPipeline.tokenizer, {
      type: 'json_schema',
      json_schema: getDecisionSchema(request.candidateActions)
    });
    result = await runGeneration(modelPipeline);
  }
  if (cancelled.delete(requestId)) return;
  const generated = result?.[0]?.generated_text;
  const rawContent = Array.isArray(generated) ? generated.at(-1)?.content : generated;
  if (typeof rawContent !== 'string' || !rawContent.trim()) throw new Error('O modelo não gerou uma decisão.');
  const firstBrace = rawContent.indexOf('{');
  const lastBrace = rawContent.lastIndexOf('}');
  const content = firstBrace >= 0 && lastBrace > firstBrace
    ? rawContent.slice(firstBrace, lastBrace + 1)
    : rawContent.trim();
  console.info('[Kingdom IA navegador] decisão gerada', {
    model: currentModel,
    device: currentDevice,
    elapsedMs: Math.round(performance.now() - startedAt),
    outputPreview: content.slice(0, 240)
  });
  self.postMessage({
    type: 'decision',
    requestId,
    response: {
      choices: [{ message: { content } }],
      provider: 'transformers.js-browser',
      model: currentModel,
      elapsedMs: Math.round(performance.now() - startedAt),
      outputTokens: null,
      device: currentDevice
    }
  });
}

self.addEventListener('message', event => {
  const message = event.data || {};
  if (message.type === 'cancel') {
    cancelled.add(message.requestId);
    return;
  }
  if (message.type === 'initialize') {
    ensureModel(message.model).then(() => {
      self.postMessage({ type: 'ready', provider: 'transformers.js-browser', model: currentModel, device: currentDevice });
      self.postMessage({ type: 'status', status: { phase: 'ready', text: 'Modelo pronto no navegador · ' + currentDevice + '. Ollama não é necessário.', progress: 1, device: currentDevice } });
    }).catch(error => {
      self.postMessage({ type: 'error', requestId: null, message: String(error?.message || error) });
    });
    return;
  }
  if (message.type === 'decide') {
    if (!currentModelConfig) {
      self.postMessage({ type: 'error', requestId: message.requestId, message: 'O modelo ainda não terminou de carregar.' });
      return;
    }
    decide(message.requestId, message.request, currentModelConfig)
      .catch(error => self.postMessage({ type: 'error', requestId: message.requestId, message: String(error?.message || error) }));
  }
});
