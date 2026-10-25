import { brainForward, createBrain, updateBrain } from '../../controllers/individual/neural.js';
import { clamp } from '../core/math.js';
import { log } from '../core/events.js';

export const SITING_STRATEGIES = ['defensive', 'balanced', 'expansion', 'left-flank', 'right-flank'];
export const SITING_LABELS = ['Reforçar a defesa', 'Equilibrar defesa e expansão', 'Ampliar o território', 'Expandir pelo flanco esquerdo', 'Expandir pelo flanco direito'];

function policy(world, kingdom) {
  // Site previews must not consume the simulation RNG or change learning state.
  return kingdom.royalSitingBrain || createBrain({ seed: world.seed,
    rngState: ((world.seed || 1) ^ Math.imul(kingdom.id, 2654435761)) >>> 0 }, SITING_STRATEGIES, 8, kingdom.rulerId || kingdom.id);
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
  const brain = policy(world, kingdom), out = brainForward(brain, inputs, SITING_STRATEGIES);
  const baseline = [.55 + (recentLoss ? .45 : 0) + (alert ? .3 : 0), .65,
    type === 'torre' ? .65 - (recentLoss || alert ? .3 : 0) : .25, .55, .55];
  const scores = SITING_STRATEGIES.map((id, index) => {
    const candidate = candidates.find(c => c.strategy === id);
    return candidate ? baseline[index] + candidate.quality * .3 + out.logits[index] * .18
      + (brain.actionValues[index] || 0) * .35 : -1e9;
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
    sample: { actionIndex: index, inputs, hidden: out.hidden, probs: weights.map(v => v / total) } } };
}

export function commitRoyalBuildSite(world, kingdom, selection, structure) {
  kingdom.royalSitingBrain ||= selection.brain;
  const brain = kingdom.royalSitingBrain;
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
  if (!kingdom?.royalSitingBrain) return;
  const decision = structure.sitingDecision;
  const delay = Math.max(0, day - structure.createdDay - structure.required);
  const gained = clamp(((kingdom.territoryTileCount || 0) - decision.territoryBefore) / 500, 0, 1);
  const reward = outcome === 'lost' ? -.7 : clamp(.45 - delay * .004 + gained * .2, .1, .65);
  const brain = kingdom.royalSitingBrain;
  brain.pending = decision.sample;
  updateBrain({ brain, lastLesson: '' }, reward);
  (structure.sitingOutcomes ||= {})[outcome] = day;
  kingdom.sitingHistory = [...(kingdom.sitingHistory || []), { day, outcome, reward,
    projectId: structure.id, strategy: decision.strategy, x: structure.x, y: structure.y }].slice(-32);
}

export function recordRoyalSitingOutcomes(world, day) {
  for (const structure of world.structures) if (structure.complete && structure.destroyedDay == null && !structure.sitingOutcomes?.lost)
    recordRoyalSitingOutcome(world, structure, 'completed', day);
}
