import { DAILY_FOOD_NEED } from '../../config/ecosystem.js';
import { communityFoodStock } from '../economy/inventories.js';
import { communityFoodBufferDays } from '../economy/food-policy.js';
import { HUMAN_ADULT_AGE_DAYS } from '../individuals/human-age.js';

// A king can approve conditions for a family, never order a synthetic birth.
// The capacity derives from real adult caregivers, existing dependents and
// available food, with no population target or birth-rate multiplier.
export function assessKingdomPopulationGrowth(world, kingdomId, communityId = null) {
  const kingdom = (world.kingdoms || []).find(k => k.id === kingdomId) || null;
  const effectiveCommunityId = kingdom?.communityId ?? communityId;
  const community = (world.communities || []).find(c => c.id === effectiveCommunityId && !c.dissolved) || null;
  const members = (world.people || []).filter(p => p.alive
    && (kingdom ? p.kingdomId === kingdom.id : community && p.communityId === community.id));
  const caregivers = members.filter(p => p.role !== 'soldier' && p.ageDays >= HUMAN_ADULT_AGE_DAYS
    && p.health >= 45 && p.hydration >= 25 && p.campaignId == null);
  const children = members.filter(p => p.ageDays < HUMAN_ADULT_AGE_DAYS).length;
  const careSlots = Math.max(0, caregivers.length * 2 - children);
  const meanCaregiverFood = caregivers.length
    ? caregivers.reduce((total, p) => total + Math.max(0, Number(p.foodReserve) || 0), 0) / caregivers.length : 0;
  const sharedFood = communityFoodStock(community);
  const sharedFoodDays = communityFoodBufferDays(sharedFood, members.length * DAILY_FOOD_NEED);
  // An emergency community store OR healthy caretakers with substantial
  // *existing personal* reserves may support children. Neither is minted.
  const foodReady = sharedFoodDays >= 7 || meanCaregiverFood >= 65;
  const reasons = [];
  if (!caregivers.length) reasons.push('nenhum adulto civil em condições de cuidar das crianças');
  else if (careSlots === 0) reasons.push('cuidadores civis já atendem o limite seguro de dependentes');
  if (!foodReady) reasons.push('reservas alimentares compartilhadas e pessoais insuficientes');
  return {
    kingdomId: kingdom?.id ?? null, communityId: community?.id ?? null,
    population: members.length, children, caregivers: caregivers.length,
    careSlots, meanCaregiverFood: Number(meanCaregiverFood.toFixed(2)),
    sharedFoodDays: Number.isFinite(sharedFoodDays) ? Number(sharedFoodDays.toFixed(2)) : null,
    foodReady, maySupportChild: careSlots > 0 && foodReady,
    reason: reasons.length ? reasons.join('; ') : 'há capacidade real de cuidado e alimentação'
  };
}
