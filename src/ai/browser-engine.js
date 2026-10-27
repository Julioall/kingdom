import { AI_MODEL_MANIFEST } from './model-manifest.js';

function createAbortError() {
  return new DOMException('A inferência foi cancelada.', 'AbortError');
}

export function createBrowserEngine(options = {}) {
  const WorkerClass = options.WorkerClass || globalThis.Worker;
  const onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};
  if (!options.createWorker && !WorkerClass) throw new Error('Este navegador não oferece Web Workers para executar a IA local.');

  const model = options.model || AI_MODEL_MANIFEST.browser;
  const decisionTimeoutMs = Number.isFinite(options.decisionTimeoutMs) && options.decisionTimeoutMs > 0
    ? Math.floor(options.decisionTimeoutMs)
    : model.inferenceTimeoutMs || 30000;
  const workerUrl = options.workerUrl || new URL('./browser-inference-worker.js', import.meta.url);
  const worker = options.createWorker
    ? options.createWorker()
    : new WorkerClass(workerUrl, { type: 'module', name: 'Kingdom IA local' });
  const pending = new Map();
  let nextRequestId = 1;
  let disposed = false;
  let settled = false;
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  function failPending(error) {
    for (const operation of pending.values()) operation.reject(error);
    pending.clear();
  }

  worker.addEventListener('message', event => {
    const message = event.data || {};
    if (message.type === 'status') {
      onStatus(message.status || {});
      return;
    }
    if (message.type === 'ready') {
      if (settled) return;
      settled = true;
      resolveReady({ provider: message.provider, model: message.model, device: message.device });
      return;
    }
    if (message.type === 'error' && message.requestId == null) {
      const error = new Error(message.message || 'O modelo no navegador não pôde ser carregado.');
      if (!settled) {
        settled = true;
        rejectReady(error);
      }
      failPending(error);
      return;
    }
    if (message.type !== 'decision' && message.type !== 'error') return;
    const operation = pending.get(message.requestId);
    if (!operation) return;
    pending.delete(message.requestId);
    if (message.type === 'error') operation.reject(new Error(message.message || 'A inferência no navegador falhou.'));
    else operation.resolve(message.response);
  });

  worker.addEventListener('error', event => {
    const error = new Error(event.message || 'O worker de IA local foi encerrado inesperadamente.');
    if (!settled) {
      settled = true;
      rejectReady(error);
    }
    failPending(error);
  });

  worker.postMessage({ type: 'initialize', model });

  function dispose() {
    if (disposed) return;
    disposed = true;
    worker.terminate();
    const error = createAbortError();
    if (!settled) {
      settled = true;
      rejectReady(error);
    }
    failPending(error);
  }

  return {
    ready,
    async decide(request, { signal } = {}) {
      await ready;
      if (disposed || signal?.aborted) throw createAbortError();
      const requestId = nextRequestId++;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          const operation = pending.get(requestId);
          if (!operation) return;
          pending.delete(requestId);
          const error = new Error('A inferência no navegador excedeu ' + Math.round(decisionTimeoutMs / 1000) + ' segundos.');
          error.name = 'TimeoutError';
          operation.reject(error);
          dispose();
        }, decisionTimeoutMs);
        const abort = () => {
          clearTimeout(timeout);
          pending.delete(requestId);
          worker.postMessage({ type: 'cancel', requestId });
          reject(createAbortError());
        };
        if (signal) signal.addEventListener('abort', abort, { once: true });
        pending.set(requestId, {
          resolve: response => {
            clearTimeout(timeout);
            signal?.removeEventListener('abort', abort);
            resolve(response);
          },
          reject: error => {
            clearTimeout(timeout);
            signal?.removeEventListener('abort', abort);
            reject(error);
          }
        });
        worker.postMessage({ type: 'decide', requestId, request });
      });
    },
    dispose
  };
}

export default { createBrowserEngine };
