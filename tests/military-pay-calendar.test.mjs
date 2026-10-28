import test from 'node:test';
import assert from 'node:assert/strict';
import { FOOD_DAYS_PER_UNIT } from '../src/config/ecosystem.js';
import { MILITARY_PAY, buyMilitaryMeal, enlistSoldier, payMilitarySalaries } from '../src/simulation/kingdoms/service.js';

function fixture({ campaignId = null, treasuryGold = 100, firstDue = 0, arrears = 0 } = {}) {
  const soldier = {
    id: 7, alive: true, role: 'soldier', kingdomId: 1, campaignId,
    nextMilitaryPayDay: firstDue, militaryPayArrears: arrears, militaryPayArrearsCopper: 0,
    militaryWallet: { stock: { gold: 0 } }, x: 12, y: 18
  };
  const kingdom = { id: 1, treasury: { stock: { gold: treasuryGold } } };
  return { seed: 42, day: 0, people: [soldier], kingdoms: [kingdom], communities: [] };
}

function payOn(world, day) {
  world.day = day;
  payMilitarySalaries(world, day);
}

test('peaceful soldiers receive the rebalanced salary on due dates every 30 days, never daily', () => {
  const world = fixture();
  const soldier = world.people[0];
  assert.equal(MILITARY_PAY.days, 30);
  payOn(world, 0);
  assert.equal(soldier.militaryWallet.stock.gold, MILITARY_PAY.gold);
  assert.equal(soldier.nextMilitaryPayDay, 30);
  for (const day of [1, 10, 29]) payOn(world, day);
  assert.equal(soldier.militaryWallet.stock.gold, 1);
  for (const day of [30, 60, 90]) payOn(world, day);
  assert.equal(soldier.militaryWallet.stock.gold, 4);
  assert.equal(world.kingdoms[0].treasury.stock.gold, 96);
  assert.equal(soldier.totalMilitaryPay, 4);
  assert.equal(soldier.nextMilitaryPayDay, 120);
  assert.equal(soldier.militaryPayArrears, 0);
});

test('campaign to peace and back does not defer or duplicate salary', () => {
  const world = fixture({ campaignId: 9 });
  payOn(world, 0);
  world.people[0].campaignId = null;
  payOn(world, 20);
  assert.equal(world.people[0].nextMilitaryPayDay, 30);
  payOn(world, 30);
  world.people[0].campaignId = 9;
  payOn(world, 60);
  payOn(world, 60);
  assert.equal(world.people[0].militaryWallet.stock.gold, 3);
  assert.equal(world.kingdoms[0].treasury.stock.gold, 97);
});

test('unpaid peacetime wages remain due and later recovery preserves social evidence', () => {
  const world = fixture({ treasuryGold: 0 });
  const soldier = world.people[0];
  payOn(world, 0);
  assert.equal(soldier.militaryPayArrearsCopper, 100);
  assert.equal(world.socialEvidence.facts.filter(f => f.type === 'military_pay_delayed').length, 1);
  payOn(world, 30);
  assert.equal(soldier.militaryPayArrearsCopper, 200);
  assert.equal(soldier.nextMilitaryPayDay, 60);
  world.kingdoms[0].treasury.stock.gold = 3; // External funding in fixture; salary itself never mints funds.
  payOn(world, 60);
  assert.equal(soldier.militaryPayArrears, 0);
  assert.equal(soldier.militaryPayArrearsCopper, 0);
  assert.equal(soldier.militaryWallet.stock.gold, 3);
  assert.equal(world.kingdoms[0].treasury.stock.gold, 0);
  assert.ok(world.socialEvidence.facts.some(f => f.type === 'military_pay_recovered'));
});

test('overdue pay periods are counted exactly once after skipped days', () => {
  const world = fixture({ firstDue: 10 });
  payOn(world, 75);
  assert.equal(world.people[0].militaryWallet.stock.gold, 3);
  assert.equal(world.people[0].nextMilitaryPayDay, 100);
  payOn(world, 75);
  assert.equal(world.people[0].militaryWallet.stock.gold, 3);
  assert.equal(world.kingdoms[0].treasury.stock.gold, 97);
});

test('military pay schedule produces identical deterministic account and event results', () => {
  const replay = () => {
    const world = fixture({ treasuryGold: 0 });
    for (const day of [0, 1, 30, 60, 60, 90]) {
      if (day === 60 && world.kingdoms[0].treasury.stock.gold === 0 && world.people[0].militaryPayArrearsCopper > 0) world.kingdoms[0].treasury.stock.gold = 3;
      payOn(world, day);
    }
    return JSON.stringify({
      soldier: world.people[0], treasury: world.kingdoms[0].treasury,
      facts: world.socialEvidence.facts
    });
  };
  assert.equal(replay(), replay());
});

test('arrears from former 15-gold contracts are not repriced by the new wage', () => {
  const world = fixture({ treasuryGold: 0, firstDue: 30, arrears: 15 });
  const soldier = world.people[0];
  payOn(world, 30);
  assert.equal(soldier.militaryPayArrears, 15, 'the historical 15-gold claim remains');
  assert.equal(soldier.militaryPayArrearsCopper, 100, 'new monthly claim is separate');
  world.kingdoms[0].treasury.stock.gold = 16;
  payOn(world, 31);
  assert.equal(soldier.militaryPayArrears, 0);
  assert.equal(soldier.militaryPayArrearsCopper, 0);
  assert.equal(soldier.militaryWallet.stock.gold, 16);
  assert.equal(world.kingdoms[0].treasury.stock.gold, 0);
  assert.equal(soldier.totalMilitaryPayCopper, 1600);
});

test('fractional legacy obligations are preserved, never rounded away', () => {
  const world = fixture({ firstDue: 30, arrears: .375 });
  const before = world.kingdoms[0].treasury.stock.gold;
  payOn(world, 30);
  assert.equal(world.people[0].militaryPayArrears, .375);
  assert.equal(world.people[0].militaryPayArrearsCopper, 100);
  assert.equal(world.people[0].militaryWallet.stock.gold, 0);
  assert.equal(world.kingdoms[0].treasury.stock.gold, before);
});

test('wages settle with existing silver and copper without creating gold', () => {
  const world = fixture({ treasuryGold: 0 });
  const treasury = world.kingdoms[0].treasury.stock;
  treasury.silver = 9;
  treasury.copper = 10;
  const before = treasury.silver * 10 + treasury.copper;
  payOn(world, 0);
  const wallet = world.people[0].militaryWallet.stock;
  assert.equal(wallet.gold, 0);
  assert.equal(wallet.silver * 10 + wallet.copper, 100);
  assert.equal(treasury.silver * 10 + treasury.copper, 0);
  assert.equal(wallet.silver * 10 + wallet.copper + treasury.silver * 10 + treasury.copper, before);
});

test('a treasury with value but no payable denomination does not mint change', () => {
  const world = fixture({ treasuryGold: 2 });
  // The soldier has no existing coins to return as change for 100 copper.
  world.people[0].militaryPayArrearsCopper = 50;
  world.people[0].nextMilitaryPayDay = 30;
  payOn(world, 0);
  assert.equal(world.people[0].militaryPayArrearsCopper, 50);
  assert.equal(world.people[0].militaryWallet.stock.gold, 0);
  assert.equal(world.kingdoms[0].treasury.stock.gold, 2);
});

test('a soldier buys food with copper coins and conserves every account', () => {
  const world = fixture({ treasuryGold: 0, firstDue: 30 });
  const soldier = world.people[0];
  soldier.foodReserve = 0;
  soldier.militaryWallet.stock = { gold: 0, silver: 0, copper: 5, coinMode: true };
  world.kingdoms[0].communityId = 4;
  world.kingdoms[0].market = { ownerType: 'kingdom-market', ownerId: 1,
    stock: { gold: 0, silver: 0, copper: 0, food: 2 }, prices: { food: .01 }, transactions: 0 };
  const before = soldier.militaryWallet.stock.copper + world.kingdoms[0].market.stock.copper;
  assert.equal(buyMilitaryMeal(world, soldier, 1), 1);
  assert.equal(soldier.foodReserve, 1);
  assert.equal(soldier.militaryWallet.stock.copper, 4);
  assert.equal(world.kingdoms[0].market.stock.copper, 1);
  assert.equal(world.kingdoms[0].market.stock.food, 1);
  assert.equal(world.kingdoms[0].market.transactions, 1);
  assert.equal(soldier.militaryWallet.stock.copper + world.kingdoms[0].market.stock.copper, before);
  assert.equal(world.kingdoms[0].tradeLedger.count, 1);
});

test('a soldier cannot buy food with a gold coin if the market lacks real change', () => {
  const world = fixture({ treasuryGold: 0, firstDue: 30 });
  const soldier = world.people[0];
  soldier.foodReserve = 0;
  soldier.militaryWallet.stock = { gold: 1, silver: 0, copper: 0, coinMode: true };
  world.kingdoms[0].market = { ownerType: 'kingdom-market', ownerId: 1,
    stock: { gold: 0, silver: 0, copper: 0, food: 2 }, prices: { food: .01 }, transactions: 0 };
  const before = structuredClone({ wallet: soldier.militaryWallet.stock,
    market: world.kingdoms[0].market.stock });
  assert.equal(buyMilitaryMeal(world, soldier, 1), 0);
  assert.deepEqual({ wallet: soldier.militaryWallet.stock,
    market: world.kingdoms[0].market.stock }, before);
  assert.equal(world.kingdoms[0].market.transactions, 0);
});

test('re-enlistment does not erase legacy or copper-denominated back pay', () => {
  const world = fixture({ treasuryGold: 0, firstDue: 30, arrears: 15 });
  const soldier = world.people[0];
  soldier.role = 'pawn';
  soldier.brain = { pending: null };
  soldier.militaryPayArrearsCopper = 50;
  const center = { id: 8, soldierIds: [] };
  enlistSoldier(world, soldier, center, 10);
  assert.equal(soldier.role, 'soldier');
  assert.equal(soldier.nextMilitaryPayDay, 40);
  assert.equal(soldier.militaryPayArrears, 15);
  assert.equal(soldier.militaryPayArrearsCopper, 50);
  assert.equal(world.kingdoms[0].treasury.stock.gold, 0);
});

test('paid soldier purchases a military meal in physical coins without fractional gold', () => {
  const world = fixture({ treasuryGold: 0 });
  const soldier = world.people[0];
  soldier.foodReserve = 0;
  soldier.militaryWallet.stock = { gold: 0, silver: 2, copper: 0, coinMode: true };
  const kingdom = world.kingdoms[0];
  kingdom.market = { ownerType: 'kingdom-market', ownerId: 1,
    stock: { gold: 0, silver: 0, copper: 0, food: 2 }, prices: { food: .1 } };
  const nutrition = buyMilitaryMeal(world, soldier, FOOD_DAYS_PER_UNIT);
  assert.equal(nutrition, FOOD_DAYS_PER_UNIT);
  assert.equal(soldier.militaryWallet.stock.silver, 1);
  assert.equal(kingdom.market.stock.silver, 1);
  assert.equal(kingdom.market.stock.food, 1);
  assert.equal(world.trades, 1);
  assert.equal(kingdom.market.tradeLedger.history[0].assetsCreated.length, 0);
});

test('military meal rejects purchases when real change is unavailable', () => {
  const world = fixture({ treasuryGold: 0 });
  const soldier = world.people[0];
  soldier.foodReserve = 0;
  soldier.militaryWallet.stock = { gold: 1, silver: 0, copper: 0, coinMode: true };
  world.kingdoms[0].market = { ownerType: 'kingdom-market', ownerId: 1,
    stock: { gold: 0, silver: 0, copper: 0, food: 1 }, prices: { food: .37 } };
  assert.equal(buyMilitaryMeal(world, soldier, FOOD_DAYS_PER_UNIT), 0);
  assert.equal(soldier.militaryWallet.stock.gold, 1);
  assert.equal(world.kingdoms[0].market.stock.food, 1);
  assert.equal(world.kingdoms[0].market.stock.gold, 0);
  assert.equal(world.trades ?? 0, 0);
});

test('paying old arrears cannot hide a newly missed wage in social evidence', () => {
  const world = fixture({ treasuryGold: 15, firstDue: 30, arrears: 15 });
  payOn(world, 30);
  assert.equal(world.people[0].militaryPayArrears, 0);
  assert.equal(world.people[0].militaryPayArrearsCopper, 100);
  const delayed = world.socialEvidence.facts.filter(fact => fact.type === 'military_pay_delayed');
  assert.equal(delayed.length, 1);
  assert.equal(delayed[0].outcome.amount, 1);
  assert.equal(delayed[0].outcome.dueDay, 30);
  assert.equal(world.kingdoms[0].treasury.stock.gold, 0);
});
