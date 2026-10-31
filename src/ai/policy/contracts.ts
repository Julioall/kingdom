/**
 * JUL-270 / schema v1 — future shared human decision policy contracts.
 *
 * Types only. Existing neural, LLM, and Worker runtimes are NOT changed here.
 * Actor identity/personality/memory never live inside global policy weights.
 */

/** Logical cognitive role, not the current gameplay `person.role` enum.
 * Example: the existing engine may represent a general as a soldier with
 * command rank; its role resolver is introduced separately in JUL-271.
 */
export type CognitiveRole = 'civilian' | 'worker' | 'military' | 'general' | 'king';

/** Policy outputs intentions rather than mutating the world. */
export type ActionId = string & { readonly __actionId?: never };

export type SharedPolicySpec = Readonly<{
  schemaVersion: 1;
  policyId: string;
  policyVersion: number;
  seed: number;
  inputDimension: number;
  outputDimension: number;
  /** Includes input/output dimensions, in feed-forward order. */
  layerWidths: readonly number[];
  /** Output indices must have stable meaning across versions. */
  actionIds: readonly ActionId[];
  /** Immutable global weights owned by the authoritative simulation. */
  weights: Float32Array;
  biases: Float32Array;
}>;

export type ActorIdentity = Readonly<{
  actorId: number;
  role: CognitiveRole;
  kingdomId: number | null;
  communityId: number | null;
}>;

/** Beliefs are personal and must track when and from whom they were learned. */
export type AgentBelief = {
  factId: string;
  confidence: number;
  sourceActorId: number | null;
  observedAtDay: number;
  expiresAtDay: number | null;
};

/** Bounded episodic records; compaction policy is defined in JUL-272. */
export type MemoryEpisode = {
  eventId: string;
  day: number;
  importance: number;
  valence: number;
  peopleIds: number[];
  location: { x: number; y: number } | null;
  tags: string[];
};

/** Persisted, per-actor state. Never embeds complete dense policy weights. */
export type AgentCognitiveState = {
  schemaVersion: 1;
  identity: ActorIdentity;
  personality: Float32Array;
  preferences: Float32Array;
  goals: string[];
  episodes: MemoryEpisode[];
  beliefs: AgentBelief[];
  /** Actor-specific learned preferences, indexed by actionId, not global weights. */
  actionBias: Float32Array;
  latentState: Float32Array;
  rewardBaseline: number;
  lastDecisionDay: number;
};

/**
 * Inputs must be constructed from authorised, in-range perception.
 * Sharing the model must never imply sharing knowledge between NPCs.
 */
export type ActorObservation = Readonly<{
  actor: ActorIdentity;
  worldEpoch: number;
  revision: number;
  simulatedDay: number;
  /** Features in the policy specification's fixed order. */
  perceptionFeatures: Float32Array;
  roleFeatures: Float32Array;
  personalityFeatures: Float32Array;
  memoryFeatures: Float32Array;
  contextFeatures: Float32Array;
  /** One byte per action, 0=forbidden; nonzero=permitted. */
  actionMask: Uint8Array;
}>;

export type DecisionIntent = Readonly<{
  actorId: number;
  worldEpoch: number;
  revision: number;
  policyVersion: number;
  actionId: ActionId;
  actionIndex: number;
  confidence: number;
  score: number;
  reasoningTags: readonly string[];
}>;

/**
 * Scheduler can batch observations from different roles, preserving
 * actor order. Actions are applied only after domain validation.
 */
export interface SharedPolicy {
  readonly spec: SharedPolicySpec;
  inferBatch(observations: readonly ActorObservation[]): readonly DecisionIntent[];
}

/** The runtime domain validator can reject an action without granting
 * privileged access to resources, army commands, or private actor memories.
 */
export type ValidatedIntent = Readonly<
  | { accepted: true; intent: DecisionIntent }
  | { accepted: false; intent: DecisionIntent; reason: string }
>;

/** Wire protocol design for JUL-277/JUL-278. Not active in Worker v1. */
export type DeltaEntityKind = 'person' | 'animal' | 'structure' | 'projectile' | 'loot';
export type EntityPatch = Readonly<{
  kind: DeltaEntityKind;
  id: number;
  /** An explicit allowlist of serializable view fields, never raw world state. */
  fields: Readonly<Record<string, unknown>>;
}>;
export type DirtyTileColumns = Readonly<{
  indices: Uint32Array;
  scalars?: Float32Array;
  ids?: Int32Array;
  types?: Uint8Array;
  plants?: Float32Array;
  /** Array layout is schema-versioned; no implicit deltas. */
  layoutVersion: number;
}>;
export type WorldDeltaV1 = Readonly<{
  schemaVersion: 1;
  epoch: number;
  baseRevision: number;
  revision: number;
  entityPatches: readonly EntityPatch[];
  removedEntities: readonly { kind: DeltaEntityKind; id: number }[];
  dirtyTiles: DirtyTileColumns | null;
  events: readonly unknown[];
  stats: Readonly<Record<string, unknown>> | null;
}>;
export type WorldResyncRequest = Readonly<{
  type: 'request-full-snapshot';
  epoch: number;
  lastAppliedRevision: number;
  reason: 'gap' | 'reset' | 'unknown-entity' | 'bad-schema';
}>;

/** A typed transport envelope for future use; current protocol is unchanged. */
export type SimulationDeltaEnvelope = Readonly<{
  protocolVersion: number;
  requestId: number;
  epoch: number;
  revision: number;
  type: 'world-delta';
  delta: WorldDeltaV1;
}>;
