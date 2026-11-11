import test from 'node:test';
import assert from 'node:assert/strict';
import { ANIMAL_ACTIONS, PEOPLE_ACTIONS } from '../src/config/ecosystem.js';
import { createBrain, chooseAnimalAction, choosePeopleAction, updateBrain } from '../src/controllers/individual/neural.js';
import { chooseMilitaryAction, MILITARY_ACTIONS } from '../src/simulation/kingdoms/military-learning.js';
import { selectRoyalBuildSite, SITING_STRATEGIES } from '../src/simulation/kingdoms/royal-siting.js';
import { actorObservation, cognitiveRole, forwardSharedPolicy,
  getSharedPolicy, HUMAN_POLICY_ACTIONS } from '../src/ai/policy/shared-policy.js';

const world = (seed = 42, neuralController = 'shared') =>
  ({ seed, rngState: seed, day: 12, neuralOverrides: { neuralController } });
function person(w, id, role = 'resident') {
  return {
    id, role, name: 'NPC ' + id, alive: true, skills: { build: .45, diplomacy: .3 },
    sociability: .5, trust: .4, loyalty: .7, physicalStrength: .8,
    brain: createBrain(w, PEOPLE_ACTIONS, 18, id),
    personalMemory: [], lastReward: 0, kingdomId: 1, communityId: 1
  };
}
function inputs(size = 18) { return Array.from({ length: size }, (_, i) => (i + 1) / (size + 8)); }

test('one deterministic human policy bank is shared by every role without actor weight matrices', () => {
  const w = world(42);
  const civilian = person(w, 1);
  const general = person(w, 2, 'soldier');
  general.militaryRank = 'general';
  const king = person(w, 3, 'ruler');
  assert.equal(cognitiveRole(civilian), 'civilian');
  assert.equal(cognitiveRole({ ...civilian, assignment: { action: 'build' } }), 'worker');
  assert.equal(cognitiveRole(general), 'general');
  assert.equal(cognitiveRole(king), 'king');
  const policy = getSharedPolicy(w, 'human');
  assert.strictEqual(policy, getSharedPolicy(w, 'human'));
  assert.equal(policy.spec.layerWidths[0], 39);
  assert.deepEqual(policy.spec.actionIds, HUMAN_POLICY_ACTIONS);
  assert.ok(policy.spec.weights instanceof Float32Array);
  assert.ok(policy.spec.weights.length > 1000);
  assert.ok(!('inputWeights' in civilian.brain));
  assert.ok(!('outputWeights' in civilian.brain));
  assert.ok(!('inputWeights' in king.brain));
  assert.equal(civilian.brain.mode, 'shared');
  assert.strictEqual(policy.spec.weights, getSharedPolicy(w, 'human').spec.weights);
  assert.deepEqual(Array.from(getSharedPolicy(world(42), 'human').spec.weights), Array.from(policy.spec.weights));
  assert.notDeepEqual(Array.from(getSharedPolicy(world(43), 'human').spec.weights), Array.from(policy.spec.weights));
  const civScores = forwardSharedPolicy(w, civilian, inputs()).logits;
  const kingScores = forwardSharedPolicy(w, king, inputs()).logits;
  assert.notDeepEqual(civScores, kingScores, 'role features must affect shared logits');
});

test('inference batches preserve order, role identities and action masks', () => {
  const w = world();
  const civ = person(w, 1);
  const general = person(w, 2, 'soldier');
  general.militaryRank = 'general';
  const obsA = actorObservation(w, civ, inputs(), 'people');
  const obsB = actorObservation(w, general, inputs(8), 'military',
    [false, true, false, false, false, false, false]);
  const decisions = getSharedPolicy(w, 'human').inferBatch([obsA, obsB]);
  assert.equal(decisions.length, 2);
  assert.equal(decisions[0].actorId, 1);
  assert.equal(decisions[1].actorId, 2);
  assert.equal(decisions[1].actionId, 'military:patrol');
  assert.equal(decisions[1].policyVersion, 1);
  assert.equal(obsB.actionMask.reduce((a, b) => a + b), 1);
  const guarded = forwardSharedPolicy(w, general, inputs(8), 'military',
    [false, true, false, false, false, false, false]);
  assert.equal(guarded.probs[1], 1);
  assert.ok(guarded.probs.every((p, i) => i === 1 || p === 0));
});

test('learning updates only personal reward/action bias and never shared weights', () => {
  const w = world();
  const a = person(w, 3);
  const b = person(w, 4);
  const baseline = Array.from(getSharedPolicy(w, 'human').spec.weights);
  const before = w.rngState;
  const available = PEOPLE_ACTIONS.map(action => action === 'rest' ? 4 : -1e9);
  assert.equal(choosePeopleAction(w, a, inputs(), available), 'rest');
  assert.equal(a.brain.pending.actionIndex, PEOPLE_ACTIONS.indexOf('rest'));
  updateBrain(a, .8);
  assert.equal(w.rngState, before);
  assert.ok(a.brain.actionValues[PEOPLE_ACTIONS.indexOf('rest')] > 0);
  assert.equal(b.brain.actionValues[PEOPLE_ACTIONS.indexOf('rest')], 0);
  assert.deepEqual(Array.from(getSharedPolicy(w, 'human').spec.weights), baseline);
  assert.ok(!('hidden' in (a.brain.pending || {})));
  assert.equal(a.brain.updates, 1);
});

test('military and animals share model weights without breaking their action rules', () => {
  const w = world();
  const soldier = person(w, 5, 'soldier');
  soldier.energy = 90; soldier.health = 100; soldier.hydration = 100; soldier.foodReserve = 80;
  soldier.militaryTraining = .3;
  assert.equal(chooseMilitaryAction(w, soldier, {training:true, patrol:false}), 'train');
  assert.equal(soldier.militaryBrain.mode, 'shared');
  assert.ok(!('inputWeights' in soldier.militaryBrain));
  assert.strictEqual(getSharedPolicy(w, 'human'), getSharedPolicy(w, 'human'));
  const animal = {id: 7, speciesId:'sheep', brain:createBrain(w, ANIMAL_ACTIONS, 6, 7)};
  const other = {id: 8, speciesId:'sheep', brain:createBrain(w, ANIMAL_ACTIONS, 6, 8)};
  const weights = getSharedPolicy(w, 'animal', 'sheep').spec.weights;
  assert.strictEqual(weights, getSharedPolicy(w, 'animal', 'sheep').spec.weights);
  assert.ok(!('inputWeights' in animal.brain));
  assert.ok(!('outputWeights' in other.brain));
  assert.equal(chooseAnimalAction(w, animal, inputs(6),
    ANIMAL_ACTIONS.map(a => a === 'feed' ? 9 : -1e9)), 'feed');
  updateBrain({brain: animal.brain, lastLesson:''}, .2);
  assert.strictEqual(weights, getSharedPolicy(w, 'animal', 'sheep').spec.weights);
  assert.equal(soldier.militaryBrain.actionCount, MILITARY_ACTIONS.length);
});

test('explicit legacy mode remains available and has independently trained matrices', () => {
  const w = world(9, 'legacy');
  const a = person(w, 1);
  const b = person(w, 2);
  assert.equal(a.brain.mode, undefined);
  assert.ok(a.brain.inputWeights.length > 0);
  assert.notStrictEqual(a.brain.inputWeights, b.brain.inputWeights);
  choosePeopleAction(w, a, inputs(), PEOPLE_ACTIONS.map(a => a === 'rest' ? 5 : -1e9));
  const initialWeights = a.brain.outputWeights.slice();
  updateBrain(a, .7);
  assert.notDeepEqual(a.brain.outputWeights, initialWeights);
});

test('legacy brains can be migrated to shared mode and back without losing personal learning', () => {
  const w = world(77, 'legacy');
  const npc = person(w, 33);
  npc.brain.actionValues[7] = .65;
  npc.brain.baseline = .12;
  const initialRng = w.rngState;
  w.neuralOverrides.neuralController = 'shared';
  const utility = PEOPLE_ACTIONS.map(action => action === 'build' ? 2 : -1e9);
  assert.equal(choosePeopleAction(w, npc, inputs(), utility), 'build');
  assert.equal(npc.brain.mode, 'shared');
  assert.ok(!('inputWeights' in npc.brain));
  assert.ok(!('outputWeights' in npc.brain));
  assert.equal(npc.brain.actionValues[7], .65);
  assert.equal(npc.brain.baseline, .12);
  assert.equal(w.rngState, initialRng, 'migration should not advance simulation RNG');
  w.neuralOverrides.neuralController = 'legacy';
  choosePeopleAction(w, npc, inputs(), utility);
  assert.ok(npc.brain.inputWeights.length > 0);
  assert.ok(npc.brain.outputWeights.length > 0);
  assert.equal(npc.brain.actionValues[7], .65);
});

test('royal building strategies use the same human policy without king-specific matrices', () => {
  const w = { ...world(15), tiles: Array(100), people: [] };
  const king = person(w, 12, 'ruler');
  w.people.push(king);
  const kingdom = {id: 4, rulerId: king.id, treasury: {stock: {wood:120, stone:50}},
    territoryTileCount: 20, frontierLosses: []};
  const candidates = SITING_STRATEGIES.slice(0, 2).map((strategy, i) => ({
    strategy, label: strategy, tile: {x:5+i, y:7+i},
    reason: 'fixture', quality:.5, metrics:{risk:.4,access:.8}
  }));
  const before = getSharedPolicy(w, 'human').spec.weights.slice();
  const selection = selectRoyalBuildSite(w, kingdom, 'torre', candidates);
  assert.ok(selection?.tile);
  assert.equal(selection.brain.mode, 'shared');
  assert.ok(!('inputWeights' in selection.brain));
  assert.ok(!('outputWeights' in selection.brain));
  assert.ok(candidates.some(x => x.strategy === selection.decision.strategy));
  assert.ok(getSharedPolicy(w, 'human').spec.actionIds.includes('royal:defensive'));
  assert.deepEqual(Array.from(getSharedPolicy(w, 'human').spec.weights), Array.from(before));
});
