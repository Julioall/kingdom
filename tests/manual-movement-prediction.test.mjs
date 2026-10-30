import test from 'node:test';
import assert from 'node:assert/strict';
import { createManualMovementPrediction } from '../src/ui/manual-movement-prediction.js';

test('movement responds while the Worker is busy and only unconfirmed inputs are replayed', () => {
  const prediction = createManualMovementPrediction((world, person, input) => { person.x += input.moveX * input.dt; });
  const person = { id: 1, x: 0, y: 0, playerInputSequence: 0 };
  const first = { moveX: 1, dt: .1 }, second = { moveX: 1, dt: .1 };
  prediction.predict({}, person, first);
  prediction.predict({}, person, second);
  assert.equal(person.x, .2);
  // A daily snapshot arrives before either input was processed.
  person.x = 0;
  prediction.reconcile({}, person);
  assert.equal(person.x, .2);
  // The Worker confirms the first input, but a collision shortened its step.
  person.x = .05; person.playerInputSequence = first.inputSequence;
  prediction.reconcile({}, person);
  assert.ok(Math.abs(person.x - .15) < 1e-9);
  person.x = .15; person.playerInputSequence = second.inputSequence;
  prediction.reconcile({}, person);
  assert.equal(person.x, .15);
  prediction.reset();
  person.x = 2;
  prediction.reconcile({}, person);
  assert.equal(person.x, 2);
});
