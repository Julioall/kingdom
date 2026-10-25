import { performFrontierWork } from '../../src/simulation/kingdoms/frontier-conflicts.js';
import { recomputeKingdomTerritories } from '../../src/simulation/kingdoms/territories.js';
import { recordKingdomFrontierOutcomes } from '../../src/simulation/kingdoms/frontier.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../../src/simulation/engine.js';
import { patrolSoldier } from '../../src/simulation/kingdoms/patrols.js';
import { advanceKingdomProjects } from '../../src/simulation/kingdoms/projects.js';

test('kingdoms fund a frontier post only on neutral land and assign an existing guard', () => {
  const world = Sim.createWorld(42);
  const kingdom = world.kingdoms[0];
  Sim.tick(world, 30);
  // Keep this test focused on frontier funding rather than the precise treasury drift of a map size.
  kingdom.treasury.stock.wood += 1;
  assert.equal(world.structures.some(item => item.frontierOutpost), false,
    'the ruler waits for the first monthly treasury review');
  const treasuryBefore = { ...kingdom.treasury.stock };
  const territoryBefore = kingdom.territoryTileCount;

  Sim.tick(world, 1);

  const outpost = world.structures.find(item => item.kingdomId === kingdom.id && item.frontierOutpost);
  assert.ok(outpost, 'the ruler starts a funded frontier project');
  assert.equal(outpost.complete, false);
  assert.deepEqual({
    wood: treasuryBefore.wood - kingdom.treasury.stock.wood,
    stone: treasuryBefore.stone - kingdom.treasury.stock.stone,
    gold: treasuryBefore.gold - kingdom.treasury.stock.gold
  }, { wood: 10, stone: 4, gold: 2 });
  assert.equal(world.tiles.find(tile => tile.x === outpost.x && tile.y === outpost.y).kingdomId, null,
    'the project does not claim territory before completion');

  // Frontier projects require workers to arrive before their eight work days begin.
  const builders = outpost.workerIds.map(id => world.people.find(p => p.id === id));
  for (const builder of builders) { builder.x = outpost.x; builder.y = outpost.y; }
  for (let day = 32; day <= 39; day++) {
    world.day = day - 1;
    for (const builder of builders) performFrontierWork(world, builder, { project: outpost });
    advanceKingdomProjects(world, day);
  }
  recomputeKingdomTerritories(world);
  recordKingdomFrontierOutcomes(world, 39);

  assert.equal(outpost.complete, true);
  assert.ok(kingdom.territoryTileCount > territoryBefore, 'territory changes only after the paid post is complete');
  const guard = world.people.find(person => person.id === outpost.garrisonSoldierId);
  assert.ok(guard && guard.alive && guard.role === 'soldier');
  assert.equal(guard.militaryDutyPostId, outpost.id);
  assert.equal(kingdom.frontierExpansion.lastOutcome.status, 'completed');
  assert.ok(kingdom.frontierExpansion.lastOutcome.territoryTilesGained > 0);

  guard.x = outpost.x; guard.y = outpost.y;
  patrolSoldier(world, guard);
  assert.ok(guard.patrolRoute.length >= 2, 'the new post generates a patrol route');
  assert.ok(guard.patrolRoute.every(index => world.tiles[index].kingdomId === kingdom.id),
    'the patrol route remains inside the kingdom');
}
);

test('frontier expansion waits when reserves or neutral land are unavailable', () => {
  const world = Sim.createWorld(42);
  const kingdom = world.kingdoms[0];
  for (const item of world.kingdoms) item.treasury.stock.wood = 37;

  Sim.modules.KingdomFrontier.update(world, 31);

  assert.equal(world.structures.filter(item => item.kingdomId === kingdom.id && item.frontierOutpost).length, 0);
  assert.equal(kingdom.frontierExpansion.status, 'awaiting-resources');

  kingdom.frontierExpansion.nextDecisionDay = 61;
  for (const item of world.kingdoms) item.treasury.stock.wood = 100;
  for (const tile of world.tiles) if (tile.terrain === 'land') tile.kingdomId = kingdom.id;

  Sim.modules.KingdomFrontier.update(world, 61);

  assert.equal(world.structures.filter(item => item.kingdomId === kingdom.id && item.frontierOutpost).length, 0);
  assert.equal(kingdom.frontierExpansion.status, 'no-neutral-site');
});

test('an active war pauses autonomous frontier investment', () => {
  const world = Sim.createWorld(42);
  const kingdom = world.kingdoms[0];
  world.wars.push({ a: kingdom.id, b: world.kingdoms[1].id, attackerId: kingdom.id,
    defenderId: world.kingdoms[1].id, status: 'active' });

  Sim.modules.KingdomFrontier.update(world, 31);

  assert.equal(world.structures.filter(item => item.frontierOutpost).length, 0);
  assert.equal(kingdom.frontierExpansion.status, 'paused-war');
});

test('a collapsed completed frontier post does not restart construction for free', () => {
  const world = Sim.createWorld(42);
  Sim.modules.KingdomFrontier.update(world, 31);
  const outpost = world.structures.find(item => item.frontierOutpost);
  outpost.complete = true; outpost.progress = outpost.required; outpost.builtDay = 39;
  const builtDay = outpost.builtDay;
  outpost.complete = false;
  outpost.integrity = 0;

  advanceKingdomProjects(world, world.day + 1);

  assert.equal(outpost.complete, false);
  assert.equal(outpost.progress, outpost.required);
  assert.equal(outpost.builtDay, builtDay);
});
