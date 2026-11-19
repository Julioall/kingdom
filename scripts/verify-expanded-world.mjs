// Stress validation for the expanded island and documented 5,000-NPC ceiling.
// Separate from npm test so ordinary unit tests remain fast and deterministic.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import Sim from '../src/simulation/engine.js';

const seed = Number(process.argv.find(x => x.startsWith('--seed='))?.split('=')[1] || 42);
const population = Number(process.argv.find(x => x.startsWith('--population='))?.split('=')[1] || 5000);
const start = performance.now();
const world = Sim.createWorld(seed, { initialPopulation: population });
const initMs = performance.now() - start;
assert.equal(world.width, 160);
assert.equal(world.height, 160);
assert.equal(world.tiles.length, 160 * 160);
assert.equal(world.people.length, population);
assert.equal(world.kingdoms.length, 2);
assert.ok(world.people.every(p => p.alive && p.kingdomId != null));
assert.equal(world.kingdoms.reduce((n, k) => n + k.memberIds.length, 0), population);
assert.ok(world.kingdoms.every(k => k.memberIds.length >= 48
  && world.people.some(p => p.id === k.rulerId)));
const keys = new Set(world.people.map(p => Math.round(p.y) * world.width + Math.round(p.x)));
assert.equal(keys.size, population, 'initial citizens must occupy unique tiles');
assert.ok(world.people.every(p => {
  const t = world.tiles[Math.round(p.y) * world.width + Math.round(p.x)];
  return t?.terrain === 'land' && Number.isFinite(p.x) && Number.isFinite(p.y);
}), 'each citizen must be spawned on real traversable island ground');
assert.ok(!world.initialPopulationOccupied, 'temporary spawning index must be released');
const dayStart = performance.now();
Sim.stepDay(world);
const dayMs = performance.now() - dayStart;
const stats = {
  seed, population, width: world.width, height: world.height,
  mapTiles: world.tiles.length, gameDay: world.day,
  peopleAlive: world.people.filter(p => p.alive).length,
  kingdomPopulations: world.kingdoms.map(k => k.memberIds.length),
  initMs: Number(initMs.toFixed(1)),
  firstDayMs: Number(dayMs.toFixed(1)),
  heapUsedMb: Number((process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1))
};
console.log('EXPANDED-WORLD-STRESS', JSON.stringify(stats));
