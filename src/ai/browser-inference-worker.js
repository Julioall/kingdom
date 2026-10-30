import { AutoProcessor, pipeline, Qwen3_5ForConditionalGeneration, env } from '@huggingface/transformers';
import { StructuredOutputProcessor } from '@huggingface/transformers-structured-output';
import { browserDecisionContextVariants, browserInputFitsTokenBudget, browserInputTokenBudget } from './browser-decision-context.js';
import { buildKingdomStrategySystemPrompt } from './kingdom-strategy-prompt.js';
import { browserDecisionFormat } from './browser-decision-format.js';
import { medievalVoice, medievalObservations } from './medieval-voice.js';

// Reserve room for the JSON envelope as well as a short Portuguese explanation.
const MAX_NEW_TOKENS = 512;

const GENERAL_SYSTEM_PROMPT = 'Você é o general de um reino simulado. Use somente os fatos observados da campanha. Uma unidade de alimento paga um dia para um soldado; os estoques e dias de ração são apresentados como números inteiros. Escolha exatamente um ID permitido. Ordens magic_recovery, magic_protection, magic_offense e magic_disruption apenas priorizam o apoio dos sacerdotes, preservando a manobra atual. A simulação controla recursos, alvos e resultados; não invente informações nem emita ordens fora da lista. Responda com um único JSON contendo action, confidence e reason curta em português.';
let generator = null;
let currentModel = null;
let currentDevice = null;
let currentModelConfig = null;
let currentProcessor = null;
let loading = null;
let fallbackLoading = null;
let operationQueue = Promise.resolve();
let backendError = null;
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
  return {
    revision: model.revision,
    device,
    dtype: device === 'wasm' ? model.fallbackDtype || model.dtype : model.dtype,
    progress_callback: reportProgress
  };
}

async function loadModelForDevice(model, device) {
  if (model.generationApi === 'qwen3_5') {
    const processor = await AutoProcessor.from_pretrained(model.modelId, {
      revision: model.revision,
      progress_callback: reportProgress
    });
    const loadedModel = await Qwen3_5ForConditionalGeneration.from_pretrained(
      model.modelId,
      modelOptions(model, device)
    );
    return { model: loadedModel, processor };
  }
  return {
    model: await pipeline('text-generation', model.modelId, modelOptions(model, device)),
    processor: null
  };
}

function getTokenizer(modelPipeline) {
  const tokenizer = currentProcessor?.tokenizer || modelPipeline.tokenizer;
  if (!tokenizer) throw new Error('O tokenizer do modelo não foi carregado.');
  return tokenizer;
}

async function loadModel(model) {
  env.allowRemoteModels = true;
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  const devices = self.navigator?.gpu ? ['webgpu', 'wasm'] : ['wasm'];
  let webGpuError = null;
  for (const device of devices) {
    if (device === 'webgpu') postStatus('Preparando o modelo Qwen no navegador com WebGPU…', 0);
    else if (webGpuError) postStatus('WebGPU não pôde carregar este modelo; tentando CPU/WASM no navegador…', 0);
    else postStatus('WebGPU indisponível; carregando o modelo em CPU/WASM no navegador…', 0);
    try {
      const loaded = await loadModelForDevice(model, device);
      generator = loaded.model;
      currentProcessor = loaded.processor;
      currentDevice = device === 'webgpu' ? 'WebGPU' : 'CPU/WASM';
      currentModel = model.modelId;
      StructuredOutputProcessor.warmup(getTokenizer(generator));
      currentModelConfig = model;
      if (webGpuError) {
        self.postMessage({ type: 'status', status: { phase: 'loading', text: 'Modelo carregado em CPU/WASM no navegador.', progress: 1, device: currentDevice, detail: String(webGpuError?.message || webGpuError).slice(0, 220) } });
      }
      return generator;
    } catch (error) {
      if (device !== 'webgpu') throw error;
      webGpuError = error;
      try { await generator?.dispose?.(); } catch { /* Dispose any partially initialized WebGPU session. */ }
      generator = null;
      currentProcessor = null;
      currentModelConfig = null;
    }
  }
  throw webGpuError || new Error('O modelo não pôde ser carregado no navegador.');
}

async function ensureModel(model) {
  if (backendError) throw backendError;
  if (generator && currentModel === model.modelId) return generator;
  if (!loading) {
    loading = loadModel(model).finally(() => { loading = null; });
  }
  return loading;
}

function getMessages(request, context = request.context) {
  const system = request.role === 'general'
    ? GENERAL_SYSTEM_PROMPT + ' Ações permitidas: ' + request.candidateActions.join(', ') + '.'
    : buildKingdomStrategySystemPrompt(request.candidateActions, { compact: true });
  return [
    { role: 'system', content: system + ' ' + medievalVoice(request.role) },
    { role: 'user', content: JSON.stringify(medievalObservations(context)) }
  ];
}

function disposeTensorTree(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (ArrayBuffer.isView(value)) return;
  if (typeof value.dispose === 'function') {
    try { value.dispose(); } catch { /* Tensor cleanup must not mask the inference result. */ }
    return;
  }
  for (const nested of Object.values(value)) disposeTensorTree(nested, seen);
}

async function prepareBoundedQwenInputs(request, model) {
  if (!currentProcessor) throw new Error('O processador de texto Qwen3.5 não foi carregado.');
  const contextLimit = Number(model.contextTokens);
  const inputLimit = browserInputTokenBudget(contextLimit, MAX_NEW_TOKENS);
  if (inputLimit == null) {
    const error = new Error('O modelo não informou um limite de contexto válido para reservar os tokens de saída.');
    error.code = 'AI_CONTEXT_BUDGET_UNAVAILABLE';
    throw error;
  }
  let lastInputLength = 0;
  for (const context of browserDecisionContextVariants(request)) {
    const prompt = currentProcessor.apply_chat_template(getMessages(request, context), {
      tokenize: false,
      add_generation_prompt: true,
      enable_thinking: false
    });
    const inputs = await currentProcessor(prompt);
    const inputLength = inputs.input_ids?.dims?.at(-1) || 0;
    lastInputLength = inputLength;
    if (browserInputFitsTokenBudget(inputLength, inputLimit)) {
      return { inputs, inputLength, contextLimit };
    }
    disposeTensorTree(inputs);
  }
  const error = new Error('O contexto da decisão tem ' + lastInputLength + ' tokens; o limite seguro de entrada é '
    + (Number.isFinite(inputLimit) ? inputLimit : 'desconhecido') + '. A decisão foi bloqueada para evitar exceder a memória do modelo.');
  error.code = 'AI_CONTEXT_TOO_LONG';
  throw error;
}

function createSchemaProcessor(modelPipeline, request) {
  return new StructuredOutputProcessor(getTokenizer(modelPipeline), browserDecisionFormat(request.candidateActions));
}

async function loadFallbackModel(model) {
  if (!fallbackLoading) {
    fallbackLoading = loadModelForDevice(model, 'wasm').finally(() => { fallbackLoading = null; });
  }
  const loaded = await fallbackLoading;
  generator = loaded.model;
  currentProcessor = loaded.processor;
  currentModel = model.modelId;
  currentDevice = 'CPU/WASM';
  StructuredOutputProcessor.warmup(getTokenizer(generator));
  currentModelConfig = model;
  return generator;
}

async function runGeneration(modelPipeline, request, schemaProcessor, model) {
  if (model.generationApi === 'qwen3_5') {
    const prepared = await prepareBoundedQwenInputs(request, model);
    const { inputs, inputLength } = prepared;
    let output;
    let generatedTokens;
    try {
      output = await modelPipeline.generate({
        ...inputs,
        max_new_tokens: MAX_NEW_TOKENS,
        do_sample: false,
        logits_processor: schemaProcessor
      });
      generatedTokens = output.slice(null, [inputLength, null]);
      const generated = currentProcessor.batch_decode(
        generatedTokens,
        { skip_special_tokens: true }
      );
      return {
        content: generated?.[0] || '',
        outputTokens: Math.max(0, (output.dims?.at(-1) || inputLength) - inputLength),
        inputTokens: inputLength,
        contextTokens: prepared.contextLimit
      };
    } finally {
      disposeTensorTree(inputs);
      disposeTensorTree(generatedTokens);
      disposeTensorTree(output);
    }
  }

  const result = await modelPipeline(getMessages(request), {
    max_new_tokens: MAX_NEW_TOKENS,
    do_sample: false,
    temperature: 0,
    tokenizer_encode_kwargs: { enable_thinking: false },
    logits_processor: [schemaProcessor]
  });
  const generated = result?.[0]?.generated_text;
  const rawContent = Array.isArray(generated) ? generated.at(-1)?.content : generated;
  return { content: typeof rawContent === 'string' ? rawContent : '', outputTokens: null, inputTokens: null, contextTokens: model.contextTokens ?? null };
}

async function decide(requestId, request, model) {
  let modelPipeline = await ensureModel(model);
  if (cancelled.delete(requestId)) return;
  let schemaProcessor = createSchemaProcessor(modelPipeline, request);
  const startedAt = performance.now();
  let result;
  try {
    result = await runGeneration(modelPipeline, request, schemaProcessor, model);
  } catch (error) {
    if (currentDevice !== 'WebGPU' || ['AI_CONTEXT_TOO_LONG', 'AI_CONTEXT_BUDGET_UNAVAILABLE'].includes(error?.code)) throw error;
    // Cancellation suppresses a response, but cannot interrupt an OrtRun already in progress.
    // Wait for its completion and release before another request touches these sessions.
    generator = null;
    currentProcessor = null;
    currentDevice = null;
    try { await modelPipeline.dispose?.(); } catch { /* A lost GPU may also reject release. */ }
    if (cancelled.delete(requestId)) return;
    self.postMessage({ type: 'status', status: { phase: 'loading', recovering: true,
      text: 'A GPU falhou durante a geração. Recuperando a IA em CPU/WASM…', progress: 0 } });
    try {
      modelPipeline = await loadFallbackModel(model);
      schemaProcessor = createSchemaProcessor(modelPipeline, request);
      result = await runGeneration(modelPipeline, request, schemaProcessor, model);
    } catch (fallbackError) {
      try { await generator?.dispose?.(); } catch { /* Keep both inference failures as diagnostics. */ }
      generator = null;
      currentProcessor = null;
      backendError = new Error('Não foi possível recuperar a IA em CPU/WASM. GPU: '
        + String(error?.message || error).slice(0, 240) + ' CPU: ' + String(fallbackError?.message || fallbackError).slice(0, 240));
      backendError.name = 'InferenceBackendError';
      backendError.code = 'AI_BACKEND_UNAVAILABLE';
      throw backendError;
    }
  }
  if (cancelled.delete(requestId)) return;
  const rawContent = result?.content;
  if (typeof rawContent !== 'string' || !rawContent.trim()) throw new Error('O modelo não gerou uma decisão.');
  const firstBrace = rawContent.indexOf('{');
  const lastBrace = rawContent.lastIndexOf('}');
  const content = firstBrace >= 0 && lastBrace > firstBrace
    ? rawContent.slice(firstBrace, lastBrace + 1)
    : rawContent.trim();
  const elapsedMs = Math.round(performance.now() - startedAt);
  console.info('[Kingdom IA navegador] decisão gerada', {
    model: currentModel,
    device: currentDevice,
    elapsedMs,
    outputTokens: result.outputTokens,
    inputTokens: result.inputTokens,
    contextTokens: result.contextTokens,
    outputPreview: content.slice(0, 240)
  });
  self.postMessage({
    type: 'decision',
    requestId,
    response: {
      choices: [{ message: { content } }],
      provider: 'transformers-js-browser',
      model: currentModel,
      elapsedMs,
      outputTokens: result.outputTokens,
      inputTokens: result.inputTokens,
      contextTokens: result.contextTokens,
      device: currentDevice
    }
  });
}

function reportError(error, requestId) {
  self.postMessage({ type: 'error', requestId, message: String(error?.message || error),
    name: error?.name, code: error?.code, fatal: error?.code === 'AI_BACKEND_UNAVAILABLE' });
}

self.addEventListener('message', event => {
  const message = event.data || {};
  if (message.type === 'cancel') {
    cancelled.add(message.requestId);
    return;
  }
  if (message.type === 'initialize') {
    operationQueue = operationQueue.then(() => ensureModel(message.model)).then(() => {
      self.postMessage({ type: 'ready', provider: 'transformers-js-browser', model: currentModel, device: currentDevice });
      self.postMessage({ type: 'status', status: { phase: 'ready', text: 'Modelo pronto no navegador · ' + currentDevice + '. Ollama não é necessário.', progress: 1, device: currentDevice } });
    }).catch(error => {
      reportError(error, null);
    });
    return;
  }
  if (message.type === 'decide') {
    operationQueue = operationQueue.then(async () => {
      if (cancelled.delete(message.requestId)) return;
      if (backendError) throw backendError;
      if (!currentModelConfig) throw new Error('O modelo ainda não terminou de carregar.');
      await decide(message.requestId, message.request, currentModelConfig);
    }).catch(error => reportError(error, message.requestId));
  }
});
