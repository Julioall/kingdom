export const DASH_TRAIL_FADE_MS = 240;

export function dashPosition(action, elapsed) {
  const progress = Math.max(0, Math.min(1,
    (elapsed - (action.windupMs || 0)) / Math.max(1, action.activeMs || 1)));
  const eased = action.attackVariant === 'shield-bash' ? progress * progress : progress;
  const end = action.endPosition || {
    x: action.origin.x + Math.cos(action.angle || 0) * (action.advanceDistance || 0),
    y: action.origin.y + Math.sin(action.angle || 0) * (action.advanceDistance || 0)
  };
  return { x: action.origin.x + (end.x - action.origin.x) * eased,
    y: action.origin.y + (end.y - action.origin.y) * eased };
}

export function dashGhosts(action, elapsed) {
  const active = action.activeMs || 1, windup = action.windupMs || 0;
  const age = elapsed - windup;
  if (age < 0 || age >= active + DASH_TRAIL_FADE_MS) return [];
  const fade = Math.min(1, (active + DASH_TRAIL_FADE_MS - age) / DASH_TRAIL_FADE_MS);
  return [30, 85, 140, 195].filter(delay => age >= delay).map((delay, index) => ({
    ...dashPosition(action, Math.max(windup, elapsed - delay)),
    alpha: (.29 - index * .045) * fade
  }));
}
