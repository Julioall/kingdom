// The browser needs read-only metadata and geometry, not the full Worker engine.
// Named imports let the bundler omit simulation systems from the UI bundle.
import { WIDTH, HEIGHT, PLANTS, ANIMALS, SEASONS, PEOPLE_ACTIONS } from '../config/ecosystem.js';
import { inspectTile } from '../simulation/world/queries.js';
import { calendarDate, seasonIndex } from '../simulation/ecology/climate.js';
import { isTreeAnchor } from '../simulation/ecology/plants.js';
import { corralGate } from '../simulation/individuals/movement.js';
import { npcHitbox, structureHitbox, structureInteractionPoint, worldCollisionIndex } from '../simulation/physics/hitboxes.js';
import { KINGDOM_PROJECT_TIMING } from '../simulation/kingdoms/commands.js';
import { militaryClassSource } from '../simulation/kingdoms/military-sources.js';

export default {
  width: WIDTH, height: HEIGHT, plants: PLANTS, animals: ANIMALS, seasons: SEASONS, actions: PEOPLE_ACTIONS,
  inspectTile,
  kingdomCommands: { timing: KINGDOM_PROJECT_TIMING, militaryClassSource },
  modules: {
    Cosmos: { calendarDate, seasonIndex },
    Biosphere: { Botany: { isTreeAnchor } },
    SocietyExperiment: { corralGate },
    Collision: { npcHitbox, structureHitbox, structureInteractionPoint, worldCollisionIndex },
  },
};
