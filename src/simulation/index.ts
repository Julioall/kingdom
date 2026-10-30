import engine from './engine.js';
import { defaultWorldConfig, type WorldConfig, type WorldState } from './core/state';
import { dispatchCommand } from './commands.js';
export { dispatchCommand };
export type WorldCommand =
  | { type: 'magic-tick'; elapsedMs: number }
  | { type: 'magic-loadout'; personId: number; spells: string[]; role?: string }
  | { type: 'magic-orders'; personId: number; policy: string }
  | { type: 'drought'; days: number; intensity: number }
  | { type: 'add-individuals'; count: number }
  | { type: 'kingdom-structure'; kingdomId: number; building: 'torre' | 'centro_militar' }
  | { type: 'destroy-tower'; kingdomId: number; towerId: number }
  | { type: 'capture-tower'; kingdomId: number; towerId: number }
  | { type: 'recruit-soldier'; kingdomId: number }
  | { type: 'player-control'; personId: number; enabled: boolean }
  | { type: 'player-input'; personId: number; moveX: number; moveY: number; defending: boolean; healing?: boolean; healingTargetId?: number; dt?: number; inputSequence?: number; aimX?: number; aimY?: number }
  | { type: 'player-action'; personId: number; actionKey: string; aimX: number; aimY: number; targetId?: number };
export function createWorld(config: WorldConfig = defaultWorldConfig, seed = 42): WorldState {
  if (config.scenario !== 'kingdom') throw new Error('Cenário não implementado.');
  return engine.createWorld(seed);
}
export function stepDay(world: WorldState) { return engine.stepDay(world); }
export const snapshot = engine.snapshot;
export const inspectTile = engine.inspectTile;
