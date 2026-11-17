// Repeatable microbenchmark for the occupancy query on a fixed actor layout.
// Use real-world V2/V3 benchmarks for conclusions about simulation/FPS.
// node scripts/benchmark-spatial-first-match.mjs --population=5000 --queries=30000 --repeats=5
import { performance } from 'node:perf_hooks';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createPersonSpatialIndex } from '../src/simulation/individuals/spatial-index.js';

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const equal = arg.indexOf('=');
  if (!arg.startsWith('--') || equal < 0) throw new Error('Expected --key=value');
  return [arg.slice(2, equal), arg.slice(equal + 1)];
}));
function integer(name, fallback, limit) {
  const value = args[name] == null ? fallback : Number(args[name]);
  if (!Number.isSafeInteger(value) || value <= 0 || value > limit)
    throw new Error('Invalid --' + name);
  return value;
}
const population = integer('population', 5000, 50000);
const queries = integer('queries', 20000, 500000);
const repeats = integer('repeats', 5, 20);
function random(seed) {
  let state = seed;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}
const rand = random(42);
const actors = Array.from({ length: population }, (_, id) => ({
  id, alive: id % 19 !== 0, restingStructureId: id % 17 === 0 ? 22 : null,
  x: Math.floor(rand() * 160), y: Math.floor(rand() * 120)
}));
const probes = Array.from({ length: queries }, () => ({
  x: Math.floor(rand() * 160), y: Math.floor(rand() * 120),
  radius: rand() < .9 ? 1 : 8, excluded: Math.floor(rand() * population)
}));
const index = createPersonSpatialIndex(actors);
function run(kind) {
  let sum = 0;
  const start = performance.now();
  for (const {x, y, radius, excluded} of probes) {
    const predicate = person => person.alive && person.id !== excluded
      && person.restingStructureId == null;
    const result = kind === 'sort' ? index.query(x, y, radius).find(predicate)
      : index.findFirst(x, y, radius, predicate);
    sum += result ? result.id + 1 : 0;
  }
  return {ms: performance.now() - start, checksum: sum};
}
for (let i = 0; i < 2; i++) {
  const baseline = run('sort'), direct = run('first');
  if (baseline.checksum !== direct.checksum) throw new Error('Query mismatch in warmup');
}
const rows = [];
for (let i = 0; i < repeats; i++) {
  // Alternate ordering to avoid systematic JIT, cache and CPU clock bias.
  const first = i % 2 ? run('first') : run('sort');
  const second = i % 2 ? run('sort') : run('first');
  const baseline = i % 2 ? second : first;
  const optimized = i % 2 ? first : second;
  if (baseline.checksum !== optimized.checksum)
    throw new Error('Query mismatch in measurement ' + i);
  rows.push({ baselineMs: baseline.ms, optimizedMs: optimized.ms, checksum: baseline.checksum });
}
const median = values => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
const baselineMedianMs = median(rows.map(row => row.baselineMs));
const optimizedMedianMs = median(rows.map(row => row.optimizedMs));
const report = {
  schemaVersion: 1, kind: 'npc-occupancy-microbenchmark', population, queries, repeats,
  baselineMedianMs, optimizedMedianMs,
  reductionPercent: 100 * (baselineMedianMs - optimizedMedianMs) / baselineMedianMs,
  exactQueryParity: true, rows,
  limitations: [
    'Microbenchmark of one spatial query; does not measure frame p95, GPU or entire simulation.',
    'The real occupancy query also checks hitbox overlap; this test isolates the ordered spatial search.',
    'Population distribution and cache state are artificial; benchmark full gameplay under multiple seeds.'
  ]
};
if (args.output) {
  const path = resolve(args.output);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report, null, 2));
