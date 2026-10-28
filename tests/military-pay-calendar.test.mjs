import test from 'node:test';
import assert from 'node:assert/strict';
import { MILITARY_PAY, payMilitarySalaries } from '../src/simulation/kingdoms/service.js';

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
      if (day === 60 && world.kingdoms[0].treasury.stock.gold === 0 && world.people[0].militaryPayArrears > 0) world.kingdoms[0].treasury.stock.gold = 3;
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
