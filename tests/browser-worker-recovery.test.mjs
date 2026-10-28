import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = (await readFile(new URL('../src/ai/browser-inference-worker.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/gm, '');
const config = { modelId: 'test-qwen', generationApi: 'qwen3_5', contextTokens: 2048,
  dtype: { decoder_model_merged: 'q4f16' }, fallbackDtype: { decoder_model_merged: 'q4' } };
const request = { role: 'king', candidateActions: ['forage'], context: {} };
const output = () => ({ dims: [1, 3], dispose() {}, slice() { return { dispose() {} }; } });

function harness(options = {}) {
  const messages = [], loads = [], tensors = [];
  let listener;
  const processor = Object.assign(async () => ({ input_ids: { dims: [1, 1], dispose() {} } }), {
    tokenizer: {}, apply_chat_template: () => 'prompt',
    batch_decode: () => ['{"action":"forage","confidence":0.8,"reason":"Comida"}']
  });
  const context = vm.createContext({
    console: { info() {} }, performance, env: {},
    self: { navigator: { gpu: {} }, postMessage: message => messages.push(message),
      addEventListener: (_, handler) => { listener = handler; } },
    AutoProcessor: { from_pretrained: async () => processor },
    Qwen3_5ForConditionalGeneration: { from_pretrained: async (_, settings) => {
      loads.push(settings);
      if (settings.device === 'wasm' && options.cpuLoadError) throw options.cpuLoadError;
      return {
        generate: settings.device === 'webgpu' ? options.gpuGenerate || (async () => {
          const tensor = { dims: [1, 3], disposed: false, dispose() { this.disposed = true; },
            slice() { const view = { disposed: false, dispose() { this.disposed = true; } }; tensors.push(view); return view; } };
          tensors.push(tensor); return tensor;
        }) : options.cpuGenerate || (async () => output()),
        dispose: settings.device === 'webgpu' ? options.gpuDispose || (async () => {}) : async () => {}
      };
    } },
    pipeline() { throw Error('Unexpected pipeline'); },
    StructuredOutputProcessor: class { static warmup() {} },
    browserDecisionContextVariants: value => [value.context], browserInputTokenBudget: () => 1900,
    browserInputFitsTokenBudget: () => true, buildKingdomStrategySystemPrompt: () => 'strategy'
  });
  vm.runInContext(source, context);
  return { messages, loads, tensors, send: data => listener({ data }) };
}

async function until(predicate) {
  for (let index = 0; index < 100; index++) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail('Worker did not reach the expected state');
}

test('worker serializes generations even when two messages arrive together', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let running = 0, maximum = 0, calls = 0;
  const worker = harness({ gpuGenerate: async () => {
    running++; maximum = Math.max(maximum, running); calls++;
    if (calls === 1) await gate;
    running--; return output();
  } });
  worker.send({ type: 'initialize', model: config });
  await until(() => worker.messages.some(m => m.type === 'ready'));
  worker.send({ type: 'decide', requestId: 1, request });
  worker.send({ type: 'decide', requestId: 2, request });
  await until(() => calls === 1);
  assert.equal(calls, 1);
  release();
  await until(() => worker.messages.filter(m => m.type === 'decision').length === 2);
  assert.equal(maximum, 1);
});

test('GPU failure awaits release and retries on WASM using its own precision', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let disposing = false;
  const worker = harness({ gpuGenerate: async () => { throw Error('OrtRun map_async_result failed'); },
    gpuDispose: async () => { disposing = true; await gate; } });
  worker.send({ type: 'initialize', model: config });
  await until(() => worker.messages.some(m => m.type === 'ready'));
  worker.send({ type: 'decide', requestId: 1, request });
  await until(() => disposing);
  assert.equal(worker.loads.length, 1, 'CPU must not allocate while GPU release is unfinished');
  release();
  await until(() => worker.messages.some(m => m.type === 'decision'));
  assert.equal(worker.loads[1].device, 'wasm');
  assert.equal(worker.loads[1].dtype.decoder_model_merged, 'q4');
  assert.equal(worker.messages.find(m => m.type === 'decision').response.device, 'CPU/WASM');
  assert.ok(worker.messages.some(m => m.status?.recovering));
});

test('failed CPU recovery marks the backend fatal and never reuses the broken model', async () => {
  const worker = harness({ gpuGenerate: async () => { throw Error('GPU lost'); },
    gpuDispose: async () => { throw Error('release rejected'); }, cpuLoadError: Error('CPU unavailable') });
  worker.send({ type: 'initialize', model: config });
  await until(() => worker.messages.some(m => m.type === 'ready'));
  worker.send({ type: 'decide', requestId: 1, request });
  await until(() => worker.messages.some(m => m.type === 'error'));
  const error = worker.messages.find(m => m.type === 'error');
  assert.equal(error.fatal, true);
  assert.equal(error.name, 'InferenceBackendError');
  assert.match(error.message, /GPU lost/);
  assert.match(error.message, /CPU unavailable/);
  worker.send({ type: 'decide', requestId: 2, request });
  await until(() => worker.messages.filter(m => m.type === 'error').length === 2);
  assert.equal(worker.loads.length, 2);
});

test('output tensors and sliced tokens are released after successful inference', async () => {
  const worker = harness();
  worker.send({ type: 'initialize', model: config });
  await until(() => worker.messages.some(m => m.type === 'ready'));
  worker.send({ type: 'decide', requestId: 1, request });
  await until(() => worker.messages.some(m => m.type === 'decision'));
  assert.equal(worker.tensors.length, 2);
  assert.ok(worker.tensors.every(tensor => tensor.disposed));
});
