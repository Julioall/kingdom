// JUL-284 — action utility projection at the existing causal decision point.
// Every selector is lazy: calculating a score must not run world queries which
// the prior short-circuit expression would have skipped. This function only
// scores currently observed facts; it never advances the world or selects an
// action on behalf of an NPC.
import { clamp } from '../core/math.js';

export function buildPeopleActionUtilities({
  w, p, inputs, food, community, groupFood, shelter, preyNearby, herdPrey, huntGround,
  foodNeed, huntAccess, deliveryNeed, waterTarget, socialTarget, localSuitability, risk,
  borderRisk, canBuild, canGather, materialNeed, goldNeed, storage, looseLog,
  pen, browseFood, herd, browseAccess, feedNeed, communityFoodAidAvailable,
  voluntaryFoodAidAvailable, tradePartner, marketTrust, canMigrate,
  hasFoodPressure, hasWaterPressure, availablePen, sheepSighting, raidTarget,
  communitySize
}, selectors) {
  const { communityBuildUtility, carriedResources, communityHerd, communityFoodStock } = selectors;
  return [
    food ? inputs[0] * 1.85 + .24 + inputs[4] * .2 + (community && groupFood < 8 ? .12 : 0) + p.skills.forage * .08 : -.6,
    shelter && (preyNearby || herdPrey || huntGround) && (p.carriedMeat || 0) <= .01 ? .1 + foodNeed * (.45 + huntAccess * .5) + p.skills.hunt * .16 + (preyNearby || herdPrey ? .28 : 0) : -.65,
    (p.carriedMeat || 0) > .01 && shelter ? .72 + deliveryNeed * .45 : -.7,
    waterTarget ? inputs[1] * 2.05 + .32 : -.5,
    inputs[3] * p.sociability * .82 + (socialTarget ? .12 : -.35),
    inputs[2] * .92 + p.injury * .045 + .04,
    .08 + Math.max(0, .28 - localSuitability) * .7 + risk * .16 - borderRisk * .8,
    canBuild ? communityBuildUtility(w, community, communitySize) : -1,
    canGather ? clamp(.17 + (community && materialNeed > .05 ? .48 + materialNeed * .25 : 0) + goldNeed * .24 + p.skills.gather * .12, .12, .82) : -.55,
    storage.destination && looseLog && !carriedResources(p) && p.carriedWood < 22
      ? clamp(.32 + inputs[16] * .3 + materialNeed * .55 + (storage.community.stores.wood < 18 ? .18 : 0), .2, .95) : -.65,
    community && pen && browseFood && herd.length && (community.stores.feed || 0) < 48
      ? clamp(.12 + browseAccess * .2 + feedNeed * .62 + p.skills.care * .15, .12, .9) : -.65,
    (communityFoodAidAvailable || voluntaryFoodAidAvailable) ? .3 + inputs[6] * .5 + p.skills.care * .16 : -.55,
    tradePartner ? .54 + p.skills.diplomacy * .15 + marketTrust * .12 : -.55,
    canMigrate ? .18 + risk * .58 + (1 - localSuitability) * .32 + (hasFoodPressure ? .64 : 0) + (hasWaterPressure ? .62 : 0) : -.7,
    community && availablePen && sheepSighting && sheepSighting.visible && !p.leadingSheepId
      ? .28 + (sheepSighting.distance <= 1.6 ? .72 : .24) + p.skills.care * .14 + (communityHerd(w, community).length < 3 ? .12 : 0) : -.8,
    p.leadingSheepId && pen ? 1.18 : -.8,
    raidTarget && community && communityFoodStock(community) / Math.max(1, communitySize) < 2.2
      ? .2 + clamp(.95 - communityFoodStock(community) / Math.max(1, communitySize), 0, 1) * .7 + raidTarget.relation.tension * .28 : -.85
  ];
}
