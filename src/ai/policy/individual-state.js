// JUL-272: compact, serializable cognitive state. No dense neural weights and
// no duplicated social memories, beliefs, relationships or commitments.
import { hash01 } from '../../simulation/core/math.js';

export const COGNITIVE_SCHEMA_VERSION = 1;
export const COGNITIVE_EPISODE_LIMIT = 6;
export const COGNITIVE_EPISODE_TTL_DAYS = 180;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const safe = value => Number.isFinite(value) ? value : 0;

export function createCognitiveState(world, person) {
  const seed = (world?.seed >>> 0) || 1;
  const id = person.id;
  // Stable across promotions, AI/player takeover, reload and replay. This
  // does not advance the simulation's random-number stream.
  return {
    schemaVersion: COGNITIVE_SCHEMA_VERSION,
    actorId: id,
    temperament: {
      curiosity: hash01(seed + 101, id, 1),
      caution: hash01(seed + 103, id, 2),
      altruism: hash01(seed + 107, id, 3),
      persistence: hash01(seed + 109, id, 4)
    },
    episodes: [],
    summary: { positive: 0, negative: 0, discarded: 0 },
    nextEpisodeSequence: 1
  };
}

export function ensureCognitiveState(world, person) {
  if (!person || !Number.isSafeInteger(person.id)) return null;
  if (person.cognitiveState) {
    // Fail closed on unknown versions and mismatched ownership: do not
    // overwrite a future save or allow another actor's data to be consumed.
    return person.cognitiveState.schemaVersion === COGNITIVE_SCHEMA_VERSION
      && person.cognitiveState.actorId === person.id ? person.cognitiveState : null;
  }
  // Old saves without cognitive state initialise lazily and deterministically.
  person.cognitiveState = createCognitiveState(world, person);
  return person.cognitiveState;
}

function compactEpisodes(state, day) {
  const retained = [];
  for (const episode of state.episodes) {
    if (day - episode.day <= COGNITIVE_EPISODE_TTL_DAYS) retained.push(episode);
    else state.summary.discarded++;
  }
  const overflow = Math.max(0, retained.length - COGNITIVE_EPISODE_LIMIT);
  state.summary.discarded += overflow;
  state.episodes = overflow ? retained.slice(overflow) : retained;
}

export function recordCognitiveOutcome(person, input) {
  const state = person?.cognitiveState;
  if (!state || state.schemaVersion !== COGNITIVE_SCHEMA_VERSION
      || state.actorId !== person.id) return false;
  const domain = ['people', 'military', 'royal'].includes(input?.domain) ? input.domain : null;
  const action = typeof input?.action === 'string' ? input.action.slice(0, 40) : '';
  if (!domain || !action || !Number.isFinite(input?.reward)) return false;
  const day = Math.max(0, Math.floor(safe(input.day)));
  const reward = clamp(input.reward, -1, 1);
  const eventId = String(state.actorId) + ':self:' + state.nextEpisodeSequence++;
  if (reward > .05) state.summary.positive++;
  if (reward < -.05) state.summary.negative++;
  state.episodes.push({
    eventId, source: 'self', day, domain, action, reward: Math.round(reward * 1000) / 1000
  });
  compactEpisodes(state, day);
  return true;
}

/** Features use ONLY information known by this actor. Existing social
 * memories/beliefs are read in place, never copied to the new cognitive state.
 */
export function cognitiveMemoryFeatures(person) {
  const state = person?.cognitiveState?.schemaVersion === COGNITIVE_SCHEMA_VERSION
    && person.cognitiveState.actorId === person.id ? person.cognitiveState : null;
  const episodes = state?.episodes || [];
  let weighted = 0, weight = 0;
  const today = Math.max(0, Math.floor(safe(person?.lastDecision?.day)));
  for (const episode of episodes) {
    const recency = 1 / (1 + Math.max(0, today - episode.day) / 20);
    weighted += episode.reward * recency;
    weight += recency;
  }
  const knownEventIds = new Set((person?.socialMemories || []).map(m => m.rootEventId));
  const supportedBeliefs = (person?.socialBeliefs || []).filter(b =>
    [...(b.supportingEventIds || []), ...(b.opposingEventIds || [])]
      .some(id => knownEventIds.has(id)));
  const trust = supportedBeliefs.length ? supportedBeliefs.reduce((sum, b) =>
    sum + clamp(safe(b.evaluation) * safe(b.certainty), -1, 1), 0) / supportedBeliefs.length : 0;
  return Float32Array.from([
    clamp(safe(person?.lastReward), -1, 1),
    Math.min(1, (person?.personalMemory?.length || 0) / 4),
    weight ? clamp(weighted / weight, -1, 1) : 0,
    Math.min(1, episodes.length / COGNITIVE_EPISODE_LIMIT),
    clamp(trust, -1, 1),
    Math.min(1, supportedBeliefs.length / 16)
  ]);
}

export function cognitiveTemperamentFeatures(person) {
  const t = person?.cognitiveState?.schemaVersion === COGNITIVE_SCHEMA_VERSION
    && person.cognitiveState.actorId === person.id ? person.cognitiveState.temperament : null;
  return Float32Array.from([
    clamp(safe(t?.curiosity), 0, 1),
    clamp(safe(t?.caution), 0, 1),
    clamp(safe(t?.altruism), 0, 1),
    clamp(safe(t?.persistence), 0, 1)
  ]);
}

/** Small bounded preference, not an instruction or authority grant.
 * Domain validation and utility/action masks remain authoritative.
 */
export function cognitiveActionBias(person, action, domain = 'people') {
  const state = person?.cognitiveState;
  if (!state || state.schemaVersion !== COGNITIVE_SCHEMA_VERSION
      || state.actorId !== person.id) return 0;
  const t = state.temperament;
  let disposition = 0;
  if (domain === 'people') {
    if (action === 'explore' || action === 'migrate') disposition = (t.curiosity - .5) * .12;
    else if (action === 'rest') disposition = (t.caution - .5) * .1;
    else if (action === 'socialize' || action === 'share') disposition = (t.altruism - .5) * .12;
    else if (action === 'build' || action === 'gather') disposition = (t.persistence - .5) * .1;
  }
  let experience = 0;
  let count = 0;
  // Episode retrieval is bounded to six; private observations do not leak
  // through global weights or overwrite the social evidence graph.
  for (const episode of state.episodes) {
    if (episode.domain !== domain || episode.action !== action) continue;
    experience += episode.reward;
    count++;
  }
  return clamp(disposition + (count ? experience / count * .18 : 0), -.22, .22);
}

export function cognitiveStateBytes(person) {
  return BufferlessJsonBytes(person?.cognitiveState || null);
}

// Browser and Node both support UTF-8 TextEncoder. Keep diagnostics optional.
function BufferlessJsonBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
