// Keep energy normalized to 0–100 while providing 50% more activity per reserve.
export const PERSON_ENERGY_COST_SCALE = 0.55 / 1.5;
// A marching/engaged soldier is conditioned for sustained field activity.
// Reduces energy spent by 38% without extending the 0–100 meter or
// modifying civilians' hunger, health, injury or water needs.
export const CAMPAIGN_SOLDIER_ENDURANCE_FACTOR = 0.62;

export function consumePersonEnergy(person, amount) {
  if (!person || !Number.isFinite(person.energy)) return 0;
  const militaryFactor = person.role === 'soldier' && person.campaignId != null
    ? CAMPAIGN_SOLDIER_ENDURANCE_FACTOR : 1;
  const cost = Math.max(0, Number(amount) || 0) * PERSON_ENERGY_COST_SCALE * militaryFactor;
  person.energy = Math.max(0, person.energy - cost);
  return cost;
}
