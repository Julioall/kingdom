// Orchestrates one authoritative day; subsystems own their domain details.
// Preserve phase order, RNG consumption and side effects for deterministic QA.
import { updateCombatResources } from './kingdoms/combat-resources.js';
import { updateTowerShifts, defendTowers } from './kingdoms/tower-archers.js';
import { calendarDate } from './ecology/climate.js';
import { updatePeople } from './individuals/actions.js';
import { snapshot } from './world/queries.js';
import { prepareKingdomCampaigns, resolveKingdomCampaigns } from './kingdoms/campaigns.js';
import { advanceKingdomProjects } from './kingdoms/projects.js';
import { updateClericHealing, fightBattlefieldSkirmishes, respondToLocalThreats } from './kingdoms/military.js';
import { payMilitarySalaries } from './kingdoms/service.js';
import { updateKingdomFrontierExpansion } from './kingdoms/frontier.js';
import { advanceSocialCommitmentDeadlines } from './society/social-evidence.js';
import { recoverTrainingDummyHealth } from './world/training-dummies.js';
import { advanceMagic } from './magic/system.js';
import { samplePhase as sampleSimulationPhase } from './runtime/phase-measure.js';
import { updateEnvironment } from './runtime/environment-phase.js';
import { updateResourcesAndMarkets } from './runtime/economy-maintenance.js';
import { resolveEndOfDayConsequences } from './runtime/day-consequences.js';

function updateSociety(world, phaseObserver = null) {
  updatePeople(world, phaseObserver);
}

function advanceCalendar(world, day) {
  const date = calendarDate(day);
  world.day = day;
  world.year = date.year;
  world.season = date.season;
}

export function stepDay(world, options = null) {
  const nextDay = world.day + 1;
  if (!world.magicExternalClock || options?.advanceMagic) advanceMagic(world, 1000);
  recoverTrainingDummyHealth(world, nextDay);

  // 1. Weather and ecology establish the conditions for the day.
  const observer = typeof options?.onEnvironmentPhase === 'function'
    ? options.onEnvironmentPhase : null;
  const simulationObserver = typeof options?.onSimulationPhase === 'function'
    ? options.onSimulationPhase : null;
  const measure = (name, run) => sampleSimulationPhase(simulationObserver, name, run);
  const weather = measure('environment', () => updateEnvironment(world, nextDay, observer));

  // 2. Rulers may fund a neutral frontier post from their own treasury before resolving today's needs.
  measure('frontierExpansion', () => updateKingdomFrontierExpansion(world, nextDay));

  // 3. Known war incidents mobilize forces and make field rations available before needs resolve.
  measure('combatResources', () => updateCombatResources(world, nextDay));
  measure('towerShifts', () => updateTowerShifts(world, nextDay));
  measure('campaignPreparation', () => prepareKingdomCampaigns(world, nextDay));

  // 4. Residents respond to current needs, resources, territory, and military orders.
  measure('militarySalaries', () => payMilitarySalaries(world, nextDay));
  measure('societyAndNpcActions', () => updateSociety(world, simulationObserver));
  measure('clericHealing', () => updateClericHealing(world, nextDay));
  measure('battlefieldSkirmishes', () => fightBattlefieldSkirmishes(world, nextDay));
  measure('campaignResolution', () => resolveKingdomCampaigns(world, nextDay));
  measure('towerDefense', () => defendTowers(world, nextDay));
  measure('localThreatResponse', () => respondToLocalThreats(world, nextDay));

  // 5. Loose materials decay; market prices and fortification upkeep refresh monthly.
  measure('resourcesAndMarkets', () => updateResourcesAndMarkets(world, nextDay, observer));

  // 6. Border incidents use the new date and territory after today's actions.
  measure('calendar', () => advanceCalendar(world, nextDay));
  measure('socialDeadlines', () => advanceSocialCommitmentDeadlines(world));
  measure('kingdomProjects', () => advanceKingdomProjects(world, nextDay));
  measure('endOfDay', () => resolveEndOfDayConsequences(world, nextDay, observer));

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
