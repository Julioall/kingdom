import { updateCombatResources } from './kingdoms/combat-resources.js';
import { updateTowerShifts, defendTowers } from './kingdoms/tower-archers.js';
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
import { maintainKingdomFortifications, prepareKingdomCampaigns, resolveKingdomCampaigns } from './kingdoms/campaigns.js';
import { advanceKingdomProjects } from './kingdoms/projects.js';
import { updateClericHealing, fightBattlefieldSkirmishes, respondToLocalThreats } from './kingdoms/military.js';
import { payMilitarySalaries } from './kingdoms/service.js';
import { observeMilitaryFrontiers } from './kingdoms/frontier-intelligence.js';
import { recordRoyalSitingOutcomes } from './kingdoms/royal-siting.js';
import { recordKingdomFrontierOutcomes, updateKingdomFrontierExpansion } from './kingdoms/frontier.js';
import { advanceSocialCommitmentDeadlines } from './society/social-evidence.js';
import { recoverTrainingDummyHealth } from './world/training-dummies.js';
import { advanceMagic } from './magic/system.js';

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

function updateMarketMaintenance(world, day) {
  if (day % DAYS_PER_MARKET_CYCLE !== 0) return;
  updateKingdomMarkets(world, day);
  maintainKingdomFortifications(world, day);
}

function updateResourcesAndMarkets(world, day) {
  updateLooseLogs(world);
  decompose(world);
  updateMarketMaintenance(world, day);
}

function advanceCalendar(world, day) {
  const date = calendarDate(day);
  world.day = day;
  world.year = date.year;
  world.season = date.season;
}

function reportWorldState(world, day, stats) {
  const flows = world.ecologyFlows || {};
  const harvest = world.harvests && world.harvests.plantFoodBiomass || 0;
  const cultivatedHarvest = world.harvests && world.harvests.cultivatedFoodBiomass || 0;
  const cursor = world.ecologyReportCursor || {
    day,
    humanFoodBiomass: stats.humanFoodBiomass,
    plantFoodHarvested: harvest,
    humanFoodRegrowth: flows.humanFoodRegrowth || 0,
    humanFoodNaturalLoss: flows.humanFoodNaturalLoss || 0,
    humanFoodSettlementLoss: flows.humanFoodSettlementLoss || 0,
    humanFoodCultivatedRegrowth: flows.humanFoodCultivatedRegrowth || 0,
    humanFoodCultivationSeeded: flows.humanFoodCultivationSeeded || 0,
    cultivatedFoodHarvested: cultivatedHarvest
  };
  const amountSince = key => (flows[key] || 0) - (cursor[key] || 0);
  const harvested = harvest - (cursor.plantFoodHarvested || 0);
  const regrowth = amountSince('humanFoodRegrowth');
  const naturalLoss = amountSince('humanFoodNaturalLoss');
  const settlementLoss = amountSince('humanFoodSettlementLoss');
  const cultivatedRegrowth = amountSince('humanFoodCultivatedRegrowth');
  const cultivatedSeeds = amountSince('humanFoodCultivationSeeded');
  const harvestedCultivated = cultivatedHarvest - (cursor.cultivatedFoodHarvested || 0);
  const biomassChange = stats.humanFoodBiomass - cursor.humanFoodBiomass;
  const signed = value => (value > 0 ? '+' : value < 0 ? '−' : '') + Math.round(Math.abs(value)).toLocaleString('pt-BR');
  const quantity = value => Math.round(value).toLocaleString('pt-BR');
  const periodDays = Math.max(1, day - cursor.day);
  const foodReport = 'Alimento vegetal humano (' + periodDays + ' dias): biomassa ' + quantity(stats.humanFoodBiomass)
    + ' unidades (' + signed(biomassChange) + '); regeneração ' + quantity(regrowth)
    + ' (cultivo ' + quantity(cultivatedRegrowth) + '), sementes ' + quantity(cultivatedSeeds) + ', colheita ' + quantity(harvested)
    + ' (cultivo ' + quantity(harvestedCultivated) + '), perda natural ' + quantity(naturalLoss)
    + ' e perda por assentamentos/trilhas ' + quantity(settlementLoss) + '.';
  const populationReport = 'Biomassa vegetal total ' + Math.round(stats.plantBiomass / 1000)
    + ' t, ' + stats.animalCount + ' animais e ' + stats.independentPeople + ' indivíduos ainda dispersos.';
  log(world, 'Dia ' + day + ': ' + foodReport + ' ' + populationReport, day);
  world.ecologyReportCursor = {
    day,
    humanFoodBiomass: stats.humanFoodBiomass,
    plantFoodHarvested: harvest,
    humanFoodRegrowth: flows.humanFoodRegrowth || 0,
    humanFoodNaturalLoss: flows.humanFoodNaturalLoss || 0,
    humanFoodSettlementLoss: flows.humanFoodSettlementLoss || 0,
    humanFoodCultivatedRegrowth: flows.humanFoodCultivatedRegrowth || 0,
    humanFoodCultivationSeeded: flows.humanFoodCultivationSeeded || 0,
    cultivatedFoodHarvested: cultivatedHarvest
  };
}

function resolveEndOfDayConsequences(world, day) {
  // Commands and construction may have changed structures during today's actions.
  recomputeKingdomTerritories(world);
  recordKingdomFrontierOutcomes(world, day);
  observeMilitaryFrontiers(world, day);
  recordRoyalSitingOutcomes(world, day);
  resolveBorderIncursions(world, (person, cause) => killPerson(world, person, cause));

  if (day % DAYS_PER_WORLD_REPORT !== 0) return;
  const stats = snapshot(world);
  reportWorldState(world, day, stats);
}

export function stepDay(world, options = null) {
  const nextDay = world.day + 1;
  if (!world.magicExternalClock || options?.advanceMagic) advanceMagic(world, 1000);
  recoverTrainingDummyHealth(world, nextDay);

  // 1. Weather and ecology establish the conditions for the day.
  const weather = updateEnvironment(world, nextDay);

  // 2. Rulers may fund a neutral frontier post from their own treasury before resolving today's needs.
  updateKingdomFrontierExpansion(world, nextDay);

  // 3. Known war incidents mobilize forces and make field rations available before needs resolve.
  updateCombatResources(world, nextDay);
  updateTowerShifts(world, nextDay);
  prepareKingdomCampaigns(world, nextDay);

  // 4. Residents respond to current needs, resources, territory, and military orders.
  payMilitarySalaries(world, nextDay);
  updateSociety(world);
  updateClericHealing(world, nextDay);
  fightBattlefieldSkirmishes(world, nextDay);
  resolveKingdomCampaigns(world, nextDay);
  defendTowers(world, nextDay);
  respondToLocalThreats(world, nextDay);

  // 5. Loose materials decay; market prices and fortification upkeep refresh monthly.
  updateResourcesAndMarkets(world, nextDay);

  // 6. Border incidents use the new date and territory after today's actions.
  advanceCalendar(world, nextDay);
  advanceSocialCommitmentDeadlines(world);
  advanceKingdomProjects(world, nextDay);
  resolveEndOfDayConsequences(world, nextDay);

  const capturedSnapshot = options && options.includeSnapshot === false
    ? null : snapshot(world);
  return { weather, snapshot: capturedSnapshot };
}

export function tick(world, days) {
  const count = Math.max(0, Math.floor(days || 1));
  let result;

  for (let index = 0; index < count; index++) result = stepDay(world);
  return result;
}
