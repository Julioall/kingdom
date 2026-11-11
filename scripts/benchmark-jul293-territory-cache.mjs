// JUL-293: full-real-world, paired, deterministic territory cache A/B.
// Exact authoritative snapshot digest + RNG are checked after EVERY day.
// Synchronous Node timing here is a CPU proxy, NOT browser GPU/FPS evidence.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import Sim from '../src/simulation/engine.js';
import { authoritativeSnapshotDigest } from './support/jul274-snapshot-digest.mjs';
import {
  setTerritoryRecomputeMode, territoryRecomputeDiagnostics
} from '../src/simulation/kingdoms/territory-cache.js';

const seeds = [1,42,2026];
const days = Number(process.env.JUL293_DAYS || 35);
assert.ok(Number.isSafeInteger(days) && days >= 31 && days <= 90);
const samples = [];
function summarize(arr) {
  const values=arr.slice().sort((a,b)=>a-b);
  const sum=arr.reduce((a,b)=>a+b,0);
  return {
    n:arr.length,totalMs:+sum.toFixed(2),
    meanMs:+(sum/arr.length).toFixed(3),
    p95Ms:+values[Math.ceil(values.length*.95)-1].toFixed(3)
  };
}
function measure(world) {
  const phases = {};
  const begin = performance.now();
  Sim.stepDay(world, {
    includeSnapshot: false,
    onEnvironmentPhase: (name, time) => {
      if (name === 'territoriesBeforeActors' || name === 'territoriesAfterActors')
        phases[name] = time;
    }
  });
  return {stepMs:performance.now()-begin,
    beforeMs:phases.territoriesBeforeActors,
    afterMs:phases.territoriesAfterActors,
    territoryMs:phases.territoriesBeforeActors+phases.territoriesAfterActors};
}
for (const seed of seeds) {
  const cached = Sim.createWorld(seed);
  const always = Sim.createWorld(seed);
  setTerritoryRecomputeMode(cached,'cached');
  setTerritoryRecomputeMode(always,'always');
  for(let day=1; day<=days; day++) {
    let old,optimized;
    if(day % 2 === 0) {
      optimized=measure(cached);old=measure(always);
    } else {
      old=measure(always);optimized=measure(cached);
    }
    assert.equal(cached.rngState,always.rngState,
      'RNG parity failure seed '+seed+' day '+day);
    assert.equal(authoritativeSnapshotDigest(cached),authoritativeSnapshotDigest(always),
      'Authoritative world parity failed seed '+seed+' day '+day);
    samples.push({seed,day,order:day%2===0?'cached-first':'full-first',
      full:old,cached:optimized,
      diagnostics:territoryRecomputeDiagnostics(cached)});
  }
  const stats=territoryRecomputeDiagnostics(cached);
  assert.ok(stats.skipped>0,'No territory recomputations skipped for seed '+seed);
  assert.ok(stats.recomputed>0,'No initial territory recomputation for seed '+seed);
  console.log('JUL293-SEED',JSON.stringify({
    seed,days,exactParity:true,stats,finalRngState:cached.rngState
  }));
}
const fields=['beforeMs','afterMs','territoryMs','stepMs'];
const summary=Object.fromEntries(fields.map(name=>{
  const full=summarize(samples.map(x=>x.full[name]));
  const cached=summarize(samples.map(x=>x.cached[name]));
  return [name,{full,cached,differencePercent:
    +(100*(cached.totalMs/full.totalMs-1)).toFixed(2)}];
}));
const saved=Object.fromEntries(seeds.map(seed=>{
  const last=samples.filter(x=>x.seed===seed).at(-1).diagnostics;
  return [seed,last];
}));
const report={
  schema:1,issue:'JUL-293',sourceSha:process.env.GITHUB_SHA||'unknown',
  seeds,days,fullSnapshotParity:true,recordCount:samples.length,
  methodology:'3 seeded real worlds x 35 days x full/cached territory modes, alternating daily order. Same actor logic, both territory passes, exact authoritative snapshot SHA256 and RNG checked after each day. Node performance.now phase timings. Claim expiry/change and siege cases in unit tests.',
  limits:[
    'Wall time is Linux Node CPU proxy and is affected by JIT, GC and scheduling; not Chrome FPS.',
    'This benchmark validates the normal daily actor simulation; directed siege, building and annexation cases are covered by targeted tests, not forced in all 35-day runs.',
    'The guard scans tile ownership and metadata each day, so speed depends on map size and density of territory-influence sources.',
    'Cache is WeakMap-only; no persistent save schema modifications.'
  ],summary,diagnostics:saved,samples
};
const output=resolve(process.argv[2] || 'out/jul293-territory-cache.json');
await mkdir(dirname(output),{recursive:true});
await writeFile(output,JSON.stringify(report,null,2));
console.log('JUL293-SUMMARY',JSON.stringify({summary,diagnostics:saved}));
console.log('PASSED JUL-293 full-world territory cache parity and CPU A/B');
