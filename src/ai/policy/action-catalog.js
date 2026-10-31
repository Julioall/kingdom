// Stable military action IDs consumed by both the old military controller and
// the unified shared human policy. Keep their ordering stable for learning.
export const MILITARY_ACTIONS = Object.freeze([
  'guard', 'patrol', 'train', 'campaign', 'drink', 'rest', 'return_garrison'
]);
