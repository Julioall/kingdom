import { createSimulationWorkerRuntime } from './worker-runtime.js';
import { transferablesForSnapshot } from './render-snapshot.js';
import { transferablesForTileDelta } from './tile-delta.js';
import { SIMULATION_PROTOCOL_VERSION } from './protocol-version.js';
import type { SimulationWorkerResponse } from './protocol';

const scope = globalThis as unknown as {
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};
const runtime = createSimulationWorkerRuntime();

scope.addEventListener('message', (event: MessageEvent) => {
  const response = runtime.handle(event.data) as SimulationWorkerResponse;
  if (response.protocolVersion !== SIMULATION_PROTOCOL_VERSION) return;
  const transfer = response.type === 'snapshot'
    ? transferablesForSnapshot(response.snapshot)
    : response.type === 'world-delta' ? transferablesForTileDelta(response.delta) : [];
  scope.postMessage(response, transfer as Transferable[]);
});
