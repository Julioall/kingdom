// Environment provider: kept isolated so simplified economic resource sources
// can replace costly ecology without changing the campaign day orchestrator.
import { updateClimate } from '../ecology/climate.js';
import { updateRoadWear } from '../world/roads.js';
import { updateSoilAndWater } from '../ecology/hydrology.js';
import { updatePlants } from '../ecology/plants.js';
import { updateAnimals } from '../ecology/animals.js';
import { recomputeKingdomTerritories } from '../kingdoms/territories.js';
import { samplePhase } from './phase-measure.js';

export function updateEnvironment(world, day, observer = null) {
  const weather = samplePhase(observer, 'climate', () => updateClimate(world, day));

  // Traffic influences plant recovery, so refresh roads before soil and vegetation.
  samplePhase(observer, 'roads', () => updateRoadWear(world));
  samplePhase(observer, 'hydrology', () => updateSoilAndWater(world));
  samplePhase(observer, 'vegetation', () => updatePlants(world, day));
  samplePhase(observer, 'animals', () => updateAnimals(world));

  // People and animals need current ownership when they decide where to move.
  samplePhase(observer, 'territoriesBeforeActors', () => recomputeKingdomTerritories(world));
  return weather;
}
