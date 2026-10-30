import { applyManualMovement } from '../simulation/individuals/manual-movement.js';

export function createManualMovementPrediction(move = applyManualMovement) {
  let pending = [], sequence = 0, personId = null;
  function reset() { pending = []; personId = null; }
  function predict(world, person, input) {
    if (personId !== person.id) { pending = []; personId = person.id; }
    sequence = Math.max(sequence, person.playerInputSequence || 0) + 1;
    input.inputSequence = sequence;
    pending.push(input);
    move(world, person, input);
    person.playerInput = { ...input };
  }
  function reconcile(world, person) {
    if (!person || person.id !== personId) return;
    pending = pending.filter(input => input.inputSequence > (person.playerInputSequence || 0));
    for (const input of pending) {
      move(world, person, input);
      person.playerInput = { ...input };
    }
  }
  return { predict, reconcile, reset };
}
