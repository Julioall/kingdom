import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getSharedPolicy } from '../src/ai/policy/shared-policy.js';
import { createBrain } from '../src/controllers/individual/neural.js';
import { PEOPLE_ACTIONS, PEOPLE_INPUTS, ANIMAL_ACTIONS } from '../src/config/ecosystem.js';

test('lightweight shared network defaults to 16 hidden neurons without removing action choices', () => {
  const world = { seed: 42 };
  const human = getSharedPolicy(world, 'human');
  const animal = getSharedPolicy(world, 'animal', 'sheep');
  assert.deepEqual(human.spec.layerWidths.slice(1, 3), [16, 16]);
  assert.deepEqual(animal.spec.layerWidths.slice(1, 3), [16, 16]);
  const brain = createBrain(world, PEOPLE_ACTIONS, PEOPLE_INPUTS, 17);
  assert.equal(brain.hiddenSize, 16);
  assert.equal(brain.mode, 'shared');
  assert.equal(createBrain(world, ANIMAL_ACTIONS, 6, 18).hiddenSize, 16);
  const historical = getSharedPolicy({ seed: 42, neuralOverrides: { sharedHiddenSize: 24 } }, 'human');
  assert.equal(historical.spec.layerWidths[1], 24);
});

test('game entry, scripts and dependency manifest no longer start a language model', () => {
  const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
  const packageJson = JSON.parse(read('package.json'));
  assert.ok(!Object.keys(packageJson.dependencies || {}).some(name => /transformers|onnx|ollama/i.test(name)));
  assert.ok(!packageJson.scripts['ai:serve']);
  assert.ok(!read('index.html').includes('localAiToggle'));
  assert.ok(!read('src/ui/game.js').includes('local-engine.js'));
  assert.ok(!read('scripts/run-local.mjs').includes('ollama-service'));
});
