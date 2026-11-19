// Maximum requested playable scale: inspect generation, not just injected NPCs.
// The 5,000-actor benchmark previously tested one authoritative day on 112²;
// this checks new worlds at 160² with the population created on day zero.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import engine from '../src/simulation/engine.js';
import { MAX_SUPPORTED_POPULATION, WIDTH, HEIGHT } from '../src/config/ecosystem.js';

const options = Object.fromEntries(process.argv.slice(2).map(arg => {
  const at = arg.indexOf('=');
  if (!arg.startsWith('--') || at <= 2) throw Error('Use --name=value');
  return [arg.slice(2, at), arg.slice(at + 1)];
}));
const population = Number(options.population ?? MAX_SUPPORTED_POPULATION);
const seed = Number(options.seed ?? 42);
const days = Number(options.days ?? 1);
assert.ok(Number.isSafeInteger(population) && population >= 96
  && population <= MAX_SUPPORTED_POPULATION && population % 2 === 0);
assert.ok(Number.isSafeInteger(seed) && seed > 0 && seed <= 0xffffffff);
assert.ok(Number.isSafeInteger(days) && days >= 0 && days <= 5);
const started = performance.now();
const world = engine.createWorld(seed, { initialPopulation: population });
const generationMs = performance.now() - started;
assert.equal(world.width, WIDTH);
assert.equal(world.height, HEIGHT);
assert.equal(world.tiles.length, WIDTH * HEIGHT);
assert.equal(world.people.length, population);
assert.equal(world.initialPopulationTarget, population);
const homes = world.people.filter(person => person.homeId != null).length;
const places = new Set();
for (const person of world.people) {
  const tile = world.tiles[Math.round(person.y) * WIDTH + Math.round(person.x)];
  assert.ok(tile && tile.terrain === 'land', 'resident starts on walkable land');
  const key = Math.round(person.y) * WIDTH + Math.round(person.x);
  assert.ok(!places.has(key), 'residents must not share a spawn tile: ' + key);
  places.add(key);
  assert.ok(world.kingdoms.some(kingdom => kingdom.id === person.kingdomId));
}
assert.equal(world.kingdoms.reduce((sum, kingdom) => sum + kingdom.memberIds.length, 0), population);
const timing = [];
for (let i = 0; i < days; i++) {
  const now = performance.now();
  engine.stepDay(world, { includeSnapshot: false });
  timing.push(performance.now() - now);
}
assert.equal(world.day, days);
const row = {
  scenario: 'expanded-real-population-at-world-creation',
  seed, requestedPopulation: population, generatedPopulation: population,
  dimensions: [WIDTH, HEIGHT], tiles: world.tiles.length,
  kingdomPopulations: world.kingdoms.map(k => ({
    id: k.id, name: k.name, assigned: k.memberIds.length
  })),
  assignedHomes: homes, initialWithoutHome: population - homes,
  initialMilitary: world.people.filter(p => p.role === 'soldier').length,
  daysSimulated: days, aliveAfter: world.people.filter(p => p.alive).length,
  generationMs: Math.round(generationMs),
  dayMs: timing.map(ms => Math.round(ms)),
  memory: {
    heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    rssMB: Math.round(process.memoryUsage().rss / 1024 / 1024)
  },
  hardware: { node: process.version, cpu: cpus()[0]?.model || 'unknown' },
  limits: [
    'A one-day step does NOT validate 30/90/180-day food, housing or social sustainability.',
    'Initial housing stock is reported; do not equate 5000 actors with 5000 housed citizens.',
    'Headless Node sim performance does not prove browser frame rate or device compatibility.'
  ]
};
const output = resolve(options.output || 'out/expanded-world.json');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(row, null, 2));
console.log('EXPANDED-WORLD', JSON.stringify(row));
