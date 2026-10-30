import { spendAttackStamina, recordArrow } from './combat-resources.js';
import { magicModifiers } from '../magic/effects.js';
import { captureMissionFor, TOWER_CAPTURE_RULES } from './tower-capture.js';
import { dropStructureLoot } from '../economy/loot.js';
import { distance } from '../core/math.js';
import { log } from '../core/events.js';
import { recomputeKingdomTerritories } from './territories.js';
import { invalidateNavigation } from '../individuals/navigation-cache.js';
import { recordRoyalSitingOutcome } from './royal-siting.js';
import { createCombatAction, resolveCombatAction } from './combat-contact.js';

export const TOWER_HEALTH = Object.freeze({ fortified: 6000, frontier: 4000, constructionFraction: .25 });
export const STRUCTURE_HEALTH = Object.freeze({ castelo: 10000, casa: 2000, curral: 3000, vila: 4000, mercado: 3000, centro_militar: 4000, monasterio: 3000, arquearia: 3000, abrigo: 2000, 'posto de coleta': 3000, acampamento: 3000, roça: 1000 });
const SIEGE_ATTACKS = Object.freeze({
  guerreiro: { range: 3.8, damage: 24 },
  lanceiro: { range: 4.5, damage: 18 },
  arqueiro: { range: 9, damage: 12 }
});

export function structureVitality(tower) {
  const maxHealth = tower.maxHealth || (tower.type === 'torre' ? tower.frontierOutpost ? TOWER_HEALTH.frontier : TOWER_HEALTH.fortified : STRUCTURE_HEALTH[tower.type] || 2000);
  const progress = tower.complete ? 1 : Math.max(0, Math.min(1, (tower.progress || 0) / (tower.required || 1)));
  const fallback = tower.destroyedDay != null || tower.integrity <= 0 ? 0
    : maxHealth * (TOWER_HEALTH.constructionFraction + (1 - TOWER_HEALTH.constructionFraction) * progress);
  return { maxHealth, health: Math.max(0, Math.min(maxHealth, tower.destroyedDay != null || tower.integrity <= 0 ? 0 : Number.isFinite(tower.health) ? tower.health : fallback)) };
}

export function initializeStructureHealth(tower) {
  if (tower.type !== 'torre' && !STRUCTURE_HEALTH[tower.type]) return;
  Object.assign(tower, structureVitality(tower));
}

export function campaignStructure(world, campaign) {
  return world.structures.find(s => s.id === campaign.evidence?.structureId && (s.type === 'torre' || STRUCTURE_HEALTH[s.type])) || null;
}

export function destroyStructureInWorld(world, tower, day, attackerId = null, reason = 'siege') {
  if (tower.destroyedDay != null) return false;
  recordRoyalSitingOutcome(world, tower, 'lost', day);
  tower.health = 0; tower.integrity = 0; tower.complete = false;
  tower.destroyedDay = day; tower.destroyedByKingdomId = attackerId; tower.destroyedCause = reason;
  invalidateNavigation(world);
  // A destroyed worksite must never start building again without a new paid project.
  tower.builtDay ??= day;
  tower.siegeBlocked = true; tower.garrisonSoldierId = null;
  tower.archerId = null;
  for (const person of world.people) if (person.towerDutyId === tower.id) {
    person.towerDutyId = null; person.towerMounted = false;
  }
  const owner = world.kingdoms.find(k => k.id === tower.kingdomId);
  if (owner) {
    owner.homeIds = (owner.homeIds || []).filter(id => id !== tower.id);
    owner.militaryCenterIds = (owner.militaryCenterIds || []).filter(id => id !== tower.id);
    owner.towerIds = (owner.towerIds || []).filter(id => id !== tower.id);
    owner.structureIds = (owner.structureIds || []).filter(id => id !== tower.id);
  }
  for (const person of world.people) if (person.militaryDutyPostId === tower.id) {
    person.militaryDutyPostId = null; person.patrolRoute = null;
  }
  for (const person of world.people) if (person.homeId === tower.id) person.homeId = null;
  dropStructureLoot(world, tower, day);
  recomputeKingdomTerritories(world, attackerId == null ? null : { attackerId, defenderId: tower.kingdomId, day });
  log(world, (owner?.name || 'O reino') + ' perdeu ' + tower.type + ' em ' + tower.x + ',' + tower.y
    + (reason === 'siege' ? ' após sua vida chegar a zero durante o cerco.' : ' por falta de manutenção.'), day);
  return true;
}

export function damageStructure(world, tower, damage, day, attackerId) {
  if ((tower.type !== 'torre' && !STRUCTURE_HEALTH[tower.type]) || tower.destroyedDay != null || tower.kingdomId === attackerId
    || !Number.isFinite(damage) || damage <= 0) return 0;
  initializeStructureHealth(tower);
  if (tower.health <= 0) return 0;
  const applied = Math.min(tower.health, damage);
  tower.health -= applied;
  tower.lastAttackedDay = day; tower.lastAttackSequence = (tower.lastAttackSequence || 0) + 1;
  tower.siegeDamageTaken = (tower.siegeDamageTaken || 0) + applied;
  if (tower.health === 0) destroyStructureInWorld(world, tower, day, attackerId);
  return applied;
}

export function attackStructure(world, person, tower, day) {
  const attack = SIEGE_ATTACKS[person.militaryClass];
  if (!attack || !person.alive || person.role !== 'soldier' || person.health < 28
    || person.kingdomId === tower.kingdomId || tower.destroyedDay != null
    || day - (person.lastMilitaryAttackDay ?? -Infinity) < 2 || distance(person, tower) > attack.range) return 0;
  const capture = tower.type === 'torre' && captureMissionFor(world, person, tower);
  const damageLimit = capture ? Math.max(0, structureVitality(tower).health - structureVitality(tower).maxHealth * TOWER_CAPTURE_RULES.healthFraction) : Infinity;
  if (damageLimit <= 0 || !spendAttackStamina(person, day)) return 0;
  const action = createCombatAction(world, person, tower, day, { structure: true, reach: attack.range });
  recordArrow(person, tower, day, action);
  const contact = resolveCombatAction(world, person, action, [tower],
    () => damageStructure(world, tower, Math.min(attack.damage * magicModifiers(person, world).damage, damageLimit), day, person.kingdomId));
  const damage = contact.damageApplied || 0;
  // A miss still consumes the attack, preventing repeated free attempts this day.
  person.lastMilitaryAttackDay = day;
  if (damage > 0) {
    person.lastMilitaryAttackDay = day; person.attackingTowerId = tower.id; person.attackingStructureId = tower.id;
    person.militaryAnimation = 'attack'; person.militaryAnimationDay = day;
    person.militaryFacingX = tower.x - person.x; person.militaryFacingY = tower.y - person.y;
    person.state = person.militaryClass === 'arqueiro' ? 'disparando contra a construção' : 'atacando a construção inimiga';
    person.militaryMerit = (person.militaryMerit || 0) + damage / 100;
  }
  return damage;
}

export function towerBattlePosition(world, person, tower, side, opponents) {
  if (person.militaryClass === 'monge' || person.health < 28 || person.tacticalRecovering) return null;
  const threats = opponents.filter(p => p.alive && distance(p, tower) <= 12)
    .sort((a, b) => Number(b.attackingTowerId === tower.id) - Number(a.attackingTowerId === tower.id)
      || distance(a, tower) - distance(b, tower) || a.id - b.id);
  if (side.role === 'defender' && threats.length) {
    const threat = threats[0];
    const dx = tower.x - threat.x, dy = tower.y - threat.y, length = Math.hypot(dx, dy) || 1;
    const offset = Math.min(length, person.militaryClass === 'arqueiro' ? 5 : 1);
    return { x: threat.x + dx / length * offset, y: threat.y + dy / length * offset };
  }
  const home = world.kingdoms.find(k => k.id === person.kingdomId) || tower;
  const baseAngle = Math.atan2(home.y - tower.y, home.x - tower.x);
  const spread = ((person.id % 9) - 4) * .14;
  const radius = person.militaryClass === 'arqueiro' ? 6 : person.militaryClass === 'lanceiro' ? 2.6 : 2;
  return { x: tower.x + Math.cos(baseAngle + spread) * radius, y: tower.y + Math.sin(baseAngle + spread) * radius };
}

// Compatibility for callers that originally handled towers only.
export const towerVitality = structureVitality;
export const initializeTowerHealth = initializeStructureHealth;
export const campaignTower = campaignStructure;
export const destroyTowerInWorld = destroyStructureInWorld;
export const damageTower = damageStructure;
export const attackTower = attackStructure;
