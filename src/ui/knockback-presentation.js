export function knockbackPose(launch, elapsedMs) {
  const elapsed = elapsedMs - (launch.atMs || 0);
  const progress = Math.max(0, Math.min(1, elapsed / launch.durationMs));
  const travel = 1 - (1 - progress) ** 2;
  return {
    x: launch.from.x + (launch.to.x - launch.from.x) * travel,
    y: launch.from.y + (launch.to.y - launch.from.y) * travel,
    lift: 4 * launch.height * progress * (1 - progress),
    rotation: 0,
    moving: false
  };
}
