import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { workMineralDeposit } from '../src/simulation/economy/mining.js';
import { reduceInitialMineralSites } from '../src/simulation/world/mineral-distribution.js';
import { collectLoot, nearestLoot } from '../src/simulation/economy/loot.js';
import { MINERAL_SPRITE_KINDS, mineralDepositVariant } from '../src/ui/mineral-sprites.js';

function fixture(amount, kind = 'copper') {
  const tile = { i: 0, x: 0, y: 0, terrain: 'land', [kind + 'Ore']: amount };
  return { tile, world: { nextId: 1, day: 0, width: 1, height: 1, tiles: [tile], loot: [] } };
}

test('larger deposits require proportional work and release more finite fragments only when broken', () => {
  for (const amount of [2.5, 8, 60]) {
    const { world, tile } = fixture(amount);
    let work = 0;
    while (tile.copperOre > 0) {
      const result = workMineralDeposit(world, tile, 'copper', 3);
      assert.ok(result.worked > 0 && result.worked <= 3);
      work += result.worked;
      if (work < amount) assert.equal(world.loot.length, 0);
    }
    assert.equal(work, amount);
    assert.equal(world.loot.length, Math.ceil(amount));
    assert.equal(world.loot.reduce((sum, pile) => sum + pile.resources.copper, 0), amount);
    assert.equal(workMineralDeposit(world, tile, 'copper', 3).worked, 0);
    assert.equal(world.loot.length, Math.ceil(amount), 'depleted deposits cannot respawn fragments');
    const person = { alive: true, role: 'resident', x: 0, y: 0, foodReserve: 80 };
    assert.equal(collectLoot(world, person, world.loot[0]), Math.min(24, amount));
    assert.equal(person.carriedCopper, Math.min(24, amount));
    assert.equal(collectLoot(world, { ...person, role: 'soldier' }, world.loot[0]), 0);
    assert.equal(nearestLoot(world, { alive: true, role: 'soldier', x: 0, y: 0 }), null);
  }
});

test('initial gold and stone site counts halve again to a quarter, deterministically', () => {
  const make = () => ({ seed: 42, tiles: Array.from({ length: 17 }, (_, i) =>
    ({ i, x: i, y: 0, goldOre: 2, stoneDeposit: 5 })) });
  const first = make(), second = make();
  reduceInitialMineralSites(first); reduceInitialMineralSites(second);
  for (const field of ['goldOre', 'stoneDeposit']) assert.equal(first.tiles.filter(t => t[field] > 0).length, 4);
  assert.deepEqual(first, second);
});

test('every metal has its own six sprites and reserves variant one for ground fragments', () => {
  for (const kind of MINERAL_SPRITE_KINDS) {
    for (let variant = 1; variant <= 6; variant++)
      assert.ok(existsSync(new URL('../public/assets/tiny-swords/minerals/' + kind + '-stone-' + variant + '.png', import.meta.url)));
    assert.equal(mineralDepositVariant(kind, .1), 2);
    assert.equal(mineralDepositVariant(kind, 100), 6);
  }
});
