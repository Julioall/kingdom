import { feedRationPortions } from '../config/ecosystem.js';
export { formatWholeMeasure } from '../config/whole-measures.js';

export function wholeRationPortions(internalFeedAmount) {
  return feedRationPortions(internalFeedAmount);
}
