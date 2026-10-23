import { createWorld, stepDay, dispatchCommand, type WorldCommand } from '../simulation';
import { defaultWorldConfig, type WorldConfig } from '../simulation/core/state';
export class GameSession {
  world;
  paused = false;
  speed = 1;
  revision = 0;
  constructor(private readonly config: WorldConfig = defaultWorldConfig, seed = 42) {
    this.world = createWorld(config, seed);
  }
  reset(seed: number) {
    this.world = createWorld(this.config, seed);
    this.revision++;
    this.paused = false;
    return this.world;
  }
  advance() { return stepDay(this.world); }
  dispatch(command: WorldCommand) { return dispatchCommand(this.world, command); }
}
