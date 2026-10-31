// JUL-273 — deterministic cognition LOD, explicitly opt-in.
// This budgets *neural forward passes* only: physics, survival, orders,
// action masks and live utility resolution still run every simulated day.
import { cognitiveRole, forwardSharedPolicy, getSharedPolicy, sharedPolicyEnabled } from './shared-policy.js';
import { PEOPLE_ACTIONS } from '../../config/ecosystem.js';
import { prepareInferenceBatches } from './cognitive-batch.js';

const perWorld = new WeakMap();
export const COGNITIVE_LOD_SCHEMA_VERSION = 1;
const DEFAULT_BUDGET = 256;

function enabled(world) {
  return sharedPolicyEnabled(world) && ['budgeted','batched'].includes(world?.neuralOverrides?.cognitiveSchedule?.mode);
}
function budgetFor(world) {
  const raw = world?.neuralOverrides?.cognitiveSchedule?.budget;
  return Number.isSafeInteger(raw) && raw >= 1 && raw <= 100000 ? raw : DEFAULT_BUDGET;
}
function freshDay(world, people) {
  const budget = budgetFor(world);
  const adults = people.filter(p => p.alive && p.ageDays >= 12 * 365);
  const eligible = new Set();
  // Row-major actor ordering is stable (updatePeople sorts by id).
  // A rotating contiguous window visits every persistent actor within
  // ceil(population / budget) simulation days, even when off-camera.
  if (adults.length) {
    const start = (Math.max(0, Math.floor(world.day)) * budget) % adults.length;
    for (let i = 0; i < Math.min(budget, adults.length); i++)
      eligible.add(adults[(start + i) % adults.length].id);
  }
  const count = adults.length;
  const controlled = adults.find(p => p.playerControlled || p.id === world.playerControlledPersonId);
  const playerPosition = controlled ? { x: controlled.x, y: controlled.y } : null;
  const stats = {
    schemaVersion: COGNITIVE_LOD_SCHEMA_VERSION,
    day: world.day,
    eligible: count, budget,
    planned: eligible.size, maxRoutineWaitDays: cognitiveMaxWaitDays(count, budget),
    inferred: 0, urgent: 0, reused: 0, prefetched: 0, directForwards: 0,
    utilityOnly: 0, invalidated: 0, maxCacheAgeDays: 0,
    byRole: {civilian:0,worker:0,military:0,general:0,king:0}
  };
  const state = { day: world.day, eligible, playerPosition, stats };
  perWorld.set(world, state);
  if (world?.neuralOverrides?.cognitiveSchedule?.mode === 'batched') {
    const candidates = adults.filter(person=>eligible.has(person.id) || urgent(world,person,state))
      .filter(person=>Array.isArray(person.lastDecision?.inputs)
        && person.lastDecision.inputs.length===18)
      .map(person=>({
        person,inputs:person.lastDecision.inputs,
        urgency:urgent(world,person,state),
        waitingDays:Math.max(0,world.day-(person.brain?.cognitiveInferenceCache?.day??-1)),
        queuePriority:eligible.has(person.id)?0:1
      }));
    const rawBatchSize=world.neuralOverrides.cognitiveSchedule.batchSize;
    const batchSize=Number.isSafeInteger(rawBatchSize) && rawBatchSize>=1 && rawBatchSize<=256
      ? rawBatchSize : 32;
    state.batch=prepareInferenceBatches(world,candidates,{budget,batchSize});
    state.stats.prefetched=state.batch.metrics.queued;
  }
  return state;
}

export function beginCognitiveDay(world, living) {
  if (!enabled(world)) {
    perWorld.delete(world);
    return null;
  }
  return freshDay(world, living);
}

function urgent(world, person, state) {
  // Critical triggers originate in the actor's own status or visible facts.
  // They cannot be delayed by the ambient inference budget.
  const player = state.playerPosition;
  if (player && Number.isFinite(person.x) && Number.isFinite(person.y)
      && Math.abs(person.x - player.x) <= 18 && Math.abs(person.y - player.y) <= 18
      && Math.hypot(person.x - player.x, person.y - player.y) <= 18) return true;
  if (person.playerControlled || world.playerControlledPersonId === person.id
    || person.role === 'ruler' || person.militaryRank === 'general'
    || person.campaignId != null || person.combatTargetId != null || person.tacticalRecovering
    || person.health < 55 || person.energy < 35 || person.hydration < 45
    || person.foodReserve < 18 || person.injury >= 3 || person.territoryExposure?.danger) return true;
  const nearby = person.perception?.people || [];
  return nearby.some(s => s.visible && (s.hostile || s.enemy || s.threat));
}

export function inferCognitivePeople(world, person, inputs, allowed) {
  if (!enabled(world)) return forwardSharedPolicy(world, person, inputs, 'people', allowed);
  let state = perWorld.get(world);
  if (!state || state.day !== world.day) state = freshDay(world, world.people || []);
  const brain = person.brain;
  const role = cognitiveRole(person);
  const model = getSharedPolicy(world, 'human').spec;
  const last = brain.cognitiveInferenceCache;
  const valid = last?.schemaVersion === COGNITIVE_LOD_SCHEMA_VERSION
    && last.policyVersion === model.policyVersion && last.width === model.layerWidths[1]
    && last.seed === model.seed && last.role === role
    && last.epoch === (world.epoch || 0) && last.actorId === person.id
    && Array.isArray(last.logits) && last.logits.length === PEOPLE_ACTIONS.length;
  if (last && !valid) {
    delete brain.cognitiveInferenceCache;
    state.stats.invalidated++;
  }
  const mustRun = urgent(world, person, state);
  if (mustRun || state.eligible.has(person.id)) {
    // Model runs on current perception, never stale action masks. The legality
    // mask is checked again by the unchanged per-day utility calculation.
    const out = state.batch?.consume(world,person,inputs,allowed)
      || forwardSharedPolicy(world, person, inputs, 'people');
    if (!state.batch || out.probs?.length) state.stats.directForwards++;
    brain.cognitiveInferenceCache = {
      schemaVersion: COGNITIVE_LOD_SCHEMA_VERSION,
      actorId: person.id, role, seed: model.seed, epoch: world.epoch || 0,
      width: model.layerWidths[1], policyVersion: model.policyVersion,
      day: world.day, logits: out.logits.slice()
    };
    state.stats.inferred++;
    if (mustRun) state.stats.urgent++;
    state.stats.byRole[role] = (state.stats.byRole[role] || 0) + 1;
    return out;
  }
  if (valid) {
    state.stats.reused++;
    state.stats.maxCacheAgeDays = Math.max(state.stats.maxCacheAgeDays, world.day - last.day);
    return { hidden: [], logits: last.logits, probs: [] };
  }
  // Never select an action from a stale/foreign cache. Use current rules,
  // goals and personal reward preferences while waiting for a neural slot.
  state.stats.utilityOnly++;
  return { hidden: [], logits: new Array(PEOPLE_ACTIONS.length).fill(0), probs: [] };
}

export function cognitiveDayMetrics(world) {
  const stats = perWorld.get(world)?.stats;
  if (!stats) return null;
  const batch=perWorld.get(world).batch?.metrics;
  return {
    ...stats, byRole:{...stats.byRole},
    ...(batch ? {batch:{
      ...batch,batchCompute:{...batch.batchCompute}
    }} : {})
  };
}

/** Predictable bound on normal refresh in a static population. Urgent actors
 * may exceed it; this does not bound all gameplay work or total CPU per day.
 */
export function cognitiveMaxWaitDays(population, budget) {
  return Math.ceil(Math.max(0, population) / Math.max(1, budget));
}
