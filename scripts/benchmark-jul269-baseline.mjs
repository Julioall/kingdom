// JUL-269: isolated measurements. Does not modify game state outside disposable worlds.
import { performance } from 'node:perf_hooks';
import { cpus, platform, release, totalmem, arch } from 'node:os';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import Sim from '../src/simulation/engine.js';
import { createWorldSnapshot, applyWorldSnapshot, transferablesForSnapshot } from '../src/simulation/render-snapshot.js';

const flags = Object.fromEntries(process.argv.slice(2).map(arg => arg.replace(/^--/, '').split('=')));
const seeds = (flags.seeds || '1,42,2026').split(',').map(Number);
const days = Math.max(1, Number(flags.days || 30));
const warmup = Math.max(0, Number(flags.warmup || 5));
const repeats = Math.max(1, Number(flags.repeats || 2));
const percentile = (xs, frac) => {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * frac) - 1))];
};
const mb = n => Math.round(n * 100 / 1048576) / 100;
const report = {
  schema: 1,
  purpose: 'JUL-269 controlled baseline; estimates are NOT network byte sizes or end-user FPS',
  sourceCommit: process.env.SOURCE_COMMIT || 'unknown',
  nodeVersion: process.version,
  platform: platform(),
  platformRelease: release(),
  architecture: arch(),
  cpuModel: cpus()[0]?.model || 'unknown',
  cpuThreads: cpus().length,
  systemRamMiB: mb(totalmem()),
  days, warmup, repeats, seeds,
  results: []
};

for (const seed of seeds) {
  for (let repeat = 0; repeat < repeats; repeat++) {
    const world = Sim.createWorld(seed);
    for (let j = 0; j < warmup; j++) Sim.stepDay(world);
    const heapBefore = process.memoryUsage();
    const cpuBefore = process.cpuUsage();
    const samples = [];
    for (let j = 0; j < days; j++) {
      const t0 = performance.now();
      Sim.stepDay(world);
      samples.push(performance.now() - t0);
    }
    const cpu = process.cpuUsage(cpuBefore);
    const heapAfter = process.memoryUsage();
    const snapshotStart = performance.now();
    const full = createWorldSnapshot(world);
    const snapshotBuildMs = performance.now() - snapshotStart;
    const columns = full.tileColumns;
    const typedArrayBytes = ['scalars', 'ids', 'types', 'plants']
      .reduce((n, k) => n + columns[k].byteLength, 0);
    const json = JSON.stringify({ base: full.base, stats: full.stats, events: full.events, logs: full.logs });
    const estimatedPayloadBytes = typedArrayBytes + Buffer.byteLength(json, 'utf8');
    const hash = createHash('sha256').update(json);
    for (const key of ['scalars', 'ids', 'types', 'plants']) hash.update(new Uint8Array(columns[key].buffer));
    const cloneStart = performance.now();
    const ordinaryClone = structuredClone(full);
    const ordinaryCloneMs = performance.now() - cloneStart;
    const hydrateStart = performance.now();
    const restored = applyWorldSnapshot(ordinaryClone);
    const hydrateMs = performance.now() - hydrateStart;
    const transferStart = performance.now();
    const transferred = structuredClone(full, { transfer: transferablesForSnapshot(full) });
    const transferCloneMs = performance.now() - transferStart;
    const checks = { tileCount: restored.tiles.length, people: restored.people.length, transferredTileCount: transferred.tileColumns.tileCount };
    const simMs = samples.reduce((a, b) => a + b, 0);
    report.results.push({
      seed, repeat, alivePeople: world.people.filter(p => p.alive).length, day: world.day,
      daysPerSecond: Math.round(days / (simMs / 1000) * 100) / 100,
      meanDayMs: simMs / days, medianDayMs: percentile(samples, 0.5), p95DayMs: percentile(samples, 0.95),
      processCpuMs: (cpu.user + cpu.system) / 1000,
      heapBeforeMiB: mb(heapBefore.heapUsed), heapAfterMiB: mb(heapAfter.heapUsed),
      rssBeforeMiB: mb(heapBefore.rss), rssAfterMiB: mb(heapAfter.rss),
      snapshotBuildMs, ordinaryCloneMs, hydrateMs, transferCloneMs,
      typedArrayBytes, estimatedPayloadBytes, stateDigest: hash.digest('hex'),
      checks, samplesMs: samples
    });
  }
}

if (flags.output) {
  const target = resolve(flags.output);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({
  sourceCommit: report.sourceCommit, cpu: report.cpuModel, node: report.nodeVersion, seeds,
  results: report.results.map(({ seed, repeat, daysPerSecond, medianDayMs, p95DayMs,
    snapshotBuildMs, ordinaryCloneMs, hydrateMs, transferCloneMs, estimatedPayloadBytes, stateDigest }) => ({
    seed, repeat, daysPerSecond, medianDayMs: +medianDayMs.toFixed(2), p95DayMs: +p95DayMs.toFixed(2),
    snapshotBuildMs: +snapshotBuildMs.toFixed(2), ordinaryCloneMs: +ordinaryCloneMs.toFixed(2),
    hydrateMs: +hydrateMs.toFixed(2), transferCloneMs: +transferCloneMs.toFixed(2),
    estimatedPayloadBytes, stateDigest
  }))
}, null, 2));
