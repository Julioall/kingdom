import { ANIMAL_ACTIONS, HIDDEN_NEURONS, PEOPLE_ACTIONS } from '../../config/ecosystem.js';
import { rand } from '../../simulation/core/random.js';
import { clamp, hash01 } from '../../simulation/core/math.js';

export function createBrain(w, actions, inputSize, entityId) {
    const count = inputSize || 6;
    const hiddenSize = HIDDEN_NEURONS;
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

export function chooseAnimalAction(w, animal, inputs, utility) {
    const out = brainForward(animal.brain, inputs, ANIMAL_ACTIONS);
    let best = 0, bestScore = -Infinity;
    for (let i = 0; i < ANIMAL_ACTIONS.length; i++) {
      const score = utility[i] + out.logits[i] * .18 + (animal.brain.actionValues[i] || 0) * .12;
      if (score > bestScore) { best = i; bestScore = score; }
    }
    animal.brain.pending = { hidden: out.hidden, probs: out.probs, actionIndex: best, inputs: inputs.slice() };
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
    const brain = p.brain, out = brainForward(brain, inputs, PEOPLE_ACTIONS);
    const plan = p.strategicPlan && p.strategicPlan.expiresDay >= w.day + 1 ? p.strategicPlan : null;
    let best = 0, bestScore = -Infinity;
    const scores = [];
    for (let i = 0; i < PEOPLE_ACTIONS.length; i++) {
      const strategyBias = plan && plan.action === PEOPLE_ACTIONS[i] && utility[i] > -.1
        ? .12 + clamp(plan.confidence || .5, 0, 1) * .22 : 0;
      const score = utility[i] + out.logits[i] * .2 + (brain.actionValues[i] || 0) * .18 + strategyBias;
      scores.push(score);
      if (score > bestScore) { best = i; bestScore = score; }
    }
    brain.pending = { hidden: out.hidden, probs: out.probs, actionIndex: best, inputs: inputs.slice(), scores };
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
    for (let o = 0; o < pending.probs.length; o++) {
      const gradient = ((o === pending.actionIndex ? 1 : 0) - pending.probs[o]) * advantage;
      for (let h = 0; h < pending.hidden.length; h++) {
        const weightIndex = o * pending.hidden.length + h;
        b.outputWeights[weightIndex] = clamp(b.outputWeights[weightIndex] + rate * gradient * pending.hidden[h], -3, 3);
      }
    }
    b.baseline = b.baseline * .94 + reward * .06;
    b.rewardMean = b.rewardMean * .91 + reward * .09;
    b.updates++; p.lastReward = reward; b.pending = null;
    if (p.lastLesson === 'Ainda está aprendendo com o ambiente.' || !p.lastLesson) {
      p.lastLesson = reward > .12 ? 'A ação trouxe um benefício observável.' : reward < -.12 ? 'A ação teve custo sem atender uma necessidade.' : 'O resultado foi pequeno; ainda precisa comparar alternativas.';
    }
  }
