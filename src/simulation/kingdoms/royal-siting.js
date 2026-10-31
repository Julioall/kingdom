import { brainForward, createBrain, ensureBrainSize, updateBrain } from '../../controllers/individual/neural.js';
import { ROYAL_SITING_STRATEGIES } from '../../ai/policy/action-catalog.js';
import { forwardSharedPolicy, sharedPolicyEnabled } from '../../ai/policy/shared-policy.js';
import { cognitiveActionBias, ensureCognitiveState, recordCognitiveOutcome } from '../../ai/policy/individual-state.js';
import { clamp } from '../core/math.js';
import { log } from '../core/events.js';

export const SITING_STRATEGIES = ROYAL_SITING_STRATEGIES;
export const SITING_LABELS = ['Reforçar a defesa', 'Equilibrar defesa e expansão', 'Ampliar o território', 'Expandir pelo flanco esquerdo', 'Expandir pelo flanco direito'];

function policy(world, kingdom) {
  // Site previews must not consume the simulation RNG or change learning state.
  const ruler = world.people.find(person => person.id === kingdom.rulerId);
  // Royal preferences belong to the deciding person, not to the crown.
  // Unattributed legacy kingdom data is retained but never given to a
  // successor without a verified owner ID.
  const ownedBrain = ruler?.royalSitingBrain ||
    (kingdom.royalSitingBrainOwnerId === kingdom.rulerId ? kingdom.royalSitingBrain : null);
  const brain = ownedBrain || createBrain({ seed: world.seed,
    neuralOverrides: world.neuralOverrides,
    rngState: ((world.seed || 1) ^ Math.imul(kingdom.id, 2654435761)) >>> 0 },
    SITING_STRATEGIES, 8, kingdom.rulerId || kingdom.id);
  // Do not mutate the original kingdom until the site is committed.
  const holder = { id: kingdom.rulerId || kingdom.id, brain };
  ensureBrainSize(world, holder, 9);
  return holder.brain;
}

export function selectRoyalBuildSite(world, kingdom, type, candidates) {
  if (!candidates.length) return null;
  const recentLoss = (kingdom.frontierLosses || []).some(r => world.day - r.day <= 60);
  const alert = kingdom.frontierAlert && world.day - kingdom.frontierAlert.day <= 10;
  const inputs = [type === 'torre' ? 1 : 0, recentLoss ? 1 : 0, alert ? 1 : 0,
    clamp((kingdom.treasury?.stock?.wood || 0) / 200, 0, 1),
    clamp((kingdom.treasury?.stock?.stone || 0) / 150, 0, 1),
    clamp((kingdom.territoryTileCount || 0) / world.tiles.length, 0, 1),
    candidates.reduce((sum, c) => sum + c.metrics.risk, 0) / candidates.length,
    candidates.reduce((sum, c) => sum + c.metrics.access, 0) / candidates.length];
  const brain = policy(world, kingdom);
  const shared = brain.mode === 'shared' && sharedPolicyEnabled(world);
  const ruler = world.people.find(person => person.id === kingdom.rulerId);
  if (shared && ruler) ensureCognitiveState(world, ruler);
  const actor = { ...(ruler || {}), id: kingdom.rulerId || kingdom.id,
    role: 'ruler', kingdomId: kingdom.id };
  const allowed = SITING_STRATEGIES.map(strategy =>
    candidates.some(candidate => candidate.strategy === strategy));
  const out = shared ? forwardSharedPolicy(world, actor, inputs, 'royal', allowed)
    : brainForward(brain, inputs, SITING_STRATEGIES);
  const baseline = [.55 + (recentLoss ? .45 : 0) + (alert ? .3 : 0), .65,
    type === 'torre' ? .65 - (recentLoss || alert ? .3 : 0) : .25, .55, .55];
  const scores = SITING_STRATEGIES.map((id, index) => {
    const candidate = candidates.find(c => c.strategy === id);
    return candidate ? baseline[index] + candidate.quality * .3 + out.logits[index] * .18
      + (brain.actionValues[index] || 0) * .35
      + (shared && ruler ? cognitiveActionBias(ruler, id, 'royal') : 0) : -1e9;
  });
  const index = scores.indexOf(Math.max(...scores));
  const selected = candidates.find(c => c.strategy === SITING_STRATEGIES[index]);
  const max = Math.max(...out.logits.filter((_, i) => scores[i] > -1e8));
  const weights = out.logits.map((v, i) => scores[i] > -1e8 ? Math.exp(v - max) : 0);
  const total = weights.reduce((sum, v) => sum + v, 0);
  return { tile: selected.tile, brain, decision: { day: world.day, rulerId: kingdom.rulerId, kingdomId: kingdom.id,
    territoryBefore: kingdom.territoryTileCount || 0,
    strategy: selected.strategy, label: selected.label, x: selected.tile.x, y: selected.tile.y,
    reason: selected.reason, metrics: { ...selected.metrics },
    alternatives: candidates.map(c => ({ strategy: c.strategy, label: c.label, x: c.tile.x, y: c.tile.y,
      score: scores[SITING_STRATEGIES.indexOf(c.strategy)], metrics: { ...c.metrics } })),
    sample: shared ? { actionIndex: index }
      : { actionIndex: index, inputs, hidden: out.hidden, probs: weights.map(v => v / total) } } };
}

export function commitRoyalBuildSite(world, kingdom, selection, structure) {
  const ownerId = selection.decision.rulerId;
  const owner = world.people.find(person => person.id === ownerId);
  if (owner) owner.royalSitingBrain = selection.brain;
  kingdom.royalSitingBrainOwnerId = ownerId;
  kingdom.royalSitingBrain = selection.brain;
  const brain = selection.brain;
  brain.decisions++; brain.lastAction = selection.decision.strategy;
  brain.actionCounts[brain.lastAction]++;
  structure.sitingDecision = selection.decision;
  kingdom.lastSitingDecision = { ...selection.decision, projectId: structure.id, sample: undefined };
  log(world, kingdom.name + ': o rei comparou ' + selection.decision.alternatives.length + ' locais e escolheu '
    + selection.decision.label.toLowerCase() + ' em ' + structure.x + ',' + structure.y + '. ' + selection.decision.reason);
}

export function recordRoyalSitingOutcome(world, structure, outcome, day) {
  if (!structure.sitingDecision || structure.sitingOutcomes?.[outcome]) return;
  const kingdom = world.kingdoms.find(k => k.id === structure.sitingDecision.kingdomId);
  if (!kingdom) return;
  const decision = structure.sitingDecision;
  const decisionMaker = world.people.find(person => person.id === decision.rulerId);
  const brain = decisionMaker?.royalSitingBrain ||
    (kingdom.royalSitingBrainOwnerId === decision.rulerId ? kingdom.royalSitingBrain : null);
  if (!brain) {
    // Mark an unattributable historic outcome as processed, rather than
    // assigning another person's training history to a new monarch.
    (structure.sitingOutcomes ||= {})[outcome] = day;
    return;
  }
  const delay = Math.max(0, day - structure.createdDay - structure.required);
  const gained = clamp(((kingdom.territoryTileCount || 0) - decision.territoryBefore) / 500, 0, 1);
  const reward = outcome === 'lost' ? -.7 : clamp(.45 - delay * .004 + gained * .2, .1, .65);
  brain.pending = decision.sample;
  updateBrain({ brain, lastLesson: '' }, reward);
  if (brain.mode === 'shared') {
    if (decisionMaker) {
      ensureCognitiveState(world, decisionMaker);
      recordCognitiveOutcome(decisionMaker, { domain: 'royal', action: decision.strategy, reward, day });
    }
  }
  (structure.sitingOutcomes ||= {})[outcome] = day;
  kingdom.sitingHistory = [...(kingdom.sitingHistory || []), { day, outcome, reward,
    projectId: structure.id, strategy: decision.strategy, x: structure.x, y: structure.y }].slice(-32);
}

export function recordRoyalSitingOutcomes(world, day) {
  for (const structure of world.structures) if (structure.complete && structure.destroyedDay == null && !structure.sitingOutcomes?.lost)
    recordRoyalSitingOutcome(world, structure, 'completed', day);
}
