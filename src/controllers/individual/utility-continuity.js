// Optional Utility AI inertia for uninterrupted voluntary choices.
// Applied only AFTER the existing utility/neural/cognition scores have been
// evaluated, never to military orders, emergencies or forced assignments.
// Avoids per-day action oscillation without consuming RNG or changing scoring.
export function chooseContinuingUtilityIndex(actions, scores, previousDecision, day, utilities, margin = .12) {
  let winner = 0, highest = -Infinity;
  for (let i = 0; i < scores.length; i++) {
    if (scores[i] > highest) { highest = scores[i]; winner = i; }
  }
  if (!previousDecision || !Array.isArray(previousDecision.scores)
      || previousDecision.day !== day - 1 || !Number.isFinite(margin)
      || margin <= 0 || margin > .5) return winner;
  const previousIndex = actions.indexOf(previousDecision.action);
  if (previousIndex < 0 || previousIndex === winner
      || !(utilities[previousIndex] >= 0) || !Number.isFinite(scores[previousIndex]))
    return winner;
  const deficit = highest - scores[previousIndex];
  // Equal scores and stable preference retain prior action. A challenger must
  // exceed the margin; never invent a new task for a nonviable old action.
  return deficit <= margin ? previousIndex : winner;
}
