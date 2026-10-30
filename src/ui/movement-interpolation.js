// Render one snapshot behind the Worker. Both ends of each segment are known:
// no guessed steps through terrain, and no easing to a stop at every tile.
export function createMovementInterpolator() {
  const actors = new Map();
  let lastDay = null, lastArrival = null, cadence = 1000, lastSpeed = null;
  let playbackTime = -Infinity;
  let discontinuityPending = false;
  function markDiscontinuity() { discontinuityPending = true; }
  function observe(world, now, { reset = false, speed = 1 } = {}) {
    const safeSpeed = Math.max(.1, speed);
    const expected = 1000 / safeSpeed * (safeSpeed >= 8 ? 3 : 1);
    if (reset) {
      actors.clear(); lastDay = null; lastArrival = null; playbackTime = -Infinity;
      discontinuityPending = false;
    }
    if (reset || lastSpeed !== safeSpeed) cadence = expected;
    lastSpeed = safeSpeed;
    // Commands and UI acknowledgements can deliver the same day again.
    if (lastDay === world.day) return;
    const resumed = discontinuityPending;
    discontinuityPending = false;
    let stalledPoses = null;
    if (lastArrival !== null && !resumed) {
      // A snapshot can take several seconds when the simulation worker is busy.
      // Match that real interval so movement continues instead of finishing after
      // one nominal second and leaving every actor idle until the next response.
      const gap = now - lastArrival;
      if (gap > cadence * 1.5) {
        stalledPoses = new Map();
        for (const [kind, agents] of [['person', world.people], ['animal', world.animals]]) {
          for (const agent of agents || []) if (agent.alive)
            stalledPoses.set(kind + ':' + agent.id, pose(kind, agent, now));
        }
      }
      if (gap > 0) cadence = gap;
    }
    if (stalledPoses) playbackTime = now - cadence - 60;
    lastDay = world.day; lastArrival = now;
    const living = new Set();
    for (const [kind, agents] of [['person', world.people], ['animal', world.animals]]) {
      for (const agent of agents || []) {
        if (!agent.alive) continue;
        const key = kind + ':' + agent.id;
        living.add(key);
        let actor = actors.get(key);
        if (!actor) { actor = { points: [], facingX: 1 }; actors.set(key, actor); }
        const stalledPose = stalledPoses?.get(key);
        if (stalledPose) actor.points = [{ x: stalledPose.x, y: stalledPose.y, time: playbackTime }];
        if (resumed && actor.points.length) {
          const previous = actor.points[actor.points.length - 1];
          actor.points = [{ ...previous, time: now - cadence }];
        }
        actor.points.push({ x: agent.x, y: agent.y, time: now });
        if (actor.points.length > 16) actor.points.shift();
      }
    }
    for (const key of actors.keys()) if (!living.has(key)) actors.delete(key);
  }
  function pose(kind, agent, now) {
    const actor = actors.get(kind + ':' + agent.id);
    if (!actor) return { x: agent.x, y: agent.y, moving: false, dirX: 0, dirY: 0, facingX: 1 };
    playbackTime = Math.max(playbackTime, now - cadence - 60);
    const points = actor.points;
    while (points.length > 2 && points[1].time <= playbackTime) points.shift();
    const from = points[0], to = points[1] || from;
    const progress = Math.max(0, Math.min(1, (playbackTime - from.time) / Math.max(1, to.time - from.time)));
    const dirX = to.x - from.x, dirY = to.y - from.y;
    if (Math.abs(dirX) > .001) actor.facingX = dirX;
    return {
      x: from.x + dirX * progress, y: from.y + dirY * progress,
      moving: playbackTime >= from.time && progress < 1 && Math.hypot(dirX, dirY) > .001,
      dirX, dirY, facingX: actor.facingX
    };
  }
  function snapActor(kind, agent, now) {
    actors.set(kind + ':' + agent.id, { facingX: agent.militaryFacingX || 1,
      points: [{ x: agent.x, y: agent.y, time: now - cadence - 60 }] });
  }
  function settleActor(kind, agent, from, now) {
    const start = Math.max(playbackTime, now - cadence - 60);
    actors.set(kind + ':' + agent.id, { facingX: agent.militaryFacingX || 1,
      points: [{ x: from.x, y: from.y, time: start },
        { x: agent.x, y: agent.y, time: start + Math.min(250, cadence) }] });
  }
  return { observe, pose, markDiscontinuity, snapActor, settleActor };
}
