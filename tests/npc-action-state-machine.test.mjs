import { HUMAN_ADULT_AGE_DAYS, HUMAN_ADOLESCENT_AGE_DAYS } from '../src/simulation/individuals/human-age.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NPC_CONTROL, NPC_ACTIVITY, npcControlState,
  selectNpcActivity, prepareNpcLearningTransition
} from '../src/simulation/individuals/action-state-machine.js';

// Copy of the pre-refactor priority expression. Keep this independent from
// the machine under test: it is our behavioral oracle for conflicting guards.
function legacyAction(p, c, selectRoutine) {
  const { campaignOrder, homeRest, survivalAction, returnToGarrison,
    militaryAction, carrierMaintenanceAction, fieldRest, socialPlan, peacetimeSoldier,
    droppedLoot, assignment, carryingGoods, seedCourierDuty,
    personalMarketCargoTrade, cargoAction, foodDuty, assignedBuildDuty,
    patrolDuty, waterTarget } = c;
  const peacetimeSoldierAction = militaryAction;
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  return campaignOrder && (campaignOrder.withdrawing || campaignOrder.towerDuty)
    && !homeRest && survivalAction !== 'drink'
    ? 'campaign'
    : returnToGarrison && peacetimeSoldierAction === 'return_garrison' ? peacetimeSoldierAction
    : survivalAction || carrierMaintenanceAction || (fieldRest ? 'field_rest'
      : homeRest ? 'rest' : socialPlan ? socialPlan.action : peacetimeSoldier ? peacetimeSoldierAction : (droppedLoot && (!assignment || droppedLoot.mineralKind && assignment.action === 'gather') && !carryingGoods && p.energy >= 9
      && (!campaignOrder || !campaignOrder.withdrawing && distance(p, droppedLoot) <= 1.6) ? 'collect_loot'
      : campaignOrder ? militaryAction || 'campaign' : seedCourierDuty ? 'build'
      : personalMarketCargoTrade ? 'trade' : cargoAction || foodDuty || (p.leadingSheepId ? 'lead_sheep'
      : assignedBuildDuty ? 'build'
      : patrolDuty ? 'patrol' : p.role === 'soldier'
        ? p.hydration < 40 && waterTarget ? 'drink' : p.energy < 30 || p.health < 42 || p.injury >= 5 ? 'rest' : 'guard'
        : selectRoutine())));
}

function nextRandom(seed) {
  let state = seed;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}
const options = (pick, values) => values[Math.floor(pick() * values.length)];
const randomBool = pick => pick() < .5;

test('control states derive from canonical NPC identity without persistent copies', () => {
  const p = { alive: true, ageDays: HUMAN_ADULT_AGE_DAYS + 55, role: 'civilian', playerControlled: false, campaignId: null };
  assert.equal(npcControlState(p), NPC_CONTROL.AUTONOMOUS);
  assert.equal(npcControlState({ ...p, role: 'soldier' }), NPC_CONTROL.GARRISON);
  assert.equal(npcControlState({ ...p, campaignId: 4 }), NPC_CONTROL.CAMPAIGN);
  assert.equal(npcControlState({ ...p, role: 'soldier', playerControlled: true }), NPC_CONTROL.PLAYER);
  assert.equal(npcControlState({ ...p, role: 'soldier', ageDays: HUMAN_ADOLESCENT_AGE_DAYS - 1,
    playerControlled: true }), NPC_CONTROL.DEPENDENT);
  assert.equal(npcControlState({ ...p, alive: false }), NPC_CONTROL.DEAD);
  assert.equal(npcControlState(null), NPC_CONTROL.DEAD);
  assert.equal(npcControlState({ ...p, ageDays: HUMAN_ADULT_AGE_DAYS }), NPC_CONTROL.AUTONOMOUS);
});

test('machine preserves legacy action AND lazy neural invocation across 20k guard combinations', () => {
  const random = nextRandom(87121);
  const routine = 'socialize';
  for (let i = 0; i < 20_000; i++) {
    const person = {
      x: 3, y: 5,
      role: options(random, ['soldier', 'worker', 'ruler']),
      energy: options(random, [1, 8, 11, 29, 30, 75]),
      hydration: options(random, [7, 22, 39, 40, 75]),
      health: options(random, [15, 41, 42, 95]),
      injury: options(random, [0, 4, 5, 11]),
      leadingSheepId: randomBool(random) ? 9 : null
    };
    const context = {
      campaignOrder: options(random, [null, { withdrawing: true }, { towerDuty: true },
        { campaign: true }, { withdrawing: true, towerDuty: true }]),
      homeRest: randomBool(random),
      survivalAction: options(random, [null, null, 'drink', 'migrate', 'forage']),
      returnToGarrison: randomBool(random),
      militaryAction: options(random, [null, 'return_garrison', 'patrol', 'guard', 'train']),
      carrierMaintenanceAction: options(random, [null, null, 'forage', 'drink']),
      fieldRest: randomBool(random),
      socialPlan: options(random, [null, null, { action: 'share' }]),
      peacetimeSoldier: randomBool(random),
      droppedLoot: options(random, [null, { x: 3, y: 5 }, { x: 20, y: 20 },
        { x: 3, y: 5, mineralKind: 'gold' }]),
      assignment: options(random, [null, { action: 'gather' }, { action: 'build' }]),
      carryingGoods: randomBool(random),
      seedCourierDuty: randomBool(random),
      personalMarketCargoTrade: randomBool(random),
      cargoAction: options(random, [null, null, 'deliver', 'migrate']),
      foodDuty: options(random, [null, 'forage']),
      assignedBuildDuty: randomBool(random),
      patrolDuty: randomBool(random),
      waterTarget: randomBool(random) ? { x: 8, y: 8 } : null
    };
    let oldInvocations = 0, newInvocations = 0;
    const expected = legacyAction(person, context, () => {
      oldInvocations++;
      return routine;
    });
    const chosen = selectNpcActivity(person, context, () => {
      newInvocations++;
      return routine;
    });
    assert.equal(chosen.action, expected, 'case ' + i);
    assert.equal(newInvocations, oldInvocations, 'neural inference count case ' + i);
    assert.ok(Object.values(NPC_ACTIVITY).includes(chosen.mode));
  }
});

test('the surviving emergency and military transitions do not invoke civilian inference', () => {
  const p = { role: 'soldier', energy: 100, health: 100, injury: 0, hydration: 100, x: 1, y: 1 };
  let called = false;
  const pick = () => { called = true; throw new Error('unexpected neural action'); };
  assert.deepEqual(selectNpcActivity(p, {
    campaignOrder: { withdrawing: true }, survivalAction: 'forage', homeRest: false
  }, pick), { action: 'campaign', mode: NPC_ACTIVITY.MILITARY });
  assert.deepEqual(selectNpcActivity(p, {
    campaignOrder: { withdrawing: true }, survivalAction: 'drink', homeRest: false
  }, pick), { action: 'drink', mode: NPC_ACTIVITY.SURVIVAL });
  assert.deepEqual(selectNpcActivity(p, {
    fieldRest: true
  }, pick), { action: 'field_rest', mode: NPC_ACTIVITY.RECOVERY });
  assert.equal(called, false);
});

function legacyLearningTransition(p, action, c) {
  const { militaryAction, survivalAction, homeRest, carryingGoods,
    foodDuty, assignedBuildDuty, socialPlan, inputs, day } = c;
  if (p.militaryBrain && action !== militaryAction) p.militaryBrain.pending = null;
  if (action === 'patrol' || action === 'guard' || action === 'collect_loot' || p.role === 'soldier') {
    p.brain.pending = null;
    p.brain.lastAction = action;
    if (militaryAction !== action) p.lastDecision = { action, scores: null, inputs: inputs.slice(), day };
  }
  if (survivalAction || homeRest || carryingGoods || foodDuty || assignedBuildDuty || socialPlan) {
    p.brain.pending = null;
    p.brain.lastAction = action;
    p.lastDecision = { action, scores: null, inputs: inputs.slice(), day };
  }
  if (action === 'campaign') {
    p.brain.pending = null;
    p.brain.lastAction = 'campaign';
    if (militaryAction !== action) p.lastDecision = { action, scores: null, inputs: inputs.slice(), day };
  }
}

test('learning/reward cancellation is identical to the old path under interruptions', () => {
  const random = nextRandom(444);
  for (let i = 0; i < 5000; i++) {
    const p = { role: options(random, ['soldier', 'worker']),
      brain: { pending: { attempt: 4 }, lastAction: 'trade' },
      militaryBrain: randomBool(random) ? { pending: { sample: 5 } } : null,
      lastDecision: { action: 'trade', day: -1 } };
    const context = { militaryAction: options(random, ['campaign', 'guard', null, 'train']),
      survivalAction: options(random, [null, 'drink']), homeRest: randomBool(random),
      carryingGoods: randomBool(random), foodDuty: options(random, [null, 'forage']),
      assignedBuildDuty: randomBool(random), socialPlan: options(random, [null, { action: 'share' }]),
      inputs: [0, .5, 1], day: 14 };
    const action = options(random, ['train', 'guard', 'patrol', 'collect_loot', 'campaign', 'drink', 'forage']);
    const expected = structuredClone(p), actual = structuredClone(p);
    legacyLearningTransition(expected, action, context);
    prepareNpcLearningTransition(actual, action, context);
    assert.deepEqual(actual, expected, 'learning case ' + i);
  }
});
