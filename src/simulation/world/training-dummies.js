const TRAINING_DUMMY_COLLISION_RADIUS = .286;
const TRAINING_DUMMY_HIT_RADIUS = .416;
const TRAINING_DUMMY_SIZE_SCALE = .40625;
const TRAINING_DUMMY_MAX_HEALTH = 1000;
const TRAINING_DUMMY_HEALTH_REGEN_PER_DAY = 50;

function lerpPoint(from, to, amount) {
  return {
    x: from.x + (to.x - from.x) * amount,
    y: from.y + (to.y - from.y) * amount
  };
}

export function trainingDummiesForWorld(world) {
  if (!world) return [];
  const dummies = [];
  const centersByKingdom = new Map();
  for (const structure of world.structures || []) {
    if (!['castelo', 'centro_militar', 'arquearia', 'monasterio'].includes(structure.type)
        || !structure.complete || structure.destroyedDay != null) continue;
    let centers = centersByKingdom.get(structure.kingdomId);
    if (!centers) centersByKingdom.set(structure.kingdomId, centers = {});
    if (!centers[structure.type] || structure.id < centers[structure.type].id)
      centers[structure.type] = structure;
  }
  for (const kingdom of world.kingdoms || []) {
    const centers = centersByKingdom.get(kingdom.id);
    const barracks = centers?.centro_militar;
    const archery = centers?.arquearia;
    const monastery = centers?.monasterio;
    if (!barracks || !archery || !monastery) continue;

    const center = {
      x: (barracks.x + archery.x + monastery.x) / 3,
      y: (barracks.y + archery.y + monastery.y) / 3
    };
    let centralDummy = lerpPoint(center, barracks, .55);
    if (kingdom.palette === 'blue' && centers.castelo) {
      const awayX = barracks.x - centers.castelo.x, awayY = barracks.y - centers.castelo.y;
      const awayLength = Math.hypot(awayX, awayY) || 1;
      centralDummy = { x: barracks.x + awayX / awayLength * 1.25,
        y: barracks.y + awayY / awayLength * 1.25 };
    }
    const placements = [
      { point: centralDummy, pose: 'frontal', flipX: false },
      { point: lerpPoint(center, archery, .55), pose: 'diagonal', flipX: false },
      { point: lerpPoint(center, monastery, .55), pose: 'diagonal', flipX: true }
    ];
    for (let index = 0; index < placements.length; index++) {
      const placement = placements[index];
      const id = -(kingdom.id * 10 + index + 1);
      const state = world.trainingDummyStates?.[id];
      dummies.push({
        id,
        x: placement.point.x,
        y: placement.point.y,
        kingdomId: kingdom.id,
        palette: kingdom.palette || 'blue',
        pose: placement.pose,
        flipX: placement.flipX,
        sizeScale: TRAINING_DUMMY_SIZE_SCALE,
        trainingDummy: true,
        alive: true,
        health: state?.health ?? TRAINING_DUMMY_MAX_HEALTH,
        maxHealth: TRAINING_DUMMY_MAX_HEALTH,
        lastAttackSequence: state?.lastAttackSequence ?? 0,
        lastAttackedDay: state?.lastAttackedDay ?? null,
        hitRadius: TRAINING_DUMMY_HIT_RADIUS,
        hitbox: { radius: TRAINING_DUMMY_COLLISION_RADIUS }
      });
    }
  }
  return dummies;
}

export function damageTrainingDummy(world, dummy, damage, sequence, day) {
  world.trainingDummyStates ??= {};
  const state = world.trainingDummyStates[dummy.id] ??= {
    health: TRAINING_DUMMY_MAX_HEALTH,
    lastAttackSequence: 0,
    lastAttackedDay: null,
    recoveredDay: day
  };
  const applied = Math.max(0, Number(damage) || 0);
  state.health = Math.max(0, state.health - applied);
  state.lastAttackSequence = sequence;
  state.lastAttackedDay = day;
  state.recoveredDay = day;
  dummy.health = state.health;
  dummy.maxHealth = TRAINING_DUMMY_MAX_HEALTH;
  dummy.lastAttackSequence = sequence;
  dummy.lastAttackedDay = day;
  return applied;
}

export function recoverTrainingDummyHealth(world, day = world.day) {
  for (const [id, state] of Object.entries(world.trainingDummyStates || {})) {
    const recoveredDay = Number.isInteger(state.recoveredDay) ? state.recoveredDay : day;
    const days = Math.max(0, day - recoveredDay);
    if (days > 0) {
      state.health = Math.min(TRAINING_DUMMY_MAX_HEALTH,
        state.health + TRAINING_DUMMY_HEALTH_REGEN_PER_DAY * days);
      state.recoveredDay = day;
    }
    if (!Number.isFinite(state.health)) state.health = TRAINING_DUMMY_MAX_HEALTH;
    world.trainingDummyStates[id] = state;
  }
}
