import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import Sim from '../src/simulation/engine.js';

const seeds = (process.env.PROFILE_SEEDS || '42,2026').split(',')
  .map(value => Number(value.trim())).filter(Number.isSafeInteger);
const days = Math.max(1, Math.floor(Number(process.env.PROFILE_DAYS || 90)));
const repeats = Math.max(1, Math.floor(Number(process.env.PROFILE_REPEATS || 3)));
const warmupDays = Math.max(0, Math.floor(Number(process.env.PROFILE_WARMUP_DAYS || 5)));
const disablePeopleSpatialIndex = process.env.PROFILE_DISABLE_SPATIAL_INDEX === '1';
const navigationMetrics = {
  fullSearches: 'navigationReplans', learnedRouteHits: 'navigationCacheHits', sharedRouteHits: 'navigationSharedCacheHits',
  failedSearchesSkipped: 'navigationFailureCacheHits', localDetours: 'navigationLocalDetours', congestionWaits: 'navigationCongestionWaits',
  congestionSearches: 'navigationCongestionReplans'
};
const navigationTotals = world => Object.fromEntries(Object.entries(navigationMetrics)
  .map(([name, field]) => [name, world.people.reduce((sum, person) => sum + (person[field] || 0), 0)]));
const median = values => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];
const percentile = (values, fraction) => {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
};
const round = value => Number(value.toFixed(2));

assert.ok(seeds.length > 0, 'provide at least one integer seed');

function measureSeed(seed) {
  const samples = [];
  const allDayLatencies = [];
  const detailedPhaseCalls = new Map();
  for (let repeat = 0; repeat < repeats; repeat++) {
    const world = Sim.createWorld(seed);
    for (let day = 0; day < warmupDays; day++) Sim.stepDay(world);
    const navigationBefore = navigationTotals(world);

    const phaseCalls = new Map();
    const phaseShares = new Map();
    const dayLatencies = [];
    let currentDayPhases = null;
    let currentDayDetails = null;
    const profile = {
      disablePeopleSpatialIndex,
      now: () => performance.now(),
      record(phase, elapsedMs) {
        currentDayPhases.set(phase, (currentDayPhases.get(phase) || 0) + elapsedMs);
      },
      recordDetail(phase, elapsedMs) {
        currentDayDetails.set(phase, (currentDayDetails.get(phase) || 0) + elapsedMs);
      }
    };
    let elapsedMs = 0;
    for (let day = 0; day < days; day++) {
      currentDayPhases = new Map();
      currentDayDetails = new Map();
      const dayStartedAt = performance.now();
      Sim.stepDay(world, profile);
      const dayElapsedMs = performance.now() - dayStartedAt;
      elapsedMs += dayElapsedMs;
      dayLatencies.push(dayElapsedMs);
      allDayLatencies.push(dayElapsedMs);
      const accountedMs = [...currentDayPhases.values()].reduce((sum, value) => sum + value, 0);
      for (const [phase, duration] of currentDayPhases) {
        const durations = phaseCalls.get(phase) || [];
        durations.push(duration);
        phaseCalls.set(phase, durations);
        const shares = phaseShares.get(phase) || [];
        shares.push(duration / dayElapsedMs * 100);
        phaseShares.set(phase, shares);
      }
      for (const [phase, duration] of currentDayDetails) {
        const durations = detailedPhaseCalls.get(phase) || [];
        durations.push(duration);
        detailedPhaseCalls.set(phase, durations);
      }
      const coverage = accountedMs / dayElapsedMs * 100;
      const coverageSamples = phaseShares.get('__coverage__') || [];
      coverageSamples.push(coverage);
      phaseShares.set('__coverage__', coverageSamples);
    }
    const phaseMilliseconds = Object.fromEntries([...phaseCalls.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([phase, values]) => [phase, round(values.reduce((sum, value) => sum + value, 0))]));
    const accountedMs = Object.values(phaseMilliseconds).reduce((sum, value) => sum + value, 0);
    samples.push({
      elapsedMs: round(elapsedMs),
      daysPerSecond: round(days / (elapsedMs / 1000)),
      medianDayMs: round(median(dayLatencies)),
      p95DayMs: round(percentile(dayLatencies, .95)),
      accountedPhaseMs: phaseMilliseconds,
      phaseCoveragePercent: round(median(phaseShares.get('__coverage__') || [])),
      day: world.day,
      aliveResidents: world.people.filter(person => person.alive).length,
      navigation: Object.fromEntries(Object.entries(navigationTotals(world)).map(([name, total]) => [name, total - navigationBefore[name]])),
      events: world.events.length,
      phaseCalls: Object.fromEntries([...phaseCalls].map(([phase, values]) => [phase, values.length])),
      phaseDurationSamples: Object.fromEntries(phaseCalls),
      phaseShareSamples: Object.fromEntries(phaseShares)
    });
  }

  const phaseNames = [...new Set(samples.flatMap(sample => Object.keys(sample.phaseCalls)))].sort();
  const phases = Object.fromEntries(phaseNames.map(phase => {
    const durations = samples.flatMap(sample => sample.phaseDurationSamples[phase] || []);
    const shares = samples.flatMap(sample => sample.phaseShareSamples[phase] || []);
    return [phase, {
      calls: durations.length,
      medianMsPerDay: round(median(durations)),
      p95MsPerDay: round(percentile(durations, .95)),
      medianSharePercent: round(median(shares)),
      p95SharePercent: round(percentile(shares, .95))
    }];
  }));
  const detailedPhases = Object.fromEntries([...detailedPhaseCalls.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([phase, durations]) => [phase, {
      calls: durations.length,
      medianMsPerDay: round(median(durations)),
      p95MsPerDay: round(percentile(durations, .95))
    }]));
  const sampleSummaries = samples.map(({
    phaseDurationSamples, phaseShareSamples, accountedPhaseMs, phaseCalls, ...sample
  }) => sample);
  return {
    seed,
    configuration: {
      width: Sim.width, height: Sim.height, cells: Sim.width * Sim.height,
      kingdoms: 2, warmupDays, measuredDays: days, repeats,
      peopleSpatialIndex: disablePeopleSpatialIndex ? 'disabled' : 'enabled'
    },
    medianDaysPerSecond: median(samples.map(sample => sample.daysPerSecond)),
    medianDayMs: round(median(allDayLatencies)),
    p95DayMs: round(percentile(allDayLatencies, .95)),
    medianPhaseCoveragePercent: median(samples.map(sample => sample.phaseCoveragePercent)),
    phases,
    detailedPhases,
    samples: sampleSummaries
  };
}

console.log(JSON.stringify({
  runtime: process.version,
  measurement: 'exclusive opt-in phase timers inside stepDay; world report and domain snapshots included; Worker projection, transfer, hydration and Canvas excluded',
  profilingChangesWorldState: false,
  results: seeds.map(measureSeed)
}, null, 2));
