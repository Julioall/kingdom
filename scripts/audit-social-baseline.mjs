import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import engine from '../src/simulation/engine.js';

const args = new Map();
for (let index = 2; index < process.argv.length; index++) {
  const key = process.argv[index];
  if (!key.startsWith('--')) throw new Error('Argumento inesperado: ' + key);
  args.set(key, process.argv[++index]);
}

const days = Number(args.get('--days') ?? 30);
const seeds = (args.get('--seeds') ?? '1,42,987,2026').split(',').map(Number);
const repeatSeed = args.has('--repeat-seed') ? Number(args.get('--repeat-seed')) : 42;
const outputPath = args.get('--output');
if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error('--days deve estar entre 1 e 365');
if (!seeds.length || seeds.some(seed => !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)) {
  throw new Error('--seeds deve conter inteiros uint32 separados por vírgulas');
}
if (!Number.isInteger(repeatSeed) || repeatSeed < 0 || repeatSeed > 0xffffffff) {
  throw new Error('--repeat-seed deve ser um inteiro uint32');
}

function canonical(value, seen = new WeakSet()) {
  if (value === undefined) return '"[undefined]"';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (seen.has(value)) return '"[circular]"';
  seen.add(value);
  let output;
  if (ArrayBuffer.isView(value)) output = JSON.stringify({ type: value.constructor.name, values: Array.from(value) });
  else if (Array.isArray(value)) output = '[' + value.map(item => canonical(item, seen)).join(',') + ']';
  else if (value instanceof Map) output = '{"map":[' + [...value.entries()].map(([key, item]) => [canonical(key, seen), canonical(item, seen)])
    .sort((a, b) => a[0].localeCompare(b[0])).map(entry => '[' + entry.join(',') + ']').join(',') + ']}';
  else if (value instanceof Set) output = '{"set":[' + [...value].map(item => canonical(item, seen)).sort().join(',') + ']}';
  else output = '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key], seen)).join(',') + '}';
  seen.delete(value);
  return output;
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function percentile(sorted, fraction) {
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] || 0;
}

function summarize(world, seed) {
  const startedAt = performance.now();
  const stepDurationsMs = [];
  let peakObservedHeapBytes = process.memoryUsage().heapUsed;
  for (let day = 1; day <= days; day++) {
    const stepStart = performance.now();
    engine.stepDay(world, { includeSnapshot: false });
    stepDurationsMs.push(performance.now() - stepStart);
    peakObservedHeapBytes = Math.max(peakObservedHeapBytes, process.memoryUsage().heapUsed);
  }
  const elapsedMs = performance.now() - startedAt;
  const sortedSteps = stepDurationsMs.slice().sort((a, b) => a - b);
  const people = world.people.filter(person => person.alive);
  const socialLinks = Object.values(world.socialLinks || {});
  const actionCounts = {};
  for (const person of people) {
    const action = person.brain?.lastAction || 'sem ação registrada';
    actionCounts[action] = (actionCounts[action] || 0) + 1;
  }
  const snapshot = engine.snapshot(world);
  return {
    seed,
    days,
    stateSha256: hash(canonical(world)),
    chronicleSha256: hash(canonical(world.chronicle || [])),
    elapsedMs: Number(elapsedMs.toFixed(2)),
    throughputDaysPerSecond: Number((days / (elapsedMs / 1000)).toFixed(2)),
    perDayStepMs: {
      median: Number(percentile(sortedSteps, .5).toFixed(2)),
      p95: Number(percentile(sortedSteps, .95).toFixed(2)),
      max: Number(Math.max(...stepDurationsMs).toFixed(2))
    },
    memory: {
      peakObservedHeapBytes: peakObservedHeapBytes,
      finalHeapBytes: process.memoryUsage().heapUsed,
      finalRssBytes: process.memoryUsage().rss,
      measurement: 'maximum heapUsed observado após cada dia; amostra dependente do GC/runtime'
    },
    survival: {
      livingPeople: people.length,
      births: world.births || 0,
      deaths: world.deaths || 0,
      deathsByCause: { ...(world.deathsByCause || {}) },
      meanFoodReserve: Number((people.reduce((sum, person) => sum + (person.foodReserve || 0), 0) / Math.max(1, people.length)).toFixed(2)),
      meanSocialNeed: Number((people.reduce((sum, person) => sum + (person.socialNeed || 0), 0) / Math.max(1, people.length)).toFixed(2))
    },
    decisions: {
      lastActionByLivingPerson: Object.fromEntries(Object.entries(actionCounts).sort(([a], [b]) => a.localeCompare(b))),
      socialLinks: socialLinks.length,
      totalMeetings: socialLinks.reduce((sum, link) => sum + (link.meetings || 0), 0),
      recordedSocialMeetings: (world.socialEvidence?.facts || []).filter(fact => fact.type === 'social_meeting').length,
      recordedWaterIndications: (world.socialEvidence?.facts || []).filter(fact => fact.type === 'water_source_indicated').length,
      recordedFoodAidTransfers: (world.socialEvidence?.facts || []).filter(fact => fact.type === 'food_aid_transferred').length,
      recordedFoodAidRequests: (world.socialEvidence?.facts || []).filter(fact => fact.type === 'food_aid_requested').length,
      acceptedFoodAidRequests: (world.socialEvidence?.facts || []).filter(fact => fact.type === 'food_aid_request_resolved' && fact.outcome.result === 'accepted').length,
      refusedFoodAidRequests: (world.socialEvidence?.facts || []).filter(fact => fact.type === 'food_aid_request_resolved' && fact.outcome.result === 'refused').length,
      meanTrust: Number((socialLinks.length ? socialLinks.reduce((sum, link) => sum + (link.trust || 0), 0) / socialLinks.length : 0).toFixed(4))
    },
    production: {
      harvests: { ...(world.harvests || {}) },
      marketTransactions: world.trades || 0,
      communityTasksCompleted: snapshot.communityTasksCompleted || 0,
      cultivatedFieldCount: snapshot.cultivatedFieldCount || 0
    },
    snapshot
  };
}

function run(seed) {
  return summarize(engine.createWorld(seed), seed);
}

const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const results = [];
for (const seed of seeds) {
  const result = run(seed);
  results.push(result);
  process.stderr.write('Baseline social seed ' + seed + ' concluído; ' + result.throughputDaysPerSecond + ' dias/s; p95 ' + result.perDayStepMs.p95 + ' ms.\n');
}
const first = results.find(result => result.seed === repeatSeed);
const repeated = run(repeatSeed);
const repeat = {
  seed: repeatSeed,
  stateSha256: repeated.stateSha256,
  chronicleSha256: repeated.chronicleSha256,
  stateAndChronicleMatch: !!first && first.stateSha256 === repeated.stateSha256
    && first.chronicleSha256 === repeated.chronicleSha256
};
if (!repeat.stateAndChronicleMatch) throw new Error('Replay social repetido divergiu para a seed ' + repeatSeed);

const report = {
  sourceRevision,
  createdAt: new Date().toISOString(),
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
  configuration: {
    days,
    seeds,
    repeatSeed,
    map: { width: engine.width, height: engine.height },
    controls: 'createWorld(seed) e stepDay(includeSnapshot:false), sem intervenção humana ou alteração de estado; snapshot final salvo por seed'
  },
  repeat,
  results
};

const json = JSON.stringify(report, null, 2) + '\n';
if (outputPath) {
  await writeFile(outputPath, json, 'utf8');
  process.stdout.write('Relatório salvo em ' + outputPath + '\n');
} else process.stdout.write(json);
