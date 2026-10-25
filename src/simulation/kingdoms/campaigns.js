import { towerDutyOrder, performTowerDuty } from './tower-archers.js';
import { clearMilitaryCommand } from './military-identity.js';
import { advanceTowerCapture } from './tower-capture.js';
import { initializeTowerHealth, campaignTower, attackTower, towerBattlePosition, destroyTowerInWorld } from './fortifications.js';
import { fightTacticalRound, updateMilitaryCommand, tacticalDestination, militaryMerit, selectHealingTarget, MILITARY_CLASSES, battlefieldOpponents } from './military.js';
import { frontierWorkOrder, performFrontierWork, prepareFrontierConflicts, FRONTIER_RECOVERY_DAYS } from './frontier-conflicts.js';
import { DAILY_FOOD_NEED, FOOD_RESERVE_PER_UNIT } from '../../config/ecosystem.js';
import { clamp, distance } from '../core/math.js';
import { rand } from '../core/random.js';
import { log } from '../core/events.js';
import { cellAt } from '../world/spatial.js';
import { moveOne, reachableAreaAround } from '../individuals/movement.js';
import { changePersonHealth, killPerson } from '../individuals/lifecycle.js';
import { communityFoodStock, spendInventory, spendResource, transferInventory, transferStoreResourceToAccount } from '../economy/inventories.js';
import { kingdomFoodDemand } from '../economy/food-policy.js';
import { kingdomRelation, recomputeKingdomTerritories } from './territories.js';
import {
  AI_DECISION_CONTRACT_VERSION, validateDecisionAction, validateDecisionResult
} from '../../ai/contracts.js';
import {
  createFormation, formationSlot, measureFormation, recordFormationBlockedMove,
  setFormationDestination, setFormationState, setFormationType
} from './formations.js';

const ACTIVE_STATES = new Set(['mobilizing', 'marching', 'engaged', 'withdrawing']);
const CAMPAIGN_RATION_DAYS = 18;
const CAMPAIGN_CIVILIAN_RESERVE_DAYS = 2;
const RESUPPLY_INTERVAL = 7;
const TARGET_RADIUS = 11;
const CEASEFIRE_DAYS = 30;
const FORCE_WAIT_TIMEOUT_DAYS = 180;
const CAMPAIGN_RETURN_STALL_DAYS = 4;
const GENERAL_REVIEW_INTERVAL = 12;
const GENERAL_URGENT_REVIEW_INTERVAL = 5;
const GENERAL_QUEUE_LIMIT = 8;
const FORMATION_FRONT_OCCUPANCY = .6;
const FORMATION_ROLE_ORDER = ['guerreiro', 'lanceiro', 'arqueiro', 'monge'];

function active(campaign) {
  return campaign && ACTIVE_STATES.has(campaign.status);
}

function campaignSide(campaign, kingdomId) {
  if (campaign.attacker.kingdomId === kingdomId) return campaign.attacker;
  if (campaign.defender.kingdomId === kingdomId) return campaign.defender;
  return null;
}

function livingSideTroops(world, side) {
  return side.troopIds.map(id => world.people.find(person => person.id === id && person.alive
    && person.role === 'soldier' && person.campaignId === side.campaignId)).filter(Boolean);
}

function kingdomById(world, id) {
  return world.kingdoms.find(kingdom => kingdom.id === id) || null;
}

function campaignRationBudget(world, kingdom, troopIds) {
  const troops = troopIds.map(id => world.people.find(person => person.id === id && person.alive)).filter(Boolean);
  const community = world.communities.find(item => item.id === kingdom.communityId && !item.dissolved);
  const civilianReserve = kingdomFoodDemand(world, kingdom).dailyFoodNeed * CAMPAIGN_CIVILIAN_RESERVE_DAYS;
  const communitySurplus = Math.max(0, communityFoodStock(community) - civilianReserve);
  const treasuryFood = Math.max(0, Number(kingdom.treasury?.stock?.food) || 0);
  const personalRations = troops.reduce((sum, person) => sum + Math.max(0, Number(person.foodReserve) || 0), 0);
  return personalRations + (treasuryFood + communitySurplus) * FOOD_RESERVE_PER_UNIT;
}

function homePosition(world, kingdomId) {
  const kingdom = kingdomById(world, kingdomId);
  const settlement = kingdom && world.settlements.find(item => item.kingdomId === kingdomId);
  const castle = settlement && world.structures.find(item => item.id === settlement.castleId);
  return castle ? { x: castle.x, y: castle.y } : kingdom ? { x: kingdom.x, y: kingdom.y } : null;
}

function refreshCampaignFormationSlots(formation, troops) {
  const width = formation.type === 'line' ? 7 : 3;
  const peopleById = new Map(troops.map(person => [person.id, person]));
  const slots = {};
  let depthOffset = 0;
  for (const militaryClass of [...FORMATION_ROLE_ORDER, null]) {
    const members = formation.memberIds.filter(id => {
      const person = peopleById.get(id);
      return person && (militaryClass == null
        ? !FORMATION_ROLE_ORDER.includes(person.militaryClass)
        : person.militaryClass === militaryClass);
    });
    const rowCount = Math.ceil(members.length / width);
    members.forEach((id, index) => {
      const row = Math.floor(index / width);
      const rowWidth = Math.min(width, members.length - row * width);
      slots[id] = { depth: depthOffset + row, lateral: index % width - (rowWidth - 1) / 2 };
    });
    depthOffset += rowCount;
  }
  formation.slotAssignments = slots;
  formation.worldSlots = null;
}

function campaignFormationGeometry(campaign, side) {
  const target = campaign.target;
  const origin = campaign.attacker.home || target;
  const dx = target.x - origin.x, dy = target.y - origin.y;
  const length = Math.hypot(dx, dy);
  const direction = length ? { x: dx / length, y: dy / length } : { x: 1, y: 0 };
  const sign = side.role === 'attacker' ? -1 : 1;
  const orientationSign = side.role === 'attacker' ? 1 : -1;
  const offset = 4;
  return {
    destination: { x: target.x + direction.x * offset * sign, y: target.y + direction.y * offset * sign },
    orientation: { x: direction.x * orientationSign, y: direction.y * orientationSign }
  };
}

function campaignFormationSlot(formation, memberId, destination, orientation = formation?.orientation) {
  if (formation?.worldSlots?.[memberId]) return formation.worldSlots[memberId];
  const slot = formation?.slotAssignments?.[memberId];
  if (!slot) return formationSlot(orientation ? { ...formation, orientation } : formation, memberId, destination);
  const spacing = formation.spacing || 2;
  const forward = orientation || { x: 1, y: 0 };
  const lateral = { x: -forward.y, y: forward.x };
  return {
    x: destination.x - forward.x * slot.depth * spacing + lateral.x * slot.lateral * spacing,
    y: destination.y - forward.y * slot.depth * spacing + lateral.y * slot.lateral * spacing
  };
}

function fitFormationToTerrain(world, campaign, side, troops, geometry) {
  if (!troops.length || !geometry) return;
  const formation = side.formation;
  const ground = reachableAreaAround(world, troops[0], campaign.target, TARGET_RADIUS);
  const available = new Map(ground.map(tile => [tile.i, tile]));
  const positions = {};
  for (const id of formation.memberIds) {
    const person = troops.find(p => p.id === id);
    const ideal = person?.militaryRank === 'general' && troops.length > 1
      ? { x: geometry.destination.x - geometry.orientation.x * 6, y: geometry.destination.y - geometry.orientation.y * 6 }
      : campaignFormationSlot(formation, id, geometry.destination, geometry.orientation);
    const tile = cellAt(world, ideal.x, ideal.y);
    if (tile && available.has(tile.i) && distance(ideal, campaign.target) <= TARGET_RADIUS) {
      positions[id] = ideal; available.delete(tile.i);
      continue;
    }
    let best = null;
    for (const candidate of available.values()) {
      if (!best || distance(candidate, ideal) < distance(best, ideal)) best = candidate;
    }
    if (best) { positions[id] = { x: best.x, y: best.y }; available.delete(best.i); }
  }
  formation.worldSlots = positions;
}

function addKingdomIntel(kingdom, report) {
  if (!kingdom) return;
  kingdom.militaryIntel ||= [];
  kingdom.militaryIntel.push(report);
  if (kingdom.militaryIntel.length > 16) kingdom.militaryIntel.shift();
}

function campaignSupplyLedger() {
  return {
    deployment: { food: 0, wood: 0, gold: 0 },
    resupply: { food: 0, wood: 0, gold: 0 },
    resupplySources: { food: { treasury: 0, community: 0 } },
    rationConsumptionFood: 0,
    personalReserveRationPoints: 0,
    battleEquipmentLoss: { wood: 0, gold: 0 },
    returned: { food: 0, wood: 0, gold: 0 }
  };
}

function noteCampaign(kingdom, campaign, side, day) {
  if (!kingdom) return;
  kingdom.strategy ||= { history: [] };
  kingdom.strategy.history ||= [];
  const evidence = campaign.evidence[side.role];
  const entry = {
    day, goal: side.role === 'attacker' ? 'retaliate-for-border-incident' : 'defend-border',
    action: 'campaign', reason: campaign.cause, evidence
  };
  kingdom.strategy.history.push(entry);
  if (kingdom.strategy.history.length > 12) kingdom.strategy.history.shift();
  kingdom.strategy.lastOutcome = { status: 'planned', day, goal: entry.goal, reason: campaign.cause, evidence };
}

function fundSide(world, campaignId, kingdomId, role, troopIds) {
  const kingdom = kingdomById(world, kingdomId);
  const side = {
    campaignId,
    kingdomId,
    role,
    mobilizedTroopCount: troopIds.length,
    orderVersion: 0,
    aiOrder: null,
    lastGeneralRequestDay: null,
    nextGeneralReviewDay: null,
    troopIds: troopIds.slice(),
    supply: { ownerType: 'field-supply', ownerId: campaignId, stock: { food: 0, wood: 0, gold: 0 } },
    morale: 82,
    losses: 0,
    battles: 0,
    supplyLedger: campaignSupplyLedger(),
    supplyShortageDays: 0,
    stallDays: 0,
    lastResupplyDay: -RESUPPLY_INTERVAL
  };
  if (!kingdom) return side;
  const count = troopIds.length;
  side.supplyLedger.deployment.food = transferInventory(kingdom.treasury, side.supply, 'food',
    count * CAMPAIGN_RATION_DAYS / FOOD_RESERVE_PER_UNIT, 'campaign-deployment');
  side.supplyLedger.deployment.wood = transferInventory(kingdom.treasury, side.supply, 'wood', count * 2, 'campaign-deployment');
  side.supplyLedger.deployment.gold = transferInventory(kingdom.treasury, side.supply, 'gold', count, 'campaign-deployment');
  side.lastResupplyDay = -RESUPPLY_INTERVAL;
  return side;
}

function createCampaign(world, war, day) {
  const objective = war.evidence && war.evidence.location;
  if (!objective || !Number.isFinite(objective.x) || !Number.isFinite(objective.y)) {
    war.campaignStatus = 'blocked';
    war.campaignBlockReason = 'A mobilização precisa de um local observado do incidente.';
    return null;
  }
  const attackerId = Number.isInteger(war.attackerId) ? war.attackerId : war.a;
  const defenderId = Number.isInteger(war.defenderId) ? war.defenderId : war.b;
  const attackerKingdom = kingdomById(world, attackerId), defenderKingdom = kingdomById(world, defenderId);
  if (!attackerKingdom || !defenderKingdom) return null;
  const attackerTroops = world.people.filter(person => person.alive && person.role === 'soldier' && person.kingdomId === attackerId
    && person.campaignId == null && person.towerDutyId == null && !person.towerRecovering).map(person => person.id);
  const defenderTroops = world.people.filter(person => person.alive && person.role === 'soldier' && person.kingdomId === defenderId
    && person.campaignId == null && !person.towerRecovering
    && (person.towerDutyId == null || distance(person, objective) <= 18)).map(person => person.id);
  if (!attackerTroops.length) {
    if (war.campaignStatus !== 'awaiting-force') {
      war.campaignStatus = 'awaiting-force';
      war.awaitingForceSinceDay = day;
      delete war.awaitingSuppliesSinceDay;
      war.campaignBlockReason = 'O reino atacante não tem soldados disponíveis para mobilização.';
      attackerKingdom.militaryIntel ||= [];
      const pending = attackerKingdom.militaryIntel.find(item => item.kind === 'force-requested'
        && item.warId === war.id && item.status === 'pending');
      if (!pending) addKingdomIntel(attackerKingdom, {
        day, kind: 'force-requested', status: 'pending', warId: war.id, opponentId: defenderId,
        cause: war.cause, source: 'campanha observada aguardando efetivo', location: { ...objective }
      });
      log(world, attackerKingdom.name + ' adiou a campanha: não há soldados disponíveis para mobilização; '
        + 'o conflito continua registrado até reunir uma força.', day);
    } else if (!Number.isFinite(war.awaitingForceSinceDay)) war.awaitingForceSinceDay = day;
    return null;
  }
  const requiredRations = attackerTroops.length * DAILY_FOOD_NEED * CAMPAIGN_RATION_DAYS;
  const availableRations = campaignRationBudget(world, attackerKingdom, attackerTroops);
  if (!war.forceMobilization && availableRations + .001 < requiredRations) {
    if (war.campaignStatus !== 'awaiting-supplies') {
      war.campaignStatus = 'awaiting-supplies';
      war.awaitingSuppliesSinceDay = day;
      delete war.awaitingForceSinceDay;
      war.campaignBlockReason = 'A mobilização espera rações suficientes para os primeiros ' + CAMPAIGN_RATION_DAYS + ' dias.';
      log(world, attackerKingdom.name + ' adiou a campanha: as reservas e o alimento acessível não cobrem os primeiros '
        + CAMPAIGN_RATION_DAYS + ' dias de ração; os soldados permaneceram nos postos e nenhum estoque foi debitado.', day);
    }
    return null;
  }
  const id = world.nextId++;
  const campaign = {
    id,
    warId: war.id,
    attackerId,
    defenderId,
    cause: String(war.cause || 'incidente de fronteira observado'),
    evidence: war.evidence,
    target: { x: objective.x, y: objective.y, ownerId: defenderId },
    startedDay: day,
    readyDay: day + 2,
    status: 'mobilizing',
    outcome: null,
    outcomeReason: null,
    battleCount: 0,
    undefendedDays: 0,
    lastBattleDay: -99,
    history: [],
    attacker: fundSide(world, id, attackerId, 'attacker', attackerTroops),
    defender: fundSide(world, id, defenderId, 'defender', defenderTroops)
  };
  campaign.attacker.home = homePosition(world, attackerId);
  campaign.defender.home = homePosition(world, defenderId);
  for (const side of [campaign.attacker, campaign.defender]) {
    side.formation = createFormation({
      campaignId: id, kingdomId: side.kingdomId, role: side.role, memberIds: side.troopIds,
      origin: side.home || { x: campaign.target.x, y: campaign.target.y },
      destination: campaign.target, day
    });
    refreshCampaignFormationSlots(side.formation, side.troopIds
      .map(id => world.people.find(person => person.id === id)).filter(Boolean));
  }
  world.campaigns ||= [];
  world.campaigns.push(campaign);
  for (const request of attackerKingdom.militaryIntel || []) {
    if (request.kind === 'force-requested' && request.warId === war.id && request.status === 'pending') {
      request.status = 'mobilized';
      request.campaignId = id;
      request.resolvedDay = day;
    }
  }
  for (const personId of attackerTroops) {
    const recruitment = (attackerKingdom.militaryRecruitments || []).find(item => item.personId === personId
      && item.status === 'trained');
    if (recruitment) {
      recruitment.status = 'mobilized';
      recruitment.campaignId = id;
      recruitment.mobilizedDay = day;
    }
  }
  war.campaignId = id;
  war.campaignStatus = campaign.status;
  delete war.awaitingForceSinceDay;
  delete war.awaitingSuppliesSinceDay;
  delete war.campaignBlockReason;
  for (const side of [campaign.attacker, campaign.defender]) {
    const kingdom = kingdomById(world, side.kingdomId);
    for (const id of side.troopIds) {
      const soldier = world.people.find(person => person.id === id);
      if (soldier) {
        soldier.campaignId = campaign.id;
        soldier.campaignReturnedHome = false;
        soldier.restingStructureId = null;
        soldier.militaryRestTargetId = null;
        soldier.campaignReturnStallDays = 0;
      }
    }
    noteCampaign(kingdom, campaign, side, day);
    addKingdomIntel(kingdom, {
      day, reportDay: day, kind: 'campaign-mobilized',
      opponentId: side.role === 'attacker' ? defenderId : attackerId,
      cause: campaign.cause,
      source: campaign.evidence[side.role]?.source || 'incidente de fronteira registrado',
      location: { ...campaign.target }, campaignId: campaign.id
    });
  }
  const event = {
    day, type: 'campaign-mobilized', campaignId: id, warId: war.id,
    attackerId, defenderId, target: { ...campaign.target }, cause: campaign.cause
  };
  campaign.history.push(event);
  log(world, attackerKingdom.name + ' mobilizou ' + attackerTroops.length + ' soldados contra ' + defenderKingdom.name
    + ' após ' + campaign.cause + '. O local conhecido fica em ' + objective.x + ',' + objective.y
    + '; os suprimentos foram debitados dos tesouros.');
  for (const side of [campaign.attacker, campaign.defender]) {
    side.formation.leaderId = kingdomById(world, side.kingdomId).militaryCommand?.generalIds.find(id => side.troopIds.includes(id)) ?? side.formation.leaderId;
  }
  return campaign;
}

export function prepareKingdomCampaigns(world, day = world.day + 1) {
  updateMilitaryCommand(world, day);
  prepareFrontierConflicts(world, day);
  if (day > 45) escalateRepeatedResourceDisputes(world, day);
  for (const war of world.wars || []) {
    if (war.status !== 'active') continue;
    const relation = world.kingdomRelations[Math.min(war.a, war.b) + ':' + Math.max(war.a, war.b)];
    if (!relation || relation.status !== 'at-war' || war.campaignId || war.campaignStatus === 'blocked') continue;
    createCampaign(world, war, day);
  }
  settleWarsAwaitingSupport(world, day);

  for (const campaign of world.campaigns || []) {
    if (!active(campaign)) continue;
    if (campaign.status !== 'withdrawing') {
      for (const side of [campaign.attacker, campaign.defender]) resupplySide(world, campaign, side, day);
    }
    if (campaign.status === 'withdrawing') {
      for (const side of [campaign.attacker, campaign.defender]) {
        const fieldRationPoints = Math.max(0, Number(side.supply.stock.food) || 0) * FOOD_RESERVE_PER_UNIT;
        for (const id of side.troopIds.slice()) {
          const person = world.people.find(item => item.id === id && item.alive);
          if (!person || person.campaignReturnedHome || !side.home || distance(person, side.home) <= 2.2
              || fieldRationPoints + .001 >= DAILY_FOOD_NEED
              || (Number(person.foodReserve) || 0) > DAILY_FOOD_NEED * 2) continue;
          const remainingReserve = Number((person.foodReserve || 0).toFixed(2));
          const kingdom = releaseCampaignTroop(world, side, person, true);
          side.morale = Math.max(0, side.morale - 9);
          recordCampaignEvent(world, campaign, day, 'desertion', person.name + ' deixou a retirada de '
            + (kingdom && kingdom.name || 'seu reino') + ' antes de esgotar a reserva: a campanha não tinha '
            + 'uma ração diária disponível; foi liberado para buscar alimento.',
          { kingdomId: side.kingdomId, personId: person.id, reason: 'withdrawal-out-of-rations',
            remainingReserve, fieldRationPoints: Number(fieldRationPoints.toFixed(2)) });
        }
      }
    }
    if (day >= campaign.readyDay && campaign.status === 'mobilizing') {
      campaign.status = 'marching';
      recordCampaignEvent(world, campaign, day, 'marching', 'A mobilização terminou; os soldados avançam para o local conhecido do incidente.');
    }
    for (const side of [campaign.attacker, campaign.defender]) updateCampaignFormation(world, campaign, side, day);
  }
  queueCampaignGeneralAiRequests(world, day);
}

function settleWarsAwaitingSupport(world, day) {
  for (const war of world.wars || []) {
    const awaitingSupplies = war.campaignStatus === 'awaiting-supplies';
    const waitingSinceDay = awaitingSupplies ? war.awaitingSuppliesSinceDay : war.awaitingForceSinceDay;
    if (war.status !== 'active' || war.campaignId || !['awaiting-force', 'awaiting-supplies'].includes(war.campaignStatus)
        || !Number.isFinite(waitingSinceDay) || day - waitingSinceDay < FORCE_WAIT_TIMEOUT_DAYS) continue;
    const relationKey = Math.min(war.a, war.b) + ':' + Math.max(war.a, war.b);
    const relation = world.kingdomRelations[relationKey];
    if (!relation || relation.status !== 'at-war') continue;

    const elapsedDays = day - waitingSinceDay;
    const reason = awaitingSupplies
      ? 'Os reinos encerraram a guerra sem mudança territorial após ' + elapsedDays
        + ' dias sem ração suficiente para mobilizar uma campanha.'
      : 'Os reinos encerraram a guerra sem mudança territorial após ' + elapsedDays
        + ' dias sem efetivo disponível para mobilizar uma campanha.';
    relation.status = 'peace';
    relation.tension = Math.max(0, (relation.tension || 0) - .2);
    relation.resolvedDay = day;
    relation.ceasefireUntilDay = day + CEASEFIRE_DAYS;
    relation.nextTowerRaidDay = Math.max(relation.nextTowerRaidDay || 0, day + FRONTIER_RECOVERY_DAYS);
    relation.lastOutcome = reason;
    war.status = 'resolved';
    war.resolvedDay = day;
    war.winnerId = null;
    war.campaignStatus = awaitingSupplies ? 'settled-without-supplies' : 'settled-without-force';
    war.resolutionReason = reason;

    for (const kingdomId of [war.attackerId ?? war.a, war.defenderId ?? war.b]) {
      const kingdom = kingdomById(world, kingdomId);
      if (!kingdom) continue;
      for (const intel of kingdom.militaryIntel || []) {
        if (intel.kind === 'force-requested' && intel.warId === war.id && intel.status === 'pending') {
          intel.status = 'expired';
          intel.resolvedDay = day;
          intel.reason = reason;
        }
      }
    }

    world.treaties ||= [];
    world.treaties.push({
      id: world.nextId++, warId: war.id, campaignId: null, day,
      a: war.a, b: war.b, winnerId: null, kind: 'armistice-status-quo',
      terms: { territory: 'status quo', relation: 'peace' }, reason
    });
    if (world.treaties.length > 40) world.treaties.shift();
    const attacker = kingdomById(world, war.attackerId ?? war.a);
    const defender = kingdomById(world, war.defenderId ?? war.b);
    const message = (attacker?.name || 'Um reino') + ' e ' + (defender?.name || 'um reino rival')
      + ' firmaram um armistício sem campanha: ' + reason;
    for (const kingdom of [attacker, defender]) {
      const community = kingdom && world.communities.find(item => item.id === kingdom.communityId && !item.dissolved);
      if (community) community.history.push(message);
    }
    log(world, message, day);
  }
}

function escalateRepeatedResourceDisputes(world, day) {
  for (let left = 0; left < (world.kingdoms || []).length; left++) for (let right = left + 1; right < world.kingdoms.length; right++) {
    const a = world.kingdoms[left], b = world.kingdoms[right];
    const relation = kingdomRelation(world, a.id, b.id);
    if (relation.status === 'at-war' || day <= (relation.ceasefireUntilDay ?? -1)
        || relation.tension < .72 || (relation.resourceDisputes || 0) < 3) continue;
    const evidenceFor = (kingdom, opponentId) => (kingdom.militaryIntel || []).filter(item => item.kind === 'resource-dispute'
      && item.opponentId === opponentId && item.day > (relation.resolvedDay ?? -1)
      && (item.reportDay ?? item.day) <= day && day - item.day <= 180);
    const aReports = evidenceFor(a, b.id), bReports = evidenceFor(b, a.id);
    const aLosses = aReports.filter(item => item.outcome === 'lost');
    const bLosses = bReports.filter(item => item.outcome === 'lost');
    if (aReports.length + bReports.length < 3 || Math.max(aLosses.length, bLosses.length) < 2) continue;
    const attacker = aLosses.length >= bLosses.length ? a : b;
    const defender = attacker.id === a.id ? b : a;
    const evidenceList = attacker.id === a.id ? aLosses : bLosses;
    const lastKnown = evidenceList[evidenceList.length - 1];
    if (!lastKnown || !lastKnown.location) continue;
    const id = world.nextId++;
    const cause = attacker.name + ' retaliou após perder repetidas disputas por uma área de ' + lastKnown.resourceKind
      + ' perto de ' + lastKnown.location.x + ',' + lastKnown.location.y + '.';
    const evidence = {
      location: { ...lastKnown.location }, incidentDay: lastKnown.day,
      source: 'relatos de três ou mais disputas observadas nos últimos 180 dias',
      attacker: { source: lastKnown.source, location: { ...lastKnown.location }, certainty: 'posição do último confronto conhecido' },
      defender: { source: 'relatos locais de disputa e defesa de recurso', location: { ...lastKnown.location }, certainty: 'área conhecida' }
    };
    relation.status = 'at-war'; relation.startedDay = day; relation.warId = id; relation.warCause = cause;
    world.wars.push({ id, a: relation.a, b: relation.b, attackerId: attacker.id, defenderId: defender.id,
      startedDay: day, cause, evidence, status: 'active' });
    for (const kingdom of [attacker, defender]) {
      kingdom.militaryIntel ||= [];
      kingdom.militaryIntel.push({ day, kind: 'war-declared', opponentId: kingdom.id === attacker.id ? defender.id : attacker.id,
        cause, source: evidence.source, location: { ...lastKnown.location } });
      if (kingdom.militaryIntel.length > 16) kingdom.militaryIntel.shift();
    }
    log(world, cause + ' O motivo e a última posição estão registrados para ambos os reinos.');
  }
}

function resupplySide(world, campaign, side, day) {
  if (day - side.lastResupplyDay < RESUPPLY_INTERVAL) return;
  const troops = livingSideTroops(world, side);
  if (!troops.length || !troops.some(person => cellAt(world, Math.round(person.x), Math.round(person.y))?.kingdomId === side.kingdomId)) return;
  const kingdom = kingdomById(world, side.kingdomId);
  if (!kingdom) return;
  side.supplyLedger ||= campaignSupplyLedger();
  side.supplyLedger.resupply ||= { food: 0, wood: 0, gold: 0 };
  side.supplyLedger.resupplySources ||= {};
  side.supplyLedger.resupplySources.food ||= { treasury: 0, community: 0 };
  const foodTarget = troops.length * CAMPAIGN_RATION_DAYS / FOOD_RESERVE_PER_UNIT;
  const before = side.supply.stock.food;
  const foodGap = Math.max(0, foodTarget - before);
  const treasuryFood = transferInventory(kingdom.treasury, side.supply, 'food', foodGap, 'campaign-resupply');
  side.supplyLedger.resupply.food += treasuryFood;
  side.supplyLedger.resupplySources.food.treasury += treasuryFood;
  let communityFood = 0;
  const civilianReserveDays = CAMPAIGN_CIVILIAN_RESERVE_DAYS;
  const community = world.communities.find(item => item.id === kingdom.communityId && !item.dissolved);
  if (community) {
    const civilianReserve = kingdomFoodDemand(world, kingdom).dailyFoodNeed * civilianReserveDays;
    const protectedSurplus = Math.max(0, communityFoodStock(community) - civilianReserve);
    communityFood = transferStoreResourceToAccount(community, side.supply, 'food',
      Math.min(Math.max(0, foodGap - treasuryFood), protectedSurplus), 'campaign-resupply');
    side.supplyLedger.resupply.food += communityFood;
    side.supplyLedger.resupplySources.food.community += communityFood;
  }
  side.supplyLedger.resupply.wood += transferInventory(kingdom.treasury, side.supply, 'wood',
    Math.max(0, troops.length * 2 - side.supply.stock.wood), 'campaign-resupply');
  side.supplyLedger.resupply.gold += transferInventory(kingdom.treasury, side.supply, 'gold',
    Math.max(0, troops.length - side.supply.stock.gold), 'campaign-resupply');
  side.lastResupplyDay = day;
  const received = side.supply.stock.food - before;
  if (received > .01) recordCampaignEvent(world, campaign, day, 'resupply', kingdom.name + ' entregou '
    + received.toFixed(1) + ' unidades de alimento à linha de abastecimento.', {
      sources: { treasuryFood, communityFood, civilianReserveDays }
    });
}

function recordCampaignEvent(world, campaign, day, type, text, details = {}) {
  const event = { day, type, text, ...details };
  campaign.history.push(event);
  if (campaign.history.length > 24) campaign.history.shift();
  log(world, text);
  const war = (world.wars || []).find(item => item.id === campaign.warId);
  if (war) war.campaignStatus = campaign.status;
}

function campaignAssignmentFor(world, person) {
  if (!person || person.role !== 'soldier' || !person.alive) return null;
  const campaign = (world.campaigns || []).find(item => active(item)
    && [item.attacker, item.defender].some(side => side.troopIds.includes(person.id)));
  if (!campaign) return null;
  const side = campaignSide(campaign, person.kingdomId);
  return side ? { campaign, side } : null;
}

export function campaignOrderFor(world, person) {
  const towerOrder = towerDutyOrder(world, person);
  if (towerOrder) return towerOrder;
  const assignment = campaignAssignmentFor(world, person);
  if (!assignment) {
    if (person.role === 'soldier' && person.militaryReturningHome) {
      const home = homePosition(world, person.kingdomId);
      if (home && distance(person, home) > 3) return { returning: true, target: home, withdrawing: true };
      person.militaryReturningHome = false;
    }
    if (person.role === 'soldier' && person.militaryRank === 'general') {
      const center = world.structures.find(s => s.id === person.militaryCenterId && s.complete && s.destroyedDay == null);
      return { fieldCommandPost: true, target: center || kingdomById(world, person.kingdomId) || person, withdrawing: false };
    }
    return frontierWorkOrder(world, person);
  }
  const { campaign, side } = assignment;
  if (campaign.status !== 'withdrawing' && side.aiOrder?.action === 'hold_position') {
    return { campaign, side, target: null, withdrawing: false, holding: true };
  }
  const withdrawing = campaign.status === 'withdrawing';
  const geometry = withdrawing ? null : campaignFormationGeometry(campaign, side);
  const destination = withdrawing ? side.home : geometry.destination;
  if (!destination) return null;
  if (withdrawing && (person.campaignReturnedHome || side.home && distance(person, side.home) <= 2.2)) {
    person.campaignReturnedHome = true;
    return null;
  }
  const tower = campaignTower(world, campaign);
  const opponentSide = side.role === 'attacker' ? campaign.defender : campaign.attacker;
  const towerPosition = !withdrawing && tower && tower.destroyedDay == null
    ? towerBattlePosition(world, person, tower, side, livingSideTroops(world, opponentSide)) : null;
  const individualTarget = tacticalDestination(world, person, destination);
  const needsIndividualTarget = person.tacticalRecovering;
  const opponents = battlefieldOpponents(world, campaign, person.kingdomId);
  const atFront = distance(person, campaign.target) <= TARGET_RADIUS + 4;
  const deployed = !withdrawing && campaign.status !== 'mobilizing' && (side.formation?.deployed || atFront);
  // Nearby threats take priority over parade slots, even if reinforcements
  // or the opposing formation have not finished deploying.
  const enemy = deployed && ['guerreiro', 'lanceiro'].includes(person.militaryClass)
    ? opponents.filter(enemy => distance(person, enemy) <= 12)
      .sort((a, b) => Number(b.id === side.fieldCommand?.targetEnemyId) - Number(a.id === side.fieldCommand?.targetEnemyId)
        || distance(person, a) - distance(person, b) || a.id - b.id)[0] : null;
  const patient = deployed && person.militaryClass === 'monge'
    ? selectHealingTarget(person, livingSideTroops(world, side), 12) : null;
  const formation = withdrawing && side.formation ? { ...side.formation, worldSlots: null } : side.formation;
  const engagingEnemy = !needsIndividualTarget && enemy && (!tower || distance(person, enemy) <= 6);
  let target = formation ? campaignFormationSlot(formation, person.id, destination, geometry?.orientation)
    : towerPosition || individualTarget;
  if (patient) target = distance(person, patient) > 5 ? { x: patient.x, y: patient.y } : { x: person.x, y: person.y };
  if (deployed && towerPosition) target = towerPosition;
  if (engagingEnemy) target = { x: enemy.x, y: enemy.y };
  if (needsIndividualTarget) target = individualTarget;
  const commanding = person.militaryRank === 'general' && side.troopIds.length > 1 && !withdrawing && !needsIndividualTarget;
  if (commanding) target = formation?.worldSlots?.[person.id] || { x: geometry.destination.x - geometry.orientation.x * 6,
    y: geometry.destination.y - geometry.orientation.y * 6 };
  const tactical = !needsIndividualTarget && deployed && (!!enemy || !!towerPosition || !!patient);
  const engagementRange = engagingEnemy ? MILITARY_CLASSES[person.militaryClass].range - .1 : null;
  return { campaign, side, target, destination, withdrawing, tactical: !commanding && tactical,
    engagementRange: commanding ? null : engagementRange, commanding, formation: side.formation || null };
}

export function performCampaignOrder(world, person, order) {
  if (!order) return false;
  if (order.fieldCommandPost) {
    if (distance(person, order.target) > 3) moveOne(world, person, order.target, false, { arrivalRadius: 3 });
    person.state = 'coordenando patrulhas em campo';
    person.lastLesson = 'O general acompanha os relatórios da fronteira a partir do posto de comando em campo.';
    return true;
  }
  if (order.towerDuty) return performTowerDuty(world, person, order);
  if (order.returning) {
    moveOne(world, person, order.target, false);
    person.state = 'retornando à guarnição para se recuperar';
    return true;
  }
  if (order.construction) return performFrontierWork(world, person, order);
  const { campaign, side, target, withdrawing, holding, formation, tactical, engagementRange, commanding } = order;
  if (holding) {
    person.state = side.role === 'defender' ? 'mantendo posição defensiva' : 'mantendo posição da campanha';
    person.lastLesson = 'O general ordenou manter a posição; a guarnição não avança até receber nova ordem.';
    return true;
  }
  person.campaignMoveAttempted = true;
  if (campaign.status === 'mobilizing') {
    person.state = 'reunindo suprimentos para a campanha';
    person.lastLesson = 'A guarnição foi mobilizada após um incidente de fronteira registrado; suprimentos foram debitados do tesouro.';
    return true;
  }
  if (distance(person, target) <= (engagementRange || 1.25)) {
    person.state = commanding ? 'comandando tropas em campo' : engagementRange ? 'sustentando a linha de combate'
      : withdrawing ? 'retornando da campanha' : side.role === 'defender' ? 'defendendo a área disputada' : 'ocupando a área disputada';
    person.lastLesson = withdrawing
      ? 'A campanha terminou; a tropa retorna ao posto para reorganizar e encerrar o abastecimento de campo.'
      : 'A tropa chegou ao objetivo conhecido e tenta mantê-lo; o controle dependerá da defesa e dos suprimentos.';
    person.campaignMoveSucceeded = true;
    return true;
  }
  let moved = moveOne(world, person, cellAt(world, target.x, target.y), false,
    engagementRange ? { arrivalRadius: engagementRange } : null);
  // A formation slot may fall on a tree, cliff, fence or occupied tile.
  // Seek a reachable nearby position instead of retrying that exact slot forever.
  if (!moved && !withdrawing) {
    const radius = engagementRange || (tactical ? 1.5 : 3);
    if (distance(person, target) <= radius) {
      person.campaignMoveSucceeded = true;
      person.state = 'mantendo posição acessível na frente';
      return true;
    }
    moved = moveOne(world, person, target, false, { arrivalRadius: radius });
    if (moved) person.campaignAdjustedPosition = { x: target.x, y: target.y, radius, day: world.day };
  }
  if (!moved) recordFormationBlockedMove(formation);
  person.campaignMoveSucceeded = !!moved;
  person.state = moved ? commanding ? 'deslocando posto de comando em campo' : withdrawing ? 'retornando da campanha' : 'marchando para a área disputada' : 'rota de campanha bloqueada';
  person.lastLesson = moved
    ? withdrawing ? 'Retirar-se consome tempo e ração, mas devolve os soldados ao posto.'
      : 'A marcha segue o local do incidente conhecido; distância e abastecimento limitam a campanha.'
    : 'A rota ao local conhecido está bloqueada pelo terreno; a campanha pode falhar se não houver caminho.';
  return moved;
}

function campaignGeneralState(world) {
  if (!world.campaignGeneralAi) world.campaignGeneralAi = { requests: [], pendingBySide: {}, nextRequestSequence: 1, events: [] };
  const state = world.campaignGeneralAi;
  state.requests ||= [];
  state.pendingBySide ||= {};
  state.nextRequestSequence ||= 1;
  state.events ||= [];
  return state;
}

function recordFormationTransition(world, campaign, side, changed, description, day = world.day) {
  if (!changed) return;
  const formation = side.formation;
  recordCampaignEvent(world, campaign, day, 'formation', description, {
    kingdomId: side.kingdomId, formationId: formation?.id || null,
    formationType: formation?.type || null, formationState: formation?.state || null,
    formationVersion: formation?.orderVersion || 0
  });
}

function openFormationFront(world, target) {
  const tile = cellAt(world, target.x, target.y);
  if (!tile || tile.terrain !== 'land') return false;
  const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]]
    .map(([dx, dy]) => cellAt(world, target.x + dx, target.y + dy));
  return neighbors.filter(next => next?.terrain === 'land'
    && Math.abs((next.elevationLevel || 0) - (tile.elevationLevel || 0)) <= 1).length >= 3;
}

export function updateFieldCommand(world, campaign, side, day) {
  const troops = livingSideTroops(world, side);
  const leader = troops.filter(p => p.militaryRank === 'general' && p.health >= 60
    && !p.tacticalRecovering && p.militaryRestTargetId == null && p.restingStructureId == null)
    .sort((a, b) => militaryMerit(b) - militaryMerit(a) || a.id - b.id)[0];
  if (!leader || ['withdrawing', 'complete'].includes(campaign.status)) {
    side.fieldCommand = null;
    for (const p of troops) p.fieldCommand = null;
    return null;
  }
  const opponents = battlefieldOpponents(world, campaign, side.kingdomId);
  const observed = opponents.filter(enemy => distance(enemy, campaign.target) <= TARGET_RADIUS + 4
    && troops.some(p => p.restingStructureId == null && distance(p, enemy) <= 12));
  const priority = observed.sort((a, b) => Number(b.attackingStructureId === campaign.evidence?.structureId)
    - Number(a.attackingStructureId === campaign.evidence?.structureId)
    || distance(a, campaign.target) - distance(b, campaign.target) || a.id - b.id)[0];
  const atFront = troops.some(p => distance(p, campaign.target) <= TARGET_RADIUS);
  const formationType = atFront && troops.length > 1 && openFormationFront(world, campaign.target) ? 'line' : 'column';
  const action = side.aiOrder?.action === 'hold_position' ? 'hold_position' : priority ? 'engage' : side.role === 'attacker' ? 'advance' : 'defend';
  const reason = action === 'hold_position' ? 'Manter a posição por ordem do comando superior.'
    : priority ? 'Concentrar o combate na ameaça observada junto ao objetivo.'
      : side.role === 'attacker' ? 'Avançar sobre o objetivo da campanha com a tropa organizada.' : 'Proteger o objetivo e interceptar o avanço inimigo.';
  const command = { issuerId: leader.id, campaignId: campaign.id, day, action, formationType,
    target: { ...campaign.target }, targetStructureId: campaign.evidence?.structureId ?? null,
    targetEnemyId: priority?.id ?? null, reason };
  const previous = side.fieldCommand;
  if (!previous || previous.issuerId !== command.issuerId || previous.action !== action
    || previous.formationType !== formationType || previous.targetEnemyId !== command.targetEnemyId) {
    recordCampaignEvent(world, campaign, day, 'field-command', leader.name + ': ' + reason
      + ' Movimento em ' + (formationType === 'line' ? 'linha' : 'coluna') + '.', { kingdomId: side.kingdomId, ...command });
  }
  side.fieldCommand = command;
  for (const p of troops) p.fieldCommand = command;
  return command;
}

function updateCampaignFormation(world, campaign, side, day) {
  updateFieldCommand(world, campaign, side, day);
  if (!side.formation) {
    side.formation = createFormation({ campaignId: campaign.id, kingdomId: side.kingdomId, role: side.role,
      memberIds: side.troopIds, origin: side.home || campaign.target, destination: campaign.target, day });
  }
  const formation = side.formation;
  const troops = livingSideTroops(world, side);
  const livingIds = troops.map(person => person.id);
  if (formation.leaderId && !livingIds.includes(formation.leaderId)) {
    const previousLeaderId = formation.leaderId;
    formation.leaderId = troops.slice().sort((a, b) => militaryMerit(b) - militaryMerit(a) || a.id - b.id)[0]?.id ?? null;
    formation.orderVersion = (formation.orderVersion || 0) + 1;
    formation.transitions ||= [];
    formation.transitions.push({ day, from: previousLeaderId, to: formation.leaderId,
      reason: 'substituição após baixa do líder' });
    if (formation.transitions.length > 20) formation.transitions.shift();
    recordCampaignEvent(world, campaign, day, 'formation', formation.leaderId
      ? 'O líder da formação caiu; o integrante sobrevivente ' + formation.leaderId + ' assumiu a liderança.'
      : 'A formação ficou sem integrantes vivos após a baixa do líder.', {
      kingdomId: side.kingdomId, formationId: formation.id, previousLeaderId,
      leaderId: formation.leaderId, formationVersion: formation.orderVersion
    });
  }
  if (formation.memberIds.join(',') !== livingIds.join(',')) {
    formation.memberIds = livingIds;
    formation.orderVersion = (formation.orderVersion || 0) + 1;
    formation.transitions ||= [];
    formation.transitions.push({ day, from: 'membership', to: 'reorganized', reason: 'efetivo atualizado' });
    if (formation.transitions.length > 20) formation.transitions.shift();
    recordFormationTransition(world, campaign, side, true, 'A formação reorganizou as posições após uma mudança no efetivo.', day);
  }
  const withdrawing = campaign.status === 'withdrawing';
  if (withdrawing) formation.deployed = false;
  const geometry = withdrawing ? null : campaignFormationGeometry(campaign, side);
  const destination = withdrawing ? side.home : geometry.destination;
  if (destination) setFormationDestination(formation, destination);
  if (geometry) formation.orientation = geometry.orientation;
  const activeTroops = troops.filter(person => !person.tacticalRecovering && person.militaryRestTargetId == null);
  const atFront = activeTroops.some(person => distance(person, campaign.target) <= TARGET_RADIUS);
  if (atFront || side.fieldCommand) {
    const type = side.fieldCommand?.formationType || (openFormationFront(world, campaign.target) && troops.length > 1 ? 'line' : 'column');
    recordFormationTransition(world, campaign, side,
      setFormationType(formation, type, day, type === 'line' ? 'frente aberta observada' : 'passagem ou terreno restringe a frente'),
      type === 'line' ? 'A formação abriu em linha na frente livre.' : 'A formação fechou em coluna para atravessar a frente estreita.', day);
  }
  refreshCampaignFormationSlots(formation, troops);
  if (!withdrawing) fitFormationToTerrain(world, campaign, side, troops, geometry);
  measureFormation(formation, activeTroops, day, destination || campaign.target, withdrawing ? formationSlot
    : (_formation, id, goal) => campaignOrderFor(world, activeTroops.find(person => person.id === id))?.target
      || tacticalDestination(world, activeTroops.find(person => person.id === id), goal));
  // Deployment measures the force at the objective. Local contact can begin
  // before the rest of the formation arrives.
  if (!withdrawing && campaign.status !== 'mobilizing' && atFront
      && campaignFormationReady(campaign, side, activeTroops)) formation.deployed = true;
  let nextState = 'marching', reason = 'ordem de marcha ativa';
  if (withdrawing) { nextState = 'retreating'; reason = 'retirada após armistício'; }
  else if (campaign.status === 'mobilizing') { nextState = 'forming'; reason = 'reunindo integrantes e suprimentos'; }
  else if (side.aiOrder?.action === 'hold_position') { nextState = 'maintaining'; reason = 'ordem autorizada de manter posição'; }
  else if (atFront && campaignFormationReady(campaign, side, activeTroops)) {
    nextState = side.role === 'attacker' ? 'attacking' : 'maintaining';
    reason = side.role === 'attacker' ? 'formação reunida no objetivo' : 'formação reunida na posição defensiva';
  } else if (atFront) {
    nextState = 'forming';
    reason = 'aguardando o reagrupamento da formação';
  }
  recordFormationTransition(world, campaign, side, setFormationState(formation, nextState, day, reason),
    'A formação mudou para ' + nextState + ': ' + reason + '.', day);
}

function campaignFormationReady(campaign, side, troops) {
  const formation = side.formation;
  const activeTroops = troops.filter(person => !person.tacticalRecovering && person.militaryRestTargetId == null);
  if (!formation || !activeTroops.length) return false;
  if (formation.deployed) return activeTroops.some(person => distance(person, campaign.target) <= TARGET_RADIUS);
  const activeIds = new Set(activeTroops.map(person => person.id));
  const geometry = campaignFormationGeometry(campaign, side);
  const expectedFrontCount = formation.memberIds.filter(id => activeIds.has(id)
    && distance(campaignFormationSlot(formation, id, geometry.destination, geometry.orientation), campaign.target) <= TARGET_RADIUS).length;
  if (!expectedFrontCount) return false;
  const requiredFrontCount = Math.min(expectedFrontCount,
    Math.max(expectedFrontCount > 1 ? 2 : 1, Math.ceil(expectedFrontCount * FORMATION_FRONT_OCCUPANCY)));
  const actualFrontCount = activeTroops.filter(person => distance(person, campaign.target) <= TARGET_RADIUS).length;
  return actualFrontCount >= requiredFrontCount;
}

function recordGeneralEvent(world, campaign, event) {
  const state = campaignGeneralState(world);
  const entry = { day: event.request?.reportDay ?? world.day, campaignId: campaign?.id ?? null, ...event };
  state.events.push(entry);
  if (state.events.length > 120) state.events.splice(0, state.events.length - 120);
  if (campaign) {
    campaign.generalEvents ||= [];
    campaign.generalEvents.push(entry);
    if (campaign.generalEvents.length > 24) campaign.generalEvents.shift();
  }
}

function generalSideKey(campaignId, kingdomId) { return String(campaignId) + ':' + String(kingdomId); }

function generalAllowedActions(campaign) {
  const actions = ['advance', 'hold_position'];
  if (campaign.status !== 'withdrawing') actions.push('withdraw');
  return actions;
}

function generalObservedFacts(world, campaign, side, day) {
  const troops = livingSideTroops(world, side);
  const nearby = nearbyTroops(world, side, campaign.target);
  const dailyFood = troops.length * DAILY_FOOD_NEED / FOOD_RESERVE_PER_UNIT;
  const kingdom = kingdomById(world, side.kingdomId);
  const opponentId = campaign.attackerId === side.kingdomId ? campaign.defenderId : campaign.attackerId;
  const opponentSide = campaignSide(campaign, opponentId);
  return {
    day,
    kingdom: { id: side.kingdomId, name: kingdom?.name || 'reino' },
    campaign: {
      id: campaign.id, status: campaign.status, startedDay: campaign.startedDay,
      target: { ...campaign.target }, cause: campaign.cause, battleCount: campaign.battleCount,
      lastBattleDay: campaign.lastBattleDay
    },
    side: {
      role: side.role, troopCount: troops.length, troopsAtObjective: nearby.length,
      foodStock: Number((side.supply.stock.food || 0).toFixed(2)),
      estimatedRationDays: dailyFood > 0 ? Number(((side.supply.stock.food || 0) / dailyFood).toFixed(1)) : 0,
      woodStock: Number((side.supply.stock.wood || 0).toFixed(2)),
      goldStock: Number((side.supply.stock.gold || 0).toFixed(2)),
      morale: Number((side.morale || 0).toFixed(1)), shortageDays: side.supplyShortageDays || 0,
      stalledDays: side.stallDays || 0, order: side.aiOrder?.action || 'advance',
      orderVersion: side.orderVersion || 0,
      formation: side.formation ? { type: side.formation.type, state: side.formation.state,
        cohesion: side.formation.metrics?.cohesion ?? 1, outsideSlots: side.formation.metrics?.outsideSlots || 0 } : null
    },
    opponent: opponentSide ? {
      role: opponentSide.role, troopCount: livingSideTroops(world, opponentSide).length,
      morale: Number((opponentSide.morale || 0).toFixed(1)),
      troopsAtObjective: nearbyTroops(world, opponentSide, campaign.target).length
    } : null,
    evidence: campaign.evidence?.[side.role] || null
  };
}

/** Enqueue one isolated, versioned general request for each eligible campaign side. */
export function queueCampaignGeneralAiRequests(world, day = world.day + 1) {
  if (!world.strategicAI?.enabled) return 0;
  const state = campaignGeneralState(world);
  let added = 0;
  for (const campaign of world.campaigns || []) {
    if (!active(campaign) || campaign.status === 'withdrawing') continue;
    for (const side of [campaign.attacker, campaign.defender]) {
      if (state.requests.length >= GENERAL_QUEUE_LIMIT) return added;
      const key = generalSideKey(campaign.id, side.kingdomId);
      if (state.pendingBySide[key] || !livingSideTroops(world, side).length) continue;
      const urgent = side.supplyShortageDays >= 3 || side.morale <= 45 || side.stallDays > 0;
      const interval = urgent ? GENERAL_URGENT_REVIEW_INTERVAL : GENERAL_REVIEW_INTERVAL;
      if (side.nextGeneralReviewDay != null && day < side.nextGeneralReviewDay) continue;
      const allowedActions = generalAllowedActions(campaign);
      const observedFacts = generalObservedFacts(world, campaign, side, day);
      const requestId = 'general:' + campaign.id + ':' + side.kingdomId + ':' + state.nextRequestSequence++;
      const reportDay = Math.max(0, Math.floor(day));
      const request = {
        contractVersion: AI_DECISION_CONTRACT_VERSION,
        requestId,
        worldEpoch: Number.isSafeInteger(world.simulationEpoch) ? world.simulationEpoch : 0,
        role: 'general',
        agentId: 'general:' + campaign.id + ':' + side.kingdomId,
        kingdomId: side.kingdomId,
        campaignId: campaign.id,
        orderVersion: Math.max(0, Math.floor(side.orderVersion || 0)),
        reportDay,
        expiresDay: reportDay + Math.max(3, interval),
        priority: urgent ? 'urgent' : 'normal',
        requestedDay: reportDay,
        rulerName: null,
        candidateActions: allowedActions.slice(),
        allowedActions,
        observedFacts,
        context: observedFacts
      };
      state.pendingBySide[key] = {
        requestId, role: 'general', agentId: request.agentId, kingdomId: side.kingdomId,
        campaignId: campaign.id, orderVersion: request.orderVersion, worldEpoch: request.worldEpoch,
        reportDay, expiresDay: request.expiresDay, candidateActions: allowedActions.slice()
      };
      state.requests.push(request);
      side.lastGeneralRequestDay = reportDay;
      side.nextGeneralReviewDay = reportDay + interval;
      recordGeneralEvent(world, campaign, { type: 'request', request });
      added++;
    }
  }
  return added;
}

export function pullCampaignGeneralAiRequest(world) {
  const state = world.campaignGeneralAi;
  if (!world.strategicAI?.enabled || !state) return null;
  while (state.requests.length) {
    const request = state.requests.shift();
    const campaign = (world.campaigns || []).find(item => item.id === request.campaignId && active(item));
    const pending = state.pendingBySide[generalSideKey(request.campaignId, request.kingdomId)];
    if (!campaign || !pending || pending.requestId !== request.requestId) continue;
    if (world.day > request.expiresDay) {
      failCampaignGeneralAiRequest(world, request, { reason: 'decisão expirada' });
      continue;
    }
    return request;
  }
  return null;
}

export function applyCampaignGeneralAiDecision(world, request, decision, metadata = {}) {
  const state = world.campaignGeneralAi;
  if (!world.strategicAI?.enabled || !request || !state) return false;
  const campaign = (world.campaigns || []).find(item => item.id === request.campaignId);
  const side = campaign && campaignSide(campaign, request.kingdomId);
  const key = generalSideKey(request.campaignId, request.kingdomId);
  const pending = state.pendingBySide[key];
  recordGeneralEvent(world, campaign, { type: 'proposal', requestId: request.requestId, decision,
    provider: metadata.provider || null, model: metadata.model || null });
  if (!campaign || !active(campaign) || campaign.status === 'withdrawing' || !side || !pending) {
    recordGeneralEvent(world, campaign, { type: 'rejected', requestId: request.requestId, reason: 'campanha encerrada ou lado removido', decision });
    return false;
  }
  const invalidRequest = validateDecisionResult({
    request, pending,
    worldEpoch: Number.isSafeInteger(world.simulationEpoch) ? world.simulationEpoch : 0,
    currentDay: world.day,
    orderVersion: Math.max(0, Math.floor(side.orderVersion || 0)),
    campaignId: campaign.id,
    role: 'general'
  });
  if (invalidRequest) {
    failCampaignGeneralAiRequest(world, request, { reason: invalidRequest, decision, provider: metadata.provider, model: metadata.model });
    return false;
  }
  const invalidAction = validateDecisionAction(request, decision);
  if (invalidAction) {
    failCampaignGeneralAiRequest(world, request, { reason: invalidAction, decision, provider: metadata.provider, model: metadata.model });
    return false;
  }
  const action = decision.action;
  const day = world.day;
  const reason = String(decision.reason || '').replace(/[<>\u0000-\u001f]/g, ' ').trim().slice(0, 180);
  side.orderVersion = (side.orderVersion || 0) + 1;
  side.aiOrder = {
    action, reason, confidence: decision.confidence, requestId: request.requestId,
    provider: metadata.provider || 'ollama', model: metadata.model || null,
    assignedDay: day, version: side.orderVersion
  };
  delete state.pendingBySide[key];
  side.nextGeneralReviewDay = day + (request.priority === 'urgent' ? GENERAL_URGENT_REVIEW_INTERVAL : GENERAL_REVIEW_INTERVAL);
  recordGeneralEvent(world, campaign, { type: 'applied', requestId: request.requestId, kingdomId: side.kingdomId,
    role: 'general', decision, provider: metadata.provider || 'ollama', model: metadata.model || null,
    effect: { kind: 'campaign-order', campaignId: campaign.id, kingdomId: side.kingdomId, action, orderVersion: side.orderVersion } });
  if (action === 'withdraw') {
    const opponentId = campaign.attackerId === side.kingdomId ? campaign.defenderId : campaign.attackerId;
    const opponent = campaignSide(campaign, opponentId);
    const winnerId = opponent?.kingdomId ?? null;
    const annexed = side.role === 'defender' && winnerId === campaign.attackerId;
    retreatSide(world, campaign, side, day, 'ordem de retirada do general');
    resolveWar(world, campaign, winnerId,
      side.role === 'attacker'
        ? 'O general atacante ordenou retirada; a fronteira permaneceu sem alteração.'
        : 'O general defensor ordenou retirada e cedeu a área observada.', day, annexed);
  } else {
    recordFormationTransition(world, campaign, side,
      setFormationState(side.formation, action === 'hold_position' ? 'maintaining' : 'marching', day,
        action === 'hold_position' ? 'ordem do general para manter posição' : 'ordem do general para avançar'),
      action === 'hold_position' ? 'O general ordenou manter a formação em posição.' : 'O general ordenou avançar em formação.', day);
    recordCampaignEvent(world, campaign, day, 'general-order', side.kingdomId + ' recebeu ordem do general para '
      + (action === 'advance' ? 'avançar ao objetivo observado.' : 'manter posição.'),
    { kingdomId: side.kingdomId, action, requestId: request.requestId, orderVersion: side.orderVersion, model: metadata.model || null });
  }
  return true;
}

export function failCampaignGeneralAiRequest(world, request, { reason = 'inferência indisponível', decision = null, provider = null, model = null } = {}) {
  const state = world.campaignGeneralAi;
  if (!state || !request) return false;
  const key = generalSideKey(request.campaignId, request.kingdomId);
  const pending = state.pendingBySide[key];
  const campaign = (world.campaigns || []).find(item => item.id === request.campaignId);
  if (!pending || pending.requestId !== request.requestId) {
    recordGeneralEvent(world, campaign, { type: 'rejected', requestId: request.requestId, reason: reason || 'pedido antigo ou substituído', decision, provider, model });
    return false;
  }
  delete state.pendingBySide[key];
  const side = campaign && campaignSide(campaign, request.kingdomId);
  if (side) side.nextGeneralReviewDay = world.day + GENERAL_URGENT_REVIEW_INTERVAL;
  recordGeneralEvent(world, campaign, { type: 'fallback', requestId: request.requestId, reason, decision, provider, model });
  if (campaign) recordCampaignEvent(world, campaign, world.day, 'general-fallback',
    'A inferência do general falhou; as regras de campanha continuam ativas. Motivo: ' + String(reason).slice(0, 180),
    { kingdomId: request.kingdomId, requestId: request.requestId });
  return true;
}

export function setCampaignGeneralAiEnabled(world, enabled) {
  const state = campaignGeneralState(world);
  if (enabled) return true;
  state.requests.length = 0;
  state.pendingBySide = {};
  for (const campaign of world.campaigns || []) for (const side of [campaign.attacker, campaign.defender]) {
    if (!side.aiOrder) continue;
    recordGeneralEvent(world, campaign, { type: 'disabled', kingdomId: side.kingdomId, requestId: side.aiOrder.requestId });
    side.aiOrder = null;
    side.orderVersion = (side.orderVersion || 0) + 1;
  }
  return false;
}

export function drawCampaignRation(world, person, pointsNeeded = DAILY_FOOD_NEED) {
  const assignment = campaignAssignmentFor(world, person);
  if (!assignment || pointsNeeded <= 0) return 0;
  const account = assignment.side.supply.stock;
  const reserveRoom = Math.max(0, 100 - person.foodReserve);
  const resourceNeed = Math.min(pointsNeeded, reserveRoom) / FOOD_RESERVE_PER_UNIT;
  const used = Math.min(account.food || 0, resourceNeed);
  if (used <= .001 || !spendResource(account, { food: used })) return 0;
  assignment.side.rationsConsumed = (assignment.side.rationsConsumed || 0) + used;
  assignment.side.supplyLedger ||= campaignSupplyLedger();
  assignment.side.supplyLedger.rationConsumptionFood += used;
  return Math.min(pointsNeeded, used * FOOD_RESERVE_PER_UNIT);
}

export function recordCampaignPersonalRation(world, person, points) {
  if (!person || person.campaignId == null || !Number.isFinite(points) || points <= .001) return 0;
  const assignment = campaignAssignmentFor(world, person);
  if (!assignment) return 0;
  assignment.side.supplyLedger ||= campaignSupplyLedger();
  assignment.side.supplyLedger.personalReserveRationPoints += points;
  return points;
}

function nearbyTroops(world, side, target) {
  return livingSideTroops(world, side).filter(person => person.militaryRestTargetId == null && distance(person, target) <= TARGET_RADIUS);
}

function sidePower(world, campaign, side, troops, defending) {
  if (!troops.length) return 0;
  const individual = troops.reduce((sum, person) => sum + .38 + clamp(person.health / 100, 0, 1) * .32
    + clamp(person.energy / 100, 0, 1) * .16 + clamp(person.physicalStrength || .5, 0, 1) * .14
    + clamp(person.loyalty ?? .8, 0, 1) * .1, 0);
  const equipmentNeed = Math.max(1, troops.length);
  const equipment = clamp(Math.min((side.supply.stock.wood || 0) / equipmentNeed, (side.supply.stock.gold || 0) / equipmentNeed), 0, 1);
  const morale = .35 + clamp(side.morale / 100, 0, 1) * .65;
  const targetTile = cellAt(world, campaign.target.x, campaign.target.y);
  const fortifications = defending ? world.structures.filter(structure => structure.complete && structure.kingdomId === side.kingdomId
    && ['castelo', 'torre', 'centro_militar'].includes(structure.type) && distance(structure, campaign.target) <= 8) : [];
  const defense = defending ? 1 + Math.min(.65, fortifications.filter(item => item.type === 'torre' && !item.frontierOutpost).length * .12
    + fortifications.filter(item => item.frontierOutpost).length * .06
    + fortifications.filter(item => item.type === 'castelo').length * .2
    + fortifications.filter(item => item.type === 'centro_militar').length * .08) : 1;
  const terrain = defending && targetTile ? 1 + clamp(targetTile.slope, 0, .6) * .18 : 1;
  const cohesion = clamp(side.formation?.metrics?.cohesion ?? 1, 0, 1);
  return individual * morale * (.72 + equipment * .28) * defense * terrain * (.88 + cohesion * .12);
}

function applyBattleLosses(world, campaign, losingSide, winningSide, losingTroops, winningTroops, margin, day) {
  const kingdom = kingdomById(world, losingSide.kingdomId);
  const tower = campaignTower(world, campaign);
  const siegeObjective = side => tower ? { tower, attacking: side.role === 'attacker' } : null;
  const beforeLosing = losingTroops.filter(p => p.alive).length;
  const beforeWinning = winningTroops.filter(p => p.alive).length;
  // Alternate initiative so neither kingdom receives a permanent first-strike advantage.
  if (campaign.battleCount % 2 === 0) {
    fightTacticalRound(world, winningTroops, losingTroops, day, siegeObjective(winningSide));
    fightTacticalRound(world, losingTroops, winningTroops, day, siegeObjective(losingSide));
  } else {
    fightTacticalRound(world, losingTroops, winningTroops, day, siegeObjective(losingSide));
    fightTacticalRound(world, winningTroops, losingTroops, day, siegeObjective(winningSide));
  }
  const casualties = beforeLosing - losingTroops.filter(p => p.alive).length;
  const winningCasualties = beforeWinning - winningTroops.filter(p => p.alive).length;
  losingSide.losses += casualties;
  winningSide.losses += winningCasualties;
  updateMilitaryCommand(world, day);
  const equipmentCost = Math.max(0, Math.min(losingTroops.length * .08, losingSide.supply.stock.wood || 0));
  const woodSpent = equipmentCost > .01 && spendInventory(losingSide.supply, { wood: equipmentCost }, 'campaign-battle-equipment')
    ? equipmentCost : 0;
  const goldCost = Math.max(0, Math.min(losingTroops.length * .03, losingSide.supply.stock.gold || 0));
  const goldSpent = goldCost > .01 && spendInventory(losingSide.supply, { gold: goldCost }, 'campaign-battle-equipment')
    ? goldCost : 0;
  losingSide.supplyLedger ||= campaignSupplyLedger();
  losingSide.supplyLedger.battleEquipmentLoss.wood += woodSpent;
  losingSide.supplyLedger.battleEquipmentLoss.gold += goldSpent;
  losingSide.morale = clamp(losingSide.morale - .8 - casualties * 2, 0, 100);
  winningSide.morale = clamp(winningSide.morale + .25 - winningCasualties * 2, 0, 100);
  losingSide.battles++;
  winningSide.battles++;
  campaign.battleCount++;
  campaign.status = 'engaged';
  campaign.lastBattleDay = day;
  recordFormationTransition(world, campaign, losingSide,
    setFormationState(losingSide.formation, 'retreating', day, 'recuo após perder o confronto'),
    'A formação recuou após o confronto; coesão ' + (losingSide.formation?.metrics?.cohesion ?? 1) + '.', day);
  recordFormationTransition(world, campaign, winningSide,
    setFormationState(winningSide.formation, winningSide.role === 'attacker' ? 'attacking' : 'maintaining', day, 'manobra após o confronto'),
    'A formação vencedora manteve a manobra; coesão ' + (winningSide.formation?.metrics?.cohesion ?? 1) + '.', day);
  const loser = kingdomById(world, losingSide.kingdomId);
  const winner = kingdomById(world, winningSide.kingdomId);
  const message = winner.name + ' venceu o confronto de campanha contra ' + loser.name + ' em '
    + campaign.target.x + ',' + campaign.target.y + '; ' + casualties + ' soldados morreram, '
    + (losingTroops.length - casualties) + ' permaneceram na formação após a troca de ataques; a coesão de ' + loser.name + ' caiu; equipamento consumido: '
    + Number(woodSpent.toFixed(2)).toString().replace('.', ',') + ' madeira e '
    + Number(goldSpent.toFixed(2)).toString().replace('.', ',') + ' ouro.';
  recordCampaignEvent(world, campaign, day, 'battle', message, {
    winnerId: winningSide.kingdomId, loserId: losingSide.kingdomId, casualties,
    survivingLosses: losingTroops.length - casualties, equipmentCosts: { wood: woodSpent, gold: goldSpent },
    target: { ...campaign.target },
    formations: [campaign.attacker, campaign.defender].map(side => ({
      kingdomId: side.kingdomId, type: side.formation?.type || 'column', state: side.formation?.state || 'marching',
      cohesion: side.formation?.metrics?.cohesion ?? 1, outsideSlots: side.formation?.metrics?.outsideSlots || 0
    }))
  });
  if (kingdom && kingdom.strategy) kingdom.strategy.lastOutcome = { status: 'lost', day, reason: message, campaignId: campaign.id };
  world.conflicts = (world.conflicts || 0) + 1;
}

function claimTerritory(world, campaign, day) {
  const priorOwnerId = campaign.target.ownerId;
  world.territoryClaims ||= [];
  const existing = world.territoryClaims.find(claim => claim.campaignId === campaign.id);
  if (!existing) world.territoryClaims.push({
    id: world.nextId++, campaignId: campaign.id, ownerId: campaign.attackerId,
    priorOwnerId, x: campaign.target.x, y: campaign.target.y, radius: 4.5,
    startedDay: day, expiresDay: null, status: 'annexed'
  });
  campaign.territorialChange = { ownerId: campaign.attackerId, priorOwnerId, x: campaign.target.x, y: campaign.target.y, radius: 4.5, day };
  recomputeKingdomTerritories(world);
}

function returnSupplies(world, campaign, side) {
  const kingdom = kingdomById(world, side.kingdomId);
  if (!kingdom) return;
  side.supplyLedger ||= campaignSupplyLedger();
  for (const resource of ['food', 'wood', 'gold']) {
    const amount = side.supply.stock[resource] || 0;
    if (amount > .001) side.supplyLedger.returned[resource] += transferInventory(
      side.supply, kingdom.treasury, resource, amount, 'campaign-return');
  }
}

function resolveWar(world, campaign, winnerId, reason, day, annexed = false) {
  for (const s of world.structures) if (s.id === campaign.evidence?.structureId && s.integrity > 0) s.siegeBlocked = false;

  clearCampaignGeneralRequests(world, campaign, 'campanha resolvida antes da resposta');
  const war = (world.wars || []).find(item => item.id === campaign.warId);
  const relation = world.kingdomRelations[Math.min(campaign.attackerId, campaign.defenderId) + ':' + Math.max(campaign.attackerId, campaign.defenderId)];
  if (annexed && !campaign.capturedTowerId) claimTerritory(world, campaign, day);
  if (relation) {
    relation.status = 'peace';
    relation.tension = Math.max(0, (relation.tension || 0) - .2);
    relation.resolvedDay = day;
    relation.ceasefireUntilDay = day + CEASEFIRE_DAYS;
    relation.nextTowerRaidDay = Math.max(relation.nextTowerRaidDay || 0, day + FRONTIER_RECOVERY_DAYS);
    relation.lastOutcome = reason;
  }
  if (war) { war.status = 'resolved'; war.resolvedDay = day; war.winnerId = winnerId; }
  world.treaties ||= [];
  const treaty = {
    id: world.nextId++, warId: campaign.warId, campaignId: campaign.id, day,
    a: campaign.attackerId, b: campaign.defenderId, winnerId,
    kind: annexed ? 'armistice-with-territory-change' : 'armistice-status-quo',
    terms: annexed ? { territorialClaim: { ...campaign.territorialChange }, relation: 'peace' } : { territory: 'status quo', relation: 'peace' },
    reason
  };
  world.treaties.push(treaty);
  if (world.treaties.length > 40) world.treaties.shift();
  campaign.outcome = winnerId === campaign.attackerId ? 'attacker-victory'
    : winnerId === campaign.defenderId ? 'defender-victory' : 'negotiated';
  campaign.outcomeReason = reason;
  campaign.resolvedDay = day;
  campaign.status = 'withdrawing';
  for (const side of [campaign.attacker, campaign.defender]) {
    if (side.formation) {
      setFormationDestination(side.formation, side.home);
      recordFormationTransition(world, campaign, side,
        setFormationState(side.formation, 'retreating', day, 'retorno após armistício'),
        'A formação recebeu a ordem de retirada para o posto.', day);
    }
    for (const id of side.troopIds) {
      const person = world.people.find(item => item.id === id && item.alive);
      if (person) {
        person.campaignMoveAttempted = false;
        person.campaignMoveSucceeded = false;
        person.campaignReturnStallDays = 0;
      }
    }
  }
  const winner = winnerId == null ? null : kingdomById(world, winnerId);
  const attacker = kingdomById(world, campaign.attackerId), defender = kingdomById(world, campaign.defenderId);
  const parties = attacker.name + ' e ' + defender.name;
  recordCampaignEvent(world, campaign, day, 'armistice', (winner ? winner.name + ' venceu; ' : '') + parties
    + ' firmaram um armistício: ' + reason + (annexed ? ' A nova fronteira permanece no mapa.' : ' A fronteira voltou ao status quo.'),
  { treatyId: treaty.id, winnerId, annexed });
  for (const side of [campaign.attacker, campaign.defender]) {
    const kingdom = kingdomById(world, side.kingdomId);
    if (kingdom && kingdom.strategy) kingdom.strategy.lastOutcome = { status: side.kingdomId === winnerId ? 'completed' : 'lost', day, reason, campaignId: campaign.id };
  }
}

function clearCampaignGeneralRequests(world, campaign, reason) {
  const state = world.campaignGeneralAi;
  if (!state) return;
  state.requests = (state.requests || []).filter(request => {
    if (request.campaignId !== campaign.id) return true;
    const key = generalSideKey(request.campaignId, request.kingdomId);
    delete state.pendingBySide[key];
    recordGeneralEvent(world, campaign, { type: 'rejected', requestId: request.requestId, reason });
    return false;
  });
}

function withdrawSide(world, campaign, side, day) {
  const troops = livingSideTroops(world, side);
  if (!troops.length) return true;
  if (troops.every(person => person.campaignReturnedHome || side.home && distance(person, side.home) <= 2.2)) return true;
  return false;
}

function retreatSide(world, campaign, side, day, reason) {
  const kingdom = kingdomById(world, side.kingdomId);
  for (const person of livingSideTroops(world, side)) {
    person.loyalty = clamp((person.loyalty ?? .8) - .08, 0, 1);
    person.state = 'retirada após campanha';
  }
  side.retreatReason = reason;
  side.morale = Math.max(0, side.morale - 14);
  if (kingdom && kingdom.strategy) kingdom.strategy.lastOutcome = { status: 'blocked', day, reason, campaignId: campaign.id };
}

function releaseCampaignTroop(world, side, person, preserveService = false) {
  const kingdom = kingdomById(world, side.kingdomId);
  const center = kingdom && (kingdom.militaryCenterIds || []).map(id => world.structures.find(item => item.id === id)).find(Boolean);
  if (!preserveService && center) center.soldierIds = (center.soldierIds || []).filter(id => id !== person.id);
  if (!preserveService) {
    person.role = 'resident';
    clearMilitaryCommand(person);
    person.militaryClass = null;
    person.militaryCenterId = null;
    person.militaryDutyCenterId = null;
  } else { person.state = 'recuperando-se após a campanha'; person.militaryReturningHome = true; }
  person.campaignId = null;
  person.campaignMoveSucceeded = false;
  person.campaignMoveAttempted = false;
  person.campaignReturnStallDays = 0;
  side.troopIds = side.troopIds.filter(id => id !== person.id);
  return kingdom;
}

function maybeDesert(world, campaign, side, day) {
  const troops = livingSideTroops(world, side);
  for (const person of troops) {
    if ((person.loyalty ?? .8) > .2 && !(side.morale < 18 && person.foodReserve < 18)) continue;
    if (rand(world) > .35) continue;
    const kingdom = releaseCampaignTroop(world, side, person);
    person.loyalty = 0;
    side.morale = Math.max(0, side.morale - 9);
    recordCampaignEvent(world, campaign, day, 'desertion', person.name + ' desertou da campanha de ' + (kingdom && kingdom.name || 'seu reino')
      + ' por baixa coesão e falta de abastecimento.', { kingdomId: side.kingdomId, personId: person.id });
  }
}

function hasFoodForAnotherDay(side, troops) {
  const fieldRations = Math.max(0, Number(side.supply.stock.food) || 0) * FOOD_RESERVE_PER_UNIT;
  const fieldRationsPerTroop = fieldRations / troops.length;
  return troops.every(person => Math.max(0, Number.isFinite(person.foodReserve) ? person.foodReserve : 0)
    + fieldRationsPerTroop + .001 >= DAILY_FOOD_NEED);
}

function finishCampaign(world, campaign, day) {
  const supplyCosts = [];
  for (const side of [campaign.attacker, campaign.defender]) {
    for (const id of side.troopIds) {
      const person = world.people.find(item => item.id === id);
      if (person) {
        person.campaignId = null; person.campaignReturnedHome = false;
        person.fieldCommand = null;
        person.campaignMoveSucceeded = false; person.campaignMoveAttempted = false;
      }
    }
    returnSupplies(world, campaign, side);
    const ledger = side.supplyLedger || campaignSupplyLedger();
    supplyCosts.push({
      kingdomId: side.kingdomId,
      role: side.role,
      mobilizedTroops: side.mobilizedTroopCount ?? side.troopIds.length,
      fieldFoodDeployed: ledger.deployment.food + ledger.resupply.food,
      fieldFoodConsumed: ledger.rationConsumptionFood,
      personalReserveRationPoints: ledger.personalReserveRationPoints,
      fieldFoodReturned: ledger.returned.food,
      equipmentLost: { ...ledger.battleEquipmentLoss }
    });
  }
  campaign.status = 'complete';
  campaign.completedDay = day;
  const amount = value => Number((value || 0).toFixed(2)).toString().replace('.', ',');
  const summary = supplyCosts.map(cost => {
    const kingdom = kingdomById(world, cost.kingdomId);
    return (kingdom?.name || 'Reino') + ': ' + amount(cost.fieldFoodConsumed) + ' unidades de ração de campo, '
      + amount(cost.personalReserveRationPoints) + ' pontos das reservas pessoais, equipamento perdido '
      + amount(cost.equipmentLost.wood) + ' madeira e ' + amount(cost.equipmentLost.gold) + ' ouro.';
  }).join(' ');
  recordCampaignEvent(world, campaign, day, 'return', 'As forças sobreviventes regressaram; os suprimentos não consumidos voltaram aos tesouros. '
    + 'Custo por lado: ' + summary, { supplyCosts });
}

export function resolveKingdomCampaigns(world, day = world.day + 1) {
  for (const campaign of world.campaigns || []) {
    if (!active(campaign)) continue;
    for (const side of [campaign.attacker, campaign.defender]) updateCampaignFormation(world, campaign, side, day);
    if (campaign.status === 'withdrawing') {
      for (const side of [campaign.attacker, campaign.defender]) {
        for (const id of side.troopIds.slice()) {
          const person = world.people.find(item => item.id === id && item.alive
            && item.role === 'soldier' && item.campaignId === side.campaignId);
          if (!person) continue;
          if (person.campaignReturnedHome || side.home && distance(person, side.home) <= 2.2) continue;
          if (person.campaignMoveAttempted && !person.campaignMoveSucceeded) {
            person.campaignReturnStallDays = (person.campaignReturnStallDays || 0) + 1;
          } else if (person.campaignMoveSucceeded) person.campaignReturnStallDays = 0;
          if (person.campaignReturnStallDays < CAMPAIGN_RETURN_STALL_DAYS) continue;
          person.loyalty = clamp((person.loyalty ?? .8) - .08, 0, 1);
          const kingdom = releaseCampaignTroop(world, side, person, true);
          side.morale = Math.max(0, side.morale - 9);
          recordCampaignEvent(world, campaign, day, 'desertion', person.name + ' deixou a campanha de '
            + (kingdom && kingdom.name || 'seu reino') + ' após quatro dias sem conseguir avançar na retirada; foi liberado para buscar alimento e retornar à guarnição.',
          { kingdomId: side.kingdomId, personId: person.id, reason: 'return-route-stalled',
            stallDays: CAMPAIGN_RETURN_STALL_DAYS, location: { x: person.x, y: person.y } });
        }
      }
      const attackerReturned = withdrawSide(world, campaign, campaign.attacker, day);
      const defenderReturned = withdrawSide(world, campaign, campaign.defender, day);
      for (const side of [campaign.attacker, campaign.defender]) for (const id of side.troopIds) {
        const person = world.people.find(item => item.id === id);
        if (person) { person.campaignMoveSucceeded = false; person.campaignMoveAttempted = false; }
      }
      if (attackerReturned && defenderReturned) finishCampaign(world, campaign, day);
      continue;
    }
    const sides = [campaign.attacker, campaign.defender];
    for (const side of sides) {
      const troops = livingSideTroops(world, side);
      if (!troops.length) continue;
      if (!hasFoodForAnotherDay(side, troops)) {
        side.supplyShortageDays++;
        side.morale = Math.max(0, side.morale - 1.7);
      } else {
        side.supplyShortageDays = Math.max(0, side.supplyShortageDays - 1);
        side.morale = Math.min(100, side.morale + .12);
      }
      if ((side.supply.stock.wood || 0) < troops.length * .35 || (side.supply.stock.gold || 0) < troops.length * .2) {
        side.morale = Math.max(0, side.morale - .35);
      }
      maybeDesert(world, campaign, side, day);
      const attempted = troops.some(person => person.campaignMoveAttempted);
      const moved = troops.filter(person => person.campaignMoveSucceeded).length;
      if (campaign.status === 'mobilizing') side.stallDays = 0;
      else if (attempted && moved === 0) side.stallDays++;
      else if (moved > 0) side.stallDays = 0;
      for (const person of troops) {
        person.campaignMoveSucceeded = false;
        person.campaignMoveAttempted = false;
      }
    }
    const tower = campaignTower(world, campaign);
    if (tower) initializeTowerHealth(tower);
    const towerHealthBefore = tower?.health;
    if (tower && tower.health <= 0) {
      resolveWar(world, campaign, campaign.attackerId, tower.type === 'torre' ? 'A torre foi destruída; sua área de influência deixou de proteger a fronteira.' : 'A construção estratégica foi destruída e seus recursos foram derrubados.', day, false);
      continue;
    }
    const attackerTroops = livingSideTroops(world, campaign.attacker);
    const defenderTroops = livingSideTroops(world, campaign.defender);
    const attackerFormationReady = campaignFormationReady(campaign, campaign.attacker, attackerTroops);
    const defenderFormationReady = campaignFormationReady(campaign, campaign.defender, defenderTroops);
    if (tower && campaign.status !== 'mobilizing' && attackerFormationReady
        && advanceTowerCapture(world, campaign, tower, attackerTroops, defenderTroops, day)) {
      resolveWar(world, campaign, campaign.attackerId, 'A torre enfraquecida foi ocupada por cinco dias e capturada por ordem real.', day, true);
      continue;
    }
    if (!attackerTroops.length) {
      resolveWar(world, campaign, defenderTroops.length ? campaign.defenderId : null,
        'A campanha atacante perdeu a guarnição antes de conquistar o objetivo.', day, false);
      continue;
    }
    if (campaign.attacker.stallDays >= 4) {
      retreatSide(world, campaign, campaign.attacker, day, 'rota bloqueada por quatro dias');
      resolveWar(world, campaign, defenderTroops.length ? campaign.defenderId : null,
        'A distância e o terreno bloquearam a rota de campanha; as partes negociaram a fronteira atual.', day, false);
      continue;
    }
    if (campaign.attacker.supplyShortageDays >= 8 || campaign.attacker.morale <= 24) {
      retreatSide(world, campaign, campaign.attacker, day, 'abastecimento ou coesão insuficientes');
      resolveWar(world, campaign, defenderTroops.length ? campaign.defenderId : null,
        'A campanha atacante ficou sem abastecimento ou coesão para sustentar a marcha.', day, false);
      continue;
    }
    if (!tower && !defenderTroops.length && attackerFormationReady
        && nearbyTroops(world, campaign.attacker, campaign.target).length) {
      resolveWar(world, campaign, campaign.attackerId, 'A área ficou sem guarnição defensora e foi ocupada.', day, true);
      continue;
    }

    const nearbyAttackers = nearbyTroops(world, campaign.attacker, campaign.target);
    const nearbyDefenders = nearbyTroops(world, campaign.defender, campaign.target);
    const attackerAtFront = nearbyAttackers.length > 0;
    const defenderAtFront = nearbyDefenders.length > 0;
    const localContact = nearbyAttackers.some(person => !person.tacticalRecovering
      && nearbyDefenders.some(enemy => !enemy.tacticalRecovering && distance(person, enemy) <= 8));
    if (attackerAtFront && attackerFormationReady && !defenderAtFront) campaign.undefendedDays = (campaign.undefendedDays || 0) + 1;
    else if (defenderAtFront) campaign.undefendedDays = 0;
    if (campaign.status !== 'mobilizing' && attackerAtFront && defenderAtFront
        && (localContact || attackerFormationReady && defenderFormationReady)
        && day - campaign.lastBattleDay >= 2) {
      campaign.status = 'engaged';
      const attackPower = sidePower(world, campaign, campaign.attacker, nearbyAttackers, false);
      const defensePower = sidePower(world, campaign, campaign.defender, nearbyDefenders, true);
      const attackerWins = rand(world) < attackPower / Math.max(.01, attackPower + defensePower);
      const winningSide = attackerWins ? campaign.attacker : campaign.defender;
      const losingSide = attackerWins ? campaign.defender : campaign.attacker;
      const winningTroops = attackerWins ? nearbyAttackers : nearbyDefenders;
      const losingTroops = attackerWins ? nearbyDefenders : nearbyAttackers;
      const margin = Math.abs(attackPower - defensePower) / Math.max(.01, attackPower + defensePower);
      applyBattleLosses(world, campaign, losingSide, winningSide, losingTroops, winningTroops, margin, day);
      if (tower && tower.health <= 0) {
        resolveWar(world, campaign, campaign.attackerId, tower.type === 'torre' ? 'A torre foi destruída durante o combate e deixou de proteger a fronteira.' : 'A construção foi destruída durante o combate e seus recursos foram derrubados.', day, false);
        continue;
      }
      const remaining = livingSideTroops(world, losingSide);
      if ((!tower || losingSide.role === 'attacker') && (!remaining.length || losingSide.morale <= 36 || (campaign.battleCount >= 16 && remaining.filter(p => p.health >= 28).length < Math.max(1, losingSide.mobilizedTroopCount * .3)))) {
        const isAttackerVictory = winningSide.kingdomId === campaign.attackerId;
        resolveWar(world, campaign, winningSide.kingdomId,
          isAttackerVictory ? 'A defesa recuou após perder homens, equipamento e coesão; a área foi ocupada.'
            : 'A força defensora conteve a campanha e preservou a fronteira.', day, isAttackerVictory);
      }
    } else if (campaign.status !== 'mobilizing'
        && (!(attackerAtFront && defenderAtFront)
          || !attackerFormationReady || !defenderFormationReady)) campaign.status = 'marching';
    if (!tower && campaign.status !== 'withdrawing' && campaign.undefendedDays >= 12) {
      resolveWar(world, campaign, campaign.attackerId, 'A torre ficou sem defesa por doze dias e o objetivo foi ocupado.', day, true);
    }
    if (tower && (attackerFormationReady || !defenderAtFront)
        && campaign.status !== 'withdrawing' && campaign.status !== 'mobilizing'
        && campaign.attacker.aiOrder?.action !== 'hold_position') {
      let damage = 0;
      for (const person of attackerTroops) {
        const threatened = defenderTroops.some(enemy => distance(enemy, person) <= 2);
        if (!threatened || person.id % 3 === 0) damage += attackTower(world, person, tower, day);
      }
      damage = towerHealthBefore - tower.health;
      if (damage > 0) {
        campaign.status = 'engaged';
        recordCampaignEvent(world, campaign, day, 'siege', 'O ataque à torre causou ' + damage
          + ' de dano; vida restante ' + Math.ceil(tower.health) + '/' + tower.maxHealth + '.', { towerId: tower.id, damage, health: tower.health });
      }
      if (tower.health <= 0) {
        resolveWar(world, campaign, campaign.attackerId, tower.type === 'torre' ? 'A torre foi destruída; sua área de influência deixou de proteger a fronteira.' : 'A construção estratégica foi destruída e seus recursos foram derrubados.', day, false);
        continue;
      }
    }
    if (campaign.status !== 'withdrawing' && day - campaign.startedDay >= 150) {
      resolveWar(world, campaign, campaign.defenderId, 'A defesa resistiu por 150 dias; as forças encerraram o cerco para reabastecer.', day, false);
    }

    const noDefender = !defenderTroops.length;
    const defenderSupplyFailure = defenderTroops.length && (campaign.defender.supplyShortageDays >= 8 || campaign.defender.morale <= 24);
    const defenderCannotReachFront = campaign.defender.stallDays >= 4;
    if (!tower && campaign.status !== 'withdrawing' && !noDefender && defenderSupplyFailure && attackerAtFront
        && (defenderAtFront || defenderCannotReachFront)) {
      retreatSide(world, campaign, campaign.defender, day, 'guarnição sem abastecimento ou coesão');
      resolveWar(world, campaign, campaign.attackerId, 'A guarnição defensora perdeu coesão e aceitou a ocupação da área.', day, true);
    }
  }
}

export function maintainKingdomFortifications(world, day = world.day + 1) {
  if (day <= 0 || day % 30 !== 0) return [];
  const changes = [];
  let territoryDirty = false;
  for (const kingdom of world.kingdoms || []) {
    const fortifications = world.structures.filter(structure => structure.complete && structure.destroyedDay == null && structure.kingdomId === kingdom.id
      && ['castelo', 'torre', 'centro_militar'].includes(structure.type));
    const ledger = {
      day,
      fortificationCount: fortifications.length,
      paidStructures: 0,
      deferredStructures: 0,
      paidCost: { wood: 0, stone: 0 },
      deferredCost: { wood: 0, stone: 0 },
      integrityLost: 0,
      collapsedStructureIds: []
    };
    for (const structure of fortifications) {
      const costs = structure.frontierOutpost ? { wood: .2, stone: .1 }
        : structure.type === 'castelo' ? { wood: .8, stone: .4 }
          : structure.type === 'centro_militar' ? { wood: .6, stone: .3 } : { wood: .4, stone: .2 };
      structure.integrity = Number.isFinite(structure.integrity) ? structure.integrity : 1;
      const previousIntegrity = structure.integrity;
      const paid = spendInventory(kingdom.treasury, costs, 'fortification-maintenance');
      if (paid) {
        if (structure.type === 'torre') {
          initializeTowerHealth(structure);
          if (day - (structure.lastAttackedDay ?? -Infinity) > 7) structure.health = Math.min(structure.maxHealth, structure.health + structure.maxHealth * .02);
        }
        structure.integrity = Math.min(1, structure.integrity + .01);
        ledger.paidStructures++;
        ledger.paidCost.wood += costs.wood;
        ledger.paidCost.stone += costs.stone;
      } else {
        structure.integrity = Math.max(0, structure.integrity - .1);
        ledger.deferredStructures++;
        ledger.deferredCost.wood += costs.wood;
        ledger.deferredCost.stone += costs.stone;
      }
      territoryDirty ||= previousIntegrity !== structure.integrity;
      structure.lastMaintenanceDay = day;
      const threshold = structure.integrity <= .001 ? 0 : structure.integrity < .26 ? .25 : structure.integrity < .51 ? .5 : structure.integrity < .76 ? .75 : 1;
      if (threshold === 0) {
        structure.integrity = 0;
        structure.complete = false;
        ledger.collapsedStructureIds.push(structure.id);
        if (structure.type === 'torre') {
          destroyTowerInWorld(world, structure, day, null, 'maintenance');
          kingdom.towerIds = (kingdom.towerIds || []).filter(id => id !== structure.id);
          kingdom.structureIds = (kingdom.structureIds || []).filter(id => id !== structure.id);
        }
        const message = kingdom.name + ' perdeu ' + (structure.frontierOutpost ? 'um posto de fronteira'
          : structure.type === 'torre' ? 'uma torre' : structure.type === 'castelo' ? 'o castelo' : 'um centro militar')
          + ' por falta prolongada de madeira e pedra para manutenção.';
        log(world, message, day);
        changes.push({ kingdomId: kingdom.id, structureId: structure.id, type: 'collapsed', integrity: 0, day });
      } else if (threshold !== (structure.lastMaintenanceThreshold ?? 1)) {
        structure.lastMaintenanceThreshold = threshold;
        const message = paid
          ? kingdom.name + ' pagou manutenção de ' + structure.type + ' em madeira e pedra; integridade ' + Math.round(structure.integrity * 100) + '%.'
          : kingdom.name + ' adiou a manutenção de ' + structure.type + '; integridade caiu para ' + Math.round(structure.integrity * 100) + '%.';
        log(world, message, day);
        changes.push({ kingdomId: kingdom.id, structureId: structure.id, type: paid ? 'maintained' : 'degraded', integrity: structure.integrity, day });
      }
      ledger.integrityLost += Math.max(0, previousIntegrity - structure.integrity);
    }
    for (const resource of ['wood', 'stone']) {
      ledger.paidCost[resource] = Number(ledger.paidCost[resource].toFixed(2));
      ledger.deferredCost[resource] = Number(ledger.deferredCost[resource].toFixed(2));
    }
    ledger.integrityLost = Number(ledger.integrityLost.toFixed(2));
    if (!kingdom.fortificationMaintenance || typeof kingdom.fortificationMaintenance !== 'object') {
      kingdom.fortificationMaintenance = { history: [] };
    }
    if (!Array.isArray(kingdom.fortificationMaintenance.history)) kingdom.fortificationMaintenance.history = [];
    kingdom.fortificationMaintenance.history.push(ledger);
    if (kingdom.fortificationMaintenance.history.length > 24) kingdom.fortificationMaintenance.history.shift();
    const amountText = amount => Number(amount.toFixed(2)).toString().replace('.', ',');
    const paidText = amountText(ledger.paidCost.wood) + ' madeira e ' + amountText(ledger.paidCost.stone) + ' pedra';
    const deferredText = amountText(ledger.deferredCost.wood) + ' madeira e ' + amountText(ledger.deferredCost.stone) + ' pedra';
    const integrityText = ledger.integrityLost > 0
      ? 'integridade perdida ' + amountText(ledger.integrityLost) + ' no total'
      : 'sem perda de integridade';
    const summary = kingdom.name + ' fechou a manutenção do dia ' + day + ': pagou ' + ledger.paidStructures + '/'
      + ledger.fortificationCount + ' fortificações (' + paidText + '), adiou ' + ledger.deferredStructures
      + ' (' + deferredText + ' necessários), ' + ledger.collapsedStructureIds.length + ' colapsaram; ' + integrityText + '.';
    if (ledger.fortificationCount > 0) log(world, summary, day);
  }
  if (territoryDirty) recomputeKingdomTerritories(world);
  return changes;
}
