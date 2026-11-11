// JUL-290: reproducible per-subsystem wall-time instrumentation of REAL worlds.
// Results describe Node wall time (CPU proxy), not browser frame time or FPS.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import Sim from '../src/simulation/engine.js';
import { createWorldSnapshot } from '../src/simulation/render-snapshot.js';
import {
  corralNaturalClearanceTiles, corralClearanceCacheDiagnostics,
  CORRAL_NATURAL_CLEARANCE, CORRAL_CLEARANCE_GEOMETRY_REFRESH_DAYS
} from '../src/simulation/ecology/corral-clearance.js';
import { corralFenceRadius } from '../src/simulation/ecology/herd.js';

const seedValues = (process.env.JUL290_SEEDS || '1,42,2026').split(',')
  .map(s => Number(s.trim()));
const days = Number(process.env.JUL290_DAYS || 35);
assert.ok(seedValues.length && seedValues.every(s => Number.isSafeInteger(s) && s > 0));
assert.ok(Number.isSafeInteger(days) && days >= 30 && days <= 365);
const stages = [
  'climate','roads','hydrology','vegetation','animals',
  'territoriesBeforeActors','looseLogs','decomposition','marketMaintenance',
  'territoriesAfterActors'
];
const percentage = (num,den) => den ? +(100 * num / den).toFixed(2) : 0;
const round = num => +num.toFixed(4);
function summarize(values) {
  const sorted = [...values].sort((a,b) => a - b);
  const sum = values.reduce((a,b) => a + b, 0);
  const percentile = p => sorted[Math.min(sorted.length - 1,
    Math.max(0, Math.ceil(p * sorted.length) - 1))];
  return { n: values.length, totalMs: round(sum), meanMs: round(sum / values.length),
    medianMs: round(percentile(.5)), p95Ms: round(percentile(.95)), maxMs: round(sorted.at(-1)) };
}
function worldDigest(world) {
  // Compare the complete authoritative WorldSnapshot AFTER timing, never in a
  // measured stage. This catches altered RNG, daily events, nutrition and tiles.
  const snapshot = createWorldSnapshot(world);
  return snapshot;
}
const daysBySeed = [], parity = [], recorded = [];
for (const seed of seedValues) {
  const profiled = Sim.createWorld(seed), original = Sim.createWorld(seed);
  for (let index = 0; index < days; index++) {
    const sampled = new Map();
    const before = performance.now();
    Sim.stepDay(profiled, {
      includeSnapshot: false,
      onEnvironmentPhase: (name, elapsedMs) => {
        assert.ok(stages.includes(name), 'unknown environment stage: ' + name);
        assert.equal(sampled.has(name), false, 'stage emitted more than once: ' + name);
        sampled.set(name, elapsedMs);
      }
    });
    const elapsedMs = performance.now() - before;
    assert.deepEqual([...sampled.keys()], stages,
      'Every environmental phase must be observed exactly once, in causal order.');
    const startBaseline = performance.now();
    Sim.stepDay(original, { includeSnapshot: false });
    const baselineMs = performance.now() - startBaseline;
    assert.equal(profiled.day, original.day);
    const group = profiled.day % 30 === 0 ? 'monthly'
      : profiled.day % 7 === 0 ? 'regrowth' : 'ordinary';
    const entry = { seed, day: profiled.day, group, stepWallMs: round(elapsedMs),
      unprofiledStepWallMs: round(baselineMs),
      phases: Object.fromEntries([...sampled].map(([key,value]) => [key,round(value)])) };
    recorded.push(entry);
    daysBySeed.push(entry);
  }
  const lhs = worldDigest(profiled), rhs = worldDigest(original);
  assert.deepEqual(lhs, rhs, 'Profiling changed an authoritative world for seed ' + seed);
  parity.push({ seed, days, exact: true, finalRngState: profiled.rngState,
    people: profiled.people.length, animals: profiled.animals.length,
    structures: profiled.structures.length });
  console.log('JUL290-SEED-PARITY', JSON.stringify(parity.at(-1)));
}
const stepTotal = recorded.reduce((sum,row) => sum + row.stepWallMs, 0);
const envTotal = recorded.reduce((sum,row) => sum
  + stages.reduce((a,key) => a + row.phases[key],0), 0);
const byPhase = stages.map(name => {
  const values = recorded.map(row => row.phases[name]);
  const summary = summarize(values);
  return { name, ...summary, shareOfMeasuredPhasesPercent: percentage(summary.totalMs,envTotal),
    shareOfWholeStepPercent: percentage(summary.totalMs,stepTotal),
    bySchedule: Object.fromEntries(['ordinary','regrowth','monthly'].map(group =>
      [group, summarize(recorded.filter(x=>x.group===group).map(x=>x.phases[name]))])) };
}).sort((a,b) => b.totalMs-a.totalMs);
const totalStep = summarize(recorded.map(r=>r.stepWallMs));
const baselineStep = summarize(recorded.map(r=>r.unprofiledStepWallMs));

function historicalCorralGeometry(world) {
  const indices = new Set();
  for (const pen of world.structures || []) {
    if (pen.type !== 'curral' || pen.destroyedDay != null || pen.integrity === 0) continue;
    const radius = Math.max(Number(pen.radius) || 3.5, corralFenceRadius(pen)) + CORRAL_NATURAL_CLEARANCE;
    const minX = Math.max(0, Math.floor(pen.x-radius));
    const maxX = Math.min(world.width-1, Math.ceil(pen.x+radius));
    const minY = Math.max(0, Math.floor(pen.y-radius));
    const maxY = Math.min(world.height-1, Math.ceil(pen.y+radius));
    for (let y=minY; y<=maxY; y++) for (let x=minX; x<=maxX; x++) {
      const dx=x-pen.x, dy=y-pen.y;
      if (dx*dx+dy*dy<=radius*radius) indices.add(y*world.width+x);
    }
  }
  return indices;
}
// Controlled microbenchmark to isolate the geometry cache, which otherwise
// is just a small component inside updatePlants. No physics/AI is changed.
const geometry = [];
for (const corralCount of [0,1,8,24]) {
  const width=112,height=112;
  const world = { day:0,width,height,tiles:Array.from({length:width*height}),
    structures:Array.from({length:corralCount},(_,i)=>({
      id:i+1,type:'curral',x:8+(i%7)*14,y:9+Math.floor(i/7)*22,
      radius:3.5,integrity:100
    })) };
  const oldTimes=[], newTimes=[];
  for (let day=0; day<120; day++) {
    world.day=day;
    // Alternate order to reduce single-order JIT/timing bias.
    let oldSet,newSet,oldMs,newMs;
    const runOld=()=>{const t=performance.now();oldSet=historicalCorralGeometry(world);oldMs=performance.now()-t;};
    const runNew=()=>{const t=performance.now();newSet=corralNaturalClearanceTiles(world);newMs=performance.now()-t;};
    if (day%2===0){runOld();runNew();}else{runNew();runOld();}
    assert.deepEqual([...newSet],[...oldSet], 'corral geometry mismatch, count='+corralCount+' day='+day);
    oldTimes.push(oldMs);newTimes.push(newMs);
  }
  const cache=corralClearanceCacheDiagnostics(world);
  assert.equal(cache.rebuilds,120/CORRAL_CLEARANCE_GEOMETRY_REFRESH_DAYS);
  geometry.push({
    corrals:corralCount, calls:120,
    cells:historicalCorralGeometry(world).size,
    previous: summarize(oldTimes), cached: summarize(newTimes),
    ratioOfSummedTimes: round(newTimes.reduce((a,b)=>a+b,0)
      / Math.max(.00001,oldTimes.reduce((a,b)=>a+b,0))),
    cache
  });
}
const report={
  schema:1, issue:'JUL-290', sourceCommit:process.env.GITHUB_SHA||'local',
  methodology:'Real Kingdom world steps, same seeds and day order. Opt-in synchronous performance.now for each environment stage; separate uninstrumented replay with exact full WorldSnapshot parity. Controls: 3 seeds, >=30 days, weekly regrowth and monthly upkeep. Corral geometry microbenchmark compares former geometric algorithm with 30d WeakMap cache, controlled 0/1/8/24 pens and 120 calls per density.',
  caveats:[
    'Node wall times are machine/load-dependent CPU proxies. They are not GPU timings, Chrome frame metrics or FPS.',
    'Stage share refers to the instrumented wall time. It excludes callbacks themselves and adds instrumentation overhead.',
    'Unprofiled runs execute after profiled runs, so wall differences do not establish optimizer speedups.',
    'The vegetation stage includes the daily corral clearance and weekly regeneration; ordinary and regrowth days must be compared separately.',
    'Corral geometry microbenchmark is isolated; its savings must not be extrapolated to the full simulation without overall A/B.',
    'No weather, hydrology, decomposition, NPC behavior or frequency was changed by this benchmark.'
  ], parity, days, seeds:seedValues,
  totals:{allStep:totalStep, unprofiledStep:baselineStep,
    observedPhaseMs:round(envTotal), shareOfWholeStepPercent:percentage(envTotal,stepTotal)},
  byPhase, geometryCache:geometry, daily:recorded
};
const output=resolve(process.argv[2]||'out/jul290-environment-cpu-profile.json');
await mkdir(dirname(output),{recursive:true});
await writeFile(output,JSON.stringify(report,null,2));
for(const phase of byPhase)
  console.log('JUL290-PHASE',JSON.stringify({
    phase:phase.name,totalMs:phase.totalMs,meanMs:phase.meanMs,p95Ms:phase.p95Ms,
    stepSharePercent:phase.shareOfWholeStepPercent,
    ordinaryMeanMs:phase.bySchedule.ordinary.meanMs,
    regrowthMeanMs:phase.bySchedule.regrowth.meanMs,
    monthlyMeanMs:phase.bySchedule.monthly.meanMs
  }));
for(const row of geometry)console.log('JUL290-CORRAL-CACHE',JSON.stringify(row));
console.log('JUL290-SUMMARY',JSON.stringify({
  seeds:seedValues,days,exactParity:parity.every(x=>x.exact),
  allStepMs:totalStep.totalMs,environmentSharePercent:report.totals.shareOfWholeStepPercent,
  topPhases:byPhase.slice(0,4).map(p=>p.name)
}));
console.log('PASSED JUL-290 environment CPU profiling, geometry parity and complete deterministic replay');
