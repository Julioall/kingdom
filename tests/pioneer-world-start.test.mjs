import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../src/simulation/engine.js';

function verifyPioneerSeed(world, population) {
  assert.equal(world.civilizationStart, 'pioneers');
  assert.equal(world.day, 0);
  assert.equal(world.people.length, population);
  assert.deepEqual(world.kingdoms, []);
  assert.deepEqual(world.communities, []);
  assert.deepEqual(world.structures, []);
  assert.ok(world.tiles.every(tile => tile.kingdomId == null));
  assert.deepEqual(world.market, {
    gold: 0, food: 0, feed: 0, wood: 0, stone: 0, sheep: 0, transactions: 0
  });
  for (const person of world.people) {
    assert.equal(person.alive, true);
    assert.equal(person.role, 'resident');
    assert.equal(person.kingdomId, null);
    assert.equal(person.communityId, null);
    assert.equal(person.homeId, null);
    assert.equal(person.militaryCenterId, null);
    assert.equal(person.personalWallet.stock.gold, 0);
    assert.equal(person.foodReserve, 0);
    assert.ok(person.ageDays >= 18 * 365);
    assert.equal(person.parents, null);
    assert.ok(world.tiles.some(tile => tile.terrain === 'land'
      && Math.round(person.x) === tile.x && Math.round(person.y) === tile.y));
  }
}

test('the optional pioneers mode starts one adult without a kingdom or minted resources', () => {
  verifyPioneerSeed(Sim.createWorld(42, {
    civilizationStart: 'pioneers', initialPopulation: 1
  }), 1);
});

test('two pioneers spawn deterministically across replay seeds', () => {
  for (const seed of [1, 42, 987, 2026]) {
    const options = { civilizationStart: 'pioneers' };
    const first = Sim.createWorld(seed, options);
    const second = Sim.createWorld(seed, options);
    verifyPioneerSeed(first, 2);
    assert.deepEqual(second.people.map(({ id, x, y, ageDays, sex, foodReserve }) =>
      ({ id, x, y, ageDays, sex, foodReserve })),
    first.people.map(({ id, x, y, ageDays, sex, foodReserve }) =>
      ({ id, x, y, ageDays, sex, foodReserve })));
  }
});

test('a pioneer world can advance a day without conjuring a kingdom or money', () => {
  const world = Sim.createWorld(42, { civilizationStart: 'pioneers' });
  Sim.stepDay(world, { includeSnapshot: false });
  assert.equal(world.day, 1);
  assert.deepEqual(world.kingdoms, []);
  assert.ok(world.people.every(person => person.role !== 'soldier' && person.role !== 'ruler'));
  assert.equal(world.market.gold, 0);
  assert.ok(world.people.every(person => person.personalWallet.stock.gold === 0));
});

test('the pioneers mode rejects military quotas and impossible population sizes', () => {
  assert.throws(() => Sim.createWorld(42,
    { civilizationStart: 'pioneers', initialMilitaryShare: .8 }), RangeError);
  assert.throws(() => Sim.createWorld(42,
    { civilizationStart: 'pioneers', initialPopulation: 0 }), RangeError);
  assert.throws(() => Sim.createWorld(42,
    { civilizationStart: 'not-a-mode' }), RangeError);
});

test('legacy kingdom creation remains the unchanged default', () => {
  const world = Sim.createWorld(42);
  assert.equal(world.civilizationStart, undefined);
  assert.equal(world.people.length, 96);
  assert.equal(world.kingdoms.length, 2);
  assert.ok(world.structures.length > 0);
});
