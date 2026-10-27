import test from 'node:test';
import assert from 'node:assert/strict';
import engine from '../src/simulation/engine.js';
import { corralGate, moveOne } from '../src/simulation/individuals/movement.js';
import { createPersonSpatialIndex } from '../src/simulation/individuals/spatial-index.js';
import { animalHitbox, hitboxesOverlap, npcHitbox } from '../src/simulation/physics/hitboxes.js';
import { cellAt } from '../src/simulation/world/spatial.js';

test('crowded passage requests cannot recurse indefinitely during movement', () => {
  const world = engine.createWorld(1);

  assert.doesNotThrow(() => {
    for (let day = 1; day <= 125; day++) engine.stepDay(world, { includeSnapshot: false });
  });
  assert.equal(world.day, 125);
});

function makeShepherdPassageWorld({ soldierFirst = true } = {}) {
  const world = engine.createWorld(222);
  const roadY = 40;
  for (const tile of world.tiles) {
    tile.terrain = 'rock';
    tile.kingdomId = 1;
    tile.slope = 0;
    tile.elevationLevel = 0;
    tile.rampSide = null;
    tile.rampLevel = 0;
    tile.stoneDeposit = 0;
    tile.goldOre = 0;
    tile.plants.fill(0);
  }
  for (let x = 29; x <= 40; x++) {
    const tile = cellAt(world, x, roadY);
    tile.terrain = 'land';
    tile.kingdomId = 1;
    tile.roadWear = 0;
  }
  // One passing bay lets the yielding unit step aside, then return to the
  // same route after the other traveler clears the single tile corridor.
  for (let x = 33; x <= 39; x++) cellAt(world, x, roadY - 1).terrain = 'land';

  const soldier = {
    id: 99001, alive: true, name: 'Guerreiro', role: 'soldier', ageDays: 28 * 365,
    x: soldierFirst ? 32 : 35, y: roadY, kingdomId: 1, communityId: 1, campaignId: 7,
    energy: 100, health: 100, foodReserve: 40, hydration: 70, lastMilitaryAttackDay: -99
  };
  const shepherd = {
    id: 99002, alive: true, name: 'Pastor', role: 'resident', ageDays: 30 * 365,
    x: soldierFirst ? 33 : 36, y: roadY, kingdomId: 1, communityId: 1,
    energy: 100, health: 100, foodReserve: 40, hydration: 70,
    leadingSheepId: 99003, leadingSheepPenId: 99004,
    assignment: { action: 'lead_sheep', expiresDay: 10 },
    brain: { lastAction: 'lead_sheep' }
  };
  const sheep = {
    id: 99003, alive: true, speciesId: 'sheep', ageDays: 500, massKg: 18,
    x: shepherd.x + .25, y: shepherd.y + .15, beingLedBy: shepherd.id,
    herdCommunityId: null, herdPenId: 99004, energy: 80
  };
  world.day = 5;
  world.people = [soldier, shepherd];
  world.peopleSpatialIndex = createPersonSpatialIndex(world.people);
  world.animals = [sheep];
  world.structures = [];
  world.navigationRevision = (world.navigationRevision || 0) + 1;
  return { world, soldier, shepherd, sheep, roadY };
}

function assertLedSheepFollowsWithoutOverlap(soldier, shepherd, sheep) {
  assert.equal(sheep.beingLedBy, shepherd.id);
  assert.ok(Math.abs(sheep.x - (shepherd.x + .25)) < 1e-9);
  assert.ok(Math.abs(sheep.y - (shepherd.y + .15)) < 1e-9);
  assert.equal(hitboxesOverlap(npcHitbox(soldier), npcHitbox(shepherd)), false,
    'the two people must not overlap while passing');
  assert.equal(hitboxesOverlap(npcHitbox(soldier), animalHitbox(sheep)), false,
    'the sheep must not overlap the soldier');
  assert.equal(hitboxesOverlap(npcHitbox(shepherd), animalHitbox(sheep)), false,
    'the moving pair keeps its authored spacing');
}

test('soldier can pass a sheep-led pawn in a narrow route and the pawn resumes delivery', () => {
  const { world, soldier, shepherd, sheep, roadY } = makeShepherdPassageWorld();
  const soldierTarget = cellAt(world, 38, roadY);
  const shepherdTarget = cellAt(world, 39, roadY);
  let soldierSteps = 0;
  let shepherdSteps = 0;

  while (soldier.x < soldierTarget.x && soldierSteps < 12) {
    const from = { x: soldier.x, y: soldier.y };
    assert.equal(moveOne(world, soldier, soldierTarget, false), true,
      `soldier should keep moving after step ${soldierSteps}`);
    assert.ok(Math.hypot(soldier.x - from.x, soldier.y - from.y) <= Math.SQRT2,
      'passage handoff must not teleport the soldier');
    assertLedSheepFollowsWithoutOverlap(soldier, shepherd, sheep);
    soldierSteps++;
  }

  assert.equal(soldier.x, soldierTarget.x, 'soldier must clear the shared corridor');
  assert.ok(soldierSteps < 12, 'the soldier must not stall or oscillate');
  while (Math.hypot(shepherd.x - shepherdTarget.x, shepherd.y - shepherdTarget.y) > 1.4 && shepherdSteps < 12) {
    const from = { x: shepherd.x, y: shepherd.y };
    assert.equal(moveOne(world, shepherd, shepherdTarget, false), true,
      'shepherd must be able to resume the suspended route');
    assert.ok(Math.hypot(shepherd.x - from.x, shepherd.y - from.y) <= Math.SQRT2,
      'the resumed group must not teleport');
    assertLedSheepFollowsWithoutOverlap(soldier, shepherd, sheep);
    shepherdSteps++;
  }
  assert.ok(shepherdSteps > 0 && shepherdSteps < 12, 'shepherd must resume without oscillating');
});

test('a sheep-led pawn can clear the corridor when a campaigning soldier blocks it', () => {
  const { world, soldier, shepherd, sheep, roadY } = makeShepherdPassageWorld({ soldierFirst: false });
  const shepherdTarget = cellAt(world, 31, roadY);
  const soldierTarget = cellAt(world, 40, roadY);
  let shepherdSteps = 0;
  let soldierSteps = 0;
  const shepherdTrail = new Set();
  const soldierTrail = new Set();

  while (shepherd.x > shepherdTarget.x && shepherdSteps < 12) {
    const from = { x: shepherd.x, y: shepherd.y };
    shepherdTrail.add(`${from.x},${from.y}`);
    assert.equal(moveOne(world, shepherd, shepherdTarget, false), true,
      `sheep-led pawn should continue after step ${shepherdSteps}`);
    assert.ok(Math.hypot(shepherd.x - from.x, shepherd.y - from.y) <= Math.SQRT2,
      'shepherd movement must not teleport');
    assert.equal(shepherdTrail.has(`${shepherd.x},${shepherd.y}`), false,
      'shepherd route must not oscillate over an earlier position');
    assertLedSheepFollowsWithoutOverlap(soldier, shepherd, sheep);
    shepherdSteps++;
  }
  assert.equal(shepherd.x, shepherdTarget.x, 'shepherd must pass the soldier');
  assert.ok(shepherdSteps < 12, 'the shepherd must not stall or oscillate');

  while (soldier.x < soldierTarget.x && soldierSteps < 12) {
    const from = { x: soldier.x, y: soldier.y };
    soldierTrail.add(`${from.x},${from.y}`);
    assert.equal(moveOne(world, soldier, soldierTarget, false), true,
      `campaigning soldier must resume its route after yielding from ${from.x},${from.y}; shepherd at ${shepherd.x},${shepherd.y}`);
    assert.ok(Math.hypot(soldier.x - from.x, soldier.y - from.y) <= Math.SQRT2,
      'the soldier must not teleport while resuming');
    assert.equal(soldierTrail.has(`${soldier.x},${soldier.y}`), false,
      'soldier route must not oscillate over an earlier position');
    assert.equal(soldier.campaignId, 7, 'yielding temporarily must preserve the campaign assignment');
    assert.equal(shepherd.assignment.action, 'lead_sheep', 'yielding temporarily must preserve the delivery assignment');
    assertLedSheepFollowsWithoutOverlap(soldier, shepherd, sheep);
    soldierSteps++;
  }
  assert.equal(soldier.x, soldierTarget.x);
  assert.ok(soldierSteps < 12);
});

test('movement keeps using the corral gate when a later tile on the route is blocked', () => {
  const world = engine.createWorld(223);
  for (const tile of world.tiles) {
    tile.terrain = 'rock';
    tile.kingdomId = 1;
    tile.slope = 0;
    tile.elevationLevel = 0;
    tile.stoneDeposit = 0;
    tile.goldOre = 0;
    tile.plants.fill(0);
  }
  for (const [x, y] of [[35, 39], [35, 40], [35, 41], [35, 42], [35, 43],
    [36, 43], [36, 44], [36, 45]]) {
    const tile = cellAt(world, x, y);
    tile.terrain = 'land';
    tile.kingdomId = 1;
  }
  const person = { id: 99010, alive: true, role: 'resident', ageDays: 30 * 365,
    x: 35, y: 39, kingdomId: 1, communityId: 1, energy: 100, health: 100,
    foodReserve: 40, hydration: 70 };
  const pen = { id: 99011, type: 'curral', x: 35, y: 40, radius: 2,
    communityId: 1, kingdomId: 1, complete: true, integrity: 1 };
  world.people = [person];
  world.peopleSpatialIndex = createPersonSpatialIndex(world.people);
  world.animals = [];
  world.structures = [pen];
  world.navigationRevision = (world.navigationRevision || 0) + 1;
  const gate = corralGate(world, pen);
  assert.deepEqual({ x: gate.x, y: gate.y }, { x: 35, y: 42 }, 'the south center remains the open gate');

  const target = cellAt(world, 36, 45);
  let moves = 0;
  while ((person.x !== target.x || person.y !== target.y) && moves < 12) {
    assert.equal(moveOne(world, person, target, false), true, 'the route should move through the gate and around the blockage');
    moves++;
  }
  assert.deepEqual({ x: person.x, y: person.y }, { x: target.x, y: target.y });
  assert.ok(moves < 12, 'the partially blocked path must not produce a permanent stall');
});
