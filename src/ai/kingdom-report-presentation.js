import { DOMESTIC_SHEEP_DAILY_FEED, DOMESTIC_SHEEP_DAILY_RATION_PORTIONS } from '../config/ecosystem.js';

const whole = value => {
  if (!Number.isFinite(value)) return value;
  return value > 0 && value < 1 ? 'menos de 1' : Math.round(value);
};
const wholeRations = value => Number.isFinite(value)
  ? whole(value / DOMESTIC_SHEEP_DAILY_FEED * DOMESTIC_SHEEP_DAILY_RATION_PORTIONS) : value;

function presentStock(stock = {}) {
  return {
    ...stock,
    food: whole(stock.food),
    feed: wholeRations(stock.feed),
    wood: whole(stock.wood),
    stone: whole(stock.stone),
    gold: whole(stock.gold)
  };
}

function presentFoodInfrastructure(infrastructure = {}) {
  const result = { ...infrastructure };
  for (const key of ['standingCropBiomass', 'harvestableCropPotential', 'harvestedCropToDate', 'seedStock', 'replantSeedMass']) {
    result[key] = whole(result[key]);
  }
  result.feedStock = wholeRations(result.feedStock);
  result.feedTarget = wholeRations(result.feedTarget);
  if (Array.isArray(result.fields)) {
    result.fields = result.fields.map(field => {
      const presented = { ...field };
      for (const key of ['seedMass', 'yieldTarget', 'growthGenerated', 'harvestedThisCycle', 'standingBiomass', 'seedReserveReturned', 'foodDelivered']) {
        presented[key] = whole(presented[key]);
      }
      return presented;
    });
  }
  return result;
}

/** Quantities sent to the ruler are whole units; feed is shown as sheep-day ration portions. */
export function presentKingdomReport(report) {
  if (!report) return report;
  const community = report.community || {};
  const treasury = report.treasury || {};
  const market = report.market || {};
  const repairs = community.repairs;
  return {
    ...report,
    community: {
      ...community,
      sharedFood: whole(community.sharedFood),
      foodPerResident: whole(community.foodPerResident),
      dailyFoodNeed: whole(community.dailyFoodNeed),
      foodBufferTarget: whole(community.foodBufferTarget),
      foodBufferDays: whole(community.foodBufferDays),
      foodBufferTargetDays: whole(community.foodBufferTargetDays),
      feedStock: wholeRations(community.feedStock),
      feedTarget: wholeRations(community.feedTarget),
      feedReserveDays: community.feedReserveDays == null ? null : whole(community.feedReserveDays),
      woodStock: whole(community.woodStock),
      stoneStock: whole(community.stoneStock),
      goldStock: whole(community.goldStock),
      constructionMaterialNeed: whole(community.constructionMaterialNeed),
      foodInfrastructure: community.foodInfrastructure
        ? presentFoodInfrastructure(community.foodInfrastructure) : community.foodInfrastructure,
      repairs: repairs ? {
        ...repairs,
        repairCost: repairs.repairCost ? presentStock(repairs.repairCost) : repairs.repairCost
      } : repairs
    },
    treasury: presentStock(treasury),
    market: {
      ...market,
      foodPrice: whole(market.foodPrice),
      foodStock: whole(market.foodStock),
      foodSupply: whole(market.foodSupply),
      foodDemand: whole(market.foodDemand)
    }
  };
}
