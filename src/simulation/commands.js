import { applyManualMovement } from './individuals/manual-movement.js';
import engine from './engine.js';
import { fightTacticalRound, manualAttackProfile } from './kingdoms/military.js';
import { orderTowerCapture, orderInstallationAttack } from './kingdoms/frontier-conflicts.js';
import { exchangeAtRoyalCastle } from './economy/royal-coin-exchange.js';
import { SPELLS, equippedSpells, MAGIC_TACTICS } from './magic/catalog.js';
import { beginSpell, cancelSpell, advanceMagic, configureMagicLoadout } from './magic/system.js';
import { isCombatStunned } from './kingdoms/combat-status.js';

function manualSpell(world, person, index, command) {
  const spell = SPELLS[equippedSpells(person)[index]];
  if (!spell) return { ok: false, reason: 'spell-unavailable' };
  const requestedId = command.targetId ?? command.healingTargetId;
  if (spell.kind === 'area' || spell.radius && requestedId == null)
    return beginSpell(world, person, spell.id, { x: command.aimX, y: command.aimY });
  if (requestedId != null) return beginSpell(world, person, spell.id, { targetId: requestedId });
  const hostile = spell.kind === 'debuff' || spell.kind === 'dispel';
  const candidates = world.people.filter(other => other.alive && other.restingStructureId == null
    && (hostile ? other.kingdomId !== person.kingdomId : other.kingdomId === person.kingdomId)
    && Math.hypot(other.x - person.x, other.y - person.y) <= spell.range
    && (!spell.heal || other.health < 100));
  const target = candidates.sort((a, b) => Math.hypot(a.x - command.aimX, a.y - command.aimY)
      - Math.hypot(b.x - command.aimX, b.y - command.aimY) || a.id - b.id)[0];
  return beginSpell(world, person, spell.id, spell.kind === 'area'
    ? { x: command.aimX, y: command.aimY }
    : target ? { targetId: target.id } : { x: command.aimX, y: command.aimY });
}

export function dispatchCommand(world, command) {
  if (!world || !command || typeof command !== 'object') throw new Error('Comando inválido.');
  switch (command.type) {
    case 'magic-tick':
      return { ok: true, people: advanceMagic(world, command.elapsedMs) };
    case 'magic-loadout': {
      const person = world.people.find(person => person.id === command.personId && person.alive);
      return { ok: !!person && configureMagicLoadout(person, command.spells, command.role) };
    }
    case 'magic-orders': {
      const person = world.people.find(person => person.id === command.personId && person.alive);
      const policy = MAGIC_TACTICS[command.policy];
      if (!person || !policy || !['general', 'comandante'].includes(person.militaryRank)) return { ok: false };
      person.magicOrders = { policy: command.policy, ...policy };
      return { ok: true };
    }
    case 'player-control': {
      if (!Number.isInteger(command.personId) || typeof command.enabled !== 'boolean')
        throw new Error('Controle de personagem inválido.');
      const person = world.people.find(item => item.id === command.personId && item.alive);
      if (!person) return { ok: false, reason: 'person-unavailable' };
      if (command.enabled) {
        for (const controlled of world.people) if (controlled.playerControlled && controlled.id !== person.id) {
          controlled.playerControlled = false;
          controlled.playerInput = { moveX: 0, moveY: 0, defending: false };
          controlled.playerDefending = false;
          controlled.playerHealing = false;
          controlled.playerHealingTargetId = null;
          controlled.playerNextHealingAt = 0;
          controlled.playerCommand = null;
          controlled.playerCommandQueue = [];
        }
        person.playerControlled = true;
        person.playerInput = { moveX: 0, moveY: 0, defending: false };
        person.playerDefending = false;
        person.playerHealing = false;
        person.playerHealingTargetId = null;
        person.playerNextHealingAt = 0;
        person.playerCommand = null;
        person.playerCommandQueue = [];
        person.playerWarriorCombo = null;
        person.restingStructureId = null;
        person.homeRestTargetId = null;
        person.militaryRestTargetId = null;
        person.militaryReturningHome = false;
        for (const tower of world.structures) if (tower.archerId === person.id) tower.archerId = null;
        person.towerMounted = false;
        person.towerDutyId = null;
        world.playerControlledPersonId = person.id;
      } else if (person.playerControlled || world.playerControlledPersonId === person.id) {
        person.playerControlled = false;
        person.playerInput = { moveX: 0, moveY: 0, defending: false };
        person.playerDefending = false;
        person.playerHealing = false;
        person.playerHealingTargetId = null;
        person.playerNextHealingAt = 0;
        person.playerCommand = null;
        person.playerCommandQueue = [];
        person.playerWarriorCombo = null;
        world.playerControlledPersonId = null;
      }
      return { ok: true, enabled: !!person.playerControlled, personId: person.id };
    }
    case 'player-input': {
      if (!Number.isInteger(command.personId) || !Number.isFinite(command.moveX)
          || !Number.isFinite(command.moveY) || typeof command.defending !== 'boolean'
          || command.healing != null && typeof command.healing !== 'boolean'
          || command.healingTargetId != null && !Number.isInteger(command.healingTargetId)
          || (command.aimX != null && (!Number.isFinite(command.aimX) || command.aimX < 0 || command.aimX >= world.width))
          || (command.aimY != null && (!Number.isFinite(command.aimY) || command.aimY < 0 || command.aimY >= world.height)))
        throw new Error('Entrada de controle inválida.');
      const person = world.people.find(item => item.id === command.personId && item.alive
        && item.playerControlled && world.playerControlledPersonId === item.id);
      if (!person) return { ok: false, reason: 'person-not-controlled' };
      if (isCombatStunned(person, world.day, world.magicTimeMs || 0)) {
        if (Number.isSafeInteger(command.inputSequence)) person.playerInputSequence = command.inputSequence;
        person.playerMovementBlockedReason = command.moveX || command.moveY ? 'stunned' : null;
        return { ok: false, reason: 'stunned' };
      }
      person.playerInput = { moveX: Math.sign(command.moveX), moveY: Math.sign(command.moveY),
        defending: command.defending, aimX: command.aimX, aimY: command.aimY };
      person.playerDefending = command.defending;
      const wantsHealing = command.healing === true && person.militaryClass === 'monge';
      person.playerInput.healing = wantsHealing;
      person.playerInput.healingTargetId = command.healingTargetId;
      const healingStarted = wantsHealing && !person.playerHealing;
      const healingStopped = !wantsHealing && person.playerHealing;
      person.playerHealing = wantsHealing;
      if (wantsHealing) {
        person.playerHealingTargetId = command.healingTargetId ?? null;
        if (healingStarted && !person.magicCast) manualSpell(world, person, 0, command);
      } else if (healingStopped) {
        person.playerHealingTargetId = null;
        if (person.magicCast?.spellId === equippedSpells(person)[0]) cancelSpell(world, person, 'released');
      }
      if (command.defending && !wantsHealing) {
        person.state = 'mantendo posição defensiva';
        person.militaryAnimation = 'defend'; person.militaryAnimationDay = world.day;
      } else if (person.state === 'mantendo posição defensiva') {
        person.state = 'controlado pelo jogador';
        person.militaryAnimation = 'idle'; person.militaryAnimationDay = world.day;
      }
      if (Number.isFinite(command.aimX) && Number.isFinite(command.aimY)) {
        person.militaryFacingX = command.aimX - person.x;
        person.militaryFacingY = command.aimY - person.y;
      }
      applyManualMovement(world, person, command);
      const flurryNow = Date.now();
      if (person.playerFlurryUntil > flurryNow && flurryNow >= (person.playerFlurryNextAt || 0)) {
        if (flurryNow - person.playerFlurryLastContactAt >= 1000) {
          person.playerFlurryUntil = 0;
          person.playerMovementLockedUntil = 0;
        } else {
          const pulse = { actionKey: '2', flurryContinuation: true,
            aimX: command.aimX ?? person.x + 1, aimY: command.aimY ?? person.y,
            targetId: person.playerFlurryTargetId, expiresDay: world.day + 1 };
          person.playerCommandQueue = [pulse]; person.playerCommand = pulse;
          person.playerCommandUsedDay = null;
          fightTacticalRound(world, [person], world.people.filter(other => other.id !== person.id && other.alive), world.day);
          person.playerFlurryNextAt = flurryNow + 233;
          if (person.combatAction?.hitEvents?.length) person.playerFlurryLastContactAt = flurryNow;
        }
      }
      if (Number.isSafeInteger(command.inputSequence)) person.playerInputSequence = command.inputSequence;
      return { ok: true };
    }
    case 'player-action': {
      if (!Number.isInteger(command.personId) || !/^[1-5]$/.test(String(command.actionKey))
          || !Number.isFinite(command.aimX) || !Number.isFinite(command.aimY)
          || command.aimX < 0 || command.aimX >= world.width || command.aimY < 0 || command.aimY >= world.height
          || command.targetId != null && !Number.isInteger(command.targetId))
        throw new Error('Ação manual inválida.');
      const person = world.people.find(item => item.id === command.personId && item.alive
        && item.playerControlled && world.playerControlledPersonId === item.id);
      if (!person || person.role !== 'soldier') return { ok: false, reason: 'soldier-not-controlled' };
      if (isCombatStunned(person, world.day, world.magicTimeMs || 0)) return { ok: false, reason: 'stunned' };
      if (person.militaryClass === 'monge') {
        return manualSpell(world, person, Number(command.actionKey) - 1, command);
      }
      if (!manualAttackProfile(person, command.actionKey)) return { ok: false, reason: 'ability-locked' };
      person.militaryFacingX = command.aimX - person.x;
      person.militaryFacingY = command.aimY - person.y;
      const now = Date.now();
      const actionKey = String(command.actionKey);
      const isWarriorComboAction = person.militaryClass === 'guerreiro' && ['1', '2'].includes(actionKey);
      const previousCombo = person.playerWarriorCombo;
      const continuesCombo = isWarriorComboAction && previousCombo
        && now <= previousCombo.expiresAt && now - previousCombo.lastAttackAt >= 140
        && previousCombo.lastActionKey !== actionKey && previousCombo.count < 4;
      const chainIndex = continuesCombo ? previousCombo.count + 1 : Number(actionKey);
      if (now < (person.playerNextAttackAt || 0) && !continuesCombo) {
        person.playerCommandQueue = []; person.playerCommand = null;
        return { ok: false, reason: 'attack-cooldown' };
      }
      const queue = (person.playerCommandQueue || []).filter(item => item.expiresDay >= world.day + 1);
      if (queue.length >= 8) return { ok: false, reason: 'attack-queue-full' };
      queue.push({ actionKey, ...(isWarriorComboAction ? { comboIndex: chainIndex } : {}),
        aimX: command.aimX, aimY: command.aimY,
        targetId: command.targetId ?? null, expiresDay: world.day + 1 + queue.length });
      person.playerCommandQueue = queue;
      person.playerCommand = queue[0] || null;
      const previousActionId = person.combatAction?.id;
      person.playerCommandUsedDay = null;
      fightTacticalRound(world, [person], world.people.filter(other => other.id !== person.id && other.alive), world.day);
      const newAction = person.combatAction && person.combatAction.id !== previousActionId;
      if (newAction && person.combatAction.attackVariant === 'lance-flurry') {
        person.playerFlurryUntil = now + 3000;
        person.playerFlurryNextAt = now + 233;
        person.playerFlurryLastContactAt = now;
        person.playerFlurryTargetId = command.targetId;
        person.playerMovementLockedUntil = now + 3000;
      }
      if (isWarriorComboAction && newAction) person.playerWarriorCombo = {
        lastActionKey: actionKey, count: chainIndex, lastAttackAt: now, expiresAt: now + 1100
      };
      else if (!isWarriorComboAction) person.playerWarriorCombo = null;
      if (['shield-bash', 'lance-charge'].includes(person.combatAction?.attackVariant))
        person.playerMovementLockedUntil = now + person.combatAction.windupMs + person.combatAction.activeMs;
      person.playerNextAttackAt = now + (isWarriorComboAction && newAction ? 260
        : Math.max(350, person.combatAction?.durationMs || 350));
      if (newAction && person.combatAction.attackVariant === 'lance-flurry') person.playerNextAttackAt = now + 3000;
      return { ok: true, queued: true, queueLength: queue.length };
    }
    case 'drought':
      if (!Number.isInteger(command.days) || command.days < 1 || !Number.isFinite(command.intensity) || command.intensity < 0 || command.intensity > 1) throw new Error('Parâmetros de seca inválidos.');
      engine.modules.Atmosphere.triggerDrought(world, command.days, command.intensity);
      return { ok: true };
    case 'add-individuals':
      if (!Number.isInteger(command.count) || command.count < 1 || command.count > 100) throw new Error('Quantidade de indivíduos inválida.');
      engine.addIndividuals(world, command.count, false);
      return { ok: true };
    case 'kingdom-structure':
      if (!Number.isInteger(command.kingdomId)) throw new Error('Reino inválido.');
      return engine.kingdomCommands.buildKingdomStructure(world, command.kingdomId, command.building);
    case 'destroy-tower':
      if (!Number.isInteger(command.kingdomId) || !Number.isInteger(command.towerId)) throw new Error('Torre inválida.');
      return engine.kingdomCommands.destroyKingdomTower(world, command.kingdomId, command.towerId);
    case 'capture-tower':
      if (!Number.isInteger(command.kingdomId) || !Number.isInteger(command.towerId)) throw new Error('Torre inválida.');
      return orderTowerCapture(world, command.kingdomId, command.towerId);
    case 'attack-installation':
      if (!Number.isInteger(command.kingdomId) || !Number.isInteger(command.structureId)) throw new Error('Instalação inválida.');
      return orderInstallationAttack(world, command.kingdomId, command.structureId, { capture: false });
    case 'castle-exchange':
      return exchangeAtRoyalCastle(world, command.kingdomId, command.castleId,
        command.fromCoin, command.toCoin, command.quantity);
    case 'recruit-soldier':
      if (!Number.isInteger(command.kingdomId)) throw new Error('Reino inválido.');
      return engine.kingdomCommands.recruitKingdomSoldier(world, command.kingdomId, { militaryClass: command.militaryClass });
    default:
      throw new Error('Tipo de comando não reconhecido.');
  }
}
