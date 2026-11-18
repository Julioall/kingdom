import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../src/simulation/engine.js';
import { cellAt } from '../src/simulation/world/spatial.js';
import { reachableAreaAround } from '../src/simulation/individuals/movement.js';
import { chooseBuildSite, communityStructures }
  from '../src/simulation/settlements/construction.js';

function makePassageWorld() {
  const world = Sim.createWorld(42);
  world.structures = []; world.animals = []; world.people = [];
  for (const tile of world.tiles) {
    tile.terrain = 'rock'; tile.kingdomId = null;
    tile.slope = 0; tile.elevationLevel = 0; tile.rampLevel = 0;
    tile.stoneDeposit = 0; tile.goldOre = 0; tile.plants.fill(0);
  }
  for (let y = 59; y <= 61; y++) for (let x = 59; x <= 61; x++)
    cellAt(world, x, y).terrain = 'land';
  return world;
}

test('reachableAreaAround preserves row-major start and the exact eight-neighbor BFS order', () => {
  const world = makePassageWorld(), agent = {
    id: 999999, x: 60, y: 60, alive: true, role: 'resident',
    kingdomId: null, communityId: null
  };
  const a = reachableAreaAround(world, agent, agent, 2.1);
  const coordinates = a.map(tile => [tile.x, tile.y]);
  assert.deepEqual(coordinates, [
    [60, 60],
    [59, 59], [60, 59], [61, 59],
    [59, 60], [61, 60],
    [59, 61], [60, 61], [61, 61]
  ]);
  const b = reachableAreaAround(world, agent, agent, 2.1);
  assert.deepEqual(b.map(tile => tile.i), a.map(tile => tile.i));
  assert.equal(new Set(a.map(tile => tile.i)).size, a.length);
});

test('reachableAreaAround excludes obstacles and uses an independent scratch grid each call', () => {
  const world = makePassageWorld(), agent = {
    id: 999999, x: 60, y: 60, alive: true, role: 'resident',
    kingdomId: null, communityId: null
  };
  const before = reachableAreaAround(world, agent, agent, 1.1);
  assert.equal(before.length, 5);
  cellAt(world, 60, 59).terrain = 'rock';
  const after = reachableAreaAround(world, agent, agent, 1.1);
  assert.equal(after.length, 4);
  assert.ok(!after.some(tile => tile.x === 60 && tile.y === 59));
  assert.equal(before.length, 5, 'earlier result array stays independent');
});

test('fractional center preserves the original row-major tie-break fallback', () => {
  const world = makePassageWorld(), agent = {
    id: 999999, x: 60, y: 60, alive: true, role: 'resident',
    kingdomId: null, communityId: null
  };
  // Both 60,60 and 61,60 are equally close. The former appears first
  // in the row-major scan; using Math.round would incorrectly choose 61.
  const reached = reachableAreaAround(world, agent, {x: 60.5, y: 60}, 2.1);
  assert.deepEqual([reached[0].x, reached[0].y], [60, 60]);
});

test('blocked integer center falls back to the closest passable neighbor', () => {
  const world = makePassageWorld(), agent = {
    id: 999999, x: 60, y: 60, alive: true, role: 'resident',
    kingdomId: null, communityId: null
  };
  cellAt(world, 60, 60).terrain = 'rock';
  const reached = reachableAreaAround(world, agent, agent, 2.1);
  assert.deepEqual([reached[0].x, reached[0].y], [60, 59]);
  assert.ok(!reached.some(tile => tile.x === 60 && tile.y === 60));
});

test('site-selection score pruning preserves ID reservation and valid builder workpoints', () => {
  const w = Sim.createWorld(42), community = w.communities[0];
  const builder = w.people.find(person => person.alive && person.communityId === community.id);
  assert.ok(builder, 'community builder fixture exists');
  const idBefore = w.nextId;
  const chosen = chooseBuildSite(w, community, communityStructures(w, community), builder);
  assert.equal(w.nextId, idBefore + (chosen ? 1 : 0));
  if (chosen) {
    assert.equal(chosen.kingdomId, community.kingdomId);
    assert.equal(chosen.communityId, community.id);
    assert.equal(chosen.complete, false);
    assert.ok(Array.isArray(chosen.workPositions));
    assert.equal(chosen.workPositions.length, 2);
  }
});
