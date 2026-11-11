// Full-world M1 measurements. Run baseline/candidate sequentially on the same host.
import { performance } from 'node:perf_hooks';
import { cpus, platform, release, totalmem } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import Sim from '../src/simulation/engine.js';
import { authoritativeSnapshotDigest } from './support/jul274-snapshot-digest.mjs';

const [populationArg = '500', seedArg = '42', daysArg = '1', outputArg, schedule = 'unlimited'] = process.argv.slice(2);
const population = Number(populationArg), seed = Number(seedArg), days = Number(daysArg);
if (!Number.isSafeInteger(population) || population < 1 || !Number.isSafeInteger(seed)
  || !Number.isSafeInteger(days) || days < 1) throw Error('Expected population, seed, days and optional output path');
let commit = null;
let sourceDiffDigest = null;
try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' }).trim(); } catch {}
try { sourceDiffDigest = createHash('sha256').update(execFileSync('git', ['diff', 'HEAD', '--', 'src'],
  { cwd: new URL('..', import.meta.url) })).digest('hex'); } catch {}
const world = Sim.createWorld(seed);
if (!['unlimited', 'budgeted'].includes(schedule)) throw Error('Schedule must be unlimited or budgeted');
if (schedule === 'budgeted') world.neuralOverrides = {
  ...world.neuralOverrides, cognitiveSchedule: { mode: 'budgeted', budget: 128 }
};
if (population < world.people.length) throw Error('Population is below the world initial population');
Sim.addIndividuals(world, population - world.people.length, false);
const measurements = [];
for (let i = 0; i < days; i++) {
  const cpu = process.cpuUsage(), start = performance.now();
  Sim.stepDay(world, { includeSnapshot: false });
  const ms = performance.now() - start, usage = process.cpuUsage(cpu);
  const memory = process.memoryUsage();
  measurements.push({ day: world.day, ms, cpuUserMs: usage.user / 1000,
    cpuSystemMs: usage.system / 1000, memory, alive: world.people.filter(p => p.alive).length,
    snapshotDigest: authoritativeSnapshotDigest(world) });
  console.log(JSON.stringify(measurements.at(-1)));
}
const report = { population, seed, days, commit, node: process.version,
  sourceDiffDigest, schedule,
  host: { platform: platform(), release: release(), cpu: cpus()[0]?.model, totalMemory: totalmem() },
  configuration: `full-world controller; schedule=${schedule}; budget=${schedule === 'budgeted' ? 128 : 'unlimited'}; no snapshot in timed step; snapshot digest outside timing`,
  limitations: 'Memory is sampled after each day, not peak. No GPU, browser FPS or input latency measurement.',
  measurements };
if (outputArg) {
  const output = resolve(outputArg);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2));
}
