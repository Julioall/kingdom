import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Sim from '../../src/simulation/engine.js';
import { enlistSoldier, payMilitarySalaries, buyMilitaryMeal, drawGarrisonRation, MILITARY_PAY } from '../../src/simulation/kingdoms/service.js';
import { advanceKingdomProjects } from '../../src/simulation/kingdoms/projects.js';
import { MILITARY_SPRITES, militarySpritePose } from '../../src/ui/military-sprites.js';
import { FOOD_RESERVE_PER_UNIT } from '../../src/config/ecosystem.js';
import { restSoldierInHouse } from '../../src/simulation/kingdoms/service.js';
import { updatePeople } from '../../src/simulation/individuals/actions.js';

function fixture() {
  const world = Sim.createWorld(42);
  const kingdom = world.kingdoms[0];
  const person = world.people.find(p => p.alive && p.kingdomId === kingdom.id && p.role === 'resident' && p.ageDays >= 15 * 365);
  const center = world.structures.find(s => s.id === kingdom.militaryCenterIds[0]);
  kingdom.treasury.stock.gold = 100;
  return { world, kingdom, person, center };
}

test('training completion releases civil duties, cargo and livestock and starts in-kind peacetime service', () => {
  const { world, kingdom, person, center } = fixture();
  const community = world.communities.find(c => c.id === person.communityId);
  person.assignment = { action: 'build' };
  person.brain.pending = { action: 'gather' };
  person.carriedWood = 4;
  const wood = community.stores.wood;
  const sheep = world.animals.find(a => a.alive && a.speciesId === 'sheep');
  sheep.beingLedBy = person.id;
  person.leadingSheepId = sheep.id;
  person.recruitmentOrder = { militaryCenterId: center.id, kingdomId: kingdom.id, readyDay: 6 };
  advanceKingdomProjects(world, 6);
  assert.equal(person.role, 'soldier');
  assert.equal(person.assignment, null);
  assert.equal(person.brain.pending, null);
  assert.equal(person.carriedWood, 0);
  assert.equal(community.stores.wood, wood + 4);
  assert.equal(sheep.beingLedBy, null);
  assert.equal(person.leadingSheepId, null);
  assert.equal(person.recruitmentOrder, undefined);
  assert.equal(person.militaryWallet.stock.gold, 0);
  assert.equal(kingdom.treasury.stock.gold, 100);
  assert.equal(person.nextMilitaryPayDay, 36);
});

test('peacetime ration pauses salary accrual and deployed salary preserves arrears without duplication', () => {
  const { world, kingdom, person, center } = fixture();
  enlistSoldier(world, person, center, 7);
  world.people = [person];
  payMilitarySalaries(world, 36);
  payMilitarySalaries(world, 37);
  assert.equal(person.militaryWallet.stock.gold, 0);
  assert.equal(person.militaryPayArrears, 0);
  assert.equal(kingdom.treasury.stock.gold, 100);
  assert.equal(person.nextMilitaryPayDay, 67);

  person.campaignId = 707;
  payMilitarySalaries(world, 66);
  assert.equal(person.militaryWallet.stock.gold, 0);
  payMilitarySalaries(world, 67);
  assert.equal(person.militaryWallet.stock.gold, 15);
  kingdom.treasury.stock.gold = 3;
  payMilitarySalaries(world, 97);
  assert.equal(person.militaryWallet.stock.gold, 18);
  assert.equal(person.militaryPayArrears, 12);
  assert.equal(kingdom.treasury.stock.gold, 0);
  person.campaignId = null;
  kingdom.treasury.stock.gold = 20;
  payMilitarySalaries(world, 98);
  payMilitarySalaries(world, 98);
  assert.equal(person.militaryWallet.stock.gold, 30);
  assert.equal(person.militaryPayArrears, 0);
  assert.equal(kingdom.treasury.stock.gold, 8);
  person.role = 'resident';
  payMilitarySalaries(world, 67);
  assert.equal(person.militaryWallet.stock.gold, 30);
});

test('military meals spend salary at the market and stop when money or food is unavailable', () => {
  const { world, kingdom, person, center } = fixture();
  enlistSoldier(world, person, center);
  person.militaryWallet.stock.gold = MILITARY_PAY.gold;
  person.foodReserve = 50;
  kingdom.market.stock.food = 10;
  kingdom.market.prices.food = .5;
  const gold = kingdom.market.stock.gold;
  const meal = buyMilitaryMeal(world, person, FOOD_RESERVE_PER_UNIT);
  assert.equal(meal, FOOD_RESERVE_PER_UNIT);
  assert.equal(person.foodReserve, 50 + FOOD_RESERVE_PER_UNIT);
  assert.equal(person.militaryWallet.stock.gold, MILITARY_PAY.gold - .5);
  assert.equal(kingdom.market.stock.gold, gold + .5);
  assert.equal(kingdom.market.stock.food, 9);
  const purchase = kingdom.market.tradeLedger.history.at(-1);
  assert.equal(purchase.kind, 'market');
  assert.equal(purchase.action, 'comprou refeição militar');
  assert.deepEqual(purchase.market.delta, { food: -1, gold: .5 });
  assert.equal(world.communities[0].tradeLedger.history.at(-1).id, purchase.id);
  person.militaryWallet.stock.gold = 0;
  assert.equal(buyMilitaryMeal(world, person), 0);
  person.militaryWallet.stock.gold = 10;
  kingdom.market.stock.food = 0;
  assert.equal(buyMilitaryMeal(world, person), 0);
});

test('peacetime garrison ration remains an in-kind treasury transfer', () => {
  const { world, kingdom, person, center } = fixture();
  enlistSoldier(world, person, center);
  person.x = center.x;
  person.y = center.y;
  person.foodReserve = 40;
  const treasuryFood = kingdom.treasury.stock.food;

  assert.ok(Math.abs(drawGarrisonRation(world, person, center) - 15) < 1e-9);
  assert.equal(person.foodReserve, 55);
  assert.ok(Math.abs(kingdom.treasury.stock.food - (treasuryFood - 15 / FOOD_RESERVE_PER_UNIT)) < 1e-9);
});

test('deployed soldiers cannot bypass field rations by buying food from their home market', () => {
  const { world, kingdom, person, center } = fixture();
  enlistSoldier(world, person, center);
  person.foodReserve = 50;
  person.campaignId = 707;
  kingdom.market.stock.food = 10;
  kingdom.market.stock.gold = 4;
  person.militaryWallet.stock.gold = 8;

  assert.equal(buyMilitaryMeal(world, person, FOOD_RESERVE_PER_UNIT), 0);
  assert.equal(person.foodReserve, 50);
  assert.equal(person.militaryWallet.stock.gold, 8);
  assert.equal(kingdom.market.stock.food, 10);
  assert.equal(kingdom.market.stock.gold, 4);
});

test('soldiers choose military duty or personal recovery instead of civilian work', () => {
  const { world, person, center, kingdom } = fixture();
  enlistSoldier(world, person, center);
  kingdom.strategy = { ...kingdom.strategy, garrisonMode: 'standby' };
  person.tacticalRecovering = true;
  for (let day = 0; day < 8; day++) {
    person.foodReserve = 80; person.hydration = 80; person.energy = 80; person.health = 95;
    person.assignment = { action: 'gather', communityId: person.communityId, expiresDay: 100 };
    Sim.tick(world, 1);
    assert.ok(['guard', 'patrol', 'train', 'campaign', 'drink', 'rest'].includes(person.brain.lastAction), person.brain.lastAction);
    assert.equal(person.assignment, null);
    assert.equal(person.tacticalRecovering, false, 'a soldier at the recovery threshold returns to regular duty');
  }
});

test('a resting soldier enters a house, receives finite rations there and exits when recovered', () => {
  const { world, person, center, kingdom } = fixture();
  enlistSoldier(world, person, center);
  const house = world.structures.find(s => s.complete && s.kingdomId === kingdom.id && s.type === 'casa');
  assert.ok(house);
  person.x = house.x; person.y = house.y;
  person.energy = 30; person.foodReserve = 50; person.hydration = 90;
  assert.equal(restSoldierInHouse(world, person), true);
  assert.equal(person.restingStructureId, house.id);
  const food = kingdom.treasury.stock.food;
  assert.ok(drawGarrisonRation(world, person, center) > 0);
  assert.ok(kingdom.treasury.stock.food < food);
  world.people = [person];
  updatePeople(world);
  assert.equal(person.restingStructureId, house.id);
  assert.equal(person.state, 'descansando dentro da casa');
  person.energy = 60;
  updatePeople(world);
  assert.equal(person.restingStructureId, house.id, 'recovery continues inside until the rest threshold');
  person.energy = 95; person.health = 100; person.injury = 0;
  updatePeople(world);
  assert.equal(person.restingStructureId, null);
  assert.notEqual(person.brain.lastAction, 'rest');
});

test('an exhausted resident walks home, recovers indoors, and returns to normal decisions', () => {
  const { world, person } = fixture();
  const house = world.structures.find(s => s.id === person.homeId && s.type === 'casa');
  assert.ok(house, 'the resident has an assigned home');
  world.people = [person];
  for (const tile of world.tiles) {
    tile.terrain = 'land'; tile.elevationLevel = 0;
    tile.plants = tile.plants.map(() => 0);
  }
  Object.assign(person, {
    ageDays: 20 * 365, x: house.x - 5, y: house.y,
    energy: 20, health: 100, injury: 0, foodReserve: 90, hydration: 90,
    assignment: null, carriedWood: 0, carriedStone: 0, carriedGold: 0,
    carriedFood: 0, carriedFruit: 0, carriedMeat: 0, carriedFeed: 0,
    leadingSheepId: null
  });

  updatePeople(world);
  assert.equal(person.brain.lastAction, 'rest', 'low energy overrides ordinary work');
  assert.equal(person.homeRestTargetId, house.id, 'the assigned home is the destination');
  assert.equal(person.restingStructureId, null, 'the resident stays visible while walking');
  assert.equal(person.state, 'indo descansar na casa');

  for (let day = 0; day < 12 && person.restingStructureId == null; day++) {
    world.day++;
    updatePeople(world);
  }
  assert.equal(person.restingStructureId, house.id, 'the resident sleeps inside the assigned home');
  assert.equal(person.state, 'descansando dentro da casa');

  const energyAtEntry = person.energy;
  for (let day = 0; day < 12 && person.energy < 72; day++) {
    world.day++;
    updatePeople(world);
    if (person.energy < 72) assert.equal(person.restingStructureId, house.id, 'recovery keeps the resident indoors');
  }
  assert.ok(person.energy >= 72 && person.energy > energyAtEntry, 'indoor rest replenishes energy');
  world.day++;
  updatePeople(world);
  assert.equal(person.restingStructureId, null, 'the resident becomes visible again after recovery');
  assert.equal(person.homeRestTargetId, null, 'the completed rest order is cleared');
  assert.notEqual(person.brain.lastAction, 'rest', 'normal decisions resume');
});

test('a tired returning soldier walks to a house without oscillating back to the center', () => {
  const { world, person, center, kingdom } = fixture();
  enlistSoldier(world, person, center);
  const house = world.structures.find(s => s.complete && s.kingdomId === kingdom.id && s.type === 'casa');
  house.x = center.x + 6; house.y = center.y;
  world.structures = [center, house];
  world.people = [person];
  for (const tile of world.tiles) {
    tile.terrain = 'land'; tile.elevationLevel = 0;
    tile.plants = tile.plants.map(() => 0);
  }
  person.x = center.x - 6; person.y = center.y;
  person.energy = 30; person.foodReserve = 80; person.hydration = 90;
  person.militaryReturningHome = true;
  updatePeople(world);
  assert.equal(person.militaryRestTargetId, house.id);
  assert.equal(person.restingStructureId, null, 'the soldier remains visible while walking');
  assert.equal(person.state, 'indo descansar na casa');
  for (let day = 0; day < 12 && person.restingStructureId == null; day++) updatePeople(world);
  assert.equal(person.restingStructureId, house.id);
  assert.equal(person.militaryReturningHome, false, 'entering the house completes the post-campaign return');
});

test('wounded soldiers complete home recovery within twelve daily updates without a healer', () => {
  for (const conditions of [{ energy: 20, health: 24, injury: 6 }, { energy: 0, health: 5, injury: 10 }]) {
    const { world, person, center } = fixture();
    enlistSoldier(world, person, center);
    const house = world.structures.find(s => s.id === person.homeId);
    person.x = house.x; person.y = house.y;
    Object.assign(person, conditions);
    person.foodReserve = 90; person.hydration = 90; person.tacticalRecovering = true;
    world.people = [person];
    for (let day = 0; day < 12; day++) { world.day++; updatePeople(world); }
    assert.ok(person.energy >= 74, 'energy is restored');
    assert.ok(person.health >= 60, 'health no longer requires hundreds of days in bed');
    assert.ok(person.injury < 5, 'injuries no longer keep a recovered soldier hidden');
    assert.equal(person.restingStructureId, null);
    assert.equal(person.tacticalRecovering, false);
    assert.notEqual(person.brain.lastAction, 'rest');
  }
});

test('a recovered soldier leaves the house even when the garrison has no food to issue', () => {
  const { world, person, center, kingdom } = fixture();
  enlistSoldier(world, person, center);
  const house = world.structures.find(s => s.id === person.homeId);
  person.x = house.x; person.y = house.y;
  person.energy = 100; person.health = 100; person.injury = 0;
  person.foodReserve = 20; person.hydration = 90;
  restSoldierInHouse(world, person);
  kingdom.treasury.stock.food = 0;
  const community = world.communities.find(c => c.id === person.communityId);
  for (const resource of ['food', 'fruit', 'meat']) community.stores[resource] = 0;
  world.people = [person];
  updatePeople(world);
  assert.equal(person.restingStructureId, null);
  assert.notEqual(person.brain.lastAction, 'rest');
});

test('all mapped military sheets exist in every palette and use complete square frames', () => {
  for (const palette of ['blue', 'red', 'purple', 'yellow', 'black']) {
    for (const unit of Object.values(MILITARY_SPRITES)) {
      for (const file of Object.values(unit.actions)) {
        const png = fs.readFileSync(new URL('../../public/assets/tiny-swords/military/' + palette + '/' + unit.folder + '/' + unit.prefix + file + '.png', import.meta.url));
        assert.equal(png.readUInt32BE(20), unit.size);
        assert.equal(png.readUInt32BE(16) % unit.size, 0);
      }
    }
  }
  const person = { militaryClass: 'lanceiro', militaryAnimationDay: 3, militaryAnimation: 'attack' };
  assert.equal(militarySpritePose(person, { moving: true, dirX: 1 }, 3).action, 'attack-Right');
  const attack = militarySpritePose(person, { moving: false, dirX: -1, dirY: -1 }, 3);
  assert.equal(attack.action, 'attack-UpRight');
  assert.equal(attack.flip, true);
  assert.equal(militarySpritePose(person, { moving: false, dirX: 0, dirY: -1 }, 3).action, 'attack-Up');
  assert.equal(militarySpritePose(person, { moving: false }, 4).action, 'idle');
});
