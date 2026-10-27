import { initializeCombatResources } from './combat-resources.js';
import { militaryCivilianFoodFloor } from '../economy/food-policy.js';
import { DAILY_FOOD_NEED, FOOD_DAYS_PER_UNIT } from '../../config/ecosystem.js';
import { distance } from '../core/math.js';
import {
  addFoodReserve, communityFoodStock, spendInventory, transferInventory, transferResource, withdrawCommunityFood
} from '../economy/inventories.js';
import { MILITARY_CLASSES } from './military.js';
import { moveOne } from '../individuals/movement.js';
import { structureInteractionPoint } from '../physics/hitboxes.js';
import { recordTrade } from '../economy/trade-ledger.js';
import {
  advanceSocialIntention, defineSocialIntention, recordSocialBeliefEvidence, recordSocialFact,
  rememberSocialFact, SOCIAL_ACTIVE_INTENTION_PER_PERSON_LIMIT
} from '../society/social-evidence.js';

export const MILITARY_PAY = Object.freeze({ gold: 15, days: 30 });
export const PEACETIME_SOLDIER_FOOD_NEED = DAILY_FOOD_NEED;
export const GARRISON_RATION_TARGET = 55;
export const GARRISON_RECOVERY = Object.freeze({
  food: 42, energy: 50, health: 55, hydration: 24,
  restEnergy: 72, restHealth: 60, restInjury: 5,
  startRestEnergy: 24, energyPerDay: 14, healthPerDay: 6, injuryPerDay: 1
});

export function restPersonInHouse(world, person) {
  const buildings = world.structures.filter(structure => structure.complete
    && (person.kingdomId != null && structure.kingdomId === person.kingdomId
      || person.communityId != null && structure.communityId === person.communityId)
    && structure.destroyedDay == null
    && structure.integrity !== 0);
  const home = world.structures.find(structure => structure.id === person.homeId && structure.complete
    && structure.destroyedDay == null && structure.integrity !== 0);
  const houses = buildings.filter(structure => ['abrigo', 'casa'].includes(structure.type));
  const soldier = person.role === 'soldier';
  const currentTargetId = soldier ? person.militaryRestTargetId : person.homeRestTargetId;
  const house = home || houses.find(structure => structure.id === currentTargetId)
    || houses.slice().sort((a, b) => distance(person, a) - distance(person, b) || a.id - b.id)[0]
    || (soldier ? buildings.find(structure => structure.id === currentTargetId)
      || buildings.filter(structure => ['centro_militar', 'castelo'].includes(structure.type))
        .sort((a, b) => distance(person, a) - distance(person, b) || a.id - b.id)[0] : null);
  person.restingStructureId = null;
  if (soldier) person.militaryRestTargetId = house?.id ?? null;
  else person.homeRestTargetId = house?.id ?? null;
  if (!house) return false;
  person.towerMounted = false;
  const entry = structureInteractionPoint(house) || house;
  if (distance(person, entry) > 1.25) {
    const moved = moveOne(world, person, entry, false, { arrivalRadius: 1.25 });
    if (!moved) {
      if (soldier) person.militaryRestTargetId = null;
      else person.homeRestTargetId = null;
      person.state = 'descansando ao ar livre';
    } else person.state = 'indo descansar na casa';
    return false;
  }
  person.restingStructureId = house.id;
  person.militaryReturningHome = false;
  person.state = 'descansando dentro da casa';
  return true;
}

export const restSoldierInHouse = restPersonInHouse;

export function militaryDutyCenterFor(world, person) {
  const validCenter = center => center && center.complete && center.type === 'centro_militar'
    && center.kingdomId === person.kingdomId;
  const assigned = world.structures.find(center => center.id === person.militaryDutyCenterId && validCenter(center));
  if (assigned) return assigned;
  const kingdom = world.kingdoms.find(item => item.id === person.kingdomId);
  return (kingdom?.militaryCenterIds || []).map(id => world.structures.find(center => center.id === id && validCenter(center)))
    .filter(Boolean).sort((a, b) => distance(person, a) - distance(person, b) || a.id - b.id)[0] || null;
}

export function drawGarrisonRation(world, person, center = militaryDutyCenterFor(world, person), target = GARRISON_RATION_TARGET,
  { allowAwayFromCenter = false } = {}) {
  const restingHouse = world.structures.find(structure => structure.id === person?.restingStructureId
    && structure.complete && structure.kingdomId === person.kingdomId
    && structure.destroyedDay == null && structure.integrity !== 0 && distance(person, structure) <= 1.25);
  const validCenter = center && center.type === 'centro_militar' && center.kingdomId === person?.kingdomId && center.complete;
  const canDrawAtCenter = validCenter && (distance(person, center) <= 2.5 || restingHouse);
  if (!person || person.role !== 'soldier' || person.campaignId != null
      || !allowAwayFromCenter && !canDrawAtCenter || allowAwayFromCenter && center && !validCenter) return 0;
  const need = Math.min(Math.max(0, target - person.foodReserve), Math.max(0, 100 - person.foodReserve));
  if (need <= .01) return 0;
  const kingdom = world.kingdoms.find(item => item.id === person.kingdomId);
  const available = Math.max(0, Number(kingdom?.treasury?.stock?.food) || 0);
  let received = 0;
  const treasuryRation = Math.min(available, need / FOOD_DAYS_PER_UNIT);
  if (treasuryRation > .01 && spendInventory(kingdom.treasury, { food: treasuryRation }, 'military-garrison-ration')) {
    received += addFoodReserve(person, treasuryRation * FOOD_DAYS_PER_UNIT, 'military-garrison-ration');
  }
  const remainder = Math.max(0, need - received);
  const community = world.communities.find(item => item.id === kingdom?.communityId && item.kingdomId === person.kingdomId);
  const surplus = Math.max(0, communityFoodStock(community) - militaryCivilianFoodFloor(world, kingdom));
  const communityRation = Math.min(surplus, remainder / FOOD_DAYS_PER_UNIT);
  if (communityRation > .01) {
    const meal = withdrawCommunityFood(world, community, communityRation, 'military-garrison-ration');
    received += addFoodReserve(person, meal.nutrition * FOOD_DAYS_PER_UNIT, 'military-garrison-ration');
  }
  return received;
}

export function clearCivilianDuties(world, person, returnCargo = true) {
  person.assignment = null;
  person.brain.pending = null;
  const community = world.communities.find(item => item.id === person.communityId);
  if (community && returnCargo) {
    for (const [carried, stored] of Object.entries({ carriedFood: 'food', carriedFruit: 'food', carriedMeat: 'meat',
      carriedWood: 'wood', carriedStone: 'stone', carriedGold: 'gold', carriedFeed: 'feed' })) {
      transferResource(person, community.stores, carried, person[carried] || 0, stored);
    }
  }
  if (person.leadingSheepId != null) {
    const sheep = world.animals.find(item => item.id === person.leadingSheepId);
    if (sheep?.beingLedBy === person.id) { sheep.beingLedBy = null; sheep.herdPenId = null; }
    person.leadingSheepId = null;
    person.leadingSheepPenId = null;
  }
}

export function enlistSoldier(world, person, center, day = world.day, militaryClass = 'lanceiro') {
  clearCivilianDuties(world, person);
  person.role = 'soldier';
  person.militaryClass = MILITARY_CLASSES[militaryClass] ? militaryClass : 'lanceiro';
  initializeCombatResources(person);
  person.maxCombatHealth = MILITARY_CLASSES[person.militaryClass].vitality;
  person.health = 100;
  person.militaryMerit ||= 0;
  person.loyalty = Number.isFinite(person.loyalty) ? person.loyalty : .8;
  person.militaryCenterId = center.id;
  person.militaryDutyCenterId = center.id;
  person.militaryTraining = 0;
  person.militaryServiceDay = day;
  person.nextMilitaryPayDay = day;
  person.militaryPayArrears = 0;
  person.militaryWallet ||= { stock: { gold: 0 } };
  person.state = 'em serviço militar';
  person.brain.lastAction = 'guard';
  center.soldierIds ||= [];
  if (!center.soldierIds.includes(person.id)) center.soldierIds.push(person.id);
  delete person.recruitmentOrder;
  paySoldier(world, person, day);
}

function paySoldier(world, person, day) {
  const kingdom = world.kingdoms.find(item => item.id === person.kingdomId);
  if (!kingdom) return;
  person.militaryWallet ||= { stock: { gold: 0 } };
  person.nextMilitaryPayDay ??= day;
  person.militaryPayArrears ||= 0;
  const previousArrears = person.militaryPayArrears;
  let missedPayDay = null;
  if (person.campaignId == null) {
    person.nextMilitaryPayDay = day + MILITARY_PAY.days;
  } else if (day >= person.nextMilitaryPayDay) {
    missedPayDay = person.nextMilitaryPayDay;
    const months = Math.floor((day - person.nextMilitaryPayDay) / MILITARY_PAY.days) + 1;
    person.militaryPayArrears += months * MILITARY_PAY.gold;
    person.nextMilitaryPayDay += months * MILITARY_PAY.days;
  }
  const paid = transferInventory(kingdom.treasury, person.militaryWallet, 'gold', person.militaryPayArrears, 'military-salary');
  person.militaryPayArrears = Math.max(0, person.militaryPayArrears - paid);
  if (missedPayDay !== null && person.militaryPayArrears > previousArrears) {
    recordMilitaryPayExperience(world, person, kingdom, 'military_pay_delayed',
      person.militaryPayArrears - previousArrears, day, missedPayDay);
  }
  if (previousArrears > 0 && paid > 0) {
    recordMilitaryPayExperience(world, person, kingdom, 'military_pay_recovered', paid, day, null);
  }
  if (paid > 0) {
    person.lastMilitaryPayDay = day;
    person.totalMilitaryPay = (person.totalMilitaryPay || 0) + paid;
  }
}

function recordMilitaryPayExperience(world, soldier, kingdom, type, amount, paymentDay, dueDay) {
  const nextFact = world.socialEvidence?.nextFactNumber || 1;
  const fact = recordSocialFact(world, {
    idempotencyKey: 'military-pay:' + type + ':' + soldier.id + ':' + paymentDay + ':' + nextFact,
    type,
    participantIds: [soldier.id],
    witnessIds: [soldier.id],
    targetId: kingdom.id,
    location: Number.isFinite(soldier.x) && Number.isFinite(soldier.y) ? { x: soldier.x, y: soldier.y } : null,
    outcome: { resource: 'gold', amount, paymentDay, dueDay }
  });
  rememberSocialFact(world, soldier.id, fact.eventId, { source: 'direct', deferPrune: true });
  recordSocialBeliefEvidence(world, soldier.id, {
    topic: 'military_pay_reliability', aboutId: kingdom.id, eventId: fact.eventId,
    polarity: type === 'military_pay_delayed' ? -1 : 1
  });
  ensureMilitaryServiceEvaluationPlan(world, soldier, kingdom, fact);
}

function ensureMilitaryServiceEvaluationPlan(world, soldier, kingdom, payFact) {
  soldier.socialIntentions ||= [];
  const current = soldier.socialIntentions.find(item => item.type === 'evaluate_service'
    && String(item.targetId) === String(kingdom.id) && !['completed', 'abandoned'].includes(item.status));
  if (current) return current;
  const activeCount = soldier.socialIntentions.filter(item => !['completed', 'abandoned'].includes(item.status)).length;
  if (activeCount >= SOCIAL_ACTIVE_INTENTION_PER_PERSON_LIMIT) return null;
  return defineSocialIntention(world, soldier.id, {
    type: 'evaluate_service', priority: .45, targetId: kingdom.id,
    dueDay: world.day + 3, evidenceIds: [payFact.eventId],
    steps: [
      { action: 'review_pay_history', targetId: kingdom.id },
      { action: 'evaluate_outstanding_compensation', targetId: kingdom.id }
    ],
    endsWhen: 'verified_pay_review_or_deadline'
  });
}

export function resolveMilitaryServiceEvaluation(world, soldier) {
  if (!world || !soldier || soldier.role !== 'soldier') return null;
  const plan = (soldier.socialIntentions || []).find(item => item.type === 'evaluate_service'
    && item.status === 'active' && item.progress < item.steps.length);
  if (!plan) return null;
  const kingdom = world.kingdoms.find(item => String(item.id) === String(plan.targetId));
  if (!kingdom) return null;
  if (plan.progress === 0) {
    const progressed = advanceSocialIntention(world, soldier.id, plan.intentionId, { progress: 1 });
    return { plan: progressed, evaluation: null };
  }

  const relatedPayEvents = (world.socialEvidence?.facts || []).filter(fact =>
    ['military_pay_delayed', 'military_pay_recovered'].includes(fact.type)
    && fact.participantIds.includes(String(soldier.id)) && String(fact.targetId) === String(kingdom.id)
    && ((plan.evidenceIds || []).includes(fact.eventId) || fact.day >= plan.createdDay));
  const outstandingArrears = Math.max(0, Number(soldier.militaryPayArrears) || 0);
  const evaluation = recordSocialFact(world, {
    idempotencyKey: 'military-service-evaluation:' + plan.intentionId,
    type: 'military_service_evaluated', participantIds: [soldier.id], witnessIds: [soldier.id],
    targetId: kingdom.id,
    location: Number.isFinite(soldier.x) && Number.isFinite(soldier.y) ? { x: soldier.x, y: soldier.y } : null,
    outcome: {
      status: outstandingArrears > .001 ? 'arrears_outstanding' : 'paid_to_date',
      outstandingArrears,
      walletGold: Math.max(0, Number(soldier.militaryWallet?.stock?.gold) || 0),
      reviewedPaymentEventIds: relatedPayEvents.map(fact => fact.eventId)
    }
  });
  rememberSocialFact(world, soldier.id, evaluation.eventId, { source: 'direct' });
  const completed = advanceSocialIntention(world, soldier.id, plan.intentionId, {
    progress: plan.steps.length, status: 'completed', blockers: [], evidenceIds: [evaluation.eventId],
    terminationReason: 'remuneration_evaluated'
  });
  return { plan: completed, evaluation };
}

export function payMilitarySalaries(world, day) {
  for (const person of world.people) {
    if (person.alive && person.role === 'soldier') paySoldier(world, person, day);
  }
}

export function buyMilitaryMeal(world, person, rationNeed = DAILY_FOOD_NEED) {
  if (person.role !== 'soldier' || person.campaignId != null || rationNeed <= .01) return 0;
  const kingdom = world.kingdoms.find(item => item.id === person.kingdomId);
  const market = kingdom?.market;
  const wallet = person.militaryWallet?.stock;
  const price = market?.prices?.food;
  if (!wallet || !market || !Number.isFinite(price) || price <= 0) return 0;
  const food = Math.min(rationNeed / FOOD_DAYS_PER_UNIT, (100 - person.foodReserve) / FOOD_DAYS_PER_UNIT,
    market.stock.food || 0, (wallet.gold || 0) / price);
  if (!(food > .01)) return 0;
  const goldPaid = transferResource(wallet, market.stock, 'gold', food * price);
  const foodPurchased = transferResource(market.stock, person, 'food', food, 'militaryFoodPurchased');
  if (!(foodPurchased > .01)) {
    transferResource(market.stock, wallet, 'gold', goldPaid);
    return 0;
  }
  market.transactions = (market.transactions || 0) + 1;
  const reserveAdded = addFoodReserve(person, foodPurchased * FOOD_DAYS_PER_UNIT, 'military-market-meal');
  const community = world.communities.find(item => item.id === kingdom.communityId);
  recordTrade(world, {
    kind: 'market',
    action: 'comprou refeição militar',
    participants: [{ personId: person.id, kingdomId: kingdom.id, delta: {
      gold: -goldPaid, foodReserveDays: reserveAdded
    } }],
    market: {
      ownerType: market.ownerType || 'kingdom-market',
      ownerId: market.ownerId ?? kingdom.id,
      delta: { food: -foodPurchased, gold: goldPaid }
    },
    assetsCreated: []
  }, [community, kingdom, market]);
  return reserveAdded;
}
