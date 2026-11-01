import type { WorldConfig, WorldState } from './core/state';
import type { WorldCommand } from './index';
import { SIMULATION_PROTOCOL_VERSION } from './protocol-version.js';

export { SIMULATION_PROTOCOL_VERSION };

export type TileColumns = {
  scalars: Float32Array;
  ids: Int32Array;
  types: Uint8Array;
  plants: Float32Array;
  tileCount: number;
  plantCount: number;
};

export type WorldSnapshot = {
  base: Omit<WorldState, 'tiles' | 'waterTiles' | 'events' | 'logs'>;
  tileColumns: TileColumns;
  stats: Record<string, unknown>;
  events: unknown[];
  logs: unknown[];
  reset: boolean;
};

export type SparseTileColumns = {
  schemaVersion: 1;
  tileCount: number;
  plantCount: number;
  indices: Uint32Array;
  scalars: Float32Array;
  ids: Int32Array;
  types: Uint8Array;
  plants: Float32Array;
};

export type FieldTileColumns = {
  schemaVersion: 2;
  tileCount: number;
  plantCount: number;
  scalarFields: number;
  idFields: number;
  typeFields: number;
  fields: {
    scalars: Array<{field: number; indices?: Uint32Array; values: Float32Array}>;
    ids: Array<{field: number; indices?: Uint32Array; values: Int32Array}>;
    types: Array<{field: number; indices?: Uint32Array; values: Uint8Array}>;
    plants: Array<{field: number; indices?: Uint32Array; values: Float32Array}>;
  };
};

export type WorldTileDelta = Omit<WorldSnapshot, 'tileColumns' | 'reset'> & {
  tileColumns: SparseTileColumns | FieldTileColumns;
  baseRevision: number;
  reset: false;
};

export type KingdomAiDecisionRequest = {
  contractVersion: 1;
  requestId: string;
  worldEpoch: number;
  role: 'king' | 'general';
  agentId: number;
  kingdomId: number;
  campaignId: number | string | null;
  orderVersion: number;
  reportDay: number;
  expiresDay: number;
  priority?: 'normal' | 'urgent';
  requestedDay: number;
  rulerName: string | null;
  candidateActions: string[];
  allowedActions: string[];
  observedFacts: Record<string, unknown>;
  context: Record<string, unknown>;
};

type RequestEnvelope = {
  protocolVersion: typeof SIMULATION_PROTOCOL_VERSION;
  requestId: number;
  epoch: number;
};

export type SimulationWorkerRequest = RequestEnvelope & (
  | { type: 'initialize'; config: WorldConfig; seed: number; transport?: 'tile-delta' }
  | { type: 'reset'; seed: number; kingdomAiEnabled: boolean; transport?: 'tile-delta' }
  | { type: 'resync' }
  | { type: 'set-paused'; paused: boolean }
  | { type: 'advance'; days: number; source: 'clock' | 'manual' }
  | { type: 'dispatch'; command: WorldCommand }
  | { type: 'set-kingdom-ai'; enabled: boolean }
  | { type: 'pull-kingdom-ai-request'; limit: number }
  | { type: 'apply-kingdom-ai-decision'; aiRequest: KingdomAiDecisionRequest; decision: { action: string; confidence: number; reason: string }; providerMetadata?: { provider?: string; model?: string; elapsedMs?: number; inputTokens?: number; contextTokens?: number; outputTokens?: number } }
  | { type: 'fail-kingdom-ai-request'; aiRequest: KingdomAiDecisionRequest; failure?: { reason?: string; provider?: string; model?: string } }
  | { type: 'inspect-tile'; x: number; y: number }
);

type ResponseEnvelope = {
  protocolVersion: typeof SIMULATION_PROTOCOL_VERSION;
  requestId: number;
  epoch: number;
  revision: number;
};

export type SimulationWorkerResponse = ResponseEnvelope & (
  | { type: 'snapshot'; snapshot: WorldSnapshot; result?: unknown }
  | { type: 'world-delta'; delta: WorldTileDelta; result?: unknown }
  | { type: 'player-update'; person?: WorldState['people'][number] | null; people?: WorldState['people']; combatEvents?: unknown[]; loot?: unknown[]; trainingDummyStates?: WorldState['trainingDummyStates']; events?: unknown[]; logs?: unknown[]; magicTimeMs?: number; magicZones?: unknown[]; magicEvents?: unknown[]; magicStats?: unknown; result?: unknown }
  | { type: 'ack'; result?: unknown }
  | { type: 'kingdom-ai-request'; request: KingdomAiDecisionRequest | null }
  | { type: 'query'; result: unknown }
  | { type: 'error'; message: string }
);

export type WorldView = Omit<WorldState, 'tiles' | 'waterTiles'> & {
  tiles: WorldState['tiles'];
  waterTiles: WorldState['tiles'];
  stats: Record<string, unknown>;
};
