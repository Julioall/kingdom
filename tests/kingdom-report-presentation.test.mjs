import test from 'node:test';
import assert from 'node:assert/strict';
import { presentKingdomReport } from '../src/ai/kingdom-report-presentation.js';

test('ruler sees rounded economic quantities and whole sheep-day ration portions', () => {
  const report = {
    community: {
      sharedFood: 12.4, foodPerResident: .248, dailyFoodNeed: 50.2,
      foodBufferTarget: 9000.4, foodBufferDays: .7, foodBufferTargetDays: 180,
      feedStock: 4.2, feedTarget: 21, feedReserveDays: 8.75,
      woodStock: 6.4, stoneStock: 8.5, goldStock: 10.1, constructionMaterialNeed: 3.2,
      foodInfrastructure: {
        standingCropBiomass: 300.8, harvestableCropPotential: 200.4, harvestedCropToDate: 12.6,
        seedStock: 2.7, replantSeedMass: 1.1, feedStock: 4.2, feedTarget: 21,
        fields: [{ seedMass: 1.2, yieldTarget: 20.4, growthGenerated: 5.5, harvestedThisCycle: 7.6,
          standingBiomass: 8.4, seedReserveReturned: 1.3, foodDelivered: 4.9 }]
      },
      repairs: { repairCost: { wood: 2.8, stone: 1.2 } }
    },
    treasury: { food: 10.5, feed: 1.2, wood: 2.4, stone: 3.8, gold: 4.2 },
    market: { foodPrice: 1.5, foodStock: 12.8, foodSupply: 2.4, foodDemand: 3.8 }
  };

  const presented = presentKingdomReport(report);

  assert.equal(presented.community.sharedFood, 12);
  assert.equal(presented.community.foodPerResident, 'menos de 1');
  assert.equal(presented.community.foodBufferDays, 'menos de 1');
  assert.equal(presented.community.foodBufferTargetDays, 180);
  assert.equal(presented.community.feedStock, 35);
  assert.equal(presented.community.feedTarget, 175);
  assert.equal(presented.community.feedReserveDays, 9);
  assert.equal(presented.community.foodInfrastructure.feedStock, 35);
  assert.equal(presented.community.foodInfrastructure.fields[0].foodDelivered, 5);
  assert.equal(presented.community.repairs.repairCost.wood, 3);
  assert.equal(presented.treasury.feed, 10);
  assert.equal(presented.market.foodPrice, 2);
  assert.equal(presented.market.foodDemand, 4);
  assert.equal(report.community.sharedFood, 12.4, 'projection keeps the precise simulation report untouched');
  assert.equal(report.community.feedStock, 4.2);
});
