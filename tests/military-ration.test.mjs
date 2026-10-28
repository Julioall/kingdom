import test from 'node:test';
import assert from 'node:assert/strict';
import { DAILY_FOOD_NEED, FOOD_DAYS_PER_UNIT } from '../src/config/ecosystem.js';
import { drawGarrisonRation, militaryDutyCenterFor } from '../src/simulation/kingdoms/service.js';
import { startFoodInventoryAudit } from '../src/simulation/economy/food-audit-ledger.js';

test('garrison ration withdraws only the food present in the treasury and kingdom community', () => {
  const person = { id: 11, role: 'soldier', kingdomId: 1, campaignId: null, x: 0, y: 0, foodReserve: 0 };
  const center = { id: 4, type: 'centro_militar', kingdomId: 1, complete: true, x: 0, y: 0 };
  const kingdom = { id: 1, communityId: 2, treasury: { stock: { food: 1 } } };
  const community = { id: 2, kingdomId: 1, stores: { food: 1, meat: 0 } };
  const world = { people: [person], structures: [center], kingdoms: [kingdom], communities: [community] };
  const audit = startFoodInventoryAudit(world);
  audit.beginDay(1);

  const received = drawGarrisonRation(world, person, center, 5);
  audit.endDay();
  const report = audit.finish();

  assert.ok(Math.abs(received - 2 * FOOD_DAYS_PER_UNIT) < 1e-9);
  assert.ok(Math.abs(person.foodReserve - received) < 1e-9);
  assert.equal(kingdom.treasury.stock.food, 0);
  assert.equal(community.stores.food, 0);
  const rations = report.transactions.filter(operation => operation.category === 'military-garrison-ration'
    && operation.kind !== 'spend' && operation.parentId == null);
  const personalReserve = report.accounts.find(account => account.ownerType === 'person'
    && account.ownerId === person.id && account.property === 'foodReserve');
  assert.equal(rations.length, 2);
  assert.ok(rations.every(operation => operation.destination === personalReserve.index));
  assert.ok(rations.some(operation => typeof operation.source === 'number'));
  assert.ok(rations.some(operation => operation.source?.type === 'community-food-network'));
  assert.equal(report.coverage.balanced, true);
});

test('garrison can only use community food above two days of civilian demand', () => {
  const soldier = { id: 11, alive: true, ageDays: 30 * 365, role: 'soldier', kingdomId: 1, campaignId: null, x: 0, y: 0, foodReserve: 0 };
  const adult = { id: 12, alive: true, ageDays: 30 * 365, role: 'pawn' };
  const child = { id: 13, alive: true, ageDays: 5 * 365, role: 'pawn' };
  const center = { id: 4, type: 'centro_militar', kingdomId: 1, complete: true, x: 0, y: 0 };
  const kingdom = { id: 1, communityId: 2, memberIds: [11, 12, 13], treasury: { stock: { food: 0 } } };
  const floor = (2 * DAILY_FOOD_NEED) * 2 / FOOD_DAYS_PER_UNIT;
  const community = { id: 2, kingdomId: 1, stores: { food: floor + 1, meat: 0 } };
  const world = { people: [soldier, adult, child], structures: [center], kingdoms: [kingdom], communities: [community] };
  const received = drawGarrisonRation(world, soldier, center, 10);
  assert.ok(Math.abs(received - FOOD_DAYS_PER_UNIT) < 1e-9);
  assert.ok(Math.abs(community.stores.food - floor) < 1e-9);
  assert.equal(drawGarrisonRation(world, soldier, center, 10), 0);
});

test('garrison preserves the civilian floor when community food includes meat', () => {
  const soldier = { id: 1, alive: true, ageDays: 10000, role: 'soldier', kingdomId: 1, campaignId: null, x: 0, y: 0, foodReserve: 0 };
  const civilian = { id: 2, alive: true, ageDays: 10000, role: 'pawn' };
  const center = { id: 4, type: 'centro_militar', kingdomId: 1, complete: true, x: 0, y: 0 };
  const kingdom = { id: 1, communityId: 2, memberIds: [1, 2], treasury: { stock: { food: 0 } } };
  const floor = DAILY_FOOD_NEED * 2 / FOOD_DAYS_PER_UNIT;
  const community = { id: 2, kingdomId: 1, stores: { food: floor, meat: 0.1 } };
  const world = { people: [soldier, civilian], structures: [center], kingdoms: [kingdom], communities: [community] };
  const received = drawGarrisonRation(world, soldier, center, 10);
  assert.ok(Math.abs(received - FOOD_DAYS_PER_UNIT) < 1e-9);
  assert.ok(Math.abs(community.stores.food - floor) < 1e-9);
  assert.ok(Math.abs(community.stores.meat) < 1e-9);
});


test('destroyed military centers cannot supply rations; a surviving center can take over without creating food', () => {
  const person = { id: 11, alive: true, ageDays: 30 * 365, role: 'soldier', kingdomId: 1,
    campaignId: null, militaryDutyCenterId: 4, x: 0, y: 0, foodReserve: 0 };
  const destroyed = { id: 4, type: 'centro_militar', kingdomId: 1, complete: true,
    destroyedDay: 10, integrity: 0, health: 0, x: 0, y: 0 };
  const alternate = { id: 5, type: 'centro_militar', kingdomId: 1, complete: true,
    destroyedDay: null, integrity: 1, health: 1, x: 0, y: 0 };
  const kingdom = { id: 1, communityId: 2, militaryCenterIds: [4, 5],
    memberIds: [11], treasury: { stock: { food: 2 } } };
  const community = { id: 2, kingdomId: 1, stores: { food: 0, meat: 0 } };
  const world = { people: [person], structures: [destroyed, alternate],
    kingdoms: [kingdom], communities: [community] };

  assert.equal(militaryDutyCenterFor(world, person)?.id, alternate.id,
    'a ruined assigned center must not hide a surviving operational center');
  assert.equal(drawGarrisonRation(world, person, destroyed, FOOD_DAYS_PER_UNIT), 0,
    'even an explicitly passed ruined center cannot authorize a ration');
  assert.equal(kingdom.treasury.stock.food, 2);
  assert.equal(person.foodReserve, 0);

  assert.equal(drawGarrisonRation(world, person, undefined, FOOD_DAYS_PER_UNIT), FOOD_DAYS_PER_UNIT);
  assert.equal(kingdom.treasury.stock.food, 1);
  assert.equal(person.foodReserve, FOOD_DAYS_PER_UNIT);

  person.foodReserve = 0;
  alternate.health = 0;
  assert.equal(militaryDutyCenterFor(world, person), null);
  assert.equal(drawGarrisonRation(world, person, alternate, FOOD_DAYS_PER_UNIT), 0);
  assert.equal(drawGarrisonRation(world, person, undefined, FOOD_DAYS_PER_UNIT), 0);
  assert.equal(kingdom.treasury.stock.food, 1, 'no food is debited while every center is inoperative');
  assert.equal(person.foodReserve, 0);

  alternate.health = 1;
  assert.equal(militaryDutyCenterFor(world, person)?.id, alternate.id,
    'restoring the alternate resumes service without recreating its stock');
});


test('garrison rejects fabricated and stale centers even when their fields look operational', () => {
  const person = { id: 11, alive: true, ageDays: 30 * 365, role: 'soldier',
    kingdomId: 1, campaignId: null, x: 0, y: 0, foodReserve: 0 };
  const registered = { id: 4, type: 'centro_militar', kingdomId: 1,
    complete: true, destroyedDay: null, integrity: 1, health: 1, x: 0, y: 0 };
  const kingdom = { id: 1, communityId: 2, militaryCenterIds: [4],
    memberIds: [11], treasury: { stock: { food: 2 } } };
  const community = { id: 2, kingdomId: 1, stores: { food: 0, meat: 0 } };
  const world = { people: [person], structures: [registered],
    kingdoms: [kingdom], communities: [community] };
  const snapshot = { food: kingdom.treasury.stock.food, reserve: person.foodReserve };

  const phantom = { ...registered, id: 99 };
  const stale = { ...registered };
  assert.equal(drawGarrisonRation(world, person, phantom, FOOD_DAYS_PER_UNIT), 0,
    'a phantom center cannot authorize a treasury debit');
  assert.equal(drawGarrisonRation(world, person, stale, FOOD_DAYS_PER_UNIT), 0,
    'an outdated copy of a real center cannot authorize a treasury debit');
  assert.equal(kingdom.treasury.stock.food, snapshot.food);
  assert.equal(person.foodReserve, snapshot.reserve);

  assert.equal(drawGarrisonRation(world, person, registered, FOOD_DAYS_PER_UNIT), FOOD_DAYS_PER_UNIT,
    'the registered operational center still serves the ration normally');
  assert.equal(kingdom.treasury.stock.food, snapshot.food - 1);
  assert.equal(person.foodReserve, FOOD_DAYS_PER_UNIT);

  person.foodReserve = 0;
  world.structures = [{ ...registered, destroyedDay: 11, health: 0 }];
  assert.equal(drawGarrisonRation(world, person, registered, FOOD_DAYS_PER_UNIT), 0,
    'a removed center cannot supply rations through a stale reference');
  assert.equal(kingdom.treasury.stock.food, snapshot.food - 1);
  assert.equal(person.foodReserve, 0);
});
