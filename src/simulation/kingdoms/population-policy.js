import { log } from '../core/events.js';
import { recruitKingdomSoldier } from './commands.js';
import { dischargeSoldier } from './service.js';
import { updateMilitaryCommand, militaryMerit } from './military.js';

// The 80% founder army is a starting condition, not a constitutional quota.
// This opt-in path leaves the legacy 96-person audit world unchanged.
export const FORCE_POLICY_REVIEW_DAYS = 30;

export function planKingdomForceBalance(report) {
  const military = report?.military || {};
  const adults = Math.max(0, Number(military.adultPopulation) || 0);
  const soldiers = Math.max(0, Number(military.soldiers) || 0);
  const civilianAdults = Math.max(0, Number(military.civilianAdults) || 0);
  const atWar = !!military.activeCampaign || (military.pendingForceRequests || []).length > 0;
  const threatened = atWar || !!military.frontierAlert || (military.recentTerritoryLosses || []).length > 0;
  const foodDays = Math.max(0, Number.isFinite(report?.community?.foodBufferDays)
    ? report.community.foodBufferDays : 0);
  const shortages = foodDays < 14 || civilianAdults < Math.ceil(adults * .35);
  const preferredShare = atWar ? .6 : threatened ? .45 : shortages ? .25 : .35;
  const protectedCivilians = Math.max(8, Math.ceil(adults * .35));
  const target = Math.max(0, Math.min(Math.max(0, adults - protectedCivilians),
    Math.round(adults * preferredShare)));
  let action = 'hold';
  if (!atWar && soldiers > target) action = 'demobilize';
  else if (soldiers < target && civilianAdults > protectedCivilians
    && foodDays >= 14 && military.recruitment?.available) action = 'recruit';
  return { action, target, actual: soldiers, adultPopulation: adults,
    civilianAdults, protectedCivilians, preferredShare, atWar, threatened, foodDays };
}

export function updateKingdomForceBalance(world, kingdom, report) {
  // No synthetic citizens, no arbitrary recruitment and no mutation of
  // historic 96-person default worlds whose audits use the old initial roster.
  if (world.initialMilitaryShare !== .8 || !report || !kingdom) return null;
  const day = world.day + 1;
  if (day % FORCE_POLICY_REVIEW_DAYS !== 0
    || kingdom.forcePolicy?.lastReviewedDay === day) return null;
  const decision = planKingdomForceBalance(report);
  const members = (world.people || []).filter(p => p.alive && p.kingdomId === kingdom.id);
  let changed = 0;
  if (decision.action === 'demobilize') {
    const limit = Math.min(12, Math.max(3, Math.ceil(decision.adultPopulation * .1)),
      Math.max(0, decision.actual - decision.target));
    const canDischarge = person => person.role === 'soldier' && person.campaignId == null
      && person.towerDutyId == null && !person.towerMounted
      && !person.playerControlled && !person.militaryReturningHome && !person.fieldCommand
      && !['general', 'comandante'].includes(person.militaryRank);
    const retiring = members.filter(canDischarge)
      .sort((a, b) => militaryMerit(a) - militaryMerit(b) || a.id - b.id)
      .slice(0, limit);
    for (const person of retiring) if (dischargeSoldier(world, person, day)) changed++;
    if (changed) updateMilitaryCommand(world, day);
  } else if (decision.action === 'recruit') {
    // Each enlistment uses the current treasury inventory, training delay and
    // garrison source rules. Do not take the last essential civilian workers.
    const limit = Math.min(3, decision.target - decision.actual,
      Math.max(0, decision.civilianAdults - decision.protectedCivilians));
    const training = members.filter(p => p.recruitmentOrder).length;
    for (let i = training; i < limit; i++) {
      const result = recruitKingdomSoldier(world, kingdom.id, { startedDay: day });
      if (!result.ok) break;
      changed++;
    }
  }
  kingdom.forcePolicy = {
    ...decision, lastReviewedDay: day, changed,
    resultingSoldiers: members.filter(p => p.role === 'soldier').length,
    trainingOrders: members.filter(p => p.recruitmentOrder).length
  };
  if (changed) {
    const label = decision.action === 'demobilize' ? 'desmobilizou' : 'iniciou treinamento de';
    log(world, kingdom.name + ' ' + label + ' ' + changed
      + ' moradores por decisão do rei; ' + kingdom.forcePolicy.resultingSoldiers
      + ' militares ativos, ' + (decision.civilianAdults + (decision.action === 'demobilize' ? changed : -changed))
      + ' civis adultos (estimativa ao iniciar treinamento), meta ' + decision.target
      + '. Regra: preservar trabalho civil, alimento e defesa.', day);
  }
  return kingdom.forcePolicy;
}
