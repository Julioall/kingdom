import { parentPort } from 'node:worker_threads';

// Run the production Worker entry in an isolated Node worker with browser message APIs.
globalThis.addEventListener = (type, listener) => {
  if (type === 'message') parentPort.on('message', data => listener({ data }));
};
globalThis.postMessage = (response, transfer) => parentPort.postMessage(response, transfer);
await import('../../src/simulation/simulation.worker.ts');
parentPort.postMessage({ ready: true });
