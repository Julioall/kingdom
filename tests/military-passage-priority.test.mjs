import test from 'node:test';
import assert from 'node:assert/strict';
import engine from '../src/simulation/engine.js';
import { militaryPassageYieldDecision } from '../src/simulation/individuals/military-passage.js';
import { moveOne } from '../src/simulation/individuals/movement.js';
import { createPersonSpatialIndex } from '../src/simulation/individuals/spatial-index.js';
import { hitboxesOverlap, npcHitbox } from '../src/simulation/physics/hitboxes.js';
import { cellAt } from '../src/simulation/world/spatial.js';

function soldier(id, unit, role, rank = 'soldado') {
  return {
    id, alive: true, role: 'soldier', kingdomId: 1, campaignId: 7,
    militaryUnitId: unit, commanderId: rank === 'comandante' ? id : 100,
    militaryRank: rank, tacticalRole: role, tacticalPhase: 'marching',
    x: 32, y: 40, health: 100, energy: 100, foodReserve: 40,
    hydration: 75, stamina: 100, lastMilitaryAttackDay: -100
  };
}

test('captains have the right of way within their own unit', () => {
  const commander = soldier(101, 'a', 'vanguard', 'comandante');
  const follower = soldier(102, 'a', 'vanguard');
  follower.commanderId = commander.id;
  assert.equal(militaryPassageYieldDecision(follower, commander), true);
  assert.equal(militaryPassageYieldDecision(commander, follower), false);
});

test('opposed unit priorities are stable, independent of update order', () => {
  const front = soldier(201, 'a', 'vanguard', 'comandante');
  const support = soldier(202, 'b', 'support', 'comandante');
  assert.equal(militaryPassageYieldDecision(support, front), true);
  assert.equal(militaryPassageYieldDecision(front, support), false);

  const wingA = soldier(203, 'a', 'flank-left');
  const wingB = soldier(204, 'b', 'flank-right');
  assert.equal(militaryPassageYieldDecision(wingB, wingA), true,
    'a stable unit ID breaks equal-role ties');
  assert.equal(militaryPassageYieldDecision(wingA, wingB), false);
  wingB.tacticalPhase = 'rout';
  assert.equal(militaryPassageYieldDecision(wingA, wingB), true,
    'withdrawal gets precedence over ordinary marching');
});

test('reserve, manual control and unrelated travelers cannot be displaced by the new rule', () => {
  const front = soldier(301, 'a', 'vanguard', 'comandante');
  const reserve = soldier(302, 'b', 'reserve');
  reserve.tacticalReserveHolding = true;
  assert.equal(militaryPassageYieldDecision(reserve, front), false);
  assert.equal(militaryPassageYieldDecision(front, reserve), false);
  const visitor = soldier(303, 'c', 'support');
  visitor.campaignId = 8;
  assert.equal(militaryPassageYieldDecision(front, visitor), null);
  visitor.campaignId = 7;
  visitor.tacticalRole = null;
  assert.equal(militaryPassageYieldDecision(front, visitor), null);
  front.playerControlled = true;
  assert.equal(militaryPassageYieldDecision(reserve, front), false);
});

test('different friendly squads use an actual passing bay and do not return into it the same day', () => {
  const world = engine.createWorld(224);
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
    const tile = cellAt(world, x, 40);
    tile.terrain = 'land';
    tile.kingdomId = 1;
  }
  // There is ONE real bay, so a follower can physically clear the corridor.
  const bay = cellAt(world, 33, 39);
  bay.terrain = 'land'; bay.kingdomId = 1;
  const vanguard = soldier(99021, 'unit-a', 'vanguard', 'comandante');
  const support = soldier(99022, 'unit-b', 'support', 'comandante');
  support.x = 33;
  world.day = 5;
  world.people = [vanguard, support];
  world.animals = [];
  world.structures = [];
  world.peopleSpatialIndex = createPersonSpatialIndex(world.people);
  world.navigationRevision = (world.navigationRevision || 0) + 1;
  world.tacticalCombat = { mode: 'hierarchical' };

  const advance = cellAt(world, 39, 40);
  assert.equal(moveOne(world, vanguard, advance, false), true);
  assert.equal(vanguard.x, 33, 'vanguard occupies the corridor cell after the other unit yields');
  assert.equal(vanguard.y, 40);
  assert.equal(support.x, bay.x);
  assert.equal(support.y, bay.y);
  assert.equal(support.passageYieldHoldDay, 5);
  assert.equal(hitboxesOverlap(npcHitbox(vanguard), npcHitbox(support)), false);
  assert.equal(moveOne(world, support, advance, false), false,
    'yielding soldier cannot immediately reoccupy the same corridor on that day');
  assert.equal(support.y, bay.y);
  world.day++;
  assert.equal(moveOne(world, support, advance, false), true,
    'temporary passage hold expires on the next day');
  assert.equal(hitboxesOverlap(npcHitbox(vanguard), npcHitbox(support)), false);
});
