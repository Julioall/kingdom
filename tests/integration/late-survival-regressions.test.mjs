import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../../src/simulation/engine.js';
import { DAILY_FOOD_NEED, FOOD_RESERVE_PER_UNIT, MEAT_NUTRITIONAL_VALUE, PLANTS } from '../../src/config/ecosystem.js';
import { cargoDeliveryPlan, collectFoodForCommunity, nearestKnownStorage, updatePeople } from '../../src/simulation/individuals/actions.js';
import { consumeEdibleCargo } from '../../src/simulation/economy/inventories.js';
import { activeLeadershipRank } from '../../src/simulation/kingdoms/military-identity.js';
import { updateMilitaryCommand } from '../../src/simulation/kingdoms/military.js';

function fixture() {
  const world = Sim.createWorld(42);
  const person = world.people.find(p => p.role === 'resident');
  const kingdom = world.kingdoms.find(k => k.id === person.kingdomId);
  const community = world.communities.find(c => c.id === person.communityId);
  world.day = 2000;
  for (const tile of world.tiles) {
    tile.terrain = 'land'; tile.elevationLevel = 0; tile.slope = 0;
    tile.kingdomId = null; tile.plants.fill(0); tile.plantResourceMask = 0;
  }
  world.people = [person]; world.animals = []; world.structures = [];
  world.communities = []; world.kingdoms = []; world.loot = []; world.logs = [];
  Object.assign(person, { x: 20, y: 20, ageDays: 25 * 365, health: 44, injury: 0, energy: 80,
    hydration: 80, foodReserve: 80, role: 'resident', kingdomId: null, communityId: null, homeId: null,
    headingX: 0, headingY: 0, assignment: null, carriedFood: 0, carriedFruit: 0, carriedMeat: 0,
    carriedFeed: 0, carriedWood: 2, carriedStone: 0, carriedGold: 0, carriedMaterial: 0, leadingSheepId: null });
  person.sensoryMemory = { actors: {}, water: [], logs: {}, storages: {} };
  return { world, person, kingdom, community };
}
const at = (w, x, y) => w.tiles[y * w.width + x];

test('an independent carrier at day 2000 drinks before delivery and keeps the cargo', () => {
  const { world, person } = fixture();
  person.energy = 24; person.hydration = 31;
  at(world, 21, 20).terrain = 'water';
  updatePeople(world);
  assert.equal(person.brain.lastAction, 'drink');
  assert.ok(person.hydration > 50);
  assert.equal(person.carriedWood, 2);
  assert.doesNotMatch(person.state, /aguardando abrigo/);
});

test('outdoor recovery continues beyond the energy threshold instead of cycling near 24 percent', () => {
  const { world, person } = fixture();
  person.energy = 24;
  for (let day = 0; day < 13; day++) { updatePeople(world); world.day++; }
  assert.ok(person.energy >= 72, String(person.energy));
  assert.equal(person.restingOutdoors, false);
  assert.equal(person.carriedWood, 2);
  updatePeople(world);
  assert.notEqual(person.brain.lastAction, 'rest');
});

test('a hungry carrier eats a visible resource instead of waiting for a nonexistent depot', () => {
  const { world, person } = fixture();
  person.foodReserve = 18;
  at(world, 20, 20).plants[PLANTS.findIndex(p => p.id === 'berry')] = 80;
  updatePeople(world);
  assert.equal(person.brain.lastAction, 'forage');
  assert.ok(person.foodReserve > 18 - DAILY_FOOD_NEED);
  assert.equal(person.carriedWood, 2);
});

test('an independent carrier with safe needs explores instead of forcing an impossible delivery', () => {
  const { world, person } = fixture();
  updatePeople(world);
  assert.equal(person.brain.lastAction, 'migrate');
  assert.doesNotMatch(person.state, /aguardando abrigo/);
  assert.equal(person.carriedWood, 2);
});

test('food collectors consolidate small harvests before a distant delivery', () => {
  const { world, person, kingdom, community } = fixture();
  world.kingdoms = [kingdom]; world.communities = [community];
  kingdom.memberIds = [person.id]; community.memberIds = [person.id];
  community.x = 26; community.y = 20;
  Object.assign(person, { kingdomId: kingdom.id, communityId: community.id, carriedWood: 0, carriedFood: 2,
    assignment: { source: 'kingdom-strategy', action: 'forage', communityId: community.id,
      goal: 'secure-shared-food', expiresDay: 2020, assignedBy: person.id } });
  at(world, 20, 20).plants[PLANTS.findIndex(p => p.id === 'berry')] = 80;
  updatePeople(world);
  assert.equal(person.brain.lastAction, 'forage');
  assert.ok(person.carriedFood > 2);
  assert.deepEqual([person.x, person.y], [20, 20]);
});

test('a full food load does not destroy uncollected plant biomass', () => {
  const { world, person } = fixture();
  const tile = at(world, 20, 20), berry = PLANTS.findIndex(p => p.id === 'berry');
  tile.plants[berry] = 80; person.carriedFood = 24;
  assert.equal(collectFoodForCommunity(world, person, tile), 0);
  assert.equal(tile.plants[berry], 80);
  person.carriedFood = 23.5;
  assert.equal(collectFoodForCommunity(world, person, tile), .5);
  assert.equal(tile.plants[berry], 79.5);
});

test('emergency meals consume finite edible cargo using its nutritional value', () => {
  const person = { carriedFood: 1, carriedFruit: 2, carriedMeat: 3, carriedWood: 4 };
  const before = person.carriedFood + person.carriedFruit + person.carriedMeat * MEAT_NUTRITIONAL_VALUE;
  const consumed = consumeEdibleCargo(person, 4);
  const after = person.carriedFood + person.carriedFruit + person.carriedMeat * MEAT_NUTRITIONAL_VALUE;
  assert.equal(consumed, 4);
  assert.ok(Math.abs(before - after - consumed) < 1e-9);
  assert.equal(person.carriedWood, 4);
});

test('a starving independent person can use fruit cargo without creating food', () => {
  const { world, person } = fixture();
  person.foodReserve = 0; person.carriedFruit = 2;
  updatePeople(world);
  assert.ok(Math.abs(person.carriedFruit - (2 - DAILY_FOOD_NEED / FOOD_RESERVE_PER_UNIT)) < 1e-9);
  assert.equal(person.foodReserve, 0);
  assert.equal(person.health, 44, 'the daily ration was supplied from physical cargo');
});

test('meat delivery skips a destroyed shelter and reaches a known valid one without owning a kingdom', () => {
  const { world, person, community } = fixture();
  person.carriedWood = 0; person.carriedMeat = 2;
  world.communities = [community]; community.x = 21; community.y = 20;
  const bad = { id: 9000, communityId: community.id, complete: true, type: 'abrigo', x: 20, y: 20, destroyedDay: 1900 };
  const good = { id: 9001, communityId: community.id, complete: true, type: 'abrigo', x: 21, y: 20, meatStored: 0 };
  world.structures = [bad, good];
  const before = community.stores.meat;
  updatePeople(world);
  assert.equal(person.carriedMeat, 0);
  assert.equal(community.stores.meat, before + 2);
  assert.equal(good.meatStored, 2);
  assert.equal(person.state, 'carne armazenada no abrigo');
});

test('feed can enter its community reserve before a corral is available', () => {
  const { world, person, community } = fixture();
  world.communities = [community]; person.communityId = community.id;
  person.carriedFeed = 2;
  const storage = nearestKnownStorage(world, person, community);
  assert.equal(cargoDeliveryPlan(world, person, community, storage).destination, community);
});

test('former generals and independent people cannot display military leadership badges', () => {
  const { world, person, kingdom } = fixture();
  world.kingdoms = [kingdom];
  person.militaryRank = 'general'; person.generalId = person.id; person.commanderId = person.id;
  assert.equal(activeLeadershipRank(person, kingdom), null);
  updateMilitaryCommand(world);
  assert.equal(person.militaryRank, undefined);
  assert.equal(person.generalId, undefined);
  assert.equal(person.commanderId, undefined);
  Object.assign(person, { role: 'soldier', kingdomId: kingdom.id, militaryRank: 'general' });
  assert.equal(activeLeadershipRank(person, kingdom), 'general');
  assert.equal(activeLeadershipRank(person, null), null);
});
