import { defaultWorldConfig, type WorldConfig } from '../simulation/core/state';
import type { WorldCommand } from '../simulation';
import { applyWorldSnapshot } from '../simulation/render-snapshot.js';
import { indexPeopleById, applyIndexedPersonUpdates } from './person-update-index.js';
import {
  SIMULATION_PROTOCOL_VERSION,
  type KingdomAiDecisionRequest,
  type SimulationWorkerRequest,
  type SimulationWorkerResponse,
  type WorldView
} from '../simulation/protocol';

type PendingRequest = {
  epoch: number;
  resolve: (response: SimulationWorkerResponse) => void;
  reject: (error: Error) => void;
};

export class GameSession {
  world: WorldView | null = null;
  stats: Record<string, unknown> | null = null;
  paused = false;
  speed = 1;
  revision = 0;
  private receivedRevision = 0;
  onPlayerUpdate: ((combat: boolean, personIds: number[], magic?: boolean) => void) | null = null;
  epoch = 1;
  ready: Promise<WorldView>;
  onUpdate: ((world: WorldView, stats: Record<string, unknown>, reset: boolean) => void) | null = null;
  onError: ((error: Error) => void) | null = null;

  private readonly worker: Worker;
  private nextRequestId = 1;
  private pending = new Map<number, PendingRequest>();
  private peopleById = new Map<number, WorldView['people'][number]>();
  private advanceInFlight = false;
  private advanceFlightToken = 0;
  private queuedClockDays = 0;
  private queuedManualDays = 0;

  constructor(private readonly config: WorldConfig = defaultWorldConfig, seed = 42) {
    this.worker = new Worker(new URL('../simulation/simulation.worker.ts', import.meta.url), { type: 'module' });
    this.worker.addEventListener('message', (event: MessageEvent<SimulationWorkerResponse>) => this.receive(event.data));
    this.worker.addEventListener('error', event => {
      const error = new Error(event.message || 'O Worker de simulação falhou.');
      this.failPending(error);
      this.onError?.(error);
    });
    this.worker.addEventListener('messageerror', () => {
      const error = new Error('Não foi possível decodificar uma resposta do Worker de simulação.');
      this.failPending(error);
      this.onError?.(error);
    });
    this.ready = this.send('initialize', { config: this.config, seed }, this.epoch).then(() => {
      if (!this.world) throw new Error('O Worker inicializou sem devolver o estado do mundo.');
      return this.world;
    });
  }

  async reset(seed: number, kingdomAiEnabled = false): Promise<WorldView> {
    if (!this.world) {
      try { await this.ready; } catch { /* Reset can recover from a failed first initialization. */ }
    }
    this.epoch++;
    const cancellation = new Error('Solicitação cancelada por um reset do mundo.');
    cancellation.name = 'AbortError';
    this.rejectOlderRequests(cancellation);
    this.advanceFlightToken++;
    this.advanceInFlight = false;
    this.queuedClockDays = 0;
    this.queuedManualDays = 0;
    this.paused = false;
    this.peopleById.clear();
    this.ready = this.send('reset', { seed, kingdomAiEnabled }, this.epoch).then(() => {
      if (!this.world) throw new Error('O Worker reiniciou sem devolver o estado do mundo.');
      return this.world;
    });
    return this.ready;
  }

  advance(days = 1, source: 'clock' | 'manual' = 'clock'): Promise<void> {
    const safeDays = Math.max(1, Math.min(12, Math.trunc(days)));
    if (source === 'clock') {
      if (this.paused) return Promise.resolve();
      this.queuedClockDays = Math.min(12, this.queuedClockDays + safeDays);
    } else this.queuedManualDays = Math.min(12, this.queuedManualDays + safeDays);
    this.drainAdvances();
    return Promise.resolve();
  }

  async setPaused(paused: boolean): Promise<void> {
    if (paused) this.queuedClockDays = 0;
    const response = await this.send('set-paused', { paused });
    if (response.type !== 'ack') throw new Error('O Worker não confirmou o estado de pausa.');
  }

  async dispatch(command: WorldCommand): Promise<unknown> {
    const response = await this.send('dispatch', { command });
    return response.type === 'snapshot' || response.type === 'player-update' ? response.result : undefined;
  }

  async setKingdomAiEnabled(enabled: boolean): Promise<boolean> {
    const response = await this.send('set-kingdom-ai', { enabled });
    return response.type === 'snapshot' ? !!response.result : false;
  }

  async pullKingdomAiRequest(limit = 1): Promise<KingdomAiDecisionRequest | null> {
    const response = await this.send('pull-kingdom-ai-request', { limit });
    return response.type === 'kingdom-ai-request' ? response.request : null;
  }

  async applyKingdomAiDecision(aiRequest: KingdomAiDecisionRequest, decision: unknown, providerMetadata?: Record<string, unknown>): Promise<boolean> {
    const response = await this.send('apply-kingdom-ai-decision', { aiRequest, decision, providerMetadata });
    return response.type === 'snapshot' ? !!response.result : false;
  }

  async failKingdomAiRequest(aiRequest: KingdomAiDecisionRequest, failure?: { reason?: string; provider?: string; model?: string }): Promise<boolean> {
    const response = await this.send('fail-kingdom-ai-request', { aiRequest, failure });
    return response.type === 'snapshot' ? !!response.result : false;
  }

  async inspectTile(x: number, y: number): Promise<unknown> {
    const response = await this.send('inspect-tile', { x, y });
    return response.type === 'query' ? response.result : null;
  }

  terminate() {
    this.failPending(new Error('A sessão de simulação foi encerrada.'));
    this.worker.terminate();
    this.peopleById.clear();
  }

  private send(type: string, payload: Record<string, unknown>, epoch = this.epoch): Promise<SimulationWorkerResponse> {
    const requestId = this.nextRequestId++;
    const request = {
      protocolVersion: SIMULATION_PROTOCOL_VERSION,
      requestId,
      epoch,
      type,
      ...payload
    } as SimulationWorkerRequest;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { epoch, resolve, reject });
      this.worker.postMessage(request);
    });
  }

  private drainAdvances() {
    if (this.advanceInFlight) return;
    let source: 'clock' | 'manual', days: number;
    if (this.queuedManualDays > 0) {
      source = 'manual';
      days = Math.min(12, this.queuedManualDays);
      this.queuedManualDays -= days;
    } else if (!this.paused && this.queuedClockDays > 0) {
      source = 'clock';
      days = Math.min(3, this.queuedClockDays);
      this.queuedClockDays -= days;
    } else return;

    const requestEpoch = this.epoch;
    const flightToken = ++this.advanceFlightToken;
    this.advanceInFlight = true;
    this.send('advance', { days, source }, requestEpoch).catch(error => {
      if (requestEpoch === this.epoch) this.onError?.(error);
    }).finally(() => {
      if (flightToken !== this.advanceFlightToken) return;
      this.advanceInFlight = false;
      if (requestEpoch === this.epoch) this.drainAdvances();
    });
  }

  private receive(response: SimulationWorkerResponse) {
    const pending = this.pending.get(response.requestId);
    if (!pending) return;
    this.pending.delete(response.requestId);
    if (response.protocolVersion !== SIMULATION_PROTOCOL_VERSION) {
      pending.reject(new Error('O Worker respondeu com uma versão de protocolo incompatível.'));
      return;
    }
    if (response.epoch !== pending.epoch || response.epoch !== this.epoch) {
      pending.reject(new Error('Resposta de uma época de simulação expirada.'));
      return;
    }
    if (response.type === 'error') {
      const error = new Error(response.message);
      pending.reject(error);
      return;
    }
    if (response.revision < this.receivedRevision) {
      pending.resolve(response);
      return;
    }
    this.receivedRevision = response.revision;
    if (response.type === 'player-update') {
      if (this.world) {
        const updates = response.people || (response.person ? [response.person] : []);
        applyIndexedPersonUpdates(this.peopleById, updates);
        for (const key of ['combatEvents', 'loot', 'trainingDummyStates', 'events', 'logs', 'magicTimeMs', 'magicZones', 'magicEvents', 'magicStats'] as const) {
          if (response[key] !== undefined) (this.world as unknown as Record<string, unknown>)[key] = response[key];
        }
        this.onPlayerUpdate?.(!!response.people?.length, updates.map(person => person.id), response.magicTimeMs !== undefined);
      }
      pending.resolve(response);
      return;
    }
    this.revision = response.revision;
    if (response.type === 'snapshot') {
      const nextWorld = applyWorldSnapshot(response.snapshot, response.snapshot.reset ? null : this.world);
      this.world = nextWorld;
      this.peopleById = indexPeopleById(nextWorld.people);
      this.stats = nextWorld.stats;
      this.onUpdate?.(nextWorld, nextWorld.stats, response.snapshot.reset);
    }
    pending.resolve(response);
  }

  private rejectOlderRequests(error: Error) {
    for (const [requestId, pending] of this.pending) {
      if (pending.epoch >= this.epoch) continue;
      this.pending.delete(requestId);
      pending.reject(error);
    }
  }

  private failPending(error: Error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
