import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../../src/simulation/engine.js';
import { spendInventory, transferInventory } from '../../src/simulation/economy/inventories.js';
import { moveOne } from '../../src/simulation/individuals/movement.js';

function movementWorld() {
  const width = 192, height = 192;
  return {
    width, height, seed: 1, structures: [],
    tiles: Array.from({ length: width * height }, (_, i) => ({
      i, x: i % width, y: Math.floor(i / width), terrain: 'land', slope: 0,
      plants: new Float32Array(7)
    }))
  };
}

function stateSummary(world) {
  return {
    snapshot: Sim.snapshot(world), rngState: world.rngState,
    kingdoms: world.kingdoms.map(kingdom => ({
      name: kingdom.name, rulerId: kingdom.rulerId, memberIds: kingdom.memberIds,
      homeIds: kingdom.homeIds, territoryTileCount: kingdom.territoryTileCount,
      treasury: kingdom.treasury.stock, market: kingdom.market
    })),
    people: world.people.map(person => [person.id, person.kingdomId, person.homeId, person.x, person.y, person.foodReserve, person.hydration]),
    structures: world.structures.map(structure => [structure.id, structure.kingdomId, structure.type, structure.x, structure.y, structure.cost])
  };
}

test('two starting kingdoms and ten simulation days reproduce for fixed seeds', () => {
  for (const seed of [1, 42, 987]) {
    const world = Sim.createWorld(seed);
    const replay = Sim.createWorld(seed);
    assert.equal(world.width, 192);
    assert.equal(world.height, 192);
    assert.equal(world.kingdoms.length, 2);
    assert.equal(world.tiles.length, 192 * 192);
    assert.equal(world.lakes.length, 4);
    assert.equal(world.kingdoms.reduce((sum, kingdom) => sum + kingdom.territoryTileCount, 0), world.tiles.length);
    for (const kingdom of world.kingdoms) {
      const residents = kingdom.memberIds.map(id => world.people.find(person => person.id === id)).filter(Boolean);
      const homes = kingdom.homeIds.map(id => world.structures.find(structure => structure.id === id));
      assert.equal(residents.length, 25);
      assert.equal(residents.filter(person => person.homeId !== null).length, residents.length);
      for (const child of residents.filter(person => person.ageDays < 12 * 365)) {
        const guardian = world.people.find(person => person.id === child.guardianId);
        assert.ok(guardian && guardian.alive && guardian.ageDays >= 12 * 365);
        assert.equal(guardian.kingdomId, child.kingdomId);
      }
      assert.ok(homes.every(home => home.type === 'casa' && home.complete));
      assert.ok(homes.reduce((sum, home) => sum + home.residentIds.length, 0) >= residents.length);
      assert.ok(world.people.some(person => person.id === kingdom.rulerId && person.role === 'ruler'));
      assert.ok(kingdom.structureIds.some(id => world.structures.find(structure => structure.id === id)?.type === 'castelo'));
      assert.ok(kingdom.structureIds.some(id => world.structures.find(structure => structure.id === id)?.type === 'mercado'));
    }
    assert.deepEqual(stateSummary(world), stateSummary(replay));
    for (let day = 0; day < 10; day++) {
      Sim.stepDay(world);
      Sim.stepDay(replay);
      assert.deepEqual(stateSummary(world), stateSummary(replay));
    }
  }
});

test('inventory spending is atomic and transfers conserve stock', () => {
  const treasury = { stock: { food: 10, wood: 4 } };
  const market = { stock: { food: 3, wood: 0 } };

  assert.equal(spendInventory(treasury, { food: 5, stone: 2 }), false);
  assert.deepEqual(treasury.stock, { food: 10, wood: 4 });
  assert.equal(spendInventory(treasury, { food: 4, wood: 2 }), true);
  assert.deepEqual(treasury.stock, { food: 6, wood: 2 });

  const moved = transferInventory(treasury, market, 'food', 9);
  assert.equal(moved, 6);
  assert.equal(treasury.stock.food, 0);
  assert.equal(market.stock.food, 9);
  assert.equal(transferInventory(treasury, market, 'food', -1), 0);
  assert.equal(treasury.stock.food + market.stock.food, 9);
});

test('movement cannot cut diagonally through tree or fence corners', () => {
  const forest = movementWorld();
  forest.tiles[1].plants[3] = 500;
  forest.tiles[forest.width].terrain = 'rock';
  const walker = { x: 0, y: 0, energy: 100, travelCost: 0, communityId: null };
  assert.equal(moveOne(forest, walker, { x: 1, y: 1 }, false), false);
  assert.deepEqual([walker.x, walker.y], [0, 0]);

  const fenced = movementWorld();
  fenced.structures.push({ id: 1, type: 'curral', complete: true, x: 2, y: 2, radius: 2, communityId: null });
  const entrant = { x: 1, y: 5, energy: 100, travelCost: 0, communityId: null };
  assert.equal(moveOne(fenced, entrant, { x: 2, y: 2 }, false), true);
  assert.deepEqual([entrant.x, entrant.y], [2, 5]);

  const leaver = { x: 2, y: 3, energy: 100, travelCost: 0, communityId: null };
  assert.equal(moveOne(fenced, leaver, { x: 5, y: 2 }, false), true);
  assert.deepEqual([leaver.x, leaver.y], [2, 4]);
  assert.equal(moveOne(fenced, leaver, { x: 5, y: 2 }, false), true);
  assert.deepEqual([leaver.x, leaver.y], [2, 5]);
});

test('initial households keep dependent residents cared for through day 253', () => {
  const world = Sim.createWorld(42);
  for (let day = 0; day < 253; day++) Sim.stepDay(world);

  assert.equal(world.kingdoms.length, 2);
  assert.equal(world.deathsByCause.starvation, 0);
  assert.equal(world.deathsByCause.dehydration, 0);
  for (const person of world.people.filter(person => person.alive && person.kingdomId !== null)) {
    const home = world.structures.find(structure => structure.id === person.homeId && structure.type === 'casa');
    assert.ok(home, person.name + ' ficou sem casa');
    assert.ok(home.residentIds.includes(person.id), person.name + ' não consta na ocupação da casa');
  }
});
