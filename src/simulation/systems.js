import { calendarDate, updateClimate } from './ecology/climate.js';
import { updateSoilAndWater } from './ecology/hydrology.js';
import { decompose, updateLooseLogs, updatePlants } from './ecology/plants.js';
import { updateAnimals } from './ecology/animals.js';
import { updatePeople } from './individuals/actions.js';
import { snapshot } from './world/queries.js';
import { log } from './core/events.js';
import { updateKingdomMarkets } from './kingdoms/initialization.js';
import { recomputeKingdomTerritories, resolveBorderIncursions } from './kingdoms/territories.js';
import { killPerson } from './individuals/lifecycle.js';
import { updateRoadWear } from './world/roads.js';

const DAYS_PER_MARKET_CYCLE = 30;
const DAYS_PER_WORLD_REPORT = 30;

function updateEnvironment(world, day) {
  const weather = updateClimate(world, day);

  // Traffic influences plant recovery, so refresh roads before soil and vegetation.
  updateRoadWear(world);
  updateSoilAndWater(world);
  updatePlants(world, day);
  updateAnimals(world);

  // People and animals need current ownership when they decide where to move.
  recomputeKingdomTerritories(world);
  return weather;
}

function updateSociety(world) {
  updatePeople(world);
}

function updateResourcesAndMarkets(world, day) {
  updateLooseLogs(world);
  decompose(world);

  if (day % DAYS_PER_MARKET_CYCLE === 0) updateKingdomMarkets(world);
}

function advanceCalendar(world, day) {
  const date = calendarDate(day);
  world.day = day;
  world.year = date.year;
  world.season = date.season;
}

function resolveEndOfDayConsequences(world, day) {
  // Commands and construction may have changed structures during today's actions.
  recomputeKingdomTerritories(world);
  resolveBorderIncursions(world, (person, cause) => killPerson(world, person, cause));

  if (day % DAYS_PER_WORLD_REPORT !== 0) return;
  const stats = snapshot(world);
  log(world, 'Dia ' + day + ': biomassa vegetal ' + Math.round(stats.plantBiomass / 1000)
    + ' t, ' + stats.animalCount + ' animais e ' + stats.independentPeople + ' indivíduos ainda dispersos.');
}

export function stepDay(world) {
  const nextDay = world.day + 1;

  // 1. Weather and ecology establish the conditions for the day.
  const weather = updateEnvironment(world, nextDay);

  // 2. Residents respond to current needs, resources, and territory.
  updateSociety(world);

  // 3. Loose materials decay; market prices refresh on the monthly cycle.
  updateResourcesAndMarkets(world, nextDay);

  // 4. Border incidents use the new date and the territory after today's actions.
  advanceCalendar(world, nextDay);
  resolveEndOfDayConsequences(world, nextDay);

  return { weather, snapshot: snapshot(world) };
}

export function tick(world, days) {
  const count = Math.max(0, Math.floor(days || 1));
  let result;

  for (let index = 0; index < count; index++) result = stepDay(world);
  return result;
}
