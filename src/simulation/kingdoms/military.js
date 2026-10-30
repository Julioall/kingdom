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
import { createCombatAction, resolveCombatAction, frontGuard, isCombatTargetEligible, segmentCircle, BODY_RADIUS } from './combat-contact.js';
import { cellAt } from '../world/spatial.js';
import { canTraverseElevation } from '../world/island-terrain.js';
import { combatPathObstruction, collidesWithWorldPositionAt, worldMovementBlocked, worldCollisionIndex } from '../physics/hitboxes.js';
import { peopleNear } from '../individuals/spatial-index.js';
import { TERRITORY_AVOIDANCE_DAYS } from './territories.js';
import { damageTrainingDummy, trainingDummiesForWorld } from '../world/training-dummies.js';
import { magicModifiers } from '../magic/effects.js';
import { updatePriestDecisions, chooseMagicAction, beginSpell } from '../magic/system.js';
import { stunCombatPerson } from './combat-status.js';
import { canUseAbility, abilityTargetLimit } from './ability-progression.js';
import { isTerritorialIntruder } from './border-defense.js';

export const MILITARY_CLASSES = Object.freeze({
  guerreiro: { label: 'Infantaria', vitality: 360, range: 1.8, damage: 18, dodge: .12, block: .42 },
  lanceiro: { label: 'Lanceiro', vitality: 300, range: 3.2, damage: 15, dodge: .18, block: .32 },
  arqueiro: { label: 'Arqueiro', vitality: 220, range: 8, damage: 14, dodge: .3, block: .08 },
  monge: { label: 'Clérigo', vitality: 240, range: 6, damage: 0, dodge: .45, block: .05,
    healRadius: 3, healing: 24, areaHealing: 16, healCooldownDays: 6 }
});

const COMBAT_KNOCKBACK = Object.freeze({ guerreiro: .28, lanceiro: .34, arqueiro: .12 });
const COMBO_MAX = 3;
const WARRIOR_COMBO_MAX = 4;
const COMBO_DAMAGE_STEP = .1;
const WARRIOR_SHIELD_BASH = Object.freeze({ minStamina: 28, staminaCost: 28, range: 2.1,
  advanceDistance: 5, shieldOffset: .4, radius: .34, damageMultiplier: 0, pushDistance: 1.05 });
const LANCER_FLURRY = Object.freeze({ minStamina: 24, staminaCost: 24, range: 3.2,
  durationMs: 3000, speedMultiplier: 1.5, strikeIntervalMs: 233, thrustDurationMs: 93,
  noContactTimeoutMs: 1000, damageMultiplier: .14, pushDistance: .06 });
const LANCER_CHARGE = Object.freeze({ minStamina: 28, staminaCost: 28, range: 4.9,
  advanceDistance: 3.5, weaponOffset: .9, radius: .2, damageMultiplier: 0, pushDistance: .58 });
const ARCHER_ATTACKS = Object.freeze({
  standard: { minStamina: 8, staminaCost: 8, damageMultiplier: .5, range: 8, weight: .38 },
  rain: { minStamina: 80, damageMultiplier: 1, range: 7, areaRadius: 1.8,
    splashMultiplier: 3, arrowCount: 36, rainDurationMs: 3000, weight: .12 },
  cone: { minStamina: 32, staminaCost: 32, damageMultiplier: .75, range: 5,
    arrowCount: 3, halfAngle: .22, weight: .22 },
  charged: { minStamina: 24, staminaCost: 24, damageMultiplier: 1, range: 14, weight: .28 }
});

export function manualAttackProfile(person, actionKey, comboIndexOverride = null) {
  if (person.role !== 'soldier') return null;
  const key = String(actionKey);
  const required = person.militaryClass === 'guerreiro' ? ({ '2': 'combo', '3': 'shield-bash' })[key]
    : person.militaryClass === 'lanceiro' ? ({ '2': 'lance-flurry', '3': 'lance-charge' })[key]
      : person.militaryClass === 'arqueiro' ? ({ '2': 'rain', '3': 'cone', '4': 'charged' })[key] : null;
  if (required && !canUseAbility(person, required)) return null;
  if (comboIndexOverride > 1 && !canUseAbility(person, 'combo')) comboIndexOverride = 1;
  if (person.militaryClass === 'guerreiro') {
    if (key === '1') return { attackVariant: null, comboIndex: comboIndexOverride ?? 1, range: MILITARY_CLASSES.guerreiro.range };
    if (key === '2') return { attackVariant: null, comboIndex: comboIndexOverride ?? 2, range: MILITARY_CLASSES.guerreiro.range };
    if (key === '3') return { attackVariant: 'shield-bash', comboIndex: 1, range: WARRIOR_SHIELD_BASH.range };
  }
  if (person.militaryClass === 'lanceiro') {
    if (key === '1') return { attackVariant: null, comboIndex: 1, range: MILITARY_CLASSES.lanceiro.range };
    if (key === '2') return { attackVariant: 'lance-flurry', comboIndex: 1, range: LANCER_FLURRY.range };
    if (key === '3') return { attackVariant: 'lance-charge', comboIndex: 1, range: LANCER_CHARGE.range };
  }
  if (person.militaryClass === 'arqueiro') {
    const attackVariant = ({ '1': 'standard', '2': 'rain', '3': 'cone', '4': 'charged' })[key];
    if (attackVariant) return { attackVariant, comboIndex: 1, ...ARCHER_ATTACKS[attackVariant] };
  }
  return null;
}

function manualTargetAlongAim(person, threats, command, profile) {
  const explicitTarget = threats.find(target => target.id === command.targetId);
  if (explicitTarget) return explicitTarget;
  if (profile.attackVariant === 'rain') {
    return threats.filter(target => distance(person, target) <= profile.range)
      .sort((a, b) => distance(a, { x: command.aimX, y: command.aimY })
        - distance(b, { x: command.aimX, y: command.aimY }) || a.id - b.id)[0] || null;
  }
  const dx = command.aimX - person.x, dy = command.aimY - person.y;
  const aimLength = Math.hypot(dx, dy);
  if (aimLength < 1e-6) return threats.slice().sort((a, b) => distance(person, a) - distance(person, b) || a.id - b.id)[0] || null;
  const directionX = dx / aimLength, directionY = dy / aimLength;
  const maxDistance = Math.min(profile.range, aimLength + .65);
  return threats.map(target => {
    const relativeX = target.x - person.x, relativeY = target.y - person.y;
    const along = relativeX * directionX + relativeY * directionY;
    const across = Math.abs(relativeX * directionY - relativeY * directionX);
    const angleAllowance = profile.attackVariant === 'cone'
      ? Math.max(.45, along * Math.tan(ARCHER_ATTACKS.cone.halfAngle) + .35)
      : profile.attackVariant == null && person.militaryClass === 'guerreiro' ? 1.15
        : person.militaryClass === 'arqueiro' ? .48 : .72;
    return { target, along, across, allowance: angleAllowance };
  }).filter(candidate => candidate.along >= -.2 && candidate.along <= maxDistance
    && candidate.across <= candidate.allowance)
    .sort((a, b) => a.across - b.across || a.along - b.along || a.target.id - b.target.id)[0]?.target || null;
}

function pendingPlayerAttack(person, day) {
  const queue = person.playerCommandQueue;
  if (Array.isArray(queue)) {
    while (queue.length && queue[0].expiresDay < day) queue.shift();
    person.playerCommand = queue[0] || null;
  } else if (person.playerCommand?.expiresDay < day) person.playerCommand = null;
  return person.playerCommand?.expiresDay >= day ? person.playerCommand : null;
}

function consumePlayerAttack(person, command, day) {
  if (!command || person.playerCommandUsedDay === day) return false;
  person.playerCommandUsedDay = day;
  if (Array.isArray(person.playerCommandQueue) && person.playerCommandQueue[0] === command)
    person.playerCommandQueue.shift();
  person.playerCommand = person.playerCommandQueue?.[0] || null;
  return true;
}

function chooseArcherAttack(person, world, target, towerMounted = false) {
  const stamina = person.stamina ?? COMBAT_RESOURCES.stamina;
  const rangeBonus = towerMounted ? 6 : 0;
  const available = Object.entries(ARCHER_ATTACKS).filter(([id, attack]) =>
    canUseAbility(person, id) && stamina >= attack.minStamina && distance(person, target) <= attack.range + rangeBonus);
  const totalWeight = available.reduce((total, [, attack]) => total + attack.weight, 0);
  if (!totalWeight) return null;
  let roll = rand(world) * totalWeight;
  for (const [name, attack] of available) {
    if (roll < attack.weight) return name;
    roll -= attack.weight;
  }
  return available[available.length - 1]?.[0] || null;
}

export function combatEngagementRange(militaryClass) {
  const spec = MILITARY_CLASSES[militaryClass];
  if (!spec || !['guerreiro', 'lanceiro'].includes(militaryClass)) return null;
  const approachBuffer = militaryClass === 'guerreiro' ? .55 : .7;
  return Math.max(.65, spec.range - approachBuffer);
}

function nudgePersonFrom(world, person, threat, amount, direction = null) {
  if (!person || !threat || !Number.isFinite(amount) || amount <= 0 || person.towerMounted) return false;
  let dx = direction?.x ?? person.x - threat.x, dy = direction?.y ?? person.y - threat.y;
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

export function launchCombatPerson(world, person, attacker, action, guarded = false) {
  if (!person?.alive || person.towerMounted) return false;
  const from = { x: person.x, y: person.y };
  const side = Math.sign((person.y - action.origin.y) * Math.cos(action.angle)
    - (person.x - action.origin.x) * Math.sin(action.angle)) || (person.id % 2 ? 1 : -1);
  const angle = action.angle + side * .28;
  const distance = guarded ? 1.2 : action.attackVariant === 'shield-bash' ? 3.2 : 2.8;
  const collision = worldCollisionIndex(world);
  let previous = from, previousTile = cellAt(world, from.x, from.y), destination = from;
  // Airborne bodies can pass through the formation, but never through walls,
  // water or cliffs. Landing samples must also be clear of another body.
  for (let i = 1, steps = Math.ceil(distance / .12); i <= steps; i++) {
    const progress = i / steps;
    const point = { x: from.x + Math.cos(angle) * distance * progress,
      y: from.y + Math.sin(angle) * distance * progress };
    const tile = cellAt(world, point.x, point.y);
    if (!tile || tile.terrain !== 'land' || !canTraverseElevation(previousTile, tile)
        || worldMovementBlocked(world, person, previous, point, collision)) break;
    const occupied = peopleNear(world, point.x, point.y, .6).some(other => other !== person && other.alive
      && other.restingStructureId == null && Math.hypot(other.x - point.x, other.y - point.y) < .45);
    if (!occupied) destination = point;
    previous = point; previousTile = tile;
  }
  person.x = destination.x; person.y = destination.y;
  person.navigationRoute = null; person.navigationCongestion = null;
  world.peopleSpatialIndex?.move(person);
  world.combatLaunchSequence = (world.combatLaunchSequence || 0) + 1;
  person.combatLaunch = { id: world.combatLaunchSequence, actionId: action.id, sourceId: attacker.id,
    from, to: { x: person.x, y: person.y }, durationMs: 600, atMs: 0,
    height: guarded ? .35 : .8 };
  stunCombatPerson(world, person, attacker.id, 3600);
  return true;
}

export function moveCombatPersonTo(world, person, target) {
  if (!person || !target || person.towerMounted) return false;
  if (isCombatDisarmed(person, world.day, world.magicTimeMs || 0)) return false;
  const dx = target.x - person.x, dy = target.y - person.y;
  if (Math.hypot(dx, dy) < 1e-5) return false;
  const fromTile = cellAt(world, person.x, person.y);
  if (!fromTile) return false;
  const collisionIndex = worldCollisionIndex(world);
  let blockedReason = 'blocked';
  for (const scale of [1, .7, .4]) {
    const x = person.x + dx * scale, y = person.y + dy * scale;
    const distanceToTarget = Math.hypot(x - person.x, y - person.y);
    const steps = Math.max(1, Math.ceil(distanceToTarget / .18));
    let previousTile = fromTile, previousPosition = { x: person.x, y: person.y }, clearPath = true;
    for (let step = 1; step <= steps; step++) {
      const progress = step / steps;
      const sampleX = person.x + (x - person.x) * progress;
      const sampleY = person.y + (y - person.y) * progress;
      const sampleTile = cellAt(world, sampleX, sampleY);
      const occupied = peopleNear(world, sampleX, sampleY, .55).some(other => other !== person && other.alive
        && other.restingStructureId == null && !other.towerMounted
        && Math.hypot(other.x - sampleX, other.y - sampleY) < .42
        && Math.hypot(other.x - sampleX, other.y - sampleY)
          <= Math.hypot(other.x - previousPosition.x, other.y - previousPosition.y) + 1e-7);
      const reason = !sampleTile ? 'map-edge'
        : sampleTile.terrain === 'water' ? 'water'
          : sampleTile.terrain === 'rock' ? 'rock'
            : !canTraverseElevation(previousTile, sampleTile) ? 'elevation'
              : worldMovementBlocked(world, person, previousPosition, { x: sampleX, y: sampleY }, collisionIndex) ? 'object'
                : occupied ? 'person' : null;
      if (reason) {
        blockedReason = reason;
        clearPath = false;
        break;
      }
      previousTile = sampleTile;
      previousPosition = { x: sampleX, y: sampleY };
    }
    if (!clearPath) continue;
    person.x = x; person.y = y;
    person.playerMovementBlockedReason = null;
    person.navigationRoute = null;
    person.navigationCongestion = 0;
    world.peopleSpatialIndex?.move(person);
    return true;
  }
  person.playerMovementBlockedReason = blockedReason;
  return false;
}

function countEnemiesInSpearLane(person, target, threats, range) {
  const dx = target.x - person.x, dy = target.y - person.y;
  const length = Math.hypot(dx, dy) || 1;
  const forwardX = dx / length, forwardY = dy / length;
  return threats.filter(candidate => {
    if (!candidate.alive || !!candidate.towerMounted !== !!person.towerMounted) return false;
    const offsetX = candidate.x - person.x, offsetY = candidate.y - person.y;
    const forward = offsetX * forwardX + offsetY * forwardY;
    const sideways = Math.abs(offsetX * forwardY - offsetY * forwardX);
    return forward >= .6 && forward <= range && sideways <= .5;
  }).length;
}

const HEALING_HEALTH_THRESHOLD = 95;

export function selectHealingTarget(cleric, allies, range = MILITARY_CLASSES.monge.range,
  preferredTarget = null, healthThreshold = HEALING_HEALTH_THRESHOLD) {
  if (preferredTarget?.alive && preferredTarget.kingdomId === cleric.kingdomId
      && preferredTarget.health < healthThreshold && distance(cleric, preferredTarget) <= range)
    return preferredTarget;
  return allies.filter(p => p.alive && p.kingdomId === cleric.kingdomId && p.health < healthThreshold
    && distance(cleric, p) <= range)
    .sort((a, b) => a.health - b.health || (b.injury || 0) - (a.injury || 0)
      || distance(cleric, a) - distance(cleric, b) || a.id - b.id)[0] || null;
}

export function castAreaHealing(world, cleric, allies, day, preferredTarget = null, { manual = false } = {}) {
  const spec = MILITARY_CLASSES.monge;
  if (!cleric.alive || cleric.role !== 'soldier' || cleric.militaryClass !== 'monge'
    || !manual && day < (cleric.nextHealingDay ?? -Infinity)) return [];
  initializeCombatResources(cleric);
  if (cleric.mana < COMBAT_RESOURCES.healingCost) { cleric.state = 'recuperando mana'; return []; }
  const healthThreshold = manual ? 100 : HEALING_HEALTH_THRESHOLD;
  const patient = selectHealingTarget(cleric, allies, MILITARY_CLASSES.monge.range, preferredTarget, healthThreshold);
  if (!patient) return [];
  const healed = [];
  for (const ally of allies) {
    if (!ally.alive || ally.kingdomId !== cleric.kingdomId || ally.health >= healthThreshold
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
  if (!manual) cleric.nextHealingDay = day + spec.healCooldownDays;
  cleric.militaryAnimation = 'heal'; cleric.militaryAnimationDay = day;
  cleric.militaryFacingX = patient.x - cleric.x; cleric.militaryFacingY = patient.y - cleric.y;
  cleric.militaryMerit = (cleric.militaryMerit || 0) + healed.length * .2;
  cleric.lastHealingCast = { day, primaryTargetId: patient.id, recipientIds: healed };
  cleric.state = 'curando os mais feridos em área';
  return healed;
}

export function updateClericHealing(world, day) {
  updatePriestDecisions(world);
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

function rememberHostileDamage(world, victim, aggressor, day) {
  const tile = cellAt(world, victim.x, victim.y);
  const owner = tile?.kingdomId == null ? null : world.kingdoms.find(kingdom => kingdom.id === tile.kingdomId);
  victim.lastHostileEncounter = {
    sourcePersonId: aggressor.id, sourceKingdomId: aggressor.kingdomId,
    day, location: { x: victim.x, y: victim.y }, territoryId: tile?.kingdomId ?? null
  };
  victim.lastLesson = aggressor.kingdomId != null && victim.kingdomId !== aggressor.kingdomId
    ? aggressor.name + ' do reino ' + (world.kingdoms.find(kingdom => kingdom.id === aggressor.kingdomId)?.name || 'rival')
      + ' causou dano direto. Evite a ameaça e peça ajuda a aliados.'
    : 'Você sofreu dano direto em combate; procure abrigo e avise aliados.';
  victim.conflictRisk = Math.max(Number(victim.conflictRisk) || 0, .55);
  if (!owner || owner.id === victim.kingdomId) return;
  victim.territoryAwareness = { ownerId: owner.id, name: owner.name, warning: true, caught: true,
    harmed: true, day, aggressorId: aggressor.id };
  victim.territoryWarnings ||= {};
  victim.territoryWarnings[owner.id] = Math.max(victim.territoryWarnings[owner.id] || 0,
    day + TERRITORY_AVOIDANCE_DAYS);
}

export function respondToLocalThreats(world, day = world.day + 1) {
  const people = world.people || [];
  const frontierOrders = new Map();
  for (const kingdom of world.kingdoms || []) {
    const report = kingdom.frontierAlert;
    if (report?.kind !== 'tower-intrusion' || !Number.isFinite(report.day)
      || day < report.day || day - report.day > 1) continue;
    const reportedIntruders = new Set(report.intruderIds || []);
    const activeTargets = new Set(people.filter(person => reportedIntruders.has(person.id)
      && person.alive && person.restingStructureId == null
      && isTerritorialIntruder(world, kingdom.id, person)).map(person => person.id));
    if (!activeTargets.size) continue;
    const generalIds = new Set([...(kingdom.militaryCommand?.generalIds || []), ...(report.notifiedGeneralIds || [])]);
    for (const person of people) {
      if (person.alive && person.kingdomId === kingdom.id && person.role === 'soldier'
        && (generalIds.has(person.id) || person.militaryRank === 'general')) {
        frontierOrders.set(person.id, { kingdom, report, targetIds: activeTargets });
      }
    }
  }
  const responders = people.filter(person => person.alive && person.role === 'soldier'
    && (person.playerControlled ? person.health > 0 : person.kingdomId != null && person.health >= 28)
    && person.restingStructureId == null && !person.towerMounted
    && person.militaryRestTargetId == null && !isCombatDisarmed(person, day, world.magicTimeMs || 0)
    && (person.playerControlled
      ? person.playerCommandUsedDay !== day && !!pendingPlayerAttack(person, day) && (person.stamina ?? 100) > 0
      : (person.stamina ?? 100) >= 16))
    .sort((a, b) => Number(frontierOrders.has(b.id)) - Number(frontierOrders.has(a.id)) || a.id - b.id);
  const responses = [];
  const assigned = new Map();
  const recordGeneralResponse = (soldier, threat, action) => {
    const order = frontierOrders.get(soldier.id);
    if (!order?.targetIds.has(threat.id)) return;
    const response = {
      kind: 'proportional-local-defense', reportId: order.report.id, day,
      generalId: soldier.id, targetId: threat.id, action,
      defendersAssigned: assigned.get(threat.id) || 0,
      defenderLimit: threat.role === 'soldier' ? 2 : 1
    };
    order.kingdom.militaryCommand ||= { generalIds: [soldier.id], units: [] };
    order.kingdom.militaryCommand.lastFrontierResponse = response;
    soldier.lastFrontierResponse = response;
  };
  // Intruder response is local: at most one guard for a civilian, two for a soldier.
  // A tower watcher has already handled its own targets without moving. When a
  // general receives a fresh tower report, they lead the first available local
  // interception and the same per-target cap still limits the response.
  for (const soldier of responders) {
    const manualCommand = soldier.playerControlled ? pendingPlayerAttack(soldier, day) : null;
    const manualProfile = manualCommand ? manualAttackProfile(soldier, manualCommand.actionKey) : null;
    if (manualCommand && !manualProfile) { consumePlayerAttack(soldier, manualCommand, day); continue; }
    const homeTile = cellAt(world, soldier.x, soldier.y);
    if (!manualCommand && homeTile?.kingdomId !== soldier.kingdomId) continue;
    const order = frontierOrders.get(soldier.id);
    const threats = people.filter(candidate => candidate.alive && candidate.kingdomId !== soldier.kingdomId
      && candidate.restingStructureId == null
      && isCombatTargetEligible(world, soldier, candidate, day)
      && (manualCommand || cellAt(world, candidate.x, candidate.y)?.kingdomId === soldier.kingdomId)
      && distance(soldier, candidate) <= (manualCommand ? 16 : 12)
      && (manualCommand || (assigned.get(candidate.id) || 0) < (candidate.role === 'soldier' ? 2 : 1)))
      .sort((a, b) => Number(order?.targetIds.has(b.id)) - Number(order?.targetIds.has(a.id))
        || Number(b.role === 'soldier') - Number(a.role === 'soldier')
        || distance(soldier, a) - distance(soldier, b) || a.id - b.id);
    const threat = manualCommand
      ? manualTargetAlongAim(soldier, threats, manualCommand,
        { ...manualProfile, range: manualProfile.range + (soldier.towerMounted ? 6 : 0) })
      : threats[0];
    if (!threat) {
      if (manualCommand) consumePlayerAttack(soldier, manualCommand, day);
      continue;
    }
    const range = manualCommand ? manualProfile.range + (soldier.towerMounted ? 6 : 0)
      : (MILITARY_CLASSES[soldier.militaryClass]?.range || 0) + (soldier.towerMounted ? 6 : 0);
    if (distance(soldier, threat) > range) {
      if (manualCommand) { consumePlayerAttack(soldier, manualCommand, day); continue; }
      if (soldier.towerMounted) continue;
      if (moveOne(world, soldier, threat, false, {
        allowedTile: tile => tile.kingdomId === soldier.kingdomId,
        preferRoads: true
      })) {
        assigned.set(threat.id, (assigned.get(threat.id) || 0) + 1);
        soldier.state = 'interceptando invasor no território';
        soldier.lastLesson = 'A patrulha observou uma ameaça dentro do reino e avançou sem cruzar a fronteira.';
        recordGeneralResponse(soldier, threat, 'intercept');
        responses.push({ soldierId: soldier.id, targetId: threat.id, action: 'intercept' });
      }
      continue;
    }
    if (manualCommand) {
      const healthBefore = threat.health;
      fightTacticalRound(world, [soldier], threats, day);
      if (threat.health < healthBefore || !threat.alive)
        responses.push({ soldierId: soldier.id, targetId: threat.id, action: 'engage' });
      continue;
    }
    const healthBefore = threat.health;
    assigned.set(threat.id, (assigned.get(threat.id) || 0) + 1);
    fightTacticalRound(world, [soldier], [threat], day);
    if (threat.health < healthBefore || !threat.alive) {
      recordGeneralResponse(soldier, threat, 'engage');
      responses.push({ soldierId: soldier.id, targetId: threat.id, action: 'engage' });
    }
  }
  return responses;
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
    const manualCommand = person.playerControlled && person.playerCommandUsedDay !== day
      ? pendingPlayerAttack(person, day) : null;
    if (person.playerControlled && !manualCommand) continue;
    const manualProfile = manualCommand
      ? manualAttackProfile(person, manualCommand.actionKey, manualCommand.comboIndex) : null;
    if (manualCommand && !manualProfile) { consumePlayerAttack(person, manualCommand, day); continue; }
    if (person.combatDisarmedUntilDay != null && !isCombatDisarmed(person, day, world.magicTimeMs || 0)) {
      delete person.combatDisarmedUntilDay;
      delete person.combatDisarmedById;
    }
    if (isCombatDisarmed(person, day, world.magicTimeMs || 0)) {
      person.state = 'desarmado após parry';
      person.militaryAnimation = 'defend'; person.militaryAnimationDay = day;
      continue;
    }
    const spec = MILITARY_CLASSES[person.militaryClass] || MILITARY_CLASSES.lanceiro;
    const selectedTrainingDummy = manualCommand
      ? trainingDummiesForWorld(world).find(dummy => dummy.id === manualCommand.targetId) : null;
    const candidates = selectedTrainingDummy ? [...enemies, selectedTrainingDummy] : enemies;
    const threats = candidates.filter(p => p.alive && p.restingStructureId == null
      && (p.trainingDummy ? p.id === manualCommand?.targetId
        : (person.kingdomId == null || p.kingdomId !== person.kingdomId)
          && isCombatTargetEligible(world, person, p, day)));
    let manualTarget = manualCommand
      ? manualTargetAlongAim(person, threats, manualCommand,
        { ...manualProfile, range: manualProfile.range + (person.towerMounted ? 6 : 0) }) : null;
    if (manualCommand && !manualTarget) {
      const angle = Math.atan2(manualCommand.aimY - person.y, manualCommand.aimX - person.x);
      const reach = Math.min(manualProfile.range, Math.hypot(manualCommand.aimX - person.x, manualCommand.aimY - person.y));
      manualTarget = { id: -1, alive: true, role: 'soldier', militaryClass: 'guerreiro', kingdomId: -1,
        x: person.x + Math.cos(angle) * reach, y: person.y + Math.sin(angle) * reach,
        health: 100, stamina: 100 };
    }
    if (manualCommand && !manualTarget) { consumePlayerAttack(person, manualCommand, day); continue; }
    const threatenedAlly = allies.filter(ally => ally.alive && ally.id !== person.id
      && ally.health <= 75 && day - (ally.lastAttackedDay ?? -Infinity) <= 1
      && distance(person, ally) <= 6)
      .sort((a, b) => a.health - b.health || distance(person, a) - distance(person, b) || a.id - b.id)[0];
    const assistingThreat = threatenedAlly && threats.find(threat => threat.id === threatenedAlly.lastAttackedById
      && distance(person, threat) <= spec.range);
    const opening = person.combatOpening?.expiresDay > day ? person.combatOpening : null;
    if (!opening && person.combatOpening) person.combatOpening = null;
    const comboMaximum = canUseAbility(person, 'combo') ? (person.militaryClass === 'guerreiro' ? WARRIOR_COMBO_MAX : COMBO_MAX) : 1;
    const combo = person.combatCombo?.lastDay === day - 1
      && person.combatCombo.count < comboMaximum ? person.combatCombo : null;
    if (!combo && person.combatCombo) person.combatCombo = null;
    const openingThreat = opening && threats.find(threat => threat.id === opening.targetId);
    const comboThreat = combo && threats.find(threat => threat.id === combo.targetId);
    const recentShieldBlock = person.militaryClass === 'guerreiro'
      && person.combatDefense?.day === day - 1
      && person.combatDefense.blockKind === 'shield'
      && person.combatDefense.kind === 'shield';
    const defendedThreat = recentShieldBlock
      ? threats.find(threat => threat.id === person.lastAttackedById) : null;
    const designatedThreat = threats.find(threat => threat.id === person.combatTargetId);
    if (!designatedThreat && person.combatTargetId != null) person.combatTargetId = null;
    const nearestThreat = threats.sort((a, b) => distance(person, a) - distance(person, b) || a.id - b.id)[0];
    const enemy = manualTarget || openingThreat || comboThreat || defendedThreat || designatedThreat || assistingThreat || nearestThreat;
    if (manualCommand) consumePlayerAttack(person, manualCommand, day);
    if (!manualCommand && person.militaryClass === 'monge') {
      const decision = chooseMagicAction(world, person);
      if (decision) beginSpell(world, person, decision.spellId, decision);
      if (!person.magicCast && enemy && distance(person, enemy) < 3) {
        moveOne(world, person, { x: person.x + (person.x - enemy.x || 1) * 2, y: person.y + (person.y - enemy.y) * 2 }, false);
        person.state = 'recuando para proteção';
      }
      continue;
    }
    if (!manualCommand && objective?.attacking && (!enemy || distance(person, enemy) > 2 || person.id % 3 === 0)
      && attackTower(world, person, objective.tower, day) > 0) continue;
    if (!enemy) continue;
    person.militaryFacingX = manualCommand ? manualCommand.aimX - person.x : enemy.x - person.x;
    person.militaryFacingY = manualCommand ? manualCommand.aimY - person.y : enemy.y - person.y;
    if (!manualCommand && (person.health < 28 || (!person.towerMounted && ['monge', 'arqueiro'].includes(person.militaryClass) && distance(person, enemy) < 3))) {
      moveOne(world, person, { x: person.x + (person.x - enemy.x || 1) * 2, y: person.y + (person.y - enemy.y) * 2 }, false);
      person.state = 'recuando para proteção';
    }
    const warriorEngagementRange = combatEngagementRange('guerreiro') ?? MILITARY_CLASSES.guerreiro.range;
    const enemyDistance = distance(person, enemy);
    const justShieldDashed = person.militaryClass === 'guerreiro'
      && person.combatAction?.attackVariant === 'shield-bash'
      && person.combatAction.day === day - 1;
    const shieldBashReady = !manualCommand && person.militaryClass === 'guerreiro'
      && canUseAbility(person, 'shield-bash')
      && (!combo || recentShieldBlock) && !openingThreat && !justShieldDashed
      && (person.stamina ?? COMBAT_RESOURCES.stamina) >= WARRIOR_SHIELD_BASH.minStamina
      && enemyDistance <= WARRIOR_SHIELD_BASH.range
      && (recentShieldBlock || enemyDistance > warriorEngagementRange || rand(world) < .16);
    const lanceEngagementRange = combatEngagementRange('lanceiro') ?? MILITARY_CLASSES.lanceiro.range;
    const lanceStamina = person.stamina ?? COMBAT_RESOURCES.stamina;
    const lanceLaneCount = person.militaryClass === 'lanceiro' && !person.towerMounted
      ? countEnemiesInSpearLane(person, enemy, threats, LANCER_CHARGE.range) : 0;
    const lancerSpecialReady = !manualCommand && person.militaryClass === 'lanceiro' && !person.towerMounted
      && !combo && !openingThreat;
    const lanceChargeReady = lancerSpecialReady && canUseAbility(person, 'lance-charge') && lanceStamina >= LANCER_CHARGE.minStamina
      && enemyDistance >= 1 && enemyDistance <= LANCER_CHARGE.range
      && (lanceLaneCount > 1 || enemyDistance > lanceEngagementRange && rand(world) < .22);
    const lanceFlurryReady = lancerSpecialReady && !lanceChargeReady && canUseAbility(person, 'lance-flurry')
      && lanceStamina >= LANCER_FLURRY.minStamina && enemyDistance <= LANCER_FLURRY.range
      && rand(world) < .28;
    const attackVariant = manualCommand ? manualProfile.attackVariant
      : person.militaryClass === 'arqueiro'
      ? chooseArcherAttack(person, world, enemy, person.towerMounted)
      : shieldBashReady ? 'shield-bash'
        : lanceChargeReady ? 'lance-charge' : lanceFlurryReady ? 'lance-flurry' : null;
    const archerAttack = attackVariant ? ARCHER_ATTACKS[attackVariant] : null;
    if (person.militaryClass === 'arqueiro' && !archerAttack) {
      if ((person.stamina ?? COMBAT_RESOURCES.stamina) < ARCHER_ATTACKS.standard.minStamina)
        person.state = 'recuperando estamina';
      continue;
    }
    const attackRange = (manualCommand ? manualProfile.range : archerAttack?.range
      ?? (attackVariant === 'shield-bash' ? WARRIOR_SHIELD_BASH.range
        : attackVariant === 'lance-charge' ? LANCER_CHARGE.range : spec.range))
      + (person.towerMounted ? 6 : 0);
    const reliableRange = manualCommand || person.towerMounted || ['shield-bash', 'lance-charge', 'lance-flurry'].includes(attackVariant)
      ? attackRange : combatEngagementRange(person.militaryClass) ?? attackRange;
    if ((!manualCommand && person.health < 28) || distance(person, enemy) > reliableRange + 1e-6) continue;
    const isOpeningAttack = openingThreat?.id === enemy.id;
    const openingComboStart = person.militaryClass === 'guerreiro' ? 1 : 2;
    const comboIndex = manualCommand ? manualProfile.comboIndex
      : attackVariant === 'shield-bash' ? 1 : Math.min(comboMaximum, isOpeningAttack
      ? Math.max(openingComboStart, comboThreat?.id === enemy.id ? combo.count + 1 : openingComboStart)
      : comboThreat?.id === enemy.id ? combo.count + 1 : 1);
    const staminaCost = attackVariant === 'rain'
      ? (person.stamina ?? COMBAT_RESOURCES.stamina)
      : attackVariant === 'shield-bash' ? WARRIOR_SHIELD_BASH.staminaCost
        : attackVariant === 'lance-charge' ? LANCER_CHARGE.staminaCost
          : attackVariant === 'lance-flurry' ? LANCER_FLURRY.staminaCost : archerAttack?.staminaCost;
    const specialLanceAttack = attackVariant === 'lance-charge' || attackVariant === 'lance-flurry';
    if (!enemy.trainingDummy && !manualCommand?.flurryContinuation && !spendAttackStamina(person, day, { combo: comboIndex > 1 || specialLanceAttack
      || attackVariant === 'shield-bash' || justShieldDashed, cost: staminaCost, nowMs: world.magicTimeMs || 0 })) {
      person.state = 'recuperando estamina'; continue;
    }
    const action = createCombatAction(world, person, enemy, day, {
      reach: attackRange, comboIndex, attackVariant, arrowCount: archerAttack?.arrowCount,
      targetKind: enemy.trainingDummy ? 'training-dummy' : undefined,
      manualControl: !!manualCommand,
      aim: manualCommand ? { x: manualCommand.aimX, y: manualCommand.aimY } : undefined,
      targetLock: person.militaryClass === 'arqueiro' && manualCommand?.targetId === enemy.id,
      halfAngle: archerAttack?.halfAngle, rainDurationMs: archerAttack?.rainDurationMs,
      areaRadius: archerAttack?.areaRadius,
      shieldOffset: attackVariant === 'shield-bash' ? WARRIOR_SHIELD_BASH.shieldOffset : undefined,
      radius: attackVariant === 'shield-bash' ? WARRIOR_SHIELD_BASH.radius
        : attackVariant === 'lance-charge' ? LANCER_CHARGE.radius : undefined,
      advanceDistance: attackVariant === 'lance-charge' ? LANCER_CHARGE.advanceDistance
        : attackVariant === 'shield-bash' ? WARRIOR_SHIELD_BASH.advanceDistance : undefined,
      weaponOffset: attackVariant === 'lance-charge' ? LANCER_CHARGE.weaponOffset : undefined,
      strikeIntervalMs: attackVariant === 'lance-flurry' ? LANCER_FLURRY.strikeIntervalMs : undefined,
      thrustDurationMs: attackVariant === 'lance-flurry' ? LANCER_FLURRY.thrustDurationMs : undefined,
      animationSpeedMultiplier: attackVariant === 'lance-flurry' ? LANCER_FLURRY.speedMultiplier : undefined,
      flurryDurationMs: attackVariant === 'lance-flurry' ? (manualCommand ? 233 : LANCER_FLURRY.durationMs) : undefined,
      noContactTimeoutMs: attackVariant === 'lance-flurry' ? LANCER_FLURRY.noContactTimeoutMs : undefined });
    if (!action) continue;
    action.damageMultiplier = attackVariant === 'shield-bash'
      ? WARRIOR_SHIELD_BASH.damageMultiplier
      : attackVariant === 'lance-charge' ? LANCER_CHARGE.damageMultiplier
        : attackVariant === 'lance-flurry' ? LANCER_FLURRY.damageMultiplier
          : archerAttack?.damageMultiplier ?? 1;
    recordArrow(person, enemy, day, action);
    person.lastMilitaryAttackDay = day;
    person.attackingTowerId = null;
    person.militaryAnimation = attackVariant === 'shield-bash' ? 'defend' : 'attack';
    person.militaryAnimationDay = day;
    person.state = attackVariant === 'shield-bash' ? 'avançando com escudo'
      : attackVariant === 'lance-charge' ? 'investida de lança'
        : attackVariant === 'lance-flurry' ? 'rajada de lanças'
      : person.militaryClass === 'arqueiro' ? 'disparando à distância'
        : person.militaryClass === 'lanceiro' ? 'apoiando a linha de infantaria' : 'combatendo na linha de frente';
    const defenderDisarmed = isCombatDisarmed(enemy, day, world.magicTimeMs || 0);
    const defenseSpec = enemy.role === 'soldier' ? MILITARY_CLASSES[enemy.militaryClass] || MILITARY_CLASSES.lanceiro
      : { vitality: 100, dodge: .05, block: 0 };
    const defense = defenderDisarmed ? { ...defenseSpec, block: 0 } : defenseSpec;
    const defensiveTraining = clamp(enemy.militaryTraining || 0, 0, 1);
    let dodge = null;
    if (!enemy.trainingDummy && !enemy.playerControlled && !enemy.towerMounted
        && rand(world) < defense.dodge + defensiveTraining * .04) {
      const from = { x: enemy.x, y: enemy.y };
      moveOne(world, enemy, { x: enemy.x - (person.y - enemy.y || 1), y: enemy.y + (person.x - enemy.x) }, false);
      dodge = { from, to: { x: enemy.x, y: enemy.y } };
      enemy.x = from.x; enemy.y = from.y;
      enemy.militaryAnimation = 'run'; enemy.militaryAnimationDay = day;
    }
    const guarding = new Set(), parrying = new Set(), parryWindows = new Map();
    const shieldUser = ['guerreiro', 'lanceiro'].includes(enemy.militaryClass)
      && (enemy.militaryClass !== 'lanceiro' || person.militaryClass !== 'arqueiro');
    const manualGuardStance = enemy.playerControlled && enemy.playerDefending;
    const canGuard = !defenderDisarmed && enemy.role === 'soldier'
      && (shieldUser || manualGuardStance)
      && frontGuard(enemy, person) && canSpendDefenseStamina(enemy);
    const holdingGuardStance = enemy.militaryClass === 'guerreiro'
      && (enemy.state === 'de guarda' || enemy.state === 'mantendo posição defensiva'
        || enemy.combatDefense?.day === day && enemy.combatDefense.blockKind === 'shield'
        || enemy.combatCombo?.lastDay === day && enemy.combatCombo.count < WARRIOR_COMBO_MAX
        || enemy.playerControlled && enemy.playerDefending);
    const blockChance = Math.min(.9, defense.block + defensiveTraining * .05 + (holdingGuardStance ? .2 : 0));
    const playerGuard = canGuard && manualGuardStance;
    if (canGuard && (playerGuard || rand(world) < blockChance)) {
      guarding.add(enemy.id);
      const parryChance = enemy.militaryClass === 'guerreiro' ? .24 : .18;
      if (person.militaryClass !== 'arqueiro' && canSpendDefenseStamina(enemy, true)
          && rand(world) < parryChance + defensiveTraining * .24) {
        parrying.add(enemy.id);
        parryWindows.set(enemy.id, 38 + defensiveTraining * 28);
      }
    }
    const strength = spec.damage * magicModifiers(person, world).damage
      * (1 + clamp(person.militaryTraining || 0, 0, 1) * .1) * (.85 + rand(world) * .3);
    const applyCombatDamage = (victim, blocked, multiplier = 1) => {
      if (victim.trainingDummy) {
        const comboMultiplier = 1 + (action.comboIndex - 1) * COMBO_DAMAGE_STEP;
        return damageTrainingDummy(world, victim, strength * multiplier * comboMultiplier, action.id, day);
      }
      if (blocked) spendDefenseStamina(victim);
      if (['shield-bash', 'lance-charge'].includes(action.attackVariant)) {
        launchCombatPerson(world, victim, person, action, blocked);
      } else if (!blocked) nudgePersonFrom(world, victim, person, action.attackVariant === 'shield-bash'
        ? WARRIOR_SHIELD_BASH.pushDistance
        : action.attackVariant === 'lance-charge' ? LANCER_CHARGE.pushDistance
          : action.attackVariant === 'lance-flurry' ? LANCER_FLURRY.pushDistance
            : COMBAT_KNOCKBACK[person.militaryClass] || .2,
      action.attackVariant === 'shield-bash'
        ? { x: Math.cos(action.angle), y: Math.sin(action.angle) } : null);
      const vitality = victim.role === 'soldier' ? victim.maxCombatHealth || MILITARY_CLASSES[victim.militaryClass]?.vitality || 300 : 100;
      const comboMultiplier = 1 + (action.comboIndex - 1) * COMBO_DAMAGE_STEP;
      const blockedDamageMultiplier = victim.militaryClass === 'guerreiro' ? .2 : .3;
      const appliedHealth = -changePersonHealth(world, victim,
        -strength * multiplier * comboMultiplier * (blocked ? blockedDamageMultiplier : 1) / vitality * 100, 'battle');
      const damage = appliedHealth * vitality / 100;
      victim.lastAttackedDay = day; victim.lastAttackedById = person.id;
      victim.injury = clamp((victim.injury || 0) + damage / 120, 0, 10);
      if (appliedHealth > 0) rememberHostileDamage(world, victim, person, day);
      person.militaryMerit = (person.militaryMerit || 0) + damage / 30;
      person.combatDamageDealt = (person.combatDamageDealt || 0) + damage;
      if (victim.health <= 0) {
        killPerson(world, victim, 'combat'); casualties++; person.militaryMerit += 3;
        person.combatVictories = (person.combatVictories || 0) + 1;
      }
      return damage;
    };
    const result = resolveCombatAction(world, person, action, threats,
      (victim, blocked) => applyCombatDamage(victim, blocked, action.damageMultiplier ?? 1),
      { guarding, parrying, parryWindows, beforeStep: dodge || ['shield-bash', 'lance-charge'].includes(action.attackVariant) ? elapsed => {
        if (action.attackVariant === 'shield-bash' || action.attackVariant === 'lance-charge') {
          const progress = Math.min(1, Math.max(0, (elapsed - action.windupMs) / Math.max(1, action.activeMs)));
          const advanceProgress = action.attackVariant === 'lance-charge'
            ? progress : progress * progress;
          moveCombatPersonTo(world, person, {
            x: action.origin.x + Math.cos(action.angle) * action.advanceDistance * advanceProgress,
            y: action.origin.y + Math.sin(action.angle) * action.advanceDistance * advanceProgress
          });
        }
        if (!dodge) return;
        const progress = Math.min(1, elapsed / action.windupMs);
        enemy.x = dodge.from.x + (dodge.to.x - dodge.from.x) * progress;
        enemy.y = dodge.from.y + (dodge.to.y - dodge.from.y) * progress;
      } : undefined });
    if (['shield-bash', 'lance-charge'].includes(action.attackVariant)) {
      for (const hit of action.hitEvents) {
        if (hit.parried || !['body', 'shield', 'weapon-guard'].includes(hit.kind)) continue;
        const victim = world.people.find(candidate => candidate.id === hit.targetId);
        if (!victim?.alive) continue;
        if (victim.combatLaunch?.actionId === action.id) {
          victim.combatLaunch.atMs = hit.atMs;
          victim.combatStunnedUntilMs = (world.magicTimeMs || 0) + hit.atMs + 3600;
        }
        victim.combatDisarmedUntilDay = Math.max(victim.combatDisarmedUntilDay || 0, day + 2);
        victim.combatDisarmedById = person.id;
        victim.combatCombo = null;
        victim.combatOpening = null;
        victim.militaryAnimation = 'defend'; victim.militaryAnimationDay = day;
        victim.state = action.attackVariant === 'shield-bash'
          ? 'atordoado por pancada de escudo' : 'atordoado pela investida de lança';
      }
    }
    const areaTargets = [];
    const alreadyHit = new Set(action.hitTargets);
    if (action.result.kind !== 'cancelled' && action.attackVariant === 'cone') {
      const arrowCount = action.arrowCount || ARCHER_ATTACKS.cone.arrowCount;
      const halfAngle = action.halfAngle ?? ARCHER_ATTACKS.cone.halfAngle;
      const shotDistance = distance(action.origin, action.aim);
      for (let arrowIndex = 0; arrowIndex < arrowCount; arrowIndex++) {
        const spread = arrowCount > 1
          ? ((arrowIndex / (arrowCount - 1)) * 2 - 1) * halfAngle : 0;
        if (Math.abs(spread) < 1e-6) continue; // The central arrow was resolved above.
        const angle = action.angle + spread;
        const endpoint = { x: action.origin.x + Math.cos(angle) * shotDistance,
          y: action.origin.y + Math.sin(angle) * shotDistance };
        let firstContact = null;
        for (const victim of threats) {
          if (!victim.alive) continue;
          const fraction = segmentCircle(action.origin, endpoint, victim,
            BODY_RADIUS + action.geometry.radius);
          if (fraction != null && (!firstContact || fraction < firstContact.fraction))
            firstContact = { victim, fraction };
        }
        const obstruction = combatPathObstruction(world, action.origin, endpoint, {
          sourceElevation: action.sourceElevation, targetElevation: action.targetElevation,
          ignoreStructureId: firstContact?.victim.trainingDummy ? firstContact.victim.id : null
        });
        if (!firstContact || obstruction && obstruction.fraction <= firstContact.fraction
            || alreadyHit.has(firstContact.victim.id)) continue;
        const victim = firstContact.victim;
        if (!victim.alive) continue;
        const damageApplied = applyCombatDamage(victim, false, action.damageMultiplier);
        action.hitEvents.push({ targetId: victim.id,
          atMs: action.windupMs + Math.max(100, Math.min(850, shotDistance * 55)),
          point: { x: victim.x, y: victim.y }, kind: victim.trainingDummy ? 'training-dummy' : 'body', damageApplied,
          ...(victim.trainingDummy ? { health: victim.health, maxHealth: victim.maxHealth } : {}),
          guarding: false, parried: false });
        areaTargets.push(victim.id); alreadyHit.add(victim.id);
      }
    } else if (action.result.kind !== 'cancelled' && action.result.kind !== 'obstructed'
        && action.attackVariant === 'rain') {
      const impact = action.result.point || action.aim;
      for (const victim of threats) {
        if (alreadyHit.size >= abilityTargetLimit(person)) break;
        if (!victim.alive || alreadyHit.has(victim.id)
            || distance(victim, impact) > (action.areaRadius ?? ARCHER_ATTACKS.rain.areaRadius)) continue;
        const damageApplied = applyCombatDamage(victim, false, ARCHER_ATTACKS.rain.splashMultiplier);
        action.hitEvents.push({ targetId: victim.id,
          atMs: action.windupMs + (action.rainDurationMs || ARCHER_ATTACKS.rain.rainDurationMs),
          point: { x: victim.x, y: victim.y }, kind: victim.trainingDummy ? 'training-dummy' : 'body', damageApplied,
          ...(victim.trainingDummy ? { health: victim.health, maxHealth: victim.maxHealth } : {}),
          guarding: false, parried: false });
        areaTargets.push(victim.id); alreadyHit.add(victim.id);
      }
    }
    if (areaTargets.length) {
      action.result.areaHitTargets = areaTargets;
      action.hitTargets.push(...areaTargets);
      const event = world.combatEvents?.[world.combatEvents.length - 1];
      if (event?.id === action.id) {
        event.hitTargets.push(...areaTargets);
        event.areaHitTargets = areaTargets;
        event.result.areaHitTargets = areaTargets;
      }
    }
    if (isOpeningAttack) person.combatOpening = null;
    if (result.kind === 'parry') {
      spendDefenseStamina(enemy, true);
      stunCombatPerson(world, person, enemy.id, 3000 + Math.max(0, result.atMs || 0));
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
    } else if (['shield-bash', 'lance-charge', 'lance-flurry'].includes(action.attackVariant)) {
      person.combatCombo = null;
    } else if (['body', 'shield', 'weapon-guard'].includes(result.kind)
        && result.damageApplied > 0 && enemy.alive) {
      person.combatCombo = { targetId: enemy.id, count: comboIndex, lastDay: day };
    } else {
      person.combatCombo = null;
    }
  }
  return casualties;
}
