import test from 'node:test';
import assert from 'node:assert/strict';
import engine from '../src/simulation/engine.js';
import { PLANTS } from '../src/config/ecosystem.js';
import Senses from '../src/simulation/individuals/perception.js';
import { cellAt } from '../src/simulation/world/spatial.js';
import { startFoodInventoryAudit } from '../src/simulation/economy/food-audit-ledger.js';

function borderForageFixture({ warned = false, foodReserve = 32 } = {}) {
  const world = engine.createWorld(42);
  const home = world.kingdoms[0];
  const host = world.kingdoms[1];
  const person = world.people.find(candidate => candidate.alive && candidate.role !== 'soldier' && candidate.ageDays >= 18 * 365
    && candidate.kingdomId === home.id);
  assert.ok(person, 'seed 42 contains a civilian pawn in the home kingdom');
  const community = world.communities.find(candidate => candidate.id === person.communityId);
  assert.ok(community);
  const berryIndex = PLANTS.findIndex(plant => plant.id === 'berry');

  // A controlled, passable strip makes the foreign food patch the only observed
  // edible target. The pawn and target still use the production perception,
  // policy, route planner, movement and harvest systems.
  world.structures = [];
  world.animals = [];
  for (let y = 53; y <= 75; y++) for (let x = 50; x <= 72; x++) {
    const tile = cellAt(world, x, y);
    tile.terrain = 'land';
    tile.slope = 0;
    tile.elevationLevel = 0;
    tile.cropFieldId = null;
    tile.plants.fill(0);
    tile.plantResourceMask = 0;
    tile.stoneDeposit = 0;
    tile.goldOre = 0;
    tile.copperOre = 0;
    tile.silverOre = 0;
    tile.ironOre = 0;
    tile.kingdomId = x <= 63 ? home.id : host.id;
  }

  const target = cellAt(world, 66, 64);
  target.plants[berryIndex] = 180;
  person.x = 61;
  person.y = 64;
  person.headingX = 1;
  person.headingY = 0;
  person.kingdomId = home.id;
  person.foodReserve = foodReserve;
  person.hydration = 85;
  person.energy = 90;
  person.health = 100;
  person.injury = 0;
  person.assignment = null;
  person.territoryWarnings = warned ? { [host.id]: 50 } : {};
  person.territoryAwareness = null;
  person.territoryExposure = null;
  person.foodTarget = null;
  person.failedFoodTargets = [];
  person.carriedFood = 0;
  person.carriedFruit = 0;
  person.carriedMeat = 0;
  person.lastSafeX = 61;
  person.lastSafeY = 64;
  community.memberIds = [person.id];
  community.stores.food = 0;
  world.people = [person];
  world.day = 10;
  world.navigationRevision = (world.navigationRevision || 0) + 1;
  person.perception = Senses.observe(world, person, 'person', PLANTS);
  return { world, home, host, person, target, berryIndex };
}

test('a hungry pawn autonomously crosses a foreign border and harvests finite visible food', () => {
  const { world, home, host, person, target, berryIndex } = borderForageFixture();
  const biomassBefore = target.plants[berryIndex];
  assert.ok(person.perception.resources.some(resource => resource.x === target.x && resource.y === target.y
    && resource.visible && resource.harvestableBiomass.berry > 0), 'the target is directly observed');

  let crossed = false;
  let harvested = false;
  const decisions = [];
  let previous = { x: person.x, y: person.y };
  const audit = startFoodInventoryAudit(world);
  let report;
  try {
    for (let day = 0; day < 6; day++) {
      audit.beginDay(world.day);
      engine.modules.SocietyExperiment.updatePeople(world);
      audit.endDay();
      decisions.push(person.lastDecision?.action);
      const movement = Math.hypot(person.x - previous.x, person.y - previous.y);
      assert.ok(movement <= Math.SQRT2 + .001, 'the pawn advances through the route one tile at a time');
      previous = { x: person.x, y: person.y };
      const currentTile = cellAt(world, person.x, person.y);
      if (currentTile.kingdomId === host.id) {
        crossed = true;
        assert.equal(person.territoryAwareness?.ownerId, host.id,
          'crossing records the foreign owner and warns the pawn of the risk');
      }
      if (target.plants[berryIndex] < biomassBefore) harvested = true;
      world.day++;
      if (harvested) break;
    }
  } finally {
    report = audit.finish();
  }

  assert.ok(decisions.includes('forage'), 'the production policy selected foraging without an assignment');
  assert.ok(crossed, 'the pawn voluntarily entered the neighboring kingdom for the observed resource');
  assert.ok(harvested, 'the real harvest reduced source biomass');
  assert.ok(target.plants[berryIndex] > 0, 'harvesting consumed only a finite part of the patch');
  assert.ok(person.foodReserve > 0, 'the harvested food reached the pawn inventory');
  assert.equal(person.kingdomId, home.id, 'the pawn retains its origin identity while crossing the border');
  const transaction = report.transactions.find(item => item.actorId === person.id
    && item.category === 'personal-foraging' && item.source?.tileIndex === target.i);
  assert.ok(transaction, 'the physical harvest is recorded with its observed source tile');
  assert.ok(['completed', 'completed-via-child-operations'].includes(transaction.status));
  assert.ok(Math.abs((biomassBefore - target.plants[berryIndex]) - transaction.requested) < .001,
    'the ledgered harvest request matches the amount removed from the physical patch');
  const inventoryMutation = report.transactions.find(item => transaction.childIds.includes(item.id) && item.moved > 0);
  assert.ok(inventoryMutation, 'the harvest produced a tracked inventory mutation');
  assert.ok(Math.abs((biomassBefore - target.plants[berryIndex]) - inventoryMutation.moved) < .001,
    'the biomass removed from the patch matches the food credited to the pawn');
});

test('a recorded warning blocks ordinary foreign foraging but critical hunger can override it', () => {
  const { world, home, host, person } = borderForageFixture({ warned: true });

  engine.modules.SocietyExperiment.updatePeople(world);
  assert.equal(cellAt(world, person.x, person.y).kingdomId, home.id,
    'ordinary food pressure does not send a warned pawn across the border');
  world.day++;

  person.foodReserve = 8;
  let crossedUnderSurvivalPressure = false;
  for (let day = 0; day < 5; day++) {
    engine.modules.SocietyExperiment.updatePeople(world);
    if (cellAt(world, person.x, person.y).kingdomId === host.id) {
      crossedUnderSurvivalPressure = true;
      break;
    }
    world.day++;
  }
  assert.ok(crossedUnderSurvivalPressure,
    'the warning informs the choice without making survival forage universally impossible');
});

test('a pawn transports surplus from a foreign berry patch back to its own community', () => {
  const { world, home, host, person, target, berryIndex } = borderForageFixture({ foodReserve: 95 });
  const community = world.communities.find(candidate => candidate.id === person.communityId);
  const startingFood = community.stores.food;
  const startingBiomass = target.plants[berryIndex];
  let enteredHostileLand = false;
  let carriedForeignHarvest = false;
  let cargoMovedTowardHome = false;
  let deliveredCargo = false;
  let deliveredAmount = 0;
  let communityStockGain = 0;
  let previousPosition = { x: person.x, y: person.y };

  for (let day = 0; day < 45; day++) {
    const cargoBefore = person.carriedFruit;
    const communityFoodBefore = community.stores.food;
    const distanceBefore = distanceTo(person, community);
    engine.modules.SocietyExperiment.updatePeople(world);
    const ownerId = cellAt(world, person.x, person.y).kingdomId;
    assert.ok(Math.hypot(person.x - previousPosition.x, person.y - previousPosition.y) <= Math.SQRT2 + .001,
      'the carrier follows the route one tile at a time');
    previousPosition = { x: person.x, y: person.y };
    if (ownerId === host.id) enteredHostileLand = true;
    if (target.plants[berryIndex] < startingBiomass && person.carriedFruit > .01) {
      carriedForeignHarvest = true;
    }
    if (carriedForeignHarvest && person.lastDecision?.action === 'deliver'
        && person.carriedFruit > .01 && distanceTo(person, community) < distanceBefore) {
      cargoMovedTowardHome = true;
    }
    if (carriedForeignHarvest && person.carriedFruit < cargoBefore - .01
        && community.stores.food > communityFoodBefore + .01) {
      deliveredCargo = true;
      deliveredAmount = cargoBefore - person.carriedFruit;
      communityStockGain = community.stores.food - communityFoodBefore;
    }
    world.day++;
    if (deliveredCargo) break;
  }

  assert.ok(enteredHostileLand, 'the forager crossed into the neighboring kingdom');
  assert.ok(target.plants[berryIndex] < startingBiomass, 'the foreign source was harvested');
  assert.ok(carriedForeignHarvest, 'limited personal storage kept the food in a physical cargo slot');
  assert.ok(cargoMovedTowardHome, 'the carrier selected delivery and traveled toward its community');
  assert.ok(deliveredCargo && community.stores.food > startingFood,
    'the foreign resource was deposited into the pawn\'s own community stock');
  assert.ok(Math.abs(deliveredAmount - communityStockGain) < .001,
    'the carrier cargo decrease matches the receiving community stock increase');
  assert.equal(person.kingdomId, home.id);
});

function distanceTo(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
