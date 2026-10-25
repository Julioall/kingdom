import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../../src/simulation/engine.js';
import { applyWorldSnapshot, createWorldSnapshot } from '../../src/simulation/render-snapshot.js';
import { canTraverseElevation, generateIslandTerrain } from '../../src/simulation/world/island-terrain.js';
import { moveOne } from '../../src/simulation/individuals/movement.js';
import Perception from '../../src/simulation/individuals/perception.js';
import { drinkWater } from '../../src/simulation/ecology/hydrology.js';

test('the Greenland-shaped continent and its elevation layers reproduce for a seed', () => {
  const a = generateIslandTerrain(Sim.width, Sim.height, 42);
  const b = generateIslandTerrain(Sim.width, Sim.height, 42);
  assert.deepEqual(Array.from(a.waterKind), Array.from(b.waterKind));
  assert.deepEqual(Array.from(a.elevationLevel), Array.from(b.elevationLevel));
  assert.deepEqual(Array.from(a.autoTileVariant), Array.from(b.autoTileVariant));
  assert.deepEqual(a.ramps, b.ramps);

  const land = Array.from(a.waterKind).filter(kind => !kind).length;
  assert.ok(land > Sim.width * Sim.height * .35 && land < Sim.width * Sim.height * .44,
    'the continent keeps a broad land area and an ocean border');
  const landTiles = Array.from(a.waterKind, (kind, i) => kind ? null : i).filter(index => index !== null);
  const xs = landTiles.map(index => index % Sim.width), ys = landTiles.map(index => Math.floor(index / Sim.width));
  const landWidth = Math.max(...xs) - Math.min(...xs) + 1, landHeight = Math.max(...ys) - Math.min(...ys) + 1;
  assert.ok(landHeight > landWidth * 1.5, 'the landmass is elongated from north to south');
  assert.ok(Array.from(a.waterKind).includes('ocean'));
  assert.ok(Array.from(a.waterKind).includes('lake'));
  assert.ok(Array.from(a.elevationLevel).includes(1));
  assert.ok(!Array.from(a.elevationLevel).includes(2), 'the configured hill is one raised layer');
  assert.ok(Array.from(a.elevationLevel).filter(level => level === 1).length < land * .06,
    'only a small part of the island is elevated');
  assert.ok(a.ramps.some(ramp => ramp.targetLevel === 1));
  assert.ok(a.ramps.length <= 5, 'the single plateau has only a few access ramps');
});

test('the continent, kingdom starts, and initial structures remain connected across seeds', () => {
  for (const seed of [42, 77, 2468, 8675309]) {
    const world = Sim.createWorld(seed);
    const coast = generateIslandTerrain(world.width, world.height, seed);
    const coastSeen = new Uint8Array(world.tiles.length), coastQueue = [coast.waterKind.findIndex(kind => !kind)];
    coastSeen[coastQueue[0]] = 1;
    for (let head = 0; head < coastQueue.length; head++) {
      const index = coastQueue[head], x = index % world.width, y = Math.floor(index / world.width);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, next = ny * world.width + nx;
        if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height || coastSeen[next] || coast.waterKind[next]) continue;
        coastSeen[next] = 1; coastQueue.push(next);
      }
    }
    assert.equal(coastQueue.length, world.tiles.filter(tile => tile.terrain === 'land').length,
      'the main landmass has no disconnected land fragments');
    for (const kingdom of world.kingdoms) {
      const start = world.tiles[kingdom.y * world.width + kingdom.x];
      assert.equal(start.terrain, 'land');
      assert.equal(start.elevationLevel, 0, 'kingdom starts stay below the hill');
      const castle = world.structures.find(structure => structure.type === 'castelo' && structure.kingdomId === kingdom.id);
      const seen = new Uint8Array(world.tiles.length), queue = [castle.y * world.width + castle.x];
      seen[queue[0]] = 1;
      for (let head = 0; head < queue.length; head++) {
        const tile = world.tiles[queue[head]];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const x = tile.x + dx, y = tile.y + dy;
          if (x < 0 || y < 0 || x >= world.width || y >= world.height) continue;
          const next = world.tiles[y * world.width + x];
          if (seen[next.i] || next.terrain === 'water') continue;
          if (!canMoveBetween(tile, next, world)) continue;
          seen[next.i] = 1; queue.push(next.i);
        }
      }
      const structures = world.structures.filter(structure => structure.kingdomId === kingdom.id);
      for (const structure of structures) {
        const tile = world.tiles[Math.round(structure.y) * world.width + Math.round(structure.x)];
        assert.equal(tile.terrain, 'land', structure.type + ' is placed on land');
        assert.ok(seen[tile.i], structure.type + ' can be reached from its castle using ramps');
      }
    }
  }
});

test('movement cannot cross an elevation edge without a ramp and can use the marked ramp both ways', () => {
  const world = makeStepWorld();
  const agent = { x: 47, y: 48, energy: 100, travelCost: 0, communityId: null };
  assert.equal(moveOne(world, agent, { x: 48, y: 48 }, false), false);
  assert.deepEqual([agent.x, agent.y], [47, 48]);

  const lower = world.tiles[48 * world.width + 47];
  lower.rampSide = 1; lower.rampLevel = 1; lower.rampSegment = 1;
  const lowerRampFoot = world.tiles[49 * world.width + 47];
  lowerRampFoot.rampSide = 1; lowerRampFoot.rampLevel = 1; lowerRampFoot.rampSegment = 2;
  assert.equal(moveOne(world, agent, { x: 48, y: 48 }, false), true);
  assert.deepEqual([agent.x, agent.y], [48, 48]);
  assert.equal(moveOne(world, agent, { x: 47, y: 48 }, false), true);
  assert.deepEqual([agent.x, agent.y], [47, 48]);
});

test('a blocked straight route does not oscillate between the same two tiles', () => {
  const world = makeStepWorld();
  for (const tile of world.tiles) { tile.elevationLevel = 0; tile.heightM = 80; }
  const agent = { x: 72, y: 62, energy: 100, travelCost: 0, communityId: null };
  const target = { x: 72, y: 58 };
  const movementOptions = { allowedTile: tile => !(tile.y === 61 && tile.x >= 71 && tile.x <= 73) };
  for (let day = 0; day < 12 && Math.hypot(agent.x - target.x, agent.y - target.y) > 1.5; day++) {
    assert.equal(moveOne(world, agent, target, false, movementOptions), true);
  }
  assert.ok(Math.hypot(agent.x - target.x, agent.y - target.y) <= 1.5,
    'the route finder should continue around a barrier instead of stepping back to the previous tile');
});

test('ocean water is perceived, retained as a source, and restores hydration', () => {
  const world = Sim.createWorld(42);
  const shore = world.tiles.find(tile => tile.terrain === 'land' && [
    world.tiles[tile.y * world.width + tile.x - 1], world.tiles[tile.y * world.width + tile.x + 1],
    world.tiles[(tile.y - 1) * world.width + tile.x], world.tiles[(tile.y + 1) * world.width + tile.x]
  ].some(neighbor => neighbor?.waterKind === 'ocean'));
  assert.ok(shore, 'there is a walkable coast beside the ocean');
  const observer = { id: -1, x: shore.x, y: shore.y, headingX: 1, headingY: 0,
    sensoryMemory: { actors: {}, water: [], logs: {} } };
  const perception = Perception.observe(world, observer, 'person', Sim.plants);
  assert.ok(perception.resources.some(resource => resource.waterSource === 'ocean'));
  assert.ok(perception.knownWater.some(point => point.source === 'ocean'));
  const ocean = world.tiles.find(tile => tile.waterKind === 'ocean');
  const drinker = { hydration: 12 };
  assert.equal(drinkWater(world, drinker, ocean, 28), true);
  assert.equal(drinker.hydration, 40);
});

test('render snapshots preserve elevation, ramp, palette, and ocean fields', () => {
  const world = Sim.createWorld(7);
  const view = applyWorldSnapshot(structuredClone(createWorldSnapshot(world)));
  const oceanIndex = world.tiles.findIndex(tile => tile.waterKind === 'ocean');
  const rampIndex = world.tiles.findIndex(tile => tile.rampSegment === 1);
  const summitIndex = world.tiles.findIndex(tile => tile.elevationLevel === 1);
  assert.equal(view.tiles[oceanIndex].waterKind, 'ocean');
  assert.equal(view.tiles[rampIndex].rampSegment, 1);
  assert.equal(view.tiles[rampIndex].rampLevel, world.tiles[rampIndex].rampLevel);
  assert.equal(view.tiles[rampIndex].rampSide, world.tiles[rampIndex].rampSide);
  assert.equal(view.tiles[summitIndex].elevationLevel, 1);
  assert.equal(view.tiles[summitIndex].autoTileVariant, world.tiles[summitIndex].autoTileVariant);
});

function canMoveBetween(from, to, world) {
  if (!canTraverseElevation(from, to)) return false;
  const dx = to.x - from.x, dy = to.y - from.y;
  if (!dx || !dy) return true;
  const horizontal = world.tiles[from.y * world.width + to.x];
  const vertical = world.tiles[to.y * world.width + from.x];
  return canTraverseElevation(from, horizontal) && canTraverseElevation(horizontal, to)
    && canTraverseElevation(from, vertical) && canTraverseElevation(vertical, to);
}

function makeStepWorld() {
  const width = Sim.width, height = Sim.height;
  const tiles = Array.from({ length: width * height }, (_, i) => {
    const x = i % width, y = Math.floor(i / width);
    return {
      i, x, y, terrain: 'land', elevationLevel: x < 48 ? 0 : 1, heightM: x < 48 ? 80 : 400,
      rampSide: 0, rampLevel: 0, rampSegment: 0, slope: 0, roadWear: 0, kingdomId: null,
      plants: new Float32Array(Sim.plants.length)
    };
  });
  return { width, height, tiles, structures: [], day: 0, kingdoms: [] };
}
