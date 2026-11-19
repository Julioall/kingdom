import { HUMAN_ADULT_AGE_DAYS, HUMAN_ELDER_AGE_DAYS, HUMAN_MAX_AGE_DAYS, humanLifeStage } from '../simulation/individuals/human-age.js';

// Rendering only. Pawn size follows the same timeline as game mechanics.
export function personAgeScale(ageDays) {
  const age = Math.max(0, Number.isFinite(ageDays) ? ageDays : 0);
  if (age < HUMAN_ADULT_AGE_DAYS) return .6 + .4 * age / HUMAN_ADULT_AGE_DAYS;
  if (age < HUMAN_ELDER_AGE_DAYS) return 1;
  return 1 - .08 * Math.min(1, (age - HUMAN_ELDER_AGE_DAYS) / (HUMAN_MAX_AGE_DAYS - HUMAN_ELDER_AGE_DAYS));
}

export function personLifeStage(ageDays) {
  return humanLifeStage(ageDays);
}
