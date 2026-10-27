import BrowserInferenceWorker from './browser-inference-worker.js?worker';

export function createBrowserInferenceWorker() {
  return new BrowserInferenceWorker({ name: 'Kingdom IA local' });
}
