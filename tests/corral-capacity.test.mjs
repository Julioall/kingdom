import test from 'node:test';
import assert from 'node:assert/strict';
import engine from '../src/simulation/engine.js';
import { PLANTS } from '../src/config/ecosystem.js';
import { captureSheep } from '../src/simulation/individuals/actions.js';
import { availableCommunityPen, communityNeedsAdditionalPen, communityHerdPenAssignments, DOMESTIC_SHEEP_PER_PEN } from '../src/simulation/ecology/herd.js';
import { communityHerd, reproduceAnimals } from '../src/simulation/ecology/animals.js';
import { performTrade } from '../src/simulation/economy/trade.js';
import { taskForCommunity } from '../src/simulation/society/governance.js';
import { canCommunityBuild, chooseBuildSite, nextCommunityStructure, workOnCommunityStructure } from '../src/simulation/settlements/construction.js';

function herdWorld({ sheepCount = 0, penCount = 1 } = {}) {
  const community = { id: 1, name: 'Valedouro', kingdomId: 2, x: 15, y: 15, memberIds: [1],
    stores: { food: 20, meat: 0, wood: 100, stone: 100, feed: 0, gold: 0 }, history: [], lastBuildDay: -24 };
  const pens = Array.from({ length: penCount }, (_, index) => ({ id: 10 + index, type: 'curral', communityId: 1,
    kingdomId: 2, x: 10 + index * 10, y: 10, radius: 3.5, complete: true, destroyedDay: null, integrity: 1 }));
  const animals = Array.from({ length: sheepCount }, (_, index) => ({ id: 100 + index, speciesId: 'sheep', alive: true,
    x: 10, y: 10, ageDays: 900, energy: 80, herdCommunityId: 1,
    herdPenId: index < DOMESTIC_SHEEP_PER_PEN && pens[0] ? pens[0].id : null, beingLedBy: null }));
  const person = { id: 1, name: 'Ayo', alive: true, role: 'resident', communityId: 1, kingdomId: 2,
    x: 10, y: 10, energy: 80, hydration: 80, foodReserve: 80, leadingSheepId: null };
  return { day: 40, seed: 7, width: 30, height: 30, nextId: 1000, navigationRevision: 0,
    people: [person], animals, structures: pens, communities: [community], kingdoms: [{ id: 2, x: 15, y: 15 }],
    tiles: [], events: [], chronicle: [], rngState: 1, deaths: 0, births: 0, birthsByKind: { animals: 0 },
    person, community, pens };
}

function constructionWorld({ territory = true } = {}) {
  const world = engine.createWorld(42);
  const community = world.communities[0];
  const kingdom = world.kingdoms[0];
  const person = { id: 1, name: 'Construtor', alive: true, role: 'resident', kingdomId: kingdom.id,
    communityId: community.id, x: 64, y: 30, energy: 90, foodReserve: 80, hydration: 80, health: 100,
    injury: 0, skills: { build: .5 }, assignment: null, buildCooldown: 0 };
  community.x = 64; community.y = 34; community.memberIds = [person.id];
  community.lastBuildDay = -24; community.properties = []; community.history = [];
  community.stores = { food: 20, meat: 0, wood: 100, stone: 100, feed: 0, gold: 0 };
  kingdom.x = 64; kingdom.y = 34;
  world.kingdoms = [kingdom, { id: 999, x: 64, y: 94 }];
  world.people = [person];
  world.day = 30;
  world.structures = [
    { id: 101, type: 'abrigo', communityId: community.id, kingdomId: kingdom.id, x: 54, y: 34, complete: true, integrity: 1 },
    { id: 102, type: 'roça', communityId: community.id, kingdomId: kingdom.id, x: 74, y: 34, complete: true, integrity: 1 },
    { id: 103, type: 'curral', communityId: community.id, kingdomId: kingdom.id, x: 64, y: 14,
      radius: 3.5, complete: true, destroyedDay: null, integrity: 1 }
  ];
  const grassIndex = PLANTS.findIndex(plant => plant.id === 'grass');
  for (const tile of world.tiles) {
    tile.terrain = 'land'; tile.slope = 0; tile.waterDist = 10; tile.kingdomId = territory ? kingdom.id : null;
    tile.elevationLevel = 0; tile.soilType = 'loam'; tile.goldOre = 0; tile.stoneDeposit = 0;
    tile.plants.fill(0); tile.plants[grassIndex] = 24;
  }
  world.navigationRevision = (world.navigationRevision || 0) + 1;
  world.animals = Array.from({ length: DOMESTIC_SHEEP_PER_PEN }, (_, index) => ({ id: 200 + index,
    alive: true, speciesId: 'sheep', x: 64, y: 14, ageDays: 900, energy: 80,
    herdCommunityId: community.id, herdPenId: 103 }));
  return { world, community, person, kingdom };
}

test('one pen holds 34 or 35 sheep and leaves the 36th outside its capacity', () => {
  for (const count of [34, 35, 36]) {
    const world = herdWorld({ sheepCount: count });
    const summary = communityHerdPenAssignments(world, world.community.id);
    assert.equal(summary.counts.get(world.pens[0].id), Math.min(count, DOMESTIC_SHEEP_PER_PEN));
    assert.equal(summary.assignments.size, Math.min(count, DOMESTIC_SHEEP_PER_PEN));
  }
});

test('a domestic flock with no active pen still triggers corral expansion', () => {
  const withFlock = herdWorld({ sheepCount: 1, penCount: 0 });
  const empty = herdWorld({ sheepCount: 0, penCount: 0 });
  assert.equal(communityNeedsAdditionalPen(withFlock, withFlock.community.id), true);
  assert.equal(communityNeedsAdditionalPen(empty, empty.community.id), false);
});

test('nearby wild sheep remain visible to community grazing logic but do not occupy pen slots', () => {
  const world = herdWorld({ sheepCount: 34 });
  world.animals[0].herdPenId = null;
  const wild = { id: 999, speciesId: 'sheep', alive: true, x: 11, y: 10, ageDays: 500,
    herdCommunityId: null, herdPenId: null, beingLedBy: null };
  world.animals.push(wild);

  assert.ok(communityHerd(world, world.community).includes(wild));
  assert.equal(availableCommunityPen(world, world.community.id), world.pens[0]);
  assert.equal(world.animals[0].herdPenId, null, 'capacity queries do not mutate legacy herd assignments');
  const assignments = communityHerdPenAssignments(world, world.community.id);
  assert.equal(assignments.assignments.size, 34);
  assert.equal(assignments.counts.get(world.pens[0].id), 34);
});

test('a second pen absorbs overflow and a shepherd reserves its remaining slot', () => {
  const world = herdWorld({ sheepCount: 35, penCount: 2 });
  const extra = { id: 999, speciesId: 'sheep', alive: true, x: 20, y: 10, ageDays: 500,
    herdCommunityId: world.community.id, herdPenId: null, beingLedBy: null };
  world.animals.push(extra);
  let summary = communityHerdPenAssignments(world, world.community.id);
  assert.equal(summary.assignments.get(extra.id), world.pens[1].id);
  assert.equal(summary.counts.get(world.pens[0].id), 35);
  assert.equal(summary.counts.get(world.pens[1].id), 1);
  assert.equal(communityNeedsAdditionalPen(world, world.community.id), false);

  const wild = { ...extra, id: 1001, x: 10, y: 10, herdCommunityId: null, herdPenId: null };
  world.animals.push(wild);
  const captured = captureSheep(world, world.person, world.community,
    { id: wild.id, visible: true, speciesId: 'sheep', distance: 0 });
  assert.equal(captured, true);
  assert.equal(wild.herdPenId, world.pens[1].id);
  summary = communityHerdPenAssignments(world, world.community.id);
  assert.equal(summary.counts.get(world.pens[1].id), 2, 'a sheep being led reserves one pen slot');
});

test('a full single pen rejects capture without changing the wild sheep', () => {
  const world = herdWorld({ sheepCount: 35 });
  const wild = { id: 999, speciesId: 'sheep', alive: true, x: 10, y: 10, ageDays: 500,
    herdCommunityId: null, herdPenId: null, beingLedBy: null };
  world.animals.push(wild);
  assert.equal(captureSheep(world, world.person, world.community,
    { id: wild.id, visible: true, speciesId: 'sheep', distance: 0 }), false);
  assert.equal(wild.herdCommunityId, null);
  assert.equal(wild.beingLedBy, null);
  assert.equal(world.person.state, 'curral sem espaço');
});

test('community AI continues seeking sheep past the former four-animal limit while a pen has room', () => {
  const world = herdWorld({ sheepCount: 5 });
  const wild = { id: 999, speciesId: 'sheep', alive: true, x: 12, y: 10,
    herdCommunityId: null, herdPenId: null, beingLedBy: null };
  world.animals.push(wild);
  world.community.stores.food = 100;
  world.community.stores.feed = 100;
  world.person.ageDays = 20 * 365;
  world.person.foodReserve = 80;
  world.person.perception = { animals: [{ id: wild.id, speciesId: 'sheep', visible: true, distance: 2 }] };
  assert.deepEqual(taskForCommunity(world, world.community, [world.person]), {
    action: 'capture_sheep', title: 'capturar e conduzir uma ovelha ao curral', skill: 'care'
  });
});

test('domesticated lambs use the next pen when the first pen is full', () => {
  const world = herdWorld({ sheepCount: 35, penCount: 2 });
  for (const sheep of world.animals) {
    sheep.reproductionCooldown = 0; sheep.feedingEvents = 1; sheep.lastFedDay = world.day;
  }
  const birthCount = world.births;
  for (let seed = 1; seed < 1000 && world.births === birthCount; seed++) {
    world.rngState = seed;
    reproduceAnimals(world);
  }
  assert.equal(world.births, birthCount + 1, 'the fixture should produce one deterministic successful conception');
  const lamb = world.animals.find(animal => animal.alive && animal.herdCommunityId === world.community.id
    && animal.ageDays === 0);
  assert.ok(lamb);
  const summary = communityHerdPenAssignments(world, world.community.id);
  assert.equal(summary.assignments.get(lamb.id), world.pens[1].id);
  assert.equal(summary.counts.get(world.pens[0].id), DOMESTIC_SHEEP_PER_PEN);
});

test('market livestock purchase uses another pen when the first one is full', () => {
  const world = engine.createWorld(42);
  const community = world.communities[0];
  const person = world.people.find(candidate => candidate.alive && candidate.communityId === community.id);
  const pens = [
    { id: 900, type: 'curral', communityId: community.id, x: 30, y: 30, radius: 3.5, complete: true, integrity: 1 },
    { id: 901, type: 'curral', communityId: community.id, x: 90, y: 30, radius: 3.5, complete: true, integrity: 1 }
  ];
  world.structures = pens;
  world.people = [person];
  person.x = 90; person.y = 30; person.skills.diplomacy = .5;
  community.memberIds = [person.id]; community.tradeCount = 0;
  community.stores = { food: 100, meat: 0, wood: 0, stone: 0, feed: 0, gold: 100 };
  world.tiles.forEach(tile => { tile.terrain = 'land'; tile.slope = 0; tile.goldOre = 0; tile.stoneDeposit = 0; });
  world.animals = Array.from({ length: 35 }, (_, index) => ({ id: 1000 + index, speciesId: 'sheep', alive: true,
    x: 30, y: 30, ageDays: 900, energy: 80, herdCommunityId: community.id, herdPenId: pens[0].id }));
  const market = { stock: { sheep: 2, gold: 0, food: 0, wood: 0, stone: 0, feed: 0 }, transactions: 0 };
  const partner = { isMarket: true, distance: 1, station: { x: 90, y: 30 }, market };
  const animalCountBefore = world.animals.length;

  assert.equal(performTrade(world, person, community, partner), true);
  const purchased = world.animals.slice(animalCountBefore).find(animal => animal.herdCommunityId === community.id);
  assert.ok(purchased);
  assert.equal(purchased.herdPenId, pens[1].id);
  assert.equal(community.stores.gold, 62);
  assert.equal(market.stock.sheep, 1);
});

test('AI proposes an additional pen at capacity and pays only after finding a valid site', () => {
  const invalid = constructionWorld({ territory: false });
  const plan = nextCommunityStructure(invalid.world, invalid.community, 1, invalid.world.structures);
  assert.equal(plan.type, 'curral');
  assert.equal(canCommunityBuild(invalid.world, invalid.community, 1), true,
    'capacity expansion can use an additional construction slot');
  assert.equal(chooseBuildSite(invalid.world, invalid.community, invalid.world.structures, invalid.person), null);
  const before = { ...invalid.community.stores };
  workOnCommunityStructure(invalid.world, invalid.person, invalid.community, 1);
  assert.deepEqual(invalid.community.stores, before);
  assert.equal(invalid.world.structures.length, 3);
  assert.equal(invalid.person.state, 'procurando local para construir');
  assert.equal(invalid.person.assignment, null);

  const valid = constructionWorld();
  const initialStores = { ...valid.community.stores };
  const site = chooseBuildSite(valid.world, valid.community, valid.world.structures, valid.person);
  assert.ok(site, 'a reachable, open footprint in the kingdom should be accepted');
  let completed = null;
  for (let day = 0; day < 60 && !completed; day++) {
    valid.world.day++;
    workOnCommunityStructure(valid.world, valid.person, valid.community, 1);
    completed = valid.world.structures.find(structure => structure.type === 'curral'
      && structure.id !== 103 && structure.complete) || null;
  }
  assert.ok(completed, 'valid site should progress to a completed second pen');
  assert.equal(valid.community.stores.wood, initialStores.wood - 14);
  assert.equal(valid.community.stores.stone, initialStores.stone - 5);
  assert.equal(valid.world.structures.filter(structure => structure.type === 'curral' && structure.complete).length, 2);
});
