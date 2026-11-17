// Economy maintenance owns market cycles and loose-resource accounting.
// The decomposition hooks remain temporary dependencies of the old ecology.
import { decompose, updateLooseLogs } from '../ecology/plants.js';
import { updateKingdomMarkets } from '../kingdoms/initialization.js';
import { maintainKingdomFortifications } from '../kingdoms/campaigns.js';
import { samplePhase } from './phase-measure.js';

const DAYS_PER_MARKET_CYCLE = 30;

function updateMarketMaintenance(world, day) {
  if (day % DAYS_PER_MARKET_CYCLE !== 0) return;
  updateKingdomMarkets(world, day);
  maintainKingdomFortifications(world, day);
}

export function updateResourcesAndMarkets(world, day, observer = null) {
  samplePhase(observer, 'looseLogs', () => updateLooseLogs(world));
  samplePhase(observer, 'decomposition', () => decompose(world));
  samplePhase(observer, 'marketMaintenance', () => updateMarketMaintenance(world, day));
}
