import test from 'node:test';
import assert from 'node:assert/strict';
import engine from '../src/simulation/engine.js';
import { moveOne } from '../src/simulation/individuals/movement.js';
import { createPersonSpatialIndex } from '../src/simulation/individuals/spatial-index.js';
import { hitboxesOverlap, npcHitbox } from '../src/simulation/physics/hitboxes.js';
import { cellAt } from '../src/simulation/world/spatial.js';

function soldier(id, unit, x, y, role = 'vanguard') {
  return {
    id, alive: true, role: 'soldier', kingdomId: 1, campaignId: 71,
    militaryUnitId: unit, tacticalRole: role, tacticalPhase: 'marching',
    commanderId: unit === 'a' ? 99101 : 99201,
    militaryRank: id === (unit === 'a' ? 99101 : 99201) ? 'comandante' : 'soldado',
    x, y, health: 100, stamina: 100, energy: 100, foodReserve: 40,
    hydration: 80, lastMilitaryAttackDay: -100
  };
}

function setup(seed = 311, count = 3) {
  const world = engine.createWorld(seed);
  for (const tile of world.tiles) {
    tile.terrain = 'rock';
    tile.kingdomId = 1;
    tile.slope = 0;
    tile.elevationLevel = 0;
    tile.rampSide = null; tile.rampLevel = 0;
    tile.stoneDeposit = 0; tile.goldOre = 0;
    tile.plants.fill(0);
  }
  for (let x = 24; x <= 49; x++) {
    const tile = cellAt(world, x, 40);
    tile.terrain = 'land'; tile.kingdomId = 1;
  }
  // Wide approaches on both ends, but only a one-tile stone crossing
  // from x=30 to x=41. No passing bays exist in the crossing itself.
  for (let x = 24; x <= 29; x++)
    for (let y = 38; y <= 42; y++) cellAt(world, x, y).terrain = 'land';
  for (let x = 42; x <= 49; x++)
    for (let y = 38; y <= 42; y++) cellAt(world, x, y).terrain = 'land';
  const a = [soldier(99101, 'a', 29, 40),
    soldier(99102, 'a', 28, 40), soldier(99103, 'a', 27, 40)].slice(0, count);
  const b = soldier(99201, 'b', 42, 40, 'support');
  world.day = 5;
  world.people = [...a, b];
  world.animals = [];
  world.structures = [];
  world.peopleSpatialIndex = createPersonSpatialIndex(world.people);
  world.navigationRevision = (world.navigationRevision || 0) + 1;
  world.tacticalCombat = { mode: 'hierarchical' };
  return { world, a, b };
}

function assertPhysical(world) {
  for (const person of world.people) {
    assert.equal(cellAt(world, person.x, person.y).terrain, 'land',
      'military movement stays on actual walkable ground');
  }
  for (let i = 0; i < world.people.length; i++) {
    for (let j = i + 1; j < world.people.length; j++) {
      assert.equal(hitboxesOverlap(npcHitbox(world.people[i]), npcHitbox(world.people[j])), false,
        'units cannot overlap while a corridor is reserved');
    }
  }
}

test('a corridor stays owned until the last member leaves, then the opposing squad may enter', () => {
  const { world, a, b } = setup();
  const east = cellAt(world, 48, 40);
  const west = cellAt(world, 24, 40);
  assert.equal(moveOne(world, a[0], east, false), true);
  assert.equal(a[0].x, 30);
  assert.equal(moveOne(world, b, west, false), false,
    'opposing commander may not enter an occupied corridor');
  assert.equal(b.x, 42);
  assert.equal(b.militaryCorridorWait.day, world.day);
  assert.equal(moveOne(world, a[1], east, false), true);
  assert.equal(moveOne(world, a[2], east, false), true);
  assertPhysical(world);

  let leaderExited = false;
  let finalExit = false;
  for (let i = 0; i < 28; i++) {
    world.day++;
    for (const member of a) moveOne(world, member, east, false);
    assertPhysical(world);
    if (a[0].x >= 42 && a[2].x < 42) {
      leaderExited = true;
      // The waiting squad may clear the exit into a safe side bay, but
      // cannot enter any of the one-file bridge cells while A still owns it.
      moveOne(world, b, west, false);
      assert.ok(b.x >= 42,
        'the opposing squad cannot take a bridge cell before the rear rank exits');
      assert.ok(!Object.values(world.militaryCorridorTraffic.corridors).every(claim => claim.empty),
        'leader exit alone never frees the whole unit ownership');
    }
    if (a[2].x >= 42) { finalExit = true; break; }
  }
  assert.equal(leaderExited, true, 'test must observe captain clearing before the rear rank');
  assert.equal(finalExit, true, 'the trailing soldier should actually clear the bridge');
  const claims = Object.values(world.militaryCorridorTraffic.corridors);
  assert.ok(claims.some(claim => claim.empty), 'ownership is released after the entire unit has crossed');
  let enteredFromOtherBank = false;
  for (let step = 0; step < 8; step++) {
    world.day++;
    // Last exit is not the end of the march. Clear the far staging tile
    // using real steps before the opposing unit enters the narrow segment.
    for (const member of a) moveOne(world, member, east, false);
    moveOne(world, b, west, false);
    assertPhysical(world);
    if (b.x <= 41) { enteredFromOtherBank = true; break; }
  }
  assert.equal(enteredFromOtherBank, true,
    'after the final exit, the waiting squad can physically enter the bridge');
});

test('abandoned corridor lease recovers without overriding the physical collision rules', () => {
  const { world, a, b } = setup(312, 2);
  const east = cellAt(world, 48, 40);
  assert.equal(moveOne(world, a[0], east, false), true);
  assert.equal(a[0].x, 30);
  assert.equal(moveOne(world, b, cellAt(world, 24, 40), false), false);
  // The captain aborts and retreats by a normal legal movement step.
  assert.equal(moveOne(world, a[0], cellAt(world, 29, 40), false), true);
  assert.equal(a[0].x, 29);
  assertPhysical(world);
  const claimed = Object.values(world.militaryCorridorTraffic.corridors);
  assert.equal(claimed.some(record => !record.empty), true,
    'the unit lock does not release just because its commander stepped backwards');
  world.day += 6;
  assert.equal(moveOne(world, b, cellAt(world, 24, 40), false), true,
    'a corridor with no occupants and no progress expires, allowing recovery');
  assert.equal(b.x, 41);
  assert.ok(world.militaryCorridorTraffic.recoveries >= 1);
  assertPhysical(world);
});

test('an actual incumbent inside the passage takes precedence over a new requester', () => {
  const { world, a, b } = setup(313, 1);
  a[0].x = 38;
  world.peopleSpatialIndex = createPersonSpatialIndex(world.people);
  const before = { ...b };
  assert.equal(moveOne(world, b, cellAt(world, 24, 40), false), false);
  assert.equal(b.x, before.x);
  assert.equal(b.militaryCorridorWait.ownerUnitId, 'a',
    'a unit already crossing cannot be displaced by a later entrant');
  assertPhysical(world);
});
