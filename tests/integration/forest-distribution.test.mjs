import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../../src/simulation/engine.js';
import { PLANTS } from '../../src/config/ecosystem.js';
import { hash01, spatialNoise } from '../../src/simulation/core/math.js';
import { gatherMaterials } from '../../src/simulation/individuals/actions.js';
import { collectLoot } from '../../src/simulation/economy/loot.js';

test('starting forests form same-species groves and include substantial conifer stands', () => {
  const broadleafIndex = PLANTS.findIndex(plant => plant.id === 'broadleaf');
  const coniferIndex = PLANTS.findIndex(plant => plant.id === 'conifer');

  for (const seed of [1, 2, 42]) {
    const world = Sim.createWorld(seed);
    let broadleaf = 0, conifer = 0, treesWithNearbySameSpecies = 0, total = 0;
    const treeAnchors = world.tiles.filter(tile => Sim.modules.Biosphere.Botany.isTreeAnchor(world, tile));
    const treeAnchorIndices = new Set(treeAnchors.map(tile => tile.i));
    let centralTrees = 0, centralLand = 0, edgeTrees = 0, edgeLand = 0;
    const anchorsInGroves = treeAnchors.filter(tile => treeAnchors.some(other => other !== tile
      && Math.max(Math.abs(other.x - tile.x), Math.abs(other.y - tile.y)) <= 3));

    for (const tile of world.tiles) {
      const edgeDistance = Math.hypot((tile.x - (world.width - 1) / 2) / (world.width / 2),
        (tile.y - (world.height - 1) / 2) / (world.height / 2));
      if (tile.terrain === 'land' && edgeDistance < .35) {
        centralLand++;
        if (treeAnchorIndices.has(tile.i)) centralTrees++;
      }
      if (tile.terrain === 'land' && edgeDistance > .7) {
        edgeLand++;
        if (treeAnchorIndices.has(tile.i)) edgeTrees++;
      }
      const broadleafMass = tile.plants[broadleafIndex], coniferMass = tile.plants[coniferIndex];
      if (Math.max(broadleafMass, coniferMass) < 150) continue;
      total++;
      const type = broadleafMass >= coniferMass ? 'broadleaf' : 'conifer';
      if (type === 'broadleaf') broadleaf++;
      else conifer++;

      let nearbySameSpecies = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = tile.x + dx, y = tile.y + dy;
        if ((!dx && !dy) || x < 0 || x >= world.width || y < 0 || y >= world.height) continue;
        const neighbor = world.tiles[y * world.width + x];
        if (Math.max(neighbor.plants[broadleafIndex], neighbor.plants[coniferIndex]) < 150) continue;
        const neighborType = neighbor.plants[broadleafIndex] >= neighbor.plants[coniferIndex]
          ? 'broadleaf' : 'conifer';
        if (neighborType === type) nearbySameSpecies = true;
      }
      if (nearbySameSpecies) treesWithNearbySameSpecies++;
    }

    assert.ok(total > 350, `seed ${seed} should retain substantial forest coverage`);
    assert.ok(conifer / total >= .3 && conifer / total <= .7,
      `seed ${seed} should visibly contain both broadleaf and conifer stands`);
    assert.ok(treesWithNearbySameSpecies / total > .73,
      `seed ${seed} trees should form same-species groves rather than isolated scatter`);
    assert.ok(treeAnchors.length > 180, `seed ${seed} should render substantial woodland`);
    assert.ok(anchorsInGroves.length / treeAnchors.length > .8,
      `seed ${seed} rendered trees should appear in close groups`);
    assert.ok(centralTrees / centralLand < edgeTrees / edgeLand * .6,
      `seed ${seed} should have fewer trees in the center than at the edges`);
  }
});

test('starting mineral deposits form concentrated stone and gold hotspots', () => {
  for (const seed of [1, 2, 42]) {
    const world = Sim.createWorld(seed);
    const stone = world.tiles.filter(tile => tile.stoneDeposit > .7);
    const gold = world.tiles.filter(tile => tile.goldOre > .05);
    const previousGoldCount = world.tiles.filter(tile => tile.terrain !== 'water'
      && hash01(seed + 53, tile.x, tile.y)
        < (spatialNoise(seed + 67, tile.x, tile.y, 12) > .66 ? .05 : .001)).length;
    const depositsWithNearby = (deposits, radius) => deposits.filter(tile => deposits.some(other => other !== tile
      && Math.max(Math.abs(other.x - tile.x), Math.abs(other.y - tile.y)) <= radius)).length / deposits.length;
    const patchCounts = predicate => Array.from({ length: 64 }, (_, patch) => {
      const patchX = patch % 8, patchY = Math.floor(patch / 8);
      let count = 0;
      for (let y = patchY * 16; y < (patchY + 1) * 16; y++) {
        for (let x = patchX * 16; x < (patchX + 1) * 16; x++) {
          if (predicate(world.tiles[y * world.width + x])) count++;
        }
      }
      return count;
    });
    const hasHotspots = counts => Math.max(...counts) > counts.reduce((sum, count) => sum + count, 0) / counts.length * 3;

    assert.ok(stone.length >= 80 && stone.length <= 180, `seed ${seed} should retain useful stone deposits`);
    assert.ok(gold.length >= 20 && gold.length <= 60, `seed ${seed} should have about half as many gold deposits`);
    assert.ok(gold.length / previousGoldCount >= .4 && gold.length / previousGoldCount <= .65,
      `seed ${seed} should generate about half as many gold sites as before`);
    assert.ok(depositsWithNearby(stone, 2) > .5, `seed ${seed} stone deposits should gather into hotspots`);
    assert.ok(depositsWithNearby(gold, 3) > .35, `seed ${seed} gold deposits should gather into hotspots`);
    assert.ok(hasHotspots(patchCounts(tile => tile.stoneDeposit > .7)),
      `seed ${seed} should have stone-rich areas and areas with little stone`);
    assert.ok(hasHotspots(patchCounts(tile => tile.goldOre > .05)),
      `seed ${seed} should have gold-rich areas and areas with little gold`);
  }
});

test('mining a large rock drops smaller stones that residents can collect', () => {
  const world = Sim.createWorld(42);
  const tile = world.tiles.find(candidate => candidate.stoneDeposit >= 8);
  assert.ok(tile, 'the world should contain a mineable large rock');
  const depositBefore = tile.stoneDeposit;
  const miner = {
    id: 9001, alive: true, x: tile.x, y: tile.y, state: '', energy: 80, hydration: 80, foodReserve: 60,
    carriedFood: 0, carriedMeat: 0, carriedWood: 0, carriedStone: 0, carriedGold: 0, carriedFeed: 0,
    skills: { gather: 0 }, perception: { resources: [{ x: tile.x, y: tile.y, visible: true, distance: 0,
      terrain: 'land', biomass: {}, stone: tile.stoneDeposit, goldOre: 0 }] }
  };
  const community = { id: -1, memberIds: Array(6).fill(0), stores: { wood: 100, stone: 0 } };
  const gathered = gatherMaterials(world, miner, community);
  const fragments = world.loot.find(pile => pile.droppedDay === world.day);

  assert.equal(miner.visualActivity.kind, 'mine');
  assert.equal(miner.state, 'minerando rocha');
  assert.ok(gathered > 0);
  assert.equal(tile.stoneDeposit + fragments.resources.stone, depositBefore);
  assert.equal(miner.carriedStone, 0);
  assert.equal(collectLoot(world, miner, fragments), gathered);
  assert.equal(miner.carriedStone, gathered);
  assert.equal(fragments.available, false);
});
