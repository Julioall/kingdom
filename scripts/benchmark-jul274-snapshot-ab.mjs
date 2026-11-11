// JUL-274: paired complete-world CPU A/B for the snapshot replay gate.
// Run in CI after checking out pinned baseline and candidate into sibling dirs.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const out = resolve(root, 'out/jul274-snapshot-ab');
mkdirSync(out, { recursive: true });
const all = [];
for (const [index, order] of [['baseline', 'candidate'], ['candidate', 'baseline']].entries()) {
  const runs = {};
  for (const mode of order) {
    const output = resolve(out, 'pair' + (index + 1) + '-' + mode + '.json');
    const started = performance.now();
    const log = execFileSync(process.execPath,
      ['scripts/benchmark-jul274-behavioral.mjs', output], {
        cwd: resolve(root, mode), encoding: 'utf8', maxBuffer: 1024 * 1024,
        timeout: 10 * 60 * 1000, env: { ...process.env, JUL274_DAYS: '6' }
      });
    const wallMs = performance.now() - started;
    writeFileSync(output.replace(/\.json$/, '.log'), log);
    const data = JSON.parse(readFileSync(output, 'utf8'));
    const samples = data.data.flatMap(row => row.timingsMs);
    const sorted = samples.slice().sort((a, b) => a - b);
    runs[mode] = {
      wallMs, data, stepMeanMs: samples.reduce((a, b) => a + b, 0) / samples.length,
      stepP95Ms: sorted[Math.ceil(sorted.length * .95) - 1]
    };
  }
  const baseline = runs.baseline, candidate = runs.candidate;
  const baselineByKey = new Map(baseline.data.data.map(row =>
    [row.seed + ':' + row.scenario, row]));
  for (const row of candidate.data.data) {
    const prior = baselineByKey.get(row.seed + ':' + row.scenario);
    if (!prior || prior.digest !== row.digest)
      throw Error('Aggregate behavior changed for ' + row.seed + '/' + row.scenario);
    if (!Array.isArray(row.snapshotDayDigests)
        || row.snapshotDayDigests.length !== candidate.data.days
        || !row.snapshotDigest)
      throw Error('Snapshot parity gate missing for ' + row.seed + '/' + row.scenario);
  }
  if (baselineByKey.size !== candidate.data.data.length)
    throw Error('Baseline and candidate scenario counts differ');
  all.push({
    pair: index + 1, order, parity: true,
    baseline: { wallMs: baseline.wallMs, stepMeanMs: baseline.stepMeanMs, stepP95Ms: baseline.stepP95Ms },
    candidate: { wallMs: candidate.wallMs, stepMeanMs: candidate.stepMeanMs, stepP95Ms: candidate.stepP95Ms },
    stepDeltaPercent: 100 * (candidate.stepMeanMs / baseline.stepMeanMs - 1),
    wallDeltaPercent: 100 * (candidate.wallMs / baseline.wallMs - 1)
  });
}
const report = {
  schema: 1, issue: 'JUL-274',
  baselineSha: process.env.BASELINE_SHA || 'unknown',
  candidateSha: process.env.GITHUB_SHA || 'unknown',
  methodology: 'Two alternating same-runner baseline/candidate pairs; 3 seeds x 3 controllers x 2 deterministic replays x 6 full-world days per mode. Check aggregate behavior equality across branches and within-candidate snapshot parity. CPU step and total wall time are separate; no GPU/FPS claim. Timing is noisy and not a speedup guarantee.',
  pairs: all
};
writeFileSync(resolve(out, 'summary.json'), JSON.stringify(report, null, 2));
for (const pair of all) console.log('A/B', JSON.stringify(pair));
console.log('PASSED two paired full-world CPU A/B comparisons with identical aggregate trajectories');
