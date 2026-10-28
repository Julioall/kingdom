import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/simulation/world/generation.js';
import { gatherMaterials } from '../src/simulation/individuals/actions.js';
import { carriedResources, moveCarriedResource } from '../src/simulation/economy/inventories.js';
import { mineralHitbox } from '../src/simulation/physics/hitboxes.js';
import { resourceSummary } from '../src/ui/gameplay-data.js';
import {
  COIN_VALUE_COPPER, COIN_TYPES, METAL_TYPES,
  currencyValueCopper, copperToCoinBreakdown, goldValueInCopper
} from '../src/simulation/economy/currency-denominations.js';

test('the monetary metal hierarchy uses exact ten-to-one denomination values', () => {
  assert.deepEqual(COIN_VALUE_COPPER, { copper: 1, silver: 10, gold: 100 });
  assert.deepEqual(COIN_TYPES, ['copper', 'silver', 'gold']);
  assert.deepEqual(METAL_TYPES, ['copper', 'silver', 'gold', 'iron']);
  assert.equal(currencyValueCopper({ copper: 100 }), 100);
  assert.equal(currencyValueCopper({ silver: 10 }), 100);
  assert.equal(currencyValueCopper({ gold: 1 }), 100);
  const unchanged = { gold: 2, silver: 3, copper: 4, iron: 99 };
  assert.equal(currencyValueCopper(unchanged), 234);
  assert.deepEqual(unchanged, { gold: 2, silver: 3, copper: 4, iron: 99 },
    'valuation is read-only and never mints or spends currency');
  assert.deepEqual(copperToCoinBreakdown(234), { gold: 2, silver: 3, copper: 4 });
  assert.equal(currencyValueCopper(copperToCoinBreakdown(234)), 234);
  assert.deepEqual(copperToCoinBreakdown(0), { gold: 0, silver: 0, copper: 0 });
  assert.equal(copperToCoinBreakdown(-1), null);
  assert.equal(copperToCoinBreakdown(.5), null);
  assert.equal(currencyValueCopper({ silver: -1 }), null);
  assert.equal(currencyValueCopper({ copper: Infinity }), null);
  assert.equal(goldValueInCopper(.4), 40);
  assert.equal(goldValueInCopper(-1), null);
});

test('seeded terrain creates finite separate copper, silver and iron deposits without replacing gold', () => {
  const seed = 42;
  const first = createWorld(seed);
  const second = createWorld(seed);
  for (const field of ['goldOre', 'copperOre', 'silverOre', 'ironOre']) {
    const present = first.tiles.filter(tile => tile[field] > .05);
    assert.ok(present.length > 0, field + ' must actually exist in the island');
    assert.ok(present.every(tile => tile.terrain === 'land'));
    const projection = world => world.tiles.map(tile => tile[field]);
    assert.deepEqual(projection(first), projection(second),
      field + ' remains deterministic for the same seed');
  }
  assert.ok(first.communities.every(c => c.stores.copper === 0
    && c.stores.silver === 0 && c.stores.iron === 0),
  'new mineral stocks begin empty rather than being issued for free');
});

test('each ore moves exactly once from finite deposit to carried cargo to community stock', () => {
  const world = createWorld(42);
  const community = world.communities[0];
  for (const metal of ['copper', 'silver', 'iron']) {
    const field = metal + 'Ore';
    const carried = 'carried' + metal[0].toUpperCase() + metal.slice(1);
    const tile = world.tiles.find(t => t[field] >= 1 && t.terrain === 'land');
    assert.ok(tile, metal + ' should have a mineable tile');
    const oreBefore = tile[field], stockBefore = community.stores[metal] || 0;
    const person = {
      x: tile.x, y: tile.y, name: 'Mineiro',
      skills: { gather: .5 }, energy: 90, hydration: 90,
      carriedFood: 0, carriedFruit: 0, carriedMeat: 0, carriedMaterial: 0,
      carriedWood: 0, carriedStone: 0, carriedFeed: 0, carriedGold: 0,
      carriedCopper: 0, carriedSilver: 0, carriedIron: 0,
      perception: { resources: [{
        x: tile.x, y: tile.y, terrain: 'land', visible: true, distance: 0,
        stone: 0, goldOre: 0, copperOre: metal === 'copper' ? tile.copperOre : 0,
        silverOre: metal === 'silver' ? tile.silverOre : 0,
        ironOre: metal === 'iron' ? tile.ironOre : 0, biomass: {}
      }] }
    };
    const hitbox = mineralHitbox(tile);
    assert.ok(hitbox, metal + ' must create a mining collision hitbox');
    const gathered = gatherMaterials(world, person, null);
    assert.ok(gathered > .01 && gathered <= oreBefore, metal + ' is physically mined');
    assert.ok(Math.abs(tile[field] + person[carried] - oreBefore) < 1e-7,
      metal + ' deposit-to-cargo conservation');
    assert.ok(carriedResources(person) >= gathered - 1e-7);
    const delivered = moveCarriedResource(person, carried, community, metal, gathered);
    assert.ok(Math.abs(delivered - gathered) < 1e-7);
    assert.equal(person[carried], 0);
    assert.ok(Math.abs(tile[field] + community.stores[metal] - oreBefore - stockBefore) < 1e-7,
      metal + ' deposit-to-stock conservation');
  }
  const kingdom = world.kingdoms.find(k => k.communityId === community.id);
  const summary = resourceSummary(world, kingdom.id);
  assert.ok(summary.copper > 0 && summary.silver > 0 && summary.iron > 0,
    'the account summary exposes all three different assets');
  assert.equal(summary.nominalCopper, summary.gold * 100 + summary.silver * 10 + summary.copper);
});
