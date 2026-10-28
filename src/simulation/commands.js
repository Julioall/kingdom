import engine from './engine.js';
import { orderTowerCapture, orderInstallationAttack } from './kingdoms/frontier-conflicts.js';
import { exchangeAtRoyalCastle } from './economy/royal-coin-exchange.js';

export function dispatchCommand(world, command) {
  if (!world || !command || typeof command !== 'object') throw new Error('Comando inválido.');
  switch (command.type) {
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
