// Deterministic, hierarchical NPC state machine.
//
// The authoritative state remains in the person, their needs, the kingdom's
// orders and their social intentions. We deliberately DO NOT store a second
// "currentAction" or "fsmState" on each actor: those duplicate fields would
// inflate every snapshot and risk contradicting military/social commands.
//
// An activity transition is selected once, after observations and urgent
// needs are evaluated, but before executing any action. The winning mode
// identifies which subsystem owns the current action. Every guard below
// preserves the precedence of the legacy action expression.
//
// Important: selectRoutine is LAZY. Running neural inference earlier would
// consume RNG/update the brain even when a survival or military guard wins.
import { distance } from '../core/math.js';
import { HUMAN_ADULT_AGE_DAYS } from './human-age.js';

export const NPC_CONTROL = Object.freeze({
  DEAD: 'dead',
  DEPENDENT: 'dependent',
  PLAYER: 'player',
  CAMPAIGN: 'campaign',
  GARRISON: 'garrison',
  AUTONOMOUS: 'autonomous'
});

export const NPC_ACTIVITY = Object.freeze({
  MILITARY: 'military',
  SURVIVAL: 'survival',
  SUPPLY: 'supply',
  RECOVERY: 'recovery',
  SOCIAL: 'social',
  WORK: 'work',
  ROUTINE: 'routine'
});

export function npcControlState(person) {
  if (!person?.alive) return NPC_CONTROL.DEAD;
  // A child is cared for before manual or adult activity checks.
  if (person.ageDays < HUMAN_ADULT_AGE_DAYS) return NPC_CONTROL.DEPENDENT;
  if (person.playerControlled) return NPC_CONTROL.PLAYER;
  if (person.campaignId != null) return NPC_CONTROL.CAMPAIGN;
  if (person.role === 'soldier') return NPC_CONTROL.GARRISON;
  return NPC_CONTROL.AUTONOMOUS;
}

const transition = (action, mode) => ({ action, mode });

/**
 * Select one daily action, retaining the original strict priority order.
 *
 * The returned mode is transient diagnostic metadata; action itself remains
 * the authoritative input to the existing action executor and reward logic.
 * The caller owns all pre-selection side effects (neural/military observation).
 */
export function selectNpcActivity(person, {
  campaignOrder, homeRest, survivalAction, returnToGarrison,
  militaryAction, carrierMaintenanceAction, fieldRest, socialPlan,
  peacetimeSoldier, droppedLoot, assignment, carryingGoods,
  seedCourierDuty, personalMarketCargoTrade, cargoAction, foodDuty,
  assignedBuildDuty, patrolDuty, waterTarget
}, selectRoutine) {
  // 1. A withdrawing/tower soldier obeys their commander unless drinking is
  // immediately vital; this command wins even over ordinary home rest.
  if (campaignOrder && (campaignOrder.withdrawing || campaignOrder.towerDuty)
      && !homeRest && survivalAction !== 'drink')
    return transition('campaign', NPC_ACTIVITY.MILITARY);

  // 2. A legitimate emergency return to a garrison remains above survival.
  if (returnToGarrison && militaryAction === 'return_garrison')
    return transition(militaryAction, NPC_ACTIVITY.MILITARY);

  // 3. Physical emergencies and cargo-maintenance override optional plans.
  if (survivalAction) return transition(survivalAction, NPC_ACTIVITY.SURVIVAL);
  if (carrierMaintenanceAction) return transition(carrierMaintenanceAction, NPC_ACTIVITY.SUPPLY);

  // 4. Field recovery prevents tired formations from marching home.
  if (fieldRest) return transition('field_rest', NPC_ACTIVITY.RECOVERY);
  if (homeRest) return transition('rest', NPC_ACTIVITY.RECOVERY);

  // 5. Existing social promises precede routine tasks.
  if (socialPlan) return transition(socialPlan.action, NPC_ACTIVITY.SOCIAL);

  // 6. Peacetime soldiers keep their military policy's exact answer, even
  // when null; falling through to a civilian policy changes agent behavior.
  if (peacetimeSoldier) return transition(militaryAction, NPC_ACTIVITY.MILITARY);

  // 7. An accessible, observed dropped resource has priority over a new
  // campaign step only under the original specific collection conditions.
  if (droppedLoot && (!assignment || droppedLoot.mineralKind && assignment.action === 'gather')
      && !carryingGoods && person.energy >= 9
      && (!campaignOrder || !campaignOrder.withdrawing && distance(person, droppedLoot) <= 1.6))
    return transition('collect_loot', NPC_ACTIVITY.WORK);

  if (campaignOrder) return transition(militaryAction || 'campaign', NPC_ACTIVITY.MILITARY);
  if (seedCourierDuty) return transition('build', NPC_ACTIVITY.WORK);
  if (personalMarketCargoTrade) return transition('trade', NPC_ACTIVITY.WORK);

  if (cargoAction) return transition(cargoAction, NPC_ACTIVITY.SUPPLY);
  if (foodDuty) return transition(foodDuty, NPC_ACTIVITY.WORK);
  if (person.leadingSheepId) return transition('lead_sheep', NPC_ACTIVITY.WORK);
  if (assignedBuildDuty) return transition('build', NPC_ACTIVITY.WORK);
  if (patrolDuty) return transition('patrol', NPC_ACTIVITY.MILITARY);

  if (person.role === 'soldier') {
    if (person.hydration < 40 && waterTarget) return transition('drink', NPC_ACTIVITY.SURVIVAL);
    if (person.energy < 30 || person.health < 42 || person.injury >= 5)
      return transition('rest', NPC_ACTIVITY.RECOVERY);
    return transition('guard', NPC_ACTIVITY.MILITARY);
  }

  if (typeof selectRoutine !== 'function')
    throw new TypeError('A civilian action requires a lazy routine selector');
  return transition(selectRoutine(), NPC_ACTIVITY.ROUTINE);
}

/**
 * Transition the learning state AFTER choosing an action, exactly as in the
 * original execution path. Forced duties cancel mismatched pending samples;
 * voluntary neural decisions retain their pending reward credit.
 */
export function prepareNpcLearningTransition(person, action, {
  militaryAction, survivalAction, homeRest, carryingGoods,
  foodDuty, assignedBuildDuty, socialPlan, inputs, day
}) {
  if (person.militaryBrain && action !== militaryAction)
    person.militaryBrain.pending = null;
  if (action === 'patrol' || action === 'guard' || action === 'collect_loot' || person.role === 'soldier') {
    person.brain.pending = null;
    person.brain.lastAction = action;
    if (militaryAction !== action)
      person.lastDecision = { action, scores: null, inputs: inputs.slice(), day };
  }
  if (survivalAction || homeRest || carryingGoods || foodDuty || assignedBuildDuty || socialPlan) {
    person.brain.pending = null;
    person.brain.lastAction = action;
    person.lastDecision = { action, scores: null, inputs: inputs.slice(), day };
  }
  if (action === 'campaign') {
    person.brain.pending = null;
    person.brain.lastAction = 'campaign';
    if (militaryAction !== action)
      person.lastDecision = { action, scores: null, inputs: inputs.slice(), day };
  }
}
