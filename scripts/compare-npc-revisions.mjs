// Cross-commit A/B: require EXACT authoritative snapshots, while permitting
// diagnostic-only fields to differ between the two instrumented revisions.
// Usage: node scripts/compare-npc-revisions.mjs BASE.json CANDIDATE.json OUT.json
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const key = row => [row.population, row.seed, row.mode, row.repeat].join('|');
const mean = values => values.reduce((a, b) => a + b, 0) / values.length;
export function compareNpcRevisions(baseline, candidate) {
  for (const field of ['populations', 'seeds', 'days', 'warmupDays', 'repeats', 'checkpointEvery', 'modes']) {
    assert.deepEqual(baseline.config[field], candidate.config[field],
      'Mismatched configuration: ' + field);
  }
  assert.equal(baseline.host.node, candidate.host.node, 'Node versions differ');
  assert.equal(baseline.host.platform, candidate.host.platform, 'Runner platforms differ');
  const base = new Map(baseline.rows.map(row => [key(row), row]));
  assert.equal(base.size, baseline.rows.length, 'Duplicate baseline observations');
  assert.equal(base.size, candidate.rows.length, 'Missing candidate observations');
  const byScenario = new Map(), samples = [];
  for (const row of candidate.rows) {
    const original = base.get(key(row));
    assert.ok(original, 'Missing baseline for ' + key(row));
    assert.equal(original.digest, row.digest, 'Authoritative simulation divergence: ' + key(row));
    assert.deepEqual(original.checkpoints, row.checkpoints,
      'Authoritative checkpoint divergence: ' + key(row));
    const reference = original.timingsMs.meanMs, optimized = row.timingsMs.meanMs;
    const reduction = 100 * (1 - optimized / reference);
    const item = {population: row.population, seed: row.seed, mode: row.mode,
      repeat: row.repeat, baselineMs: reference, candidateMs: optimized,
      reductionPercent: reduction, exactState: true};
    samples.push(item);
    const scenario = [row.population, row.seed, row.mode].join('|');
    if (!byScenario.has(scenario)) byScenario.set(scenario, []);
    byScenario.get(scenario).push(item);
  }
  const scenarios = [...byScenario.entries()].map(([scenario, group]) => {
    const [population, seed, mode] = scenario.split('|');
    const baselineMs = mean(group.map(row => row.baselineMs));
    const candidateMs = mean(group.map(row => row.candidateMs));
    return {
      population: Number(population), seed: Number(seed), mode,
      runs: group.length, baselineMs, candidateMs,
      reductionPercent: 100 * (1 - candidateMs / baselineMs),
      exactState: true
    };
  });
  return {
    schemaVersion: 1, exactAll: true, scenarios, samples,
    caveats: [
      'Baseline and candidate were run sequentially, not simultaneously.',
      'JIT, GC, CPU contention and thermal variation can change short-run timings.',
      'Semantic equivalence is verified using the authoritative snapshot digest and checkpoints.',
      'The same-mode behavioral trajectory may include new diagnostic fields across revisions.',
      'A single same-host run does not prove a sustained CPU win or 144 FPS.'
    ]
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [basePath, candidatePath, outputPath] = process.argv.slice(2);
  assert.ok(basePath && candidatePath && outputPath,
    'Expected baseline.json candidate.json output.json');
  const [base, candidate] = await Promise.all([basePath, candidatePath].map(async path =>
    JSON.parse(await readFile(resolve(path), 'utf8'))));
  const report = compareNpcRevisions(base, candidate);
  const output = resolve(outputPath);
  await mkdir(dirname(output), {recursive: true});
  await writeFile(output, JSON.stringify(report, null, 2));
  console.log('BUILD-SITE-AB', JSON.stringify(report));
}
