import { forwardSharedPolicy, sharedPolicyEnabled } from '../../ai/policy/shared-policy.js';
import { MILITARY_ACTIONS } from '../../ai/policy/action-catalog.js';
import { ANIMAL_ACTIONS, HIDDEN_NEURONS, PEOPLE_ACTIONS, RULER_HIDDEN_NEURONS } from '../../config/ecosystem.js';
import { rand } from '../../simulation/core/random.js';
import { clamp, hash01 } from '../../simulation/core/math.js';

export function createBrain(w, actions, inputSize, entityId, requestedHiddenSize = HIDDEN_NEURONS) {
    const shareable = actions === PEOPLE_ACTIONS || actions === ANIMAL_ACTIONS || actions === MILITARY_ACTIONS;
    if (shareable && sharedPolicyEnabled(w)) {
      // Per-actor state is small. All dense weights belong to the single
      // shared policy bank, never to individual NPCs or animals.
      return {
        mode: 'shared', schemaVersion: 1, inputSize: inputSize || 6, actionCount: actions.length,
        hiddenSize: actions === ANIMAL_ACTIONS ? 16 : Number(w.neuralOverrides?.sharedHiddenSize || 24),
        learningRate: .027, actionValues: Array(actions.length).fill(0),
        actionCounts: Object.fromEntries(actions.map(action => [action, 0])),
        baseline: 0, rewardMean: 0, decisions: 0, updates: 0,
        lastAction: actions.includes('explore') ? 'explore' : actions[0], pending: null
      };
    }
    const count = inputSize || 6;
    const hiddenSize = Math.max(1, Math.floor(requestedHiddenSize || HIDDEN_NEURONS));
    const inputWeights = Array.from({ length: count * hiddenSize }, () => (rand(w) - .5) * .36);
    const outputWeights = new Array(hiddenSize * actions.length);
    const legacyActions = Math.min(14, actions.length);
    for (let action = 0; action < actions.length; action++) for (let hidden = 0; hidden < hiddenSize; hidden++) {
      const weight = action < legacyActions ? (rand(w) - .5) * .32
        : (hash01(w.seed + (entityId || 0) * 97 + action * 31, hidden, action) - .5) * .32;
      outputWeights[action * hiddenSize + hidden] = weight;
    }
    return { inputSize: count, hiddenSize, learningRate: .027, inputWeights, outputWeights, actionCount: actions.length,
      actionValues: Array(actions.length).fill(0), actionCounts: Object.fromEntries(actions.map(action => [action, 0])), baseline: 0, rewardMean: 0,
      decisions: 0, updates: 0, lastAction: 'explore', pending: null };
  }

export function ensureBrainSize(w, entity, requestedHiddenSize) {
    const brain = entity && entity.brain;
    if (!brain) return false;
    if (sharedPolicyEnabled(w) && brain.mode !== 'shared') {
      // Upgrade legacy save/fixture brains lazily, preserving learned personal
      // preferences/counters while discarding the old per-actor dense weights.
      const actions = brain.actionCount === ANIMAL_ACTIONS.length ? ANIMAL_ACTIONS
        : brain.actionCount === MILITARY_ACTIONS.length ? MILITARY_ACTIONS : PEOPLE_ACTIONS;
      const compact = createBrain(w, actions, brain.inputSize, entity.id);
      for (const key of ['actionValues', 'actionCounts', 'baseline', 'rewardMean', 'decisions', 'updates', 'lastAction']) {
        if (brain[key] !== undefined) compact[key] = brain[key];
      }
      entity.brain = compact;
      return true;
    }
    if (brain.mode === 'shared') {
      if (sharedPolicyEnabled(w)) return false;
      // Explicit legacy fallback can be activated mid-world. Restore
      // independent weights deterministically without advancing world RNG.
      const size = Math.max(1, Math.floor(requestedHiddenSize || HIDDEN_NEURONS));
      const seed = ((w.seed || 1) ^ Math.imul(entity.id || 1, 2654435761)) >>> 0;
      const actions = brain.actionCount === ANIMAL_ACTIONS.length ? ANIMAL_ACTIONS
        : brain.actionCount === MILITARY_ACTIONS.length ? MILITARY_ACTIONS : PEOPLE_ACTIONS;
      const localWorld = { seed: w.seed, rngState: seed, neuralOverrides: { neuralController: 'legacy' } };
      const fallback = createBrain(localWorld, actions, brain.inputSize, entity.id, size);
      for (const key of ['actionValues', 'actionCounts', 'baseline', 'rewardMean', 'decisions', 'updates', 'lastAction'])
        fallback[key] = brain[key];
      entity.brain = fallback;
      return true;
    }
    const targetSize = Math.max(1, Math.floor(requestedHiddenSize || HIDDEN_NEURONS));
    if (!brain || brain.hiddenSize === targetSize) return false;

    const inputSize = Math.max(1, brain.inputSize || 6);
    const actionCount = Math.max(1, brain.actionCount || 1);
    const previousSize = Math.max(1, brain.hiddenSize || 6);
    const baseSeed = ((w && w.seed) || 0) + ((entity.id || 0) * 97);
    const inputWeights = new Array(inputSize * targetSize);
    const outputWeights = new Array(actionCount * targetSize);

    for (let hidden = 0; hidden < targetSize; hidden++) {
      for (let input = 0; input < inputSize; input++) {
        const nextIndex = hidden * inputSize + input;
        inputWeights[nextIndex] = hidden < previousSize
          ? brain.inputWeights[hidden * inputSize + input] || 0
          : (hash01(baseSeed, hidden, input) - .5) * .36;
      }
      for (let action = 0; action < actionCount; action++) {
        const nextIndex = action * targetSize + hidden;
        outputWeights[nextIndex] = hidden < previousSize
          ? brain.outputWeights[action * previousSize + hidden] || 0
          : (hash01(baseSeed + action * 31, hidden, action) - .5) * .32;
      }
    }

    brain.hiddenSize = targetSize;
    brain.inputWeights = inputWeights;
    brain.outputWeights = outputWeights;
    brain.pending = null;
    return true;
  }

export function chooseAnimalAction(w, animal, inputs, utility) {
    ensureBrainSize(w, animal, HIDDEN_NEURONS);
    const out = animal.brain.mode === 'shared' && sharedPolicyEnabled(w)
      ? forwardSharedPolicy(w, animal, inputs, 'animal')
      : brainForward(animal.brain, inputs, ANIMAL_ACTIONS);
    let best = 0, bestScore = -Infinity;
    for (let i = 0; i < ANIMAL_ACTIONS.length; i++) {
      const score = utility[i] + out.logits[i] * .18 + (animal.brain.actionValues[i] || 0) * .12;
      if (score > bestScore) { best = i; bestScore = score; }
    }
    animal.brain.pending = animal.brain.mode === 'shared'
      ? { actionIndex: best } : { hidden: out.hidden, probs: out.probs, actionIndex: best, inputs: inputs.slice() };
    animal.brain.decisions++; animal.brain.lastAction = ANIMAL_ACTIONS[best];
    animal.brain.actionCounts[animal.brain.lastAction] = (animal.brain.actionCounts[animal.brain.lastAction] || 0) + 1;
    return ANIMAL_ACTIONS[best];
  }

export function brainForward(brain, inputs, actions) {
    const hiddenSize = brain.hiddenSize || 6, hidden = new Array(hiddenSize);
    const inputSize = brain.inputSize || 6;
    for (let h = 0; h < hiddenSize; h++) {
      let sum = 0;
      for (let i = 0; i < inputSize; i++) sum += brain.inputWeights[h * inputSize + i] * (inputs[i] || 0);
      hidden[h] = Math.tanh(sum);
    }
    const logits = new Array(actions.length);
    for (let o = 0; o < logits.length; o++) {
      let sum = 0;
      for (let h = 0; h < hiddenSize; h++) sum += brain.outputWeights[o * hiddenSize + h] * hidden[h];
      logits[o] = sum;
    }
    const max = Math.max(...logits), exps = logits.map(v => Math.exp(v - max)), total = exps.reduce((a, b) => a + b, 0);
    return { hidden, logits, probs: exps.map(v => v / total) };
  }

export function choosePeopleAction(w, p, inputs, utility) {
    const isCitizen = p.role === 'resident';
    const requestedSize = p.role === 'ruler' ? RULER_HIDDEN_NEURONS
      : isCitizen ? w.neuralOverrides?.peopleHiddenSize || HIDDEN_NEURONS : HIDDEN_NEURONS;
    ensureBrainSize(w, p, requestedSize);
    const brain = p.brain;
    const rulesOnly = isCitizen && w.neuralOverrides?.peopleController === 'rules';
    const shared = brain.mode === 'shared' && sharedPolicyEnabled(w);
    const allowed = utility.map(value => Number.isFinite(value) && value > -1e8);
    const out = rulesOnly
      ? { hidden: [], probs: [], logits: Array(PEOPLE_ACTIONS.length).fill(0) }
      : shared ? forwardSharedPolicy(w, p, inputs, 'people', allowed)
        : brainForward(brain, inputs, PEOPLE_ACTIONS);
    const plan = p.strategicPlan && p.strategicPlan.expiresDay >= w.day + 1 ? p.strategicPlan : null;
    let best = 0, bestScore = -Infinity;
    const scores = [];
    for (let i = 0; i < PEOPLE_ACTIONS.length; i++) {
      const strategyBias = plan && plan.action === PEOPLE_ACTIONS[i] && utility[i] > -.1
        ? .12 + clamp(plan.confidence || .5, 0, 1) * .22 : 0;
      const score = utility[i] + out.logits[i] * .2 + (rulesOnly ? 0 : (brain.actionValues[i] || 0) * .18) + strategyBias;
      scores.push(score);
      if (score > bestScore) { best = i; bestScore = score; }
    }
    brain.pending = rulesOnly ? null : shared ? { actionIndex: best }
      : { hidden: out.hidden, probs: out.probs, actionIndex: best, inputs: inputs.slice(), scores };
    brain.decisions++; brain.lastAction = PEOPLE_ACTIONS[best];
    brain.actionCounts[brain.lastAction] = (brain.actionCounts[brain.lastAction] || 0) + 1;
    p.lastDecision = { action: PEOPLE_ACTIONS[best], scores, inputs: inputs.slice(), day: w.day };
    return PEOPLE_ACTIONS[best];
  }

export function updateBrain(p, reward) {
    const b = p.brain, pending = b.pending;
    if (!pending) return;
    const advantage = clamp(reward - b.baseline, -1, 1);
    const rate = b.learningRate || .027;
    const prior = b.actionValues[pending.actionIndex] || 0;
    b.actionValues[pending.actionIndex] = clamp(prior * .79 + reward * .21, -1, 1);
    // The shared policy is not trained by individual rewards. Only this
    // actor's compact action preference is updated. Global training is a
    // later versioned, validated process (JUL-272/JUL-274).
    if (b.mode !== 'shared') {
      for (let o = 0; o < pending.probs.length; o++) {
        const gradient = ((o === pending.actionIndex ? 1 : 0) - pending.probs[o]) * advantage;
        for (let h = 0; h < pending.hidden.length; h++) {
          const weightIndex = o * pending.hidden.length + h;
          b.outputWeights[weightIndex] = clamp(b.outputWeights[weightIndex] + rate * gradient * pending.hidden[h], -3, 3);
        }
      }
    }
    b.baseline = b.baseline * .94 + reward * .06;
    b.rewardMean = b.rewardMean * .91 + reward * .09;
    b.updates++; p.lastReward = reward; b.pending = null;
    if (p.lastLesson === 'Ainda está aprendendo com o ambiente.' || !p.lastLesson) {
      p.lastLesson = reward > .12 ? 'A ação trouxe um benefício observável.' : reward < -.12 ? 'A ação teve custo sem atender uma necessidade.' : 'O resultado foi pequeno; ainda precisa comparar alternativas.';
    }
  }
