// Keep energy normalized to 0–100 while providing 50% more activity per reserve.
export const PERSON_ENERGY_COST_SCALE = 0.55 / 1.5;

export function consumePersonEnergy(person, amount) {
  if (!person || !Number.isFinite(person.energy)) return 0;
  const cost = Math.max(0, Number(amount) || 0) * PERSON_ENERGY_COST_SCALE;
  person.energy = Math.max(0, person.energy - cost);
  return cost;
}
