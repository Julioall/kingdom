// Browser population controls remain explicit and reproducible across reset.
// Keep stress ceiling separate from the playable default.
// Two kingdoms, 100 people each. The 80/20 role split is applied by world generation.
export const DEFAULT_BROWSER_POPULATION = 200;
export const MIN_INITIAL_POPULATION = 96;
export const MAX_INITIAL_POPULATION = 5000;

export function parseInitialPopulation(parameter) {
  if (typeof parameter !== 'string' || !/^\d+$/.test(parameter))
    return DEFAULT_BROWSER_POPULATION;
  const population = Number(parameter);
  return Number.isSafeInteger(population)
    && population >= MIN_INITIAL_POPULATION
    && population <= MAX_INITIAL_POPULATION
    ? population : DEFAULT_BROWSER_POPULATION;
}
