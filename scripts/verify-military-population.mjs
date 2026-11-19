// A standalone full-scale founding-garrison check. The 5,000-person ceiling
// is an initialization test only: a full day with 4,000 soldiers may take
// minutes and is explicitly NOT marketed as playable browser performance.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

process.env.KINGDOM_WORLD_PRESET = 'expanded';
const { default: Sim } = await import('../src/simulation/engine.js');
const value = arg => process.argv.find(s => s.startsWith('--' + arg + '='))?.split('=')[1];
const population = Number(value('population') || 500);
const seed = Number(value('seed') || 42);
const oneDay = value('days') == null ? population <= 500 : Number(value('days')) > 0;

const started = performance.now();
const world = Sim.createWorld(seed, { initialPopulation: population, initialMilitaryShare: .8 });
const initializationMs = performance.now() - started;
const living = world.people.filter(p => p.alive);
const soldiers = living.filter(p => p.role === 'soldier');
const civilians = living.filter(p => p.role !== 'soldier');
assert.equal(world.width, 160);
assert.equal(world.height, 160);
assert.equal(living.length, population);
assert.equal(soldiers.length + civilians.length, population);
assert.equal(soldiers.length, world.kingdoms.reduce((count, k) =>
  count + Math.floor(k.memberIds.length * .8), 0));
assert.equal(new Set(living.map(p => Math.round(p.y) * world.width + Math.round(p.x))).size, population);
for (const kingdom of world.kingdoms) {
  const members = living.filter(p => p.kingdomId === kingdom.id);
  const troops = members.filter(p => p.role === 'soldier');
  const citizens = members.filter(p => p.role !== 'soldier');
  assert.equal(troops.length, Math.floor(members.length * .8));
  assert.equal(citizens.length, members.length - troops.length);
  assert.ok(troops.every(p => p.militaryUnitId && p.militaryCenterId));
  assert.equal(kingdom.militaryCommand.units.reduce((n, u) => n + u.memberIds.length, 0),
    troops.length);
}
let dayMs = null;
if (oneDay) {
  const dayStart = performance.now();
  Sim.stepDay(world);
  dayMs = Math.round(performance.now() - dayStart);
  assert.equal(world.day, 1);
}
console.log('MILITARY-80-20', JSON.stringify({
  seed, population, military: soldiers.length, civilians: civilians.length,
  militaryPercent: +(100 * soldiers.length / population).toFixed(2),
  initializationMs: Math.round(initializationMs), firstDayMs: dayMs,
  heapMb: +(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1)
}));
