import test from 'node:test';
import assert from 'node:assert/strict';
import { choosePeopleAction, createBrain, ensureBrainSize } from '../../src/controllers/individual/neural.js';
import { PEOPLE_ACTIONS, PEOPLE_INPUTS } from '../../src/config/ecosystem.js';

test('the experimental rules comparator ignores network logits and learned action values', () => {
  const world = { seed: 42, neuralOverrides: { peopleController: 'rules', peopleHiddenSize: 4 } };
  const person = { id: 7, role: 'resident', brain: createBrain(world, PEOPLE_ACTIONS, PEOPLE_INPUTS, 7, 9) };
  ensureBrainSize(world, person, 4);
  person.brain.actionValues.fill(100);
  const utility = Array(PEOPLE_ACTIONS.length).fill(-1);
  utility[3] = 4;
  assert.equal(choosePeopleAction(world, person, Array(PEOPLE_INPUTS).fill(0), utility), PEOPLE_ACTIONS[3]);
  assert.equal(person.brain.hiddenSize, 4);
  assert.equal(person.brain.pending, null);
});

test('the experimental network-size override resizes resident brains but keeps rulers at their selected default', () => {
  const world = { seed: 8, neuralOverrides: { peopleController: 'network', peopleHiddenSize: 6 } };
  const resident = { id: 2, role: 'resident', brain: createBrain(world, PEOPLE_ACTIONS, PEOPLE_INPUTS, 2, 9) };
  const soldier = { id: 4, role: 'soldier', brain: createBrain(world, PEOPLE_ACTIONS, PEOPLE_INPUTS, 4, 9) };
  const ruler = { id: 3, role: 'ruler', brain: createBrain(world, PEOPLE_ACTIONS, PEOPLE_INPUTS, 3, 50) };
  const utility = Array(PEOPLE_ACTIONS.length).fill(0);
  choosePeopleAction(world, resident, Array(PEOPLE_INPUTS).fill(0), utility);
  choosePeopleAction(world, soldier, Array(PEOPLE_INPUTS).fill(0), utility);
  choosePeopleAction(world, ruler, Array(PEOPLE_INPUTS).fill(0), utility);
  assert.equal(resident.brain.hiddenSize, 6);
  assert.equal(soldier.brain.hiddenSize, 9);
  assert.equal(ruler.brain.hiddenSize, 50);
});
