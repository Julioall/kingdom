import test from 'node:test';
import assert from 'node:assert/strict';
import engine from '../src/simulation/engine.js';
import { bestPeopleFoodCell } from '../src/simulation/individuals/actions.js';
import { distance } from '../src/simulation/core/math.js';
import { PLANTS } from '../src/config/ecosystem.js';
import Senses from '../src/simulation/individuals/perception.js';

function starvingPeacetimeSoldierFixture(garrisonFood = 0) {
  const world = engine.createWorld(42);
  const soldier = world.people.find(person => person.alive && person.role === 'soldier');
  assert.ok(soldier, 'seed 42 includes a peacetime soldier');
  soldier.perception = Senses.observe(world, soldier, 'person', PLANTS);
  assert.ok(bestPeopleFoodCell(world, soldier, 8), 'a reachable food target is visible nearby');

  const community = world.communities.find(item => item.id === soldier.communityId);
  const kingdom = world.kingdoms.find(item => item.id === soldier.kingdomId);
  community.memberIds = [soldier.id];
  community.stores.food = garrisonFood;
  kingdom.treasury.stock.food = 0;
  kingdom.communityId = community.id;
  world.people = [soldier];
  world.day = 1;
  Object.assign(soldier, {
    foodReserve: 0,
    health: 30,
    energy: 60,
    hydration: 80,
    injury: 0,
    campaignId: null,
    tacticalRecovering: false,
    restingStructureId: null,
    militaryRestTargetId: null,
    homeRestTargetId: null,
    carriedFood: 0,
    carriedFruit: 0,
    carriedMeat: 0
  });
  return { world, soldier };
}

test('peacetime soldiers forage under critical food pressure even when recovery would force rest', () => {
  const { world, soldier } = starvingPeacetimeSoldierFixture();
  for (let day = 1; day <= 2; day++) {
    world.day = day;
    engine.modules.SocietyExperiment.updatePeople(world);
  }

  assert.equal(soldier.lastDecision.action, 'forage');
  assert.ok(soldier.foodReserve > 0, 'the available finite biomass becomes the soldier\'s own ration');
});

test('a hungry peacetime soldier returns to a stocked garrison before foraging', () => {
  const { world, soldier } = starvingPeacetimeSoldierFixture(20);
  const center = world.structures.find(structure => structure.id === soldier.militaryCenterId);
  assert.ok(center, 'seed 42 gives the soldier a valid military center');
  soldier.health = 100;
  soldier.energy = 100;
  const before = distance(soldier, center);

  engine.modules.SocietyExperiment.updatePeople(world);

  assert.equal(soldier.lastDecision.action, 'return_garrison');
  assert.ok(distance(soldier, center) < before, 'the soldier moves toward the actual ration source');
});
