import { ANIMAL_ACTIONS, PEOPLE_ACTIONS, PEOPLE_INPUTS } from '../../config/ecosystem.js';
import { MILITARY_ACTIONS, ROYAL_SITING_STRATEGIES } from './action-catalog.js';

// Runtime policies live in WeakMaps, never on the serialized world or an actor.
// The human model is shared across civilian, worker, military, general and king.
// Animal models are shared per species, without per-animal dense weight matrices.
const humanPolicies = new WeakMap();
const animalPolicies = new WeakMap();

export const SHARED_POLICY_VERSION = 1;
export const COGNITIVE_ROLES = Object.freeze(['civilian', 'worker', 'military', 'general', 'king']);
export const HUMAN_POLICY_ACTIONS = Object.freeze([
  ...PEOPLE_ACTIONS.map(action => 'people:' + action),
  ...MILITARY_ACTIONS.map(action => 'military:' + action),
  ...ROYAL_SITING_STRATEGIES.map(action => 'royal:' + action)
]);
const EXTRA_FEATURES = 8;
const HUMAN_INPUT_SIZE = PEOPLE_INPUTS + COGNITIVE_ROLES.length + EXTRA_FEATURES;
const HIDDEN_WIDTHS = new Set([24, 32, 64, 128, 256]);

function randomWeights(seed) {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = state;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function finite(value) {
  return Number.isFinite(value) ? value : 0;
}

export function cognitiveRole(person) {
  if (person?.role === 'ruler') return 'king';
  if (person?.role === 'soldier' && person.militaryRank === 'general') return 'general';
  if (person?.role === 'soldier') return 'military';
  if (person?.assignment || person?.role === 'worker') return 'worker';
  return 'civilian';
}

export function sharedPolicyEnabled(world) {
  return world?.neuralOverrides?.neuralController !== 'legacy';
}

function policyWidth(world, domain) {
  const proposed = Number(world?.neuralOverrides?.sharedHiddenSize || (domain === 'human' ? 24 : 16));
  return domain === 'human' && HIDDEN_WIDTHS.has(proposed) ? proposed : domain === 'animal' ? 16 : 24;
}

function createPolicy(seed, domain, actionIds, inputDimension, width) {
  // A single role-conditioned trunk + logits. 24 hidden units is the safe
  // initial rollout; benchmark 64/128/256 before increasing inference FLOPs.
  const layerWidths = [inputDimension, width, width, actionIds.length];
  const weightCount = layerWidths.slice(1).reduce((sum, next, layer) =>
    sum + layerWidths[layer] * next, 0);
  const biasCount = layerWidths.slice(1).reduce((sum, n) => sum + n, 0);
  const weights = new Float32Array(weightCount);
  const biases = new Float32Array(biasCount);
  const random = randomWeights(seed ^ (domain === 'human' ? 0x48554d41 : 0x414e494d));
  let cursor = 0;
  for (let layer = 1; layer < layerWidths.length; layer++) {
    const scale = Math.sqrt(2 / (layerWidths[layer] + layerWidths[layer - 1]));
    for (let j = 0; j < layerWidths[layer] * layerWidths[layer - 1]; j++)
      weights[cursor++] = (random() * 2 - 1) * scale;
  }
  const spec = Object.freeze({
    schemaVersion: 1, policyId: domain, policyVersion: SHARED_POLICY_VERSION,
    seed: seed >>> 0, inputDimension, outputDimension: actionIds.length,
    layerWidths: Object.freeze(layerWidths), actionIds: Object.freeze(actionIds.slice()),
    weights, biases
  });
  return {
    spec,
    inferBatch(observations) {
      return observations.map(observation => {
        const out = forward(spec, observation);
        let best = -1, score = -Infinity;
        for (let i = 0; i < out.logits.length; i++) {
          if (!observation.actionMask[i]) continue;
          if (out.logits[i] > score) { score = out.logits[i]; best = i; }
        }
        if (best < 0) return null;
        return {
          actorId: observation.actor.actorId, worldEpoch: observation.worldEpoch,
          revision: observation.revision, policyVersion: spec.policyVersion,
          actionId: spec.actionIds[best], actionIndex: best,
          confidence: out.probs[best], score, reasoningTags: [observation.actor.role]
        };
      });
    }
  };
}

function forward(spec, observation) {
  const features = new Float32Array(spec.inputDimension);
  let cursor = 0;
  for (const array of [observation.perceptionFeatures, observation.roleFeatures,
    observation.personalityFeatures, observation.memoryFeatures, observation.contextFeatures]) {
    for (const value of array) {
      if (cursor >= features.length) break;
      features[cursor++] = finite(value);
    }
  }
  let activations = features;
  let weightOffset = 0, biasOffset = 0;
  const widths = spec.layerWidths;
  for (let layer = 1; layer < widths.length; layer++) {
    const last = layer === widths.length - 1;
    const next = new Float32Array(widths[layer]);
    for (let o = 0; o < next.length; o++) {
      let sum = spec.biases[biasOffset + o];
      for (let i = 0; i < activations.length; i++) {
        sum += spec.weights[weightOffset + o * activations.length + i] * activations[i];
      }
      next[o] = last ? sum : Math.tanh(sum);
    }
    weightOffset += widths[layer] * widths[layer - 1];
    biasOffset += widths[layer];
    activations = next;
  }
  const mask = observation.actionMask;
  const logits = Array.from(activations, (v, i) => mask[i] ? v : -1e9);
  const allowed = logits.filter((_, i) => mask[i]);
  const max = allowed.length ? Math.max(...allowed) : 0;
  const exps = logits.map((v, i) => mask[i] ? Math.exp(v - max) : 0);
  const total = exps.reduce((a, b) => a + b, 0);
  return { hidden: [], logits, probs: total ? exps.map(v => v / total) : exps };
}

export function getSharedPolicy(world, domain = 'human', speciesId = 'sheep') {
  if (!world || typeof world !== 'object') throw new Error('Shared policy requires a world.');
  const seed = (world.seed >>> 0) || 1;
  const width = policyWidth(world, domain);
  const cache = domain === 'human' ? humanPolicies : animalPolicies;
  let entry = cache.get(world);
  if (domain === 'animal') {
    if (!entry) { entry = new Map(); cache.set(world, entry); }
    const key = speciesId + ':' + width;
    if (!entry.has(key)) entry.set(key, createPolicy(seed, 'animal', ANIMAL_ACTIONS, 6, width));
    return entry.get(key);
  }
  if (!entry || entry.spec.layerWidths[1] !== width || entry.spec.seed !== seed) {
    entry = createPolicy(seed, 'human', HUMAN_POLICY_ACTIONS, HUMAN_INPUT_SIZE, width);
    cache.set(world, entry);
  }
  return entry;
}

export function actorObservation(world, actor, inputs, domain = 'people', allowedActions = null) {
  const isAnimal = domain === 'animal';
  const role = isAnimal ? 'civilian' : cognitiveRole(actor);
  const actionIds = isAnimal ? ANIMAL_ACTIONS : HUMAN_POLICY_ACTIONS;
  const mask = new Uint8Array(actionIds.length);
  if (!allowedActions) {
    if (isAnimal) mask.fill(1);
    else {
      const start = domain === 'royal' ? PEOPLE_ACTIONS.length + MILITARY_ACTIONS.length
        : domain === 'military' ? PEOPLE_ACTIONS.length : 0;
      const count = domain === 'royal' ? ROYAL_SITING_STRATEGIES.length
        : domain === 'military' ? MILITARY_ACTIONS.length : PEOPLE_ACTIONS.length;
      for (let i = start; i < start + count; i++) mask[i] = 1;
    }
  } else {
    const start = isAnimal ? 0 : domain === 'royal' ? PEOPLE_ACTIONS.length + MILITARY_ACTIONS.length
      : domain === 'military' ? PEOPLE_ACTIONS.length : 0;
    for (let i = 0; i < allowedActions.length; i++) if (allowedActions[i]) mask[start + i] = 1;
  }
  const legacy = Float32Array.from({length: isAnimal ? 6 : PEOPLE_INPUTS},
    (_, i) => finite(inputs[i]));
  const roleFeatures = isAnimal ? new Float32Array(0) :
    Float32Array.from(COGNITIVE_ROLES, candidate => Number(role === candidate));
  const personalityFeatures = isAnimal ? new Float32Array(0) :
    Float32Array.from([finite(actor.sociability), finite(actor.trust), finite(actor.loyalty),
      finite(actor.physicalStrength), finite(actor.skills?.build), finite(actor.skills?.diplomacy)]);
  const memoryFeatures = isAnimal ? new Float32Array(0) :
    Float32Array.from([finite(actor.lastReward), Math.min(1, (actor.personalMemory?.length || 0) / 32)]);
  return {
    actor: { actorId: actor.id, role, kingdomId: actor.kingdomId ?? null,
      communityId: actor.communityId ?? null },
    worldEpoch: world.epoch || 0, revision: world.revision || 0,
    simulatedDay: world.day || 0,
    perceptionFeatures: legacy, roleFeatures, personalityFeatures, memoryFeatures,
    contextFeatures: new Float32Array(0), actionMask: mask
  };
}

/** Forward results use the existing logit/probability shape, for a safe adapter
 * into current action utilities. No world or actor mutations occur here.
 */
export function forwardSharedPolicy(world, actor, inputs, domain = 'people', allowedActions = null) {
  const isAnimal = domain === 'animal';
  const model = getSharedPolicy(world, isAnimal ? 'animal' : 'human', actor.speciesId);
  const observation = actorObservation(world, actor, inputs, domain, allowedActions);
  const full = forward(model.spec, observation);
  if (isAnimal) return full;
  const start = domain === 'royal' ? PEOPLE_ACTIONS.length + MILITARY_ACTIONS.length
    : domain === 'military' ? PEOPLE_ACTIONS.length : 0;
  const count = domain === 'royal' ? ROYAL_SITING_STRATEGIES.length
    : domain === 'military' ? MILITARY_ACTIONS.length : PEOPLE_ACTIONS.length;
  return { hidden: [], logits: full.logits.slice(start, start + count),
    probs: full.probs.slice(start, start + count) };
}
