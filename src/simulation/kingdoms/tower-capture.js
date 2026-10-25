import { distance } from '../core/math.js';
import { log } from '../core/events.js';
import { recomputeKingdomTerritories } from './territories.js';
import { recordRoyalSitingOutcome } from './royal-siting.js';

export const TOWER_CAPTURE_RULES = Object.freeze({ healthFraction: .25, occupationDays: 5, assaultRadius: 4, defenseRadius: 6 });

export function captureMissionFor(world, person, tower) {
  return (world.campaigns || []).find(c => c.id === person.campaignId && c.attackerId === person.kingdomId
    && c.evidence?.structureId === tower.id && c.evidence?.mission === 'capture-tower'
    && ['mobilizing', 'marching', 'engaged'].includes(c.status)) || null;
}

export function advanceTowerCapture(world, campaign, tower, attackers, defenders, day) {
  if (campaign.evidence?.mission !== 'capture-tower' || tower.type !== 'torre' || !tower.complete
    || tower.destroyedDay != null || tower.health <= 0 || tower.kingdomId === campaign.attackerId) return false;
  const assault = attackers.filter(p => p.alive && p.health >= 28 && ['guerreiro', 'lanceiro'].includes(p.militaryClass)
    && distance(p, tower) <= TOWER_CAPTURE_RULES.assaultRadius);
  // Include posted sentries as well as the campaign's field troops.
  const resistance = world.people.filter(p => p.alive && p.role === 'soldier' && p.kingdomId === tower.kingdomId
    && p.health >= 28 && distance(p, tower) <= TOWER_CAPTURE_RULES.defenseRadius);
  const ready = tower.health <= tower.maxHealth * TOWER_CAPTURE_RULES.healthFraction
    && assault.length >= 2 && !resistance.length;
  if (!ready) campaign.captureProgressDays = 0;
  else if (campaign.lastCaptureProgressDay !== day) {
    campaign.captureProgressDays = campaign.lastCaptureProgressDay === day - 1 ? (campaign.captureProgressDays || 0) + 1 : 1;
    campaign.lastCaptureProgressDay = day;
  }
  tower.captureProgressDays = campaign.captureProgressDays || 0;
  tower.captureById = ready ? campaign.attackerId : null;
  if (tower.captureProgressDays < TOWER_CAPTURE_RULES.occupationDays) return false;
  const oldOwner = world.kingdoms.find(k => k.id === tower.kingdomId);
  const newOwner = world.kingdoms.find(k => k.id === campaign.attackerId);
  if (!newOwner) return false;
  const priorOwnerId = tower.kingdomId;
  recordRoyalSitingOutcome(world, tower, 'lost', day);
  for (const field of ['structureIds', 'towerIds']) {
    if (oldOwner) oldOwner[field] = (oldOwner[field] || []).filter(id => id !== tower.id);
    newOwner[field] ||= [];
    if (!newOwner[field].includes(tower.id)) newOwner[field].push(tower.id);
  }
  for (const p of world.people) {
    if (p.towerDutyId === tower.id) { p.towerDutyId = null; p.towerMounted = false; }
    if (p.kingdomId === priorOwnerId && p.militaryDutyPostId === tower.id) {
      p.militaryDutyPostId = null; p.patrolRoute = null; p.patrolCenterId = null;
    }
  }
  tower.kingdomId = newOwner.id; tower.communityId = newOwner.communityId || null;
  tower.archerId = null; tower.garrisonSoldierId = null; tower.siegeBlocked = false;
  tower.capturedDay = day; tower.priorOwnerId = priorOwnerId; tower.captureById = null;
  tower.captureProgressDays = 0;
  campaign.capturedTowerId = tower.id;
  campaign.territorialChange = { towerId: tower.id, ownerId: newOwner.id, priorOwnerId,
    x: tower.x, y: tower.y, radius: tower.territoryRadius || 13, day };
  recomputeKingdomTerritories(world, { day });
  log(world, newOwner.name + ' capturou a torre ' + tower.id + ' após cinco dias de ocupação. A fortificação mudou de bandeira e ampliou o domínio.', day);
  return true;
}
