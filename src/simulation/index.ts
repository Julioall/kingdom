import engine from './engine.js';
import { defaultWorldConfig, type WorldConfig, type WorldState } from './core/state';
import { dispatchCommand } from './commands.js';
export { dispatchCommand };
export type WorldCommand =
  | { type: 'drought'; days: number; intensity: number }
  | { type: 'add-individuals'; count: number }
  | { type: 'kingdom-structure'; kingdomId: number; building: 'torre' | 'centro_militar' }
  | { type: 'destroy-tower'; kingdomId: number; towerId: number }
  | { type: 'capture-tower'; kingdomId: number; towerId: number }
  | { type: 'recruit-soldier'; kingdomId: number };
export function createWorld(config: WorldConfig = defaultWorldConfig, seed = 42): WorldState {
  if (config.scenario !== 'kingdom') throw new Error('Cenário não implementado.');
  return engine.createWorld(seed);
}
export function stepDay(world: WorldState) { return engine.stepDay(world); }
export const snapshot = engine.snapshot;
export const inspectTile = engine.inspectTile;
