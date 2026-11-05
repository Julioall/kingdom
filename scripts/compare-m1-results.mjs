import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const directory = process.argv[2];
if (!directory) throw Error('Expected directory containing baseline/candidate population-seed JSON files');
const rows = [];
const identities = new Map();
for (const population of [500, 1000, 5000]) for (const seed of [1, 42, 2026]) {
  const load = async kind => JSON.parse(await readFile(resolve(directory, `${kind}-${population}-${seed}.json`), 'utf8'));
  const baseline = await load('baseline'), candidate = await load('candidate');
  for (const [kind, report] of [['baseline', baseline], ['candidate', candidate]]) {
    if (!/^[a-f0-9]{40}$/.test(report.commit || '') || !/^[a-f0-9]{64}$/.test(report.sourceDiffDigest || ''))
      throw Error(`Missing source identity ${kind} ${population}/${seed}`);
    const identity = report.commit + ':' + report.sourceDiffDigest;
    if (identities.has(kind) && identities.get(kind) !== identity)
      throw Error(`Source changed within ${kind} matrix`);
    identities.set(kind, identity);
  }
  for (const report of [baseline, candidate]) {
    if (report.population !== population || report.seed !== seed || !report.measurements?.length)
      throw Error(`Invalid scenario ${population}/${seed}`);
  }
  if (baseline.node !== candidate.node || JSON.stringify(baseline.host) !== JSON.stringify(candidate.host)
    || baseline.configuration !== candidate.configuration || baseline.days !== candidate.days
    || baseline.measurements.length !== candidate.measurements.length)
    throw Error(`Non-equivalent environment/configuration ${population}/${seed}`);
  for (let i = 0; i < baseline.measurements.length; i++) {
    const a = baseline.measurements[i], b = candidate.measurements[i];
    if (!a.snapshotDigest || a.snapshotDigest !== b.snapshotDigest || a.day !== b.day || a.alive !== b.alive)
      throw Error(`Replay mismatch ${population}/${seed} day ${a.day}`);
    if (![a.ms, b.ms].every(ms => Number.isFinite(ms) && ms > 0)) throw Error('Invalid duration');
    rows.push({ population, seed, day: a.day, baselineMs: a.ms, candidateMs: b.ms,
      gainPercent: (1 - b.ms / a.ms) * 100, parity: true });
  }
}
const scaleTimingGate = rows.filter(row => row.population === 5000)
  .every(row => row.candidateMs <= 300000 && row.gainPercent >= 20);
console.log(JSON.stringify({ rows,
  scaleTimingGate,
  limitations: 'One matrix does not establish repeatability, prolonged stability, browser transport acceptance or full M1 completion.'
}, null, 2));
if (process.argv.includes('--require-timing') && !scaleTimingGate) process.exitCode = 1;
