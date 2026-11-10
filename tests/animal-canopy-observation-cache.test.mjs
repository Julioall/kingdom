import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../src/simulation/engine.js';
import Senses from '../src/simulation/individuals/perception.js';
import { PLANTS } from '../src/config/ecosystem.js';
import { createWorldSnapshot } from '../src/simulation/render-snapshot.js';

test('animal canopy memoization preserves visible targets, resources and sensory memory', () => {
  for (const seed of [1, 42, 2026]) {
    const worldCached = Sim.createWorld(seed);
    const worldUncached = Sim.createWorld(seed);
    for (const day of [0, 1]) {
      if (day) {
        Sim.stepDay(worldCached, { includeSnapshot: false });
        Sim.stepDay(worldUncached, { includeSnapshot: false });
      }
      const animals = worldCached.animals.filter(a => a.alive).slice(0, 12);
      for (const animal of animals) {
        const other = worldUncached.animals.find(a => a.id === animal.id);
        assert.ok(other, 'matching real-world animal missing');
        const cached = Senses.observe(worldCached, animal, 'animal', PLANTS);
        const uncached = Senses.observe(worldUncached, other, 'animal', PLANTS,
          { disableCanopyCache: true });
        assert.deepEqual(cached, uncached,
          'perception changed for seed ' + seed + ' day ' + day + ' animal ' + animal.id);
        assert.deepEqual(animal.sensoryMemory, other.sensoryMemory,
          'memory changed for seed ' + seed + ' day ' + day + ' animal ' + animal.id);
      }
    }
  }
});

test('canopy changes between observations are not reused across animal calls', () => {
  const cachedWorld = Sim.createWorld(42), originalWorld = Sim.createWorld(42);
  const actor = cachedWorld.animals.find(a => a.alive);
  const otherActor = originalWorld.animals.find(a => a.id === actor.id);
  const x = Math.round(actor.x), y = Math.round(actor.y);
  const tile = cachedWorld.tiles[y * cachedWorld.width + x];
  const rawTile = originalWorld.tiles[y * originalWorld.width + x];
  const original = Senses.observe(cachedWorld, actor, 'animal', PLANTS);
  const rawOriginal = Senses.observe(originalWorld, otherActor, 'animal', PLANTS,
    { disableCanopyCache: true });
  assert.deepEqual(original, rawOriginal);
  const trees = PLANTS.findIndex(p => p.id === 'broadleaf');
  const conifers = PLANTS.findIndex(p => p.id === 'conifer');
  for (const t of [tile, rawTile]) {
    t.plants[trees] = PLANTS[trees].max;
    t.plants[conifers] = PLANTS[conifers].max;
  }
  const refreshed = Senses.observe(cachedWorld, actor, 'animal', PLANTS);
  const rawRefreshed = Senses.observe(originalWorld, otherActor, 'animal', PLANTS,
    { disableCanopyCache: true });
  assert.deepEqual(refreshed, rawRefreshed,
    'memoized canopy from prior observations must not survive terrain changes');
  assert.deepEqual(actor.sensoryMemory, otherActor.sensoryMemory);
});

test('full-world animal decisions, RNG and tile snapshots match the uncached path', () => {
  const originalObserve = Senses.observe;
  try {
    for (const seed of [1, 42]) {
      const memoized = Sim.createWorld(seed), direct = Sim.createWorld(seed);
      for (let day = 1; day <= 3; day++) {
        Senses.observe = originalObserve;
        Sim.stepDay(memoized, { includeSnapshot: false });
        Senses.observe = (world, actor, kind, plants) =>
          originalObserve(world, actor, kind, plants,
            kind === 'animal' ? { disableCanopyCache: true } : null);
        Sim.stepDay(direct, { includeSnapshot: false });
        assert.equal(memoized.rngState, direct.rngState, 'world RNG changed');
        assert.deepEqual(createWorldSnapshot(memoized), createWorldSnapshot(direct),
          'world state changed for seed ' + seed + ' day ' + day);
      }
    }
  } finally {
    Senses.observe = originalObserve;
  }
});
