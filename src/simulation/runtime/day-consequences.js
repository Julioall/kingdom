// Centralized world-facing consequences and the periodic historical record.
// Called after the command, economy and combat phases have settled.
import { snapshot } from '../world/queries.js';
import { log } from '../core/events.js';
import { recomputeKingdomTerritories, resolveBorderIncursions } from '../kingdoms/territories.js';
import { killPerson } from '../individuals/lifecycle.js';
import { recordKingdomFrontierOutcomes } from '../kingdoms/frontier.js';
import { observeMilitaryFrontiers } from '../kingdoms/frontier-intelligence.js';
import { recordRoyalSitingOutcomes } from '../kingdoms/royal-siting.js';
import { samplePhase } from './phase-measure.js';

const DAYS_PER_WORLD_REPORT = 30;

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

export function resolveEndOfDayConsequences(world, day, observer = null) {
  // Commands and construction may have changed structures during today's actions.
  samplePhase(observer, 'territoriesAfterActors', () => recomputeKingdomTerritories(world));
  recordKingdomFrontierOutcomes(world, day);
  observeMilitaryFrontiers(world, day);
  recordRoyalSitingOutcomes(world, day);
  resolveBorderIncursions(world, (person, cause) => killPerson(world, person, cause));

  if (day % DAYS_PER_WORLD_REPORT !== 0) return;
  const stats = snapshot(world);
  reportWorldState(world, day, stats);
}
