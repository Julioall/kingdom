// One simulated calendar day advances human biological age by one day.
// The world calendar and ecological seasons are not accelerated.
export const HUMAN_CHILD_AGE_DAYS = 0;
export const HUMAN_ADOLESCENT_AGE_DAYS = 240;
export const HUMAN_ADULT_AGE_DAYS = 365;
export const HUMAN_RECRUIT_AGE_DAYS = HUMAN_ADULT_AGE_DAYS;
export const HUMAN_FERTILE_START_DAYS = HUMAN_ADULT_AGE_DAYS;
export const HUMAN_ELDER_AGE_DAYS = 730;
export const HUMAN_FERTILE_END_DAYS = HUMAN_ELDER_AGE_DAYS;
export const HUMAN_MAX_AGE_DAYS = 900; // ~2.47 game years
export const HUMAN_BIRTH_COOLDOWN_DAYS = 120;

// Only new characters use this age distribution. Initial older saved games
// require a separate explicit save migration, not silent age conversion.
export const HUMAN_INITIAL_MIN_AGE_DAYS = HUMAN_ADULT_AGE_DAYS;
export const HUMAN_INITIAL_AGE_SPAN_DAYS = 350;

export function humanLifeStage(ageDays) {
  if (!Number.isFinite(ageDays) || ageDays < HUMAN_ADOLESCENT_AGE_DAYS) return 'Criança';
  if (ageDays < HUMAN_ADULT_AGE_DAYS) return 'Adolescente';
  if (ageDays < HUMAN_ELDER_AGE_DAYS) return 'Adulto';
  return 'Idoso';
}
