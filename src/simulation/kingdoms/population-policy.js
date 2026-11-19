import { log } from '../core/events.js';
import { recruitKingdomSoldier } from './commands.js';
import { dischargeSoldier, MILITARY_PAY } from './service.js';
import { updateMilitaryCommand, militaryMerit } from './military.js';

// This is MILITARY staffing and pay policy only. The king never selects
// births, parenthood, marriage or a target civilian population.
export const FORCE_POLICY_REVIEW_DAYS = 30;

export function wantsMilitaryService(person, world) {
  if (!person?.alive || person.role !== 'resident' || person.recruitmentOrder
    || person.ageDays < 365 || person.playerControlled || person.privateHomeProjectId != null
    || person.health < 60 || person.energy < 30 || person.foodReserve < 24) return false;
  const children = (world.people || []).some(child => child.alive && child.ageDays < 240
    && child.parents?.includes(person.id));
  const wealth = person.personalWallet?.stock;
  const personalGold = Number(wealth?.gold || 0) + Number(wealth?.silver || 0) / 10
    + Number(wealth?.copper || 0) / 100;
  return !children && personalGold < 3 && (person.physicalStrength || 0) >= .45;
}

export function planKingdomForceBalance(report) {
  const military = report?.military || {};
  const soldiers = Math.max(0, Number(military.soldiers) || 0);
  const civilianAdults = Math.max(0, Number(military.civilianAdults) || 0);
  const atWar = !!military.activeCampaign || (military.pendingForceRequests || []).length > 0;
  const threatened = atWar || !!military.frontierAlert || (military.recentTerritoryLosses || []).length > 0;
  const foodDays = Math.max(0, Number.isFinite(report?.community?.foodBufferDays)
    ? report.community.foodBufferDays : 0);
  const wealth = Number(report?.treasury?.gold) || 0;
  const salaryCyclesCovered = soldiers ? Math.max(0, wealth / (soldiers * MILITARY_PAY.gold)) : Infinity;
  const civilianFloor = Math.max(5, Number(military.civilianCareFloor) || 5);
  const payrollStrained = salaryCyclesCovered < 1 || foodDays < 7;
  const requestedReplacements = atWar && (military.availableSoldiers || 0) < 4;
  const volunteersAvailable = (military.volunteers || 0) > 0;
  const canHire = civilianAdults > civilianFloor && foodDays >= 7
    && military.recruitment?.available
    && wealth >= (soldiers + 1) * MILITARY_PAY.gold * 2;
  const action = !atWar && payrollStrained && soldiers > 0 ? 'demobilize'
    : canHire && requestedReplacements ? 'requisition'
      : canHire && !threatened && soldiers < 8 && volunteersAvailable ? 'recruit-volunteer'
        : 'hold';
  return { action, soldiers, civilianAdults, civilianFloor, atWar, threatened, foodDays,
    salaryCyclesCovered, payrollStrained, volunteersAvailable, requestedReplacements };
}

export function updateKingdomForceBalance(world, kingdom, report) {
  if (world.initialMilitaryShare !== .8 || !report || !kingdom) return null;
  const day = world.day + 1;
  if (day % FORCE_POLICY_REVIEW_DAYS !== 0 || kingdom.forcePolicy?.lastReviewedDay === day) return null;
  const decision = planKingdomForceBalance(report);
  const members = world.people.filter(p => p.alive && p.kingdomId === kingdom.id);
  let changed = 0;
  if (decision.action === 'demobilize') {
    const limit = Math.min(10, Math.max(2, Math.ceil(decision.soldiers * .12)));
    const candidates = members.filter(p => p.role === 'soldier' && p.campaignId == null
      && p.towerDutyId == null && !p.towerMounted && !p.playerControlled
      && !p.militaryReturningHome && !p.fieldCommand
      && !['general', 'comandante'].includes(p.militaryRank));
    candidates.sort((a, b) => Number(!!b.serviceResignationRequested) - Number(!!a.serviceResignationRequested)
      || militaryMerit(a) - militaryMerit(b) || a.id - b.id);
    for (const soldier of candidates.slice(0, limit)) {
      if (dischargeSoldier(world, soldier, day)) changed++;
    }
    if (changed) updateMilitaryCommand(world, day);
  } else if (decision.action === 'requisition') {
    const result = recruitKingdomSoldier(world, kingdom.id, { startedDay: day, requisition: true });
    if (result.ok) changed++;
  } else if (decision.action === 'recruit-volunteer') {
    const volunteer = members.filter(p => p.volunteerForService && wantsMilitaryService(p, world))
      .sort((a, b) => (b.physicalStrength || 0) - (a.physicalStrength || 0) || a.id - b.id)[0];
    if (volunteer) {
      const result = recruitKingdomSoldier(world, kingdom.id,
        { startedDay: day, volunteerId: volunteer.id });
      if (result.ok) changed++;
    }
  }
  kingdom.forcePolicy = {
    ...decision, lastReviewedDay: day, changed,
    resultingSoldiers: members.filter(p => p.role === 'soldier').length,
    trainingOrders: members.filter(p => p.recruitmentOrder).length
  };
  if (changed) {
    log(world, kingdom.name + (decision.action === 'demobilize'
      ? ' dispensou ' + changed + ' soldado(s) por falta de orçamento ou suprimentos.'
      : ' financiou ' + changed + ' alistamento(s), com treinamento e equipamentos reais.'), day);
  }
  return kingdom.forcePolicy;
}
