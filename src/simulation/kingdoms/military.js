import { COMBAT_RESOURCES, initializeCombatResources, spendAttackStamina, recordArrow,
  canSpendDefenseStamina, spendDefenseStamina, isCombatDisarmed } from './combat-resources.js';
import { attackTower } from './fortifications.js';
import { rand } from '../core/random.js';
import { distance, clamp } from '../core/math.js';
import { changePersonHealth, killPerson } from '../individuals/lifecycle.js';
import { moveOne } from '../individuals/movement.js';
import { log } from '../core/events.js';
import { updateServiceGrades } from './frontier-intelligence.js';
import { clearMilitaryCommand } from './military-identity.js';
import { createCombatAction, resolveCombatAction, frontGuard } from './combat-contact.js';
import { cellAt } from '../world/spatial.js';
import { canTraverseElevation } from '../world/island-terrain.js';
import { collidesWithWorldPositionAt, worldCollisionIndex } from '../physics/hitboxes.js';
import { peopleNear } from '../individuals/spatial-index.js';

export const MILITARY_CLASSES = Object.freeze({
  guerreiro: { label: 'Infantaria', vitality: 360, range: 1.8, damage: 18, dodge: .12, block: .42 },
  lanceiro: { label: 'Lanceiro', vitality: 300, range: 3.2, damage: 15, dodge: .18, block: .32 },
  arqueiro: { label: 'Arqueiro', vitality: 220, range: 8, damage: 14, dodge: .3, block: .08 },
  monge: { label: 'Clérigo', vitality: 240, range: 6, damage: 0, dodge: .45, block: .05,
    healRadius: 3, healing: 24, areaHealing: 16, healCooldownDays: 6 }
});

const COMBAT_KNOCKBACK = Object.freeze({ guerreiro: .28, lanceiro: .34, arqueiro: .12 });
const COMBO_MAX = 3;
const COMBO_DAMAGE_STEP = .1;

export function combatEngagementRange(militaryClass) {
  const spec = MILITARY_CLASSES[militaryClass];
  if (!spec || !['guerreiro', 'lanceiro'].includes(militaryClass)) return null;
  const approachBuffer = militaryClass === 'guerreiro' ? .55 : .7;
  return Math.max(.65, spec.range - approachBuffer);
}

function nudgePersonFrom(world, person, threat, amount) {
  if (!person || !threat || !Number.isFinite(amount) || amount <= 0 || person.towerMounted) return false;
  let dx = person.x - threat.x, dy = person.y - threat.y;
  let length = Math.hypot(dx, dy);
  if (length < 1e-6) { dx = 1; dy = 0; length = 1; }
  dx /= length; dy /= length;
  const fromTile = cellAt(world, person.x, person.y);
  if (!fromTile) return false;
  const collisionIndex = worldCollisionIndex(world);
  for (const scale of [1, .7, .4]) {
    const x = person.x + dx * amount * scale, y = person.y + dy * amount * scale;
    const toTile = cellAt(world, x, y);
    if (!toTile || toTile.terrain === 'water' || toTile.terrain === 'rock'
        || !canTraverseElevation(fromTile, toTile)
        || collidesWithWorldPositionAt(world, person, x, y, collisionIndex)) continue;
    const occupied = peopleNear(world, x, y, .55).some(other => other !== person && other.alive
      && Math.hypot(other.x - x, other.y - y) < .42);
    if (occupied) continue;
    person.x = x; person.y = y;
    person.navigationRoute = null;
    person.navigationCongestion = 0;
    world.peopleSpatialIndex?.move(person);
    return true;
  }
  return false;
}

const HEALING_HEALTH_THRESHOLD = 95;

export function selectHealingTarget(cleric, allies, range = MILITARY_CLASSES.monge.range) {
  return allies.filter(p => p.alive && p.kingdomId === cleric.kingdomId && p.health < HEALING_HEALTH_THRESHOLD
    && distance(cleric, p) <= range)
    .sort((a, b) => a.health - b.health || (b.injury || 0) - (a.injury || 0)
      || distance(cleric, a) - distance(cleric, b) || a.id - b.id)[0] || null;
}

export function castAreaHealing(world, cleric, allies, day) {
  const spec = MILITARY_CLASSES.monge;
  if (!cleric.alive || cleric.role !== 'soldier' || cleric.militaryClass !== 'monge'
    || day < (cleric.nextHealingDay ?? -Infinity)) return [];
  initializeCombatResources(cleric);
  if (cleric.mana < COMBAT_RESOURCES.healingCost) { cleric.state = 'recuperando mana'; return []; }
  const patient = selectHealingTarget(cleric, allies);
  if (!patient) return [];
  const healed = [];
  for (const ally of allies) {
    if (!ally.alive || ally.kingdomId !== cleric.kingdomId || ally.health >= HEALING_HEALTH_THRESHOLD
      || distance(patient, ally) > spec.healRadius) continue;
    const points = ally.id === patient.id ? spec.healing : spec.areaHealing;
    const restored = changePersonHealth(world, ally, points / (ally.maxCombatHealth || 100) * 100, 'cleric-healing');
    if (restored <= 0) continue;
    ally.injury = Math.max(0, (ally.injury || 0) - .3);
    ally.lastHealingSequence = (ally.lastHealingSequence || 0) + 1;
    ally.lastHealing = { day, casterId: cleric.id, healthRestored: restored,
      primaryTargetId: patient.id };
    healed.push(ally.id);
  }
  if (!healed.length) return [];
  cleric.mana -= COMBAT_RESOURCES.healingCost;
  cleric.nextHealingDay = day + spec.healCooldownDays;
  cleric.militaryAnimation = 'heal'; cleric.militaryAnimationDay = day;
  cleric.militaryFacingX = patient.x - cleric.x; cleric.militaryFacingY = patient.y - cleric.y;
  cleric.militaryMerit = (cleric.militaryMerit || 0) + healed.length * .2;
  cleric.lastHealingCast = { day, primaryTargetId: patient.id, recipientIds: healed };
  cleric.state = 'curando os mais feridos em área';
  return healed;
}

export function updateClericHealing(world, day) {
  const living = world.people.filter(p => p.alive);
  for (const cleric of living) if (cleric.role === 'soldier' && cleric.militaryClass === 'monge')
    castAreaHealing(world, cleric, living, day);
}

export function militaryMerit(person) {
  return (person.militaryMerit || 0) + (person.militaryTraining || 0) * 10
    + (person.prestige || 0) + (person.loyalty || 0) * 5;
}

// Keep surviving units together. Vacancies are filled by merit, never by array order.
export function updateMilitaryCommand(world, day = world.day + 1) {
  const kingdomIds = new Set(world.kingdoms.map(kingdom => kingdom.id));
  for (const person of world.people) {
    if (person.role !== 'soldier' || !kingdomIds.has(person.kingdomId)) clearMilitaryCommand(person);
  }
  for (const kingdom of world.kingdoms) {
    const troops = world.people.filter(p => p.alive && p.role === 'soldier' && p.kingdomId === kingdom.id);
    updateServiceGrades(world, troops, day);
    const ranked = troops.slice().sort((a, b) => militaryMerit(b) - militaryMerit(a) || a.id - b.id);
    const old = kingdom.militaryCommand || { units: [], generalIds: [] };
    const living = new Set(troops.map(p => p.id));
    const generalCount = troops.length ? Math.ceil(troops.length / 50) : 0;
    const generals = old.generalIds.filter(id => living.has(id)).slice(0, generalCount);
    for (let i = 0; i < generals.length; i++) {
      const incumbent = troops.find(p => p.id === generals[i]);
      const challenger = ranked.find(p => !generals.includes(p.id));
      if (challenger && militaryMerit(challenger) > militaryMerit(incumbent) + 15) {
        generals[i] = challenger.id;
        log(world, kingdom.name + ': ' + challenger.name + ' assumiu como general por mérito e prestígio superiores.', day);
      }
    }
    for (const p of ranked) if (generals.length < generalCount && !generals.includes(p.id)) generals.push(p.id);
    const units = old.units.map(unit => ({ ...unit, memberIds: unit.memberIds.filter(id => living.has(id)) })).filter(unit => unit.memberIds.length);
    const assigned = new Set(units.flatMap(unit => unit.memberIds));
    for (const p of ranked.filter(p => !assigned.has(p.id))) {
      let unit = units.find(unit => unit.memberIds.length < 10);
      if (!unit) { unit = { id: kingdom.id + ':unit:' + world.nextId++, memberIds: [], commanderId: null }; units.push(unit); }
      unit.memberIds.push(p.id);
    }
    troops.forEach(p => { p.militaryRank = p.militaryGrade || 'soldado'; });
    units.forEach((unit, index) => {
      unit.generalId = generals[Math.floor(index / 5)] || generals[0];
      if (!unit.memberIds.includes(unit.commanderId) || generals.includes(unit.commanderId)) {
        unit.commanderId = ranked.find(p => unit.memberIds.includes(p.id) && !generals.includes(p.id))?.id ?? unit.memberIds[0];
      }
      const incumbent = troops.find(p => p.id === unit.commanderId);
      const challenger = ranked.find(p => unit.memberIds.includes(p.id) && !generals.includes(p.id));
      if (incumbent && challenger && militaryMerit(challenger) > militaryMerit(incumbent) + 15) unit.commanderId = challenger.id;
      for (const id of unit.memberIds) {
        const p = troops.find(p => p.id === id);
        p.militaryUnitId = unit.id; p.commanderId = unit.commanderId; p.generalId = unit.generalId;
        if (id === unit.commanderId) p.militaryRank = 'comandante';
      }
    });
    generals.forEach(id => {
      const general = troops.find(p => p.id === id);
      general.militaryRank = 'general';
      for (const tower of world.structures) if (tower.archerId === id) tower.archerId = null;
      general.towerDutyId = null; general.towerMounted = false;
      general.towerEntryReady = false; general.towerRecovering = false;
    });
    if (old.generalIds.some(id => !living.has(id))) log(world, kingdom.name + ': sucessão do general por mérito; a cadeia de comando foi reorganizada.', day);
    for (const unit of units) {
      const previous = old.units.find(item => item.id === unit.id);
      if (previous?.commanderId && previous.commanderId !== unit.commanderId) log(world, kingdom.name + ': o próximo militar por mérito assumiu o comando da unidade.', day);
    }
    kingdom.militaryCommand = { generalIds: generals, units, updatedDay: day };
  }
}

export function tacticalDestination(world, person, destination) {
  const kingdom = world.kingdoms.find(k => k.id === person.kingdomId);
  const units = kingdom?.militaryCommand?.units || [];
  if (person.health < 28) person.tacticalRecovering = true;
  if (person.health >= 60) person.tacticalRecovering = false;
  if (person.tacticalRecovering && kingdom) return { x: kingdom.x, y: kingdom.y };
  const unit = units.find(u => u.id === person.militaryUnitId);
  if (!unit) return destination;
  if (person.militaryClass === 'monge') {
    const patient = selectHealingTarget(person, world.people, 12);
    if (patient && distance(person, patient) > MILITARY_CLASSES.monge.range - 1) return { x: patient.x, y: patient.y };
  }
  const commander = world.people.find(p => p.id === unit.commanderId && p.alive);
  const anchor = commander && commander.id !== person.id && distance(commander, destination) > 5 ? commander : destination;
  const index = unit.memberIds.indexOf(person.id), unitIndex = units.indexOf(unit);
  const dx = destination.x - kingdom.x, dy = destination.y - kingdom.y, length = Math.hypot(dx, dy) || 1;
  const front = person.militaryClass === 'guerreiro' ? 1.5 : person.militaryClass === 'lanceiro' ? 0 : person.militaryClass === 'arqueiro' ? -3 : -5;
  const lateral = (index % 3 - 1) * 1.2 + (unitIndex - (units.length - 1) / 2) * 3;
  return { x: anchor.x + dx / length * front - dy / length * lateral,
    y: anchor.y + dy / length * front + dx / length * lateral };
}

export function battlefieldOpponents(world, campaign, kingdomId) {
  const opponentId = campaign.attackerId === kingdomId ? campaign.defenderId : campaign.attackerId;
  return world.people.filter(p => p.alive && p.kingdomId === opponentId && p.restingStructureId == null
    && distance(p, campaign.target) <= 16);
}

export function fightBattlefieldSkirmishes(world, day) {
  for (const campaign of world.campaigns || []) {
    if (!['marching', 'engaged', 'contested'].includes(campaign.status)) continue;
    for (const kingdomId of [campaign.attackerId, campaign.defenderId]) {
      const enemies = battlefieldOpponents(world, campaign, kingdomId);
      if (!enemies.some(p => p.role !== 'soldier')) continue;
      const troops = world.people.filter(p => p.alive && p.role === 'soldier' && p.kingdomId === kingdomId
        && p.restingStructureId == null && distance(p, campaign.target) <= 16);
      fightTacticalRound(world, troops, enemies, day);
    }
  }
}

export function fightTacticalRound(world, allies, enemies, day, objective = null) {
  let casualties = 0;
  for (const person of allies) {
    if (!person.alive || person.militaryRestTargetId != null || person.restingStructureId != null) continue;
    if (person.combatDisarmedUntilDay != null && !isCombatDisarmed(person, day)) {
      delete person.combatDisarmedUntilDay;
      delete person.combatDisarmedById;
    }
    if (isCombatDisarmed(person, day)) {
      person.state = 'desarmado após parry';
      person.militaryAnimation = 'defend'; person.militaryAnimationDay = day;
      continue;
    }
    const spec = MILITARY_CLASSES[person.militaryClass] || MILITARY_CLASSES.lanceiro;
    const threats = enemies.filter(p => p.alive && p.restingStructureId == null
      && (person.kingdomId == null || p.kingdomId !== person.kingdomId));
    const threatenedAlly = allies.filter(ally => ally.alive && ally.id !== person.id
      && ally.health <= 75 && day - (ally.lastAttackedDay ?? -Infinity) <= 1
      && distance(person, ally) <= 6)
      .sort((a, b) => a.health - b.health || distance(person, a) - distance(person, b) || a.id - b.id)[0];
    const assistingThreat = threatenedAlly && threats.find(threat => threat.id === threatenedAlly.lastAttackedById
      && distance(person, threat) <= spec.range);
    const opening = person.combatOpening?.expiresDay > day ? person.combatOpening : null;
    if (!opening && person.combatOpening) person.combatOpening = null;
    const combo = person.combatCombo?.lastDay === day - 1
      && person.combatCombo.count < COMBO_MAX ? person.combatCombo : null;
    if (!combo && person.combatCombo) person.combatCombo = null;
    const openingThreat = opening && threats.find(threat => threat.id === opening.targetId);
    const comboThreat = combo && threats.find(threat => threat.id === combo.targetId);
    const designatedThreat = threats.find(threat => threat.id === person.combatTargetId);
    if (!designatedThreat && person.combatTargetId != null) person.combatTargetId = null;
    const nearestThreat = threats.sort((a, b) => distance(person, a) - distance(person, b) || a.id - b.id)[0];
    const enemy = openingThreat || comboThreat || designatedThreat || assistingThreat || nearestThreat;
    if (person.militaryClass === 'monge') {
      const healed = castAreaHealing(world, person, allies, day);
      if (!healed.length && enemy && distance(person, enemy) < 3) {
        moveOne(world, person, { x: person.x + (person.x - enemy.x || 1) * 2, y: person.y + (person.y - enemy.y) * 2 }, false);
        person.state = 'recuando para proteção';
      }
      continue;
    }
    if (objective?.attacking && (!enemy || distance(person, enemy) > 2 || person.id % 3 === 0)
      && attackTower(world, person, objective.tower, day) > 0) continue;
    if (!enemy) continue;
    person.militaryFacingX = enemy.x - person.x; person.militaryFacingY = enemy.y - person.y;
    if (person.health < 28 || (!person.towerMounted && ['monge', 'arqueiro'].includes(person.militaryClass) && distance(person, enemy) < 3)) {
      moveOne(world, person, { x: person.x + (person.x - enemy.x || 1) * 2, y: person.y + (person.y - enemy.y) * 2 }, false);
      person.state = 'recuando para proteção';
    }
    const attackRange = spec.range + (person.towerMounted ? 6 : 0);
    const reliableRange = person.towerMounted ? attackRange : combatEngagementRange(person.militaryClass) ?? attackRange;
    if (person.health < 28 || distance(person, enemy) > reliableRange) continue;
    const isOpeningAttack = openingThreat?.id === enemy.id;
    const comboIndex = Math.min(COMBO_MAX, isOpeningAttack
      ? Math.max(2, comboThreat?.id === enemy.id ? combo.count + 1 : 2)
      : comboThreat?.id === enemy.id ? combo.count + 1 : 1);
    if (!spendAttackStamina(person, day, { combo: comboIndex > 1 })) {
      person.state = 'recuperando estamina'; continue;
    }
    const action = createCombatAction(world, person, enemy, day, {
      reach: spec.range + (person.towerMounted ? 6 : 0), comboIndex });
    if (!action) continue;
    recordArrow(person, enemy, day, action);
    person.lastMilitaryAttackDay = day;
    person.attackingTowerId = null;
    person.militaryAnimation = 'attack'; person.militaryAnimationDay = day;
    person.state = person.militaryClass === 'arqueiro' ? 'disparando à distância' : person.militaryClass === 'lanceiro' ? 'apoiando a linha de infantaria' : 'combatendo na linha de frente';
    const defenderDisarmed = isCombatDisarmed(enemy, day);
    const defenseSpec = enemy.role === 'soldier' ? MILITARY_CLASSES[enemy.militaryClass] || MILITARY_CLASSES.lanceiro
      : { vitality: 100, dodge: .05, block: 0 };
    const defense = defenderDisarmed ? { ...defenseSpec, block: 0 } : defenseSpec;
    const defensiveTraining = clamp(enemy.militaryTraining || 0, 0, 1);
    let dodge = null;
    if (!enemy.towerMounted && rand(world) < defense.dodge + defensiveTraining * .04) {
      const from = { x: enemy.x, y: enemy.y };
      moveOne(world, enemy, { x: enemy.x - (person.y - enemy.y || 1), y: enemy.y + (person.x - enemy.x) }, false);
      dodge = { from, to: { x: enemy.x, y: enemy.y } };
      enemy.x = from.x; enemy.y = from.y;
      enemy.militaryAnimation = 'run'; enemy.militaryAnimationDay = day;
    }
    const guarding = new Set(), parrying = new Set(), parryWindows = new Map();
    const canGuard = !defenderDisarmed && enemy.role === 'soldier'
      && ['guerreiro', 'lanceiro'].includes(enemy.militaryClass)
      && (enemy.militaryClass !== 'lanceiro' || person.militaryClass !== 'arqueiro')
      && frontGuard(enemy, person) && canSpendDefenseStamina(enemy);
    if (canGuard && rand(world) < Math.min(.9, defense.block + defensiveTraining * .05)) {
      guarding.add(enemy.id);
      const parryChance = enemy.militaryClass === 'guerreiro' ? .24 : .18;
      if (person.militaryClass !== 'arqueiro' && canSpendDefenseStamina(enemy, true)
          && rand(world) < parryChance + defensiveTraining * .24) {
        parrying.add(enemy.id);
        parryWindows.set(enemy.id, 38 + defensiveTraining * 28);
      }
    }
    const strength = spec.damage * (1 + clamp(person.militaryTraining || 0, 0, 1) * .1) * (.85 + rand(world) * .3);
    const result = resolveCombatAction(world, person, action, threats, (victim, blocked) => {
      if (blocked) spendDefenseStamina(victim);
      else nudgePersonFrom(world, victim, person, COMBAT_KNOCKBACK[person.militaryClass] || .2);
      const vitality = victim.role === 'soldier' ? victim.maxCombatHealth || MILITARY_CLASSES[victim.militaryClass]?.vitality || 300 : 100;
      const comboMultiplier = 1 + (action.comboIndex - 1) * COMBO_DAMAGE_STEP;
      const appliedHealth = -changePersonHealth(world, victim,
        -strength * comboMultiplier * (blocked ? .3 : 1) / vitality * 100, 'battle');
      const damage = appliedHealth * vitality / 100;
      victim.lastAttackedDay = day; victim.lastAttackedById = person.id;
      victim.injury = clamp((victim.injury || 0) + damage / 120, 0, 10);
      person.militaryMerit = (person.militaryMerit || 0) + damage / 30;
      person.combatDamageDealt = (person.combatDamageDealt || 0) + damage;
      if (victim.health <= 0) {
        killPerson(world, victim, 'combat'); casualties++; person.militaryMerit += 3;
        person.combatVictories = (person.combatVictories || 0) + 1;
      }
      return damage;
    }, { guarding, parrying, parryWindows, beforeStep: elapsed => {
      if (!dodge) return;
      const progress = Math.min(1, elapsed / action.windupMs);
      enemy.x = dodge.from.x + (dodge.to.x - dodge.from.x) * progress;
      enemy.y = dodge.from.y + (dodge.to.y - dodge.from.y) * progress;
    } });
    if (isOpeningAttack) person.combatOpening = null;
    if (result.kind === 'parry') {
      spendDefenseStamina(enemy, true);
      person.combatDisarmedUntilDay = Math.max(person.combatDisarmedUntilDay || 0, day + 2);
      person.combatDisarmedById = enemy.id;
      person.combatCombo = null;
      person.combatOpening = null;
      person.lastParriedDay = day; person.lastParriedById = enemy.id;
      person.militaryAnimation = 'defend'; person.militaryAnimationDay = day;
      person.state = 'desarmado após parry';
      nudgePersonFrom(world, person, enemy, .2);
      enemy.combatCombo = null;
      enemy.combatOpening = { targetId: person.id, expiresDay: day + 2 };
      enemy.state = 'abriu a guarda com um parry';
    } else if (result.kind === 'body' && result.damageApplied > 0 && enemy.alive) {
      person.combatCombo = { targetId: enemy.id, count: comboIndex, lastDay: day };
    } else {
      person.combatCombo = null;
    }
  }
  return casualties;
}
