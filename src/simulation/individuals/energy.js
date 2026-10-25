export const PERSON_ENERGY_COST_SCALE = 0.55;

export function consumePersonEnergy(person, amount) {
  if (!person || !Number.isFinite(person.energy)) return 0;
  const cost = Math.max(0, Number(amount) || 0) * PERSON_ENERGY_COST_SCALE;
  person.energy = Math.max(0, person.energy - cost);
  return cost;
}
