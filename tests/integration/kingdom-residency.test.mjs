import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../../src/simulation/engine.js';
import { updateResidencyAbsence } from '../../src/simulation/society/residency.js';
import { updateCommunityStages } from '../../src/simulation/society/communities.js';
import { assignCommunityTasks, completeCommunityTask } from '../../src/simulation/society/governance.js';
import { fundFoodInfrastructure } from '../../src/simulation/kingdoms/strategy.js';
import { bestHabitatCell, collectFoodForCommunity, updatePeople } from '../../src/simulation/individuals/actions.js';

function fixture() {
  const world = Sim.createWorld(42), kingdom = world.kingdoms[0];
  const community = world.communities.find(c => c.id === kingdom.communityId);
  const person = world.people.find(p => p.kingdomId === kingdom.id && p.role === 'resident');
  return { world, kingdom, community, person };
}
function isolatedAbsenceFixture() {
  const { world, kingdom, community, person } = fixture();
  Object.assign(person, { x: 20, y: 20, awayDays: 46, dissatisfactionDays: 0,
    homeId: null, foodReserve: 20, hydration: 50, health: 60, socialNeed: 40 });
  community.x = 60; community.y = 60; community.satisfaction = .3;
  world.tiles[20 * world.width + 20].kingdomId = null;
  return { world, kingdom, community, person };
}

test('a resident inside their territory is not considered absent even beyond ten cells of the center', () => {
  const { world, kingdom, community, person } = isolatedAbsenceFixture();
  world.tiles[20 * world.width + 20].kingdomId = kingdom.id;
  const outcome = updateResidencyAbsence(world, person, community);
  assert.equal(person.awayDays, 0);
  assert.equal(outcome.leftAfterLongAbsence, false);
});

test('a moving courier working for the community does not accumulate abandonment days', () => {
  const { world, community, person } = isolatedAbsenceFixture();
  const outcome = updateResidencyAbsence(world, person, community, { action: 'deliver', moved: true,
    assignment: { communityId: community.id, expiresDay: world.day + 1 } });
  assert.equal(person.awayDays, 0);
  assert.equal(outcome.leftAfterLongAbsence, false);
});

test('an immobile assignment does not indefinitely suppress a genuine departure', () => {
  const { world, community, person } = isolatedAbsenceFixture();
  const outcome = updateResidencyAbsence(world, person, community, { action: 'deliver', moved: false,
    assignment: { communityId: community.id, expiresDay: world.day + 1 } });
  assert.equal(person.awayDays, 47);
  assert.equal(outcome.leftAfterLongAbsence, true);
});

test('poor aggregate satisfaction alone does not expel an individually healthy distant resident', () => {
  const { world, community, person } = isolatedAbsenceFixture();
  Object.assign(person, { foodReserve: 80, hydration: 80, health: 90, socialNeed: 20 });
  assert.equal(updateResidencyAbsence(world, person, community).leftAfterLongAbsence, false);
});

test('a valid home remains a residential connection on neutral ground', () => {
  const { world, kingdom, community, person } = isolatedAbsenceFixture();
  const home = { id: 8000, x: 20, y: 20, type: 'casa', complete: true, kingdomId: kingdom.id };
  world.structures.push(home); person.homeId = home.id;
  assert.equal(updateResidencyAbsence(world, person, community).leftAfterLongAbsence, false);
  home.kingdomId = kingdom.id + 100;
  person.awayDays = 46;
  assert.equal(updateResidencyAbsence(world, person, community).leftAfterLongAbsence, true);
});

test('kingdom community coordinates remain at the settlement while residents travel', () => {
  const { world, kingdom, community, person } = fixture();
  const castle = world.structures.find(s => s.kingdomId === kingdom.id && s.type === 'castelo');
  person.x = 15; person.y = 15;
  world.people = [person];
  updateCommunityStages(world);
  assert.deepEqual([community.x, community.y], [castle.x, castle.y]);
});

test('human migration values edible roots rather than inedible grass', () => {
  const { world, person } = fixture();
  person.x = 20; person.y = 20;
  for (const t of world.tiles) { t.terrain = 'land'; t.slope = 0; t.kingdomId = null; t.soilWaterMm = 50; t.soilCapacityMm = 100; t.plants.fill(0); }
  const grass = Sim.plants.findIndex(p => p.id === 'grass'), root = Sim.plants.findIndex(p => p.id === 'cultivated-root');
  world.tiles[20 * world.width + 19].plants[grass] = 1000;
  world.tiles[20 * world.width + 22].plants[root] = 120;
  const destination = bestHabitatCell(world, person);
  assert.deepEqual([destination.x, destination.y], [22, 20]);
});

test('food infrastructure funding debits finite royal materials without creating resources', () => {
  const { world, kingdom, community } = fixture();
  community.stores.wood = 0; community.stores.stone = 0; community.stores.food = 0;
  const wood = kingdom.treasury.stock.wood, stone = kingdom.treasury.stock.stone;
  const funding = fundFoodInfrastructure(world, kingdom);
  assert.equal(funding.type, 'abrigo');
  assert.equal(kingdom.treasury.stock.wood + community.stores.wood, wood);
  assert.equal(kingdom.treasury.stock.stone + community.stores.stone, stone);
  assert.equal(fundFoodInfrastructure(world, kingdom), null);
});

test('funding does not make a partial transfer when the treasury cannot cover both materials', () => {
  const { world, kingdom, community } = fixture();
  community.stores.wood = 0; community.stores.stone = 0; community.stores.food = 0;
  kingdom.treasury.stock.stone = 0;
  const wood = kingdom.treasury.stock.wood;
  assert.equal(fundFoodInfrastructure(world, kingdom), null);
  assert.equal(kingdom.treasury.stock.wood, wood);
  assert.equal(community.stores.wood, 0);
});

test('a field harvest enters its local community reserve while preserving biomass accounting', () => {
  const { world, community, person } = fixture();
  person.carriedFood = 0;
  const tile = world.tiles[Math.round(person.y) * world.width + Math.round(person.x)];
  const root = Sim.plants.findIndex(p => p.id === 'cultivated-root');
  tile.plants.fill(0); tile.plants[root] = 100; tile.cropFieldId = 9000;
  world.structures.push({ id: 9000, type: 'roça', complete: true, communityId: community.id, x: tile.x, y: tile.y });
  const before = community.stores.food;
  const harvest = collectFoodForCommunity(world, person, tile);
  assert.ok(harvest > 0);
  assert.equal(person.carriedFood, 0);
  assert.ok(Math.abs(community.stores.food - before - harvest) < 1e-6);
  assert.ok(Math.abs(100 - tile.plants[root] - harvest) < 1e-5);
});

test('a farmer remains assigned after a productive harvest while the reserve is critical', () => {
  const { world, community, person } = fixture();
  person.assignment = { source: 'kingdom-strategy', action: 'forage', foodFieldId: 9000,
    communityId: community.id, expiresDay: world.day + 7 };
  community.stores.food = 2;
  assert.equal(completeCommunityTask(world, person, 'forage', { carriedFood: 0, food: 0 }, { carriedFood: 0, food: 2 }), false);
  assert.equal(person.assignment.action, 'forage');
});

test('a food order can direct a safe worker to a known field beyond personal sight', () => {
  const { world, kingdom, community, person } = fixture();
  const leader = world.people.find(p => p.id === kingdom.rulerId);
  const field = { id: 9000, type: 'roça', complete: true, communityId: community.id, x: person.x + 12, y: person.y };
  world.structures.push(field);
  Object.assign(person, { ageDays: 20 * 365, energy: 80, hydration: 80, health: 80, foodReserve: 80,
    perception: { resources: [] }, assignment: null });
  assignCommunityTasks(world, community, leader, [leader, person], {
    source: 'kingdom-strategy', goal: 'secure-shared-food', action: 'forage', skill: 'forage', title: 'abastecer', priority: 'urgent'
  }, false);
  assert.equal(person.assignment.foodFieldId, field.id);
});

test('a delegated farmer actually approaches the field before it enters personal sight', () => {
  const { world, kingdom, community, person } = fixture();
  for (const t of world.tiles) { t.terrain = 'land'; t.elevationLevel = 0; t.slope = 0; t.plants.fill(0); t.kingdomId = null; }
  const field = { id: 9000, type: 'roça', complete: true, communityId: community.id, x: 20, y: 20 };
  world.structures.push(field);
  world.people = [person]; world.communities = [community]; world.kingdoms = [kingdom]; world.animals = [];
  community.memberIds = [person.id]; kingdom.memberIds = [person.id];
  Object.assign(person, { x: 20, y: 8, ageDays: 20 * 365, energy: 80, hydration: 80,
    foodReserve: 80, health: 80, homeId: null, injury: 0,
    carriedFood: 0, carriedFruit: 0, carriedMeat: 0, carriedWood: 0, carriedStone: 0, carriedGold: 0, carriedFeed: 0,
    assignment: { source: 'kingdom-strategy', action: 'forage', foodFieldId: field.id,
      communityId: community.id, expiresDay: world.day + 10 } });
  updatePeople(world);
  assert.equal(person.brain.lastAction, 'forage');
  assert.ok(Math.hypot(person.x - field.x, person.y - field.y) < 12);
});
