import engine from './engine.js';
import { defaultWorldConfig, type WorldConfig, type WorldState } from './core/state';
export type WorldCommand =
  | { type: 'drought'; days: number; intensity: number }
  | { type: 'add-individuals'; count: number }
  | { type: 'kingdom-structure'; kingdomId: number; building: 'torre' | 'centro_militar' }
  | { type: 'destroy-tower'; kingdomId: number; towerId: number }
  | { type: 'recruit-soldier'; kingdomId: number };
export function createWorld(config: WorldConfig = defaultWorldConfig, seed = 42): WorldState {
  if (config.scenario !== 'genesis') throw new Error('Cenário não implementado.');
  return engine.createWorld(seed);
}
export function stepDay(world: WorldState) { return engine.stepDay(world); }
export function dispatchCommand(world: WorldState, command: WorldCommand) {
  switch (command.type) {
    case 'drought':
      if (!Number.isInteger(command.days) || command.days < 1 || !Number.isFinite(command.intensity) || command.intensity < 0 || command.intensity > 1) throw new Error('Parâmetros de seca inválidos.');
      engine.modules.Atmosphere.triggerDrought(world, command.days, command.intensity);
      break;
    case 'add-individuals':
      if (!Number.isInteger(command.count) || command.count < 1 || command.count > 100) throw new Error('Quantidade de indivíduos inválida.');
      engine.addIndividuals(world, command.count, false);
      break;
    case 'kingdom-structure':
      if (!Number.isInteger(command.kingdomId)) throw new Error('Reino inválido.');
      return engine.kingdomCommands.buildKingdomStructure(world, command.kingdomId, command.building);
    case 'destroy-tower':
      if (!Number.isInteger(command.kingdomId) || !Number.isInteger(command.towerId)) throw new Error('Torre inválida.');
      return engine.kingdomCommands.destroyKingdomTower(world, command.kingdomId, command.towerId);
    case 'recruit-soldier':
      if (!Number.isInteger(command.kingdomId)) throw new Error('Reino inválido.');
      return engine.kingdomCommands.recruitKingdomSoldier(world, command.kingdomId);
  }
}
export const snapshot = engine.snapshot;
export const inspectTile = engine.inspectTile;
