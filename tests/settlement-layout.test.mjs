import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/simulation/world/generation.js';
import { structureHitbox, hitboxesOverlap } from '../src/simulation/physics/hitboxes.js';
import { rearProjection, safeCorralFootprint } from '../src/simulation/kingdoms/rear-sites.js';
import { hasBuildingResourceClearance } from '../src/simulation/world/building-clearance.js';
import { relocateSettlementMinerals } from '../src/simulation/world/mineral-distribution.js';

test('starting settlements mirror homes, form a military triangle and an outer tower square', () => {
  for (const seed of [1, 42, 987, 2026]) {
    const world = createWorld(seed);
    for (const kingdom of world.kingdoms) {
      const buildings = world.structures.filter(s => s.kingdomId === kingdom.id);
      assert.ok(buildings.every(s => hasBuildingResourceClearance(world, s, s.radius || 2.5)),
        'buildings need lake-bank and mineral clearance');
      const homes = buildings.filter(s => s.type === 'casa');
      const military = buildings.filter(s => ['centro_militar', 'arquearia', 'monasterio'].includes(s.type));
      assert.equal(homes.length, 8);
      const left = homes.filter(s => s.x < kingdom.x), right = homes.filter(s => s.x > kingdom.x);
      assert.equal(left.length, 4); assert.equal(right.length, 4);
      for (const home of left) assert.ok(right.some(other =>
        other.x - kingdom.x === kingdom.x - home.x && other.y === home.y));
      const castle = buildings.find(s => s.type === 'castelo');
      assert.deepEqual({ x: castle.x, y: castle.y }, { x: kingdom.x, y: kingdom.y });
      const ruler = world.people.find(person => person.id === kingdom.rulerId);
      assert.ok(Math.hypot(ruler.x - castle.x, ruler.y - castle.y) <= Math.sqrt(32));
      assert.equal(military.length, 3);
      const archery = military.find(s => s.type === 'arquearia');
      const monastery = military.find(s => s.type === 'monasterio');
      const barracks = military.find(s => s.type === 'centro_militar');
      assert.equal(archery.y, monastery.y);
      assert.equal(kingdom.x - archery.x, monastery.x - kingdom.x);
      assert.equal(barracks.x, kingdom.x);
      assert.ok((barracks.y - archery.y) * kingdom.innerY > 0);
      assert.ok(military.every(s => (s.y - kingdom.y) * kingdom.innerY > 0));
      const towers = buildings.filter(s => s.type === 'torre');
      assert.equal(towers.length, 4);
      const outerRadius = Math.abs(towers[0].x - kingdom.x);
      assert.ok(outerRadius > Math.max(...homes.map(s => Math.abs(s.x - kingdom.x))));
      assert.equal(new Set(towers.map(s => s.x + ',' + s.y)).size, 4);
      for (const tower of towers) {
        assert.equal(Math.abs(tower.x - kingdom.x), outerRadius);
        assert.equal(Math.abs(tower.y - kingdom.y), outerRadius);
      }
      for (let i = 0; i < buildings.length; i++) {
        for (let j = i + 1; j < buildings.length; j++) {
          const a = structureHitbox(buildings[i]), b = structureHitbox(buildings[j]);
          if (a && b) assert.equal(hitboxesOverlap(a, b), false,
            buildings[i].type + ' overlaps ' + buildings[j].type + ' in seed ' + seed);
        }
      }
      const pen = buildings.find(s => s.type === 'curral');
      assert.ok(rearProjection(world, kingdom, pen) >= 6);
      assert.ok(safeCorralFootprint(world, world.tiles[pen.y * world.width + pen.x]));
    }
  }
});

test('relocating town deposits preserves every finite reserve and deposit count', () => {
  const width = 40, height = 40;
  const world = { seed: 42, width, height, structures: [{ x: 20, y: 20 }],
    tiles: Array.from({ length: width * height }, (_, i) => ({ i, x: i % width,
      y: Math.floor(i / width), terrain: 'land' })) };
  const fields = ['stoneDeposit', 'goldOre', 'silverOre', 'copperOre', 'ironOre'];
  fields.forEach((field, i) => { world.tiles[20 * width + 20][field] = 3.5 + i; });
  relocateSettlementMinerals(world);
  fields.forEach((field, i) => {
    const deposits = world.tiles.filter(tile => (tile[field] || 0) > 0);
    assert.equal(deposits.length, 1);
    assert.equal(deposits[0][field], 3.5 + i);
    assert.ok(Math.hypot(deposits[0].x - 20, deposits[0].y - 20) >= 10.5);
  });
});

test('future building sites respect lake banks and all five deposit types', () => {
  const world = { width: 40, height: 40,
    tiles: Array.from({ length: 1600 }, (_, i) => ({ x: i % 40, y: Math.floor(i / 40) })) };
  const site = { x: 20, y: 20 };
  world.tiles[20 * 40 + 26].waterKind = 'lake';
  assert.equal(hasBuildingResourceClearance(world, site), false);
  world.tiles[20 * 40 + 26].waterKind = null;
  for (const field of ['stoneDeposit', 'goldOre', 'silverOre', 'copperOre', 'ironOre']) {
    world.tiles[20 * 40 + 29][field] = 1;
    assert.equal(hasBuildingResourceClearance(world, site), false);
    world.tiles[20 * 40 + 29][field] = 0;
  }
  assert.equal(hasBuildingResourceClearance(world, site), true);
});
