import test from 'node:test';
import assert from 'node:assert/strict';
import engine from '../src/simulation/engine.js';
import { reproducePeople } from '../src/simulation/individuals/lifecycle.js';
import { getSocialLink } from '../src/simulation/society/communities.js';
import { planKingdomHome } from '../src/simulation/kingdoms/initialization.js';
import { procureKingdomRepairMaterials } from '../src/simulation/kingdoms/market-procurement.js';
import { advanceKingdomProjects } from '../src/simulation/kingdoms/projects.js';
import { HUMAN_ADOLESCENT_AGE_DAYS, HUMAN_ADULT_AGE_DAYS, HUMAN_MAX_AGE_DAYS } from '../src/simulation/individuals/human-age.js';

test('age, not royal quotas, ends an individual life at 900 days', () => {
  const w = engine.createWorld(42);
  const person = w.people.find(p => p.role === 'resident');
  Object.assign(person, { ageDays: HUMAN_MAX_AGE_DAYS - 1, health: 100, hydration: 100, foodReserve: 80 });
  engine.stepDay(w, { includeSnapshot: false });
  assert.equal(person.deathCause, 'age');
  assert.equal(person.ageDays, HUMAN_MAX_AGE_DAYS);
  assert.equal(person.alive, false);
});

test('actual family resources, a shared home and child independence determine births', () => {
  const w = engine.createWorld(42);
  w.day = 29;
  for (const p of w.people) p.birthCooldown = 999;
  const k = w.kingdoms[0];
  const residents = w.people.filter(p => p.alive && p.kingdomId === k.id && p.role === 'resident');
  const father = residents.find(p => p.sex === 'M');
  const mother = residents.find(p => p.sex === 'F');
  assert.ok(father && mother);
  Object.assign(father, { ageDays: HUMAN_ADULT_AGE_DAYS + 35, foodReserve: 80, energy: 90, hydration: 90, health: 95, birthCooldown: 0 });
  Object.assign(mother, { ageDays: HUMAN_ADULT_AGE_DAYS + 35, foodReserve: 80, energy: 90, hydration: 90, health: 95, birthCooldown: 0 });
  father.x = mother.x = k.x;
  father.y = mother.y = k.y;
  getSocialLink(w, father, mother).trust = .9;
  const house = w.structures.find(s => s.id === k.homeIds[0]);
  house.complete = true;
  house.capacity = (house.residentIds || []).length + 5;
  mother.foodReserve = 40;
  reproducePeople(w);
  assert.equal(w.births, 0, 'an underfed parent chooses not to have a baby');

  mother.foodReserve = 90;
  reproducePeople(w);
  assert.equal(w.births, 1);
  const baby = w.people.find(p => p.parents?.includes(mother.id) && p.parents?.includes(father.id));
  assert.ok(baby && baby.homeId === house.id);
  assert.ok(house.residentIds.includes(mother.id) && house.residentIds.includes(father.id));
  assert.equal(baby.foodReserve, 12);
  assert.ok(!k.demographyPolicy, 'the king does not issue population targets');

  w.day = 59;
  father.birthCooldown = mother.birthCooldown = 0;
  reproducePeople(w);
  assert.equal(w.births, 1, 'the child remains dependent on the parents');
  baby.ageDays = HUMAN_ADOLESCENT_AGE_DAYS;
  mother.foodReserve = father.foodReserve = 90;
  reproducePeople(w);
  assert.equal(w.births, 2, 'parents can consider another child once the first becomes independent');
});

test('resident uses personal wallet to purchase physical wood and stone for a home', () => {
  const w = engine.createWorld(42);
  const k = w.kingdoms[0];
  const owner = w.people.find(p => p.role === 'resident' && p.kingdomId === k.id && p.ageDays >= HUMAN_ADULT_AGE_DAYS);
  assert.ok(owner);
  owner.foodReserve = 90; owner.health = 100; owner.hydration = 90;
  owner.personalWallet = { stock: { gold: 100, silver: 0, copper: 0 } };
  const before = { wallet: owner.personalWallet.stock.gold, marketGold: k.market.stock.gold,
    marketWood: k.market.stock.wood, marketStone: k.market.stock.stone,
    treasuryWood: k.treasury.stock.wood, treasuryStone: k.treasury.stock.stone };
  assert.equal(planKingdomHome(w, k, { ownerId: owner.id }), true);
  const home = w.structures.find(s => s.privateOwnerId === owner.id);
  assert.ok(home && !home.complete && home.kingdomProject && home.privateConstruction);
  assert.equal(k.market.stock.wood, before.marketWood - 8);
  assert.equal(k.market.stock.stone, before.marketStone - 2);
  assert.equal(k.treasury.stock.wood, before.treasuryWood, 'raw materials were paid for by the pawn');
  assert.equal(k.treasury.stock.stone, before.treasuryStone);
  assert.equal(owner.personalWallet.stock.gold + k.market.stock.gold,
    before.wallet + before.marketGold, 'payment only moves existing money');
  assert.equal(planKingdomHome(w, k, { ownerId: owner.id }), false, 'one funded property per person');
  owner.x = home.x + 1; owner.y = home.y;
  for (let day = 1; day <= 10; day++) {
    w.day = day - 1; owner.foodReserve = 90; owner.energy = 100;
    advanceKingdomProjects(w, day);
  }
  assert.equal(home.complete, true);
  assert.equal(owner.homeId, home.id);
  assert.deepEqual(home.residentIds, [owner.id]);
});

test('king buys market wood and stone for damaged buildings without creating materials', () => {
  const w = engine.createWorld(42);
  const k = w.kingdoms[0];
  const target = w.structures.find(s => s.kingdomId === k.id && s.type === 'castelo');
  target.integrity = .5;
  k.treasury.stock.wood = 0; k.treasury.stock.stone = 0;
  k.treasury.stock.gold = 100;
  const before = { marketWood: k.market.stock.wood, marketStone: k.market.stock.stone,
    royalGold: k.treasury.stock.gold, marketGold: k.market.stock.gold };
  const receipts = procureKingdomRepairMaterials(w, k);
  assert.equal(receipts.length, 2);
  assert.equal(k.treasury.stock.wood, 3);
  assert.equal(k.treasury.stock.stone, 2);
  assert.equal(k.market.stock.wood, before.marketWood - 3);
  assert.equal(k.market.stock.stone, before.marketStone - 2);
  assert.equal(k.treasury.stock.gold + k.market.stock.gold,
    before.royalGold + before.marketGold);
});
