import test from 'node:test';
import assert from 'node:assert/strict';
import { MILITARY_PAY, payMilitarySalaries } from '../src/simulation/kingdoms/service.js';

function fixture({ campaignId = null, treasuryGold = 100, firstDue = 0, arrears = 0 } = {}) {
  const soldier = {
    id: 7, alive: true, role: 'soldier', kingdomId: 1, campaignId,
    nextMilitaryPayDay: firstDue, militaryPayArrears: arrears,
    militaryWallet: { stock: { gold: 0 } }, x: 12, y: 18
  };
  const kingdom = { id: 1, treasury: { stock: { gold: treasuryGold } } };
  return { seed: 42, day: 0, people: [soldier], kingdoms: [kingdom], communities: [] };
}

function payOn(world, day) {
  world.day = day;
  payMilitarySalaries(world, day);
}

test('peaceful soldiers receive the existing salary at enlistment and every 30 days, never daily', () => {
  const world = fixture();
  const soldier = world.people[0];
  assert.equal(MILITARY_PAY.days, 30);
  payOn(world, 0);
  assert.equal(soldier.militaryWallet.stock.gold, MILITARY_PAY.gold);
  assert.equal(soldier.nextMilitaryPayDay, 30);
  for (const day of [1, 10, 29]) payOn(world, day);
  assert.equal(soldier.militaryWallet.stock.gold, 15);
  for (const day of [30, 60, 90]) payOn(world, day);
  assert.equal(soldier.militaryWallet.stock.gold, 60);
  assert.equal(world.kingdoms[0].treasury.stock.gold, 40);
  assert.equal(soldier.totalMilitaryPay, 60);
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
  assert.equal(world.people[0].militaryWallet.stock.gold, 45);
  assert.equal(world.kingdoms[0].treasury.stock.gold, 55);
});

test('unpaid peacetime wages remain due and later recovery preserves social evidence', () => {
  const world = fixture({ treasuryGold: 0 });
  const soldier = world.people[0];
  payOn(world, 0);
  assert.equal(soldier.militaryPayArrears, 15);
  assert.equal(world.socialEvidence.facts.filter(f => f.type === 'military_pay_delayed').length, 1);
  payOn(world, 30);
  assert.equal(soldier.militaryPayArrears, 30);
  assert.equal(soldier.nextMilitaryPayDay, 60);
  world.kingdoms[0].treasury.stock.gold = 45; // External funding in fixture; salary itself never mints funds.
  payOn(world, 60);
  assert.equal(soldier.militaryPayArrears, 0);
  assert.equal(soldier.militaryWallet.stock.gold, 45);
  assert.equal(world.kingdoms[0].treasury.stock.gold, 0);
  assert.ok(world.socialEvidence.facts.some(f => f.type === 'military_pay_recovered'));
});

test('overdue pay periods are counted exactly once after skipped days', () => {
  const world = fixture({ firstDue: 10 });
  payOn(world, 75);
  assert.equal(world.people[0].militaryWallet.stock.gold, 45);
  assert.equal(world.people[0].nextMilitaryPayDay, 100);
  payOn(world, 75);
  assert.equal(world.people[0].militaryWallet.stock.gold, 45);
  assert.equal(world.kingdoms[0].treasury.stock.gold, 55);
});

test('military pay schedule produces identical deterministic account and event results', () => {
  const replay = () => {
    const world = fixture({ treasuryGold: 0 });
    for (const day of [0, 1, 30, 60, 60, 90]) {
      if (day === 60) world.kingdoms[0].treasury.stock.gold = 45;
      payOn(world, day);
    }
    return JSON.stringify({
      soldier: world.people[0], treasury: world.kingdoms[0].treasury,
      facts: world.socialEvidence.facts
    });
  };
  assert.equal(replay(), replay());
});
