import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserEngine } from '../src/ai/browser-engine.js';

class FakeWorker {
  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.messages = [];
    this.listeners = new Map();
    this.terminated = false;
    FakeWorker.instance = this;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  postMessage(message) { this.messages.push(message); }
  terminate() { this.terminated = true; }
  emit(type, data) {
    for (const listener of this.listeners.get(type) || []) listener({ data, message: data?.message });
  }
}

test('browser AI engine reports browser worker readiness and returns decisions', async () => {
  const statuses = [];
  const engine = createBrowserEngine({ WorkerClass: FakeWorker, onStatus: status => statuses.push(status) });
  const worker = FakeWorker.instance;
  assert.equal(worker.messages[0].type, 'initialize');
  assert.equal(worker.options.type, 'module');

  worker.emit('message', { type: 'status', status: { phase: 'loading', text: 'Downloading', progress: .4 } });
  worker.emit('message', { type: 'ready', provider: 'transformers.js-browser', model: 'qwen-test', device: 'WebGPU' });
  assert.deepEqual(await engine.ready, { provider: 'transformers.js-browser', model: 'qwen-test', device: 'WebGPU' });
  assert.equal(statuses.at(-1).progress, .4);

  const request = { role: 'king', candidateActions: ['forage'], context: {} };
  const responsePromise = engine.decide(request);
  await Promise.resolve();
  const posted = worker.messages.at(-1);
  assert.equal(posted.type, 'decide');
  assert.equal(posted.request, request);
  worker.emit('message', { type: 'decision', requestId: posted.requestId, response: { choices: [{ message: { content: '{"action":"forage"}' } }] } });
  assert.deepEqual(await responsePromise, { choices: [{ message: { content: '{"action":"forage"}' } }] });

  engine.dispose();
  assert.equal(worker.terminated, true);
});

test('browser AI engine cancels an in-flight worker decision when disabled', async () => {
  const engine = createBrowserEngine({ WorkerClass: FakeWorker });
  const worker = FakeWorker.instance;
  worker.emit('message', { type: 'ready', provider: 'transformers.js-browser', model: 'qwen-test', device: 'WebGPU' });
  await engine.ready;

  const controller = new AbortController();
  const decision = engine.decide({ role: 'king' }, { signal: controller.signal });
  await Promise.resolve();
  const request = worker.messages.at(-1);
  controller.abort();
  await assert.rejects(decision, { name: 'AbortError' });
  assert.deepEqual(worker.messages.at(-1), { type: 'cancel', requestId: request.requestId });
  engine.dispose();
});

test('browser AI engine terminates a worker when inference exceeds its deadline', async () => {
  const engine = createBrowserEngine({ WorkerClass: FakeWorker, decisionTimeoutMs: 10 });
  const worker = FakeWorker.instance;
  worker.emit('message', { type: 'ready', provider: 'transformers.js-browser', model: 'qwen-test', device: 'WebGPU' });
  await engine.ready;

  const controller = new AbortController();
  await assert.rejects(engine.decide({ role: 'king' }, { signal: controller.signal }), { name: 'TimeoutError' });
  const messageCount = worker.messages.length;
  controller.abort();
  assert.equal(worker.messages.length, messageCount);
  assert.equal(worker.terminated, true);
});

test('browser AI engine gives a bounded recovery window instead of timing out the CPU reload at the GPU limit', async () => {
  const engine = createBrowserEngine({ WorkerClass: FakeWorker, decisionTimeoutMs: 10, recoveryTimeoutMs: 200 });
  const worker = FakeWorker.instance;
  worker.emit('message', { type: 'ready', device: 'WebGPU' });
  const result = engine.decide({ role: 'king' });
  await Promise.resolve();
  const requestId = worker.messages.at(-1).requestId;
  worker.emit('message', { type: 'status', status: { recovering: true, phase: 'loading' } });
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(worker.terminated, false);
  worker.emit('message', { type: 'decision', requestId, response: { device: 'CPU/WASM' } });
  assert.equal((await result).device, 'CPU/WASM');
  engine.dispose();
});

test('fatal backend errors reject every pending request and terminate the poisoned worker', async () => {
  const engine = createBrowserEngine({ WorkerClass: FakeWorker });
  const worker = FakeWorker.instance;
  worker.emit('message', { type: 'ready', device: 'WebGPU' });
  const outcomes = Promise.allSettled([engine.decide({ role: 'king' }), engine.decide({ role: 'general' })]);
  await Promise.resolve();
  const requestId = worker.messages.find(message => message.type === 'decide').requestId;
  worker.emit('message', { type: 'error', requestId, name: 'InferenceBackendError', fatal: true, message: 'GPU and CPU failed' });
  const results = await outcomes;
  assert.ok(results.every(result => result.status === 'rejected' && result.reason.name === 'InferenceBackendError'));
  assert.equal(worker.terminated, true);
  await assert.rejects(engine.decide({ role: 'king' }), { name: 'AbortError' });
});
