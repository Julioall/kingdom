import { DOMESTIC_SHEEP_DAILY_FEED, DOMESTIC_SHEEP_DAILY_RATION_PORTIONS, MEAT_NUTRITIONAL_VALUE } from '../config/ecosystem.js';
import { communityHerdPenAssignments, DOMESTIC_SHEEP_PER_PEN } from '../simulation/ecology/herd.js';
import { currencyValueCopper } from '../simulation/economy/currency-denominations.js';
import { wholeRationPortions } from './whole-measures.js';


const sum = (items, value) => items.reduce((total, item) => total + (Number(value(item)) || 0), 0);
const food = stock => (stock?.food || 0) + (stock?.meat || 0) * MEAT_NUTRITIONAL_VALUE;

// Count each account once. Food stocks and personal reserves are reported as adult person-days.
export function resourceSummary(world, kingdomId = null) {
  const people = world.people.filter(p => p.alive && (kingdomId == null || p.kingdomId === kingdomId));
  const kingdoms = world.kingdoms.filter(k => kingdomId == null || k.id === kingdomId);
  const communities = world.communities.filter(c => !c.dissolved && (kingdomId == null
    || kingdoms.some(k => k.communityId === c.id)));
  const accounts = [...kingdoms.flatMap(k => [k.treasury?.stock, k.market?.stock]), ...communities.map(c => c.stores), ...(kingdomId == null && world.market ? [world.market] : [])];
  // Account ownership is not physical access: community stores, treasury and markets
  // remain separate even though the HUD displays their aggregate in adult person-days.
  const foodByAccount = {
    community: sum(communities, c => food(c.stores)),
    treasury: sum(kingdoms, k => food(k.treasury?.stock)),
    market: sum(kingdoms, k => food(k.market?.stock)),
    unassignedMarket: kingdomId == null ? food(world.market) : 0
  };
  const gold = sum(accounts, a => a?.gold)
    + sum(people, p => (p.carriedGold || 0) + (p.militaryWallet?.stock?.gold || 0)
      + (p.personalWallet?.stock?.gold || 0));
  const copper = sum(accounts, a => a?.copper) + sum(people, p => p.carriedCopper || 0);
  const silver = sum(accounts, a => a?.silver) + sum(people, p => p.carriedSilver || 0);
  const iron = sum(accounts, a => a?.iron) + sum(people, p => p.carriedIron || 0);
  const nominalCopper = currencyValueCopper({ gold, silver, copper });
  const deceased = world.people.filter(p => !p.alive && (kingdomId == null || (p.deathKingdomId !== undefined ? p.deathKingdomId : p.kingdomId) === kingdomId));
  const born = world.people.filter(p => p.parents?.length && (kingdomId == null || (p.birthKingdomId !== undefined ? p.birthKingdomId : p.kingdomId) === kingdomId));
  return {
    people: people.length,
    food: sum(accounts, food),
    foodByAccount,
    gold, copper, silver, iron, nominalCopper,
    births: born.length, deaths: deceased.length,
    hungry: people.filter(p => p.foodReserve < 30).length,
    thirsty: people.filter(p => p.hydration < 30).length,
    tired: people.filter(p => p.energy < 25).length,
    homeless: people.filter(p => !world.structures.some(s => s.complete && s.destroyedDay == null
      && (s.residentIds || []).includes(p.id))).length,
    satisfaction: kingdomId != null ? (kingdoms[0]?.satisfaction || 0) : (kingdoms.length ? sum(kingdoms, k => k.satisfaction) / kingdoms.length : 0)
  };
}

export function corralSummary(world, structure) {
  const assignments = communityHerdPenAssignments(world, structure.communityId).assignments;
  const herd = world.animals.filter(a => a.alive && a.speciesId === 'sheep'
    && a.herdCommunityId === structure.communityId && assignments.get(a.id) === structure.id);
  const community = world.communities.find(c => c.id === structure.communityId && !c.dissolved);
  const feed = community?.stores?.feed || 0;
  const dailyFeed = herd.length * DOMESTIC_SHEEP_DAILY_FEED;
  const births = structure.herdBirths || 0;
  return { sheep: herd.length, capacity: DOMESTIC_SHEEP_PER_PEN, feed, feedPortions: wholeRationPortions(feed),
    dailyFeed, dailyRationPortions: herd.length * DOMESTIC_SHEEP_DAILY_RATION_PORTIONS,
    feedDays: dailyFeed > 0 ? feed / dailyFeed : null,
    fedToday: sum(herd, a => (a.lastFedDay === world.day || a.lastFedDay === world.day - 1)
      && a.lastFeedAmount > 0 ? DOMESTIC_SHEEP_DAILY_RATION_PORTIONS : 0),
    births, lastBirthDay: structure.lastHerdBirthDay ?? null,
    breedingReady: herd.filter(a => a.ageDays >= 200 && a.energy >= 74 && a.reproductionCooldown <= 0).length,
    foodProduced: 0 };
}

