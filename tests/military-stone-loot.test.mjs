import test from 'node:test';
import assert from 'node:assert/strict';
import engine from '../src/simulation/engine.js';
import { collectLoot, nearestLoot } from '../src/simulation/economy/loot.js';
import { enlistSoldier } from '../src/simulation/kingdoms/service.js';

test('soldiers do not select or carry stone from generic loot while civilians still can', () => {
  const stonePile = { id: 1, x: 1, y: 0, resources: { stone: 4 }, available: true };
  const mixedPile = { id: 2, x: 1, y: 0, resources: { food: 2, stone: 4 }, available: true };
  const soldier = { id: 7, alive: true, role: 'soldier', x: 0, y: 0, foodReserve: 80 };
  const civilian = { id: 8, alive: true, role: 'civilian', x: 0, y: 0, foodReserve: 80 };
  const world = { loot: [stonePile, mixedPile] };

  assert.equal(nearestLoot(world, soldier), mixedPile, 'only the mixed pile has resources the soldier may take');
  collectLoot(world, soldier, mixedPile);
  assert.equal(soldier.carriedStone || 0, 0);
  assert.equal(mixedPile.resources.stone, 4, 'stone remains available to civilian workers');
  assert.equal(soldier.carriedFood, 2, 'the soldier may still recover edible supplies from a mixed pile');

  assert.equal(nearestLoot(world, civilian), stonePile);
  collectLoot(world, civilian, stonePile);
  assert.equal(civilian.carriedStone, 4);
  assert.equal(stonePile.resources.stone, 0);
});

test('a campaign soldier does not choose a stone-only loot pile during the daily action update', () => {
  for (const seed of [1, 42, 987]) {
    const world = engine.createWorld(seed);
    const soldier = world.people.find(person => person.alive && person.role === 'soldier');
    const enemy = world.kingdoms.find(kingdom => kingdom.id !== soldier.kingdomId);
    const campaignId = 99_701;
    Object.assign(soldier, {
      campaignId, energy: 100, health: 100, hydration: 100, foodReserve: 90,
      injury: 0, restingStructureId: null, militaryRestTargetId: null,
      carriedFood: 0, carriedMeat: 0, carriedWood: 0, carriedStone: 0, carriedGold: 0, carriedFeed: 0,
    });
    world.campaigns = [{
      id: campaignId,
      status: 'engaged',
      attacker: { kingdomId: soldier.kingdomId, troopIds: [soldier.id], aiOrder: { action: 'hold_position' }, supply: { stock: { food: 0, wood: 0, gold: 0 } } },
      defender: { kingdomId: enemy.id, troopIds: [], aiOrder: { action: 'hold_position' }, supply: { stock: { food: 0, wood: 0, gold: 0 } } },
    }];
    world.loot = [{ id: 99_702, x: soldier.x, y: soldier.y, resources: { stone: 4 }, available: true }];
    world.people = [soldier];
    const homeCommunity = world.communities.find(community => community.id === soldier.communityId);
    if (homeCommunity) homeCommunity.memberIds = [soldier.id];
    world.day = 25;

    engine.modules.SocietyExperiment.updatePeople(world);

    assert.notEqual(soldier.lastDecision?.action, 'collect_loot', `seed ${seed}: stone-only pile is not a military task`);
    assert.equal(soldier.carriedStone, 0, `seed ${seed}: soldier carries no civilian stone`);
    assert.equal(world.loot[0].resources.stone, 4, `seed ${seed}: stone remains in the pile`);
  }
});

test('promotion cancels civilian duties and reconciles stone already in transit exactly once', () => {
  const person = {
    id: 11, alive: true, role: 'civilian', communityId: 3, kingdomId: 5,
    carriedStone: 3.5, assignment: { action: 'gather', source: 'kingdom-strategy' },
    brain: { pending: { action: 'gather' } },
  };
  const community = { id: 3, stores: { stone: 2 } };
  const center = { id: 9, soldierIds: [] };
  const world = { day: 12, people: [person], communities: [community], kingdoms: [] };

  enlistSoldier(world, person, center, world.day);

  assert.equal(person.role, 'soldier');
  assert.equal(person.assignment, null);
  assert.equal(person.brain.pending, null);
  assert.equal(person.carriedStone, 0);
  assert.equal(community.stores.stone, 5.5);
  assert.equal(community.stores.stone + person.carriedStone, 5.5, 'promotion neither loses nor duplicates stone');
});
