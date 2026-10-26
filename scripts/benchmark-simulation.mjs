import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import Sim from '../src/simulation/engine.js';
import { createWorldSnapshot } from '../src/simulation/render-snapshot.js';

const args = Object.fromEntries(process.argv.slice(2).map(argument => argument.replace(/^--/, '').split('=')));
const days = Number(args.days || 30), warmup = Number(args.warmup || 5), repeats = Number(args.repeats || 2);
const seeds = (args.seeds || '42,7').split(',').map(Number);
const results = [];
for (const seed of seeds) for (let repeat = 0; repeat < repeats; repeat++) {
  const world = Sim.createWorld(seed);
  for (let day = 0; day < warmup; day++) Sim.stepDay(world);
  const samples = [];
  for (let day = 0; day < days; day++) {
    const started = performance.now();
    Sim.stepDay(world);
    samples.push(performance.now() - started);
  }
  const snapshot = createWorldSnapshot(world);
  const digest = createHash('sha256').update(JSON.stringify(snapshot.base));
  for (const key of ['scalars', 'ids', 'types', 'plants']) digest.update(new Uint8Array(snapshot.tileColumns[key].buffer));
  digest.update(JSON.stringify({ stats: snapshot.stats, events: snapshot.events, logs: snapshot.logs }));
  const sorted = samples.slice().sort((a, b) => a - b);
  results.push({ seed, repeat, day: world.day, people: world.people.filter(person => person.alive).length,
    meanDayMs: samples.reduce((sum, ms) => sum + ms, 0) / samples.length,
    medianDayMs: sorted[Math.floor(sorted.length / 2)], p95DayMs: sorted[Math.ceil(sorted.length * .95) - 1],
    stateDigest: digest.digest('hex'), samples });
}
const report = { runtime: process.version, days, warmup, repeats, seeds, results };
if (args.output) {
  const output = resolve(args.output);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report, null, 2));
