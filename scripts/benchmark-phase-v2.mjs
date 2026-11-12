// Instrumented vs non-instrumented full Kingdom simulation, same seed and host.
// Measures Node synchronous wall time, never browser FPS/GPU. No gameplay skips.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import Sim from '../src/simulation/engine.js';
import { authoritativeSnapshotDigest } from './support/jul274-snapshot-digest.mjs';

const seeds=(process.env.KINGDOM_V2_SEEDS||'1,42,2026').split(',').map(Number);
const days=Number(process.env.KINGDOM_V2_DAYS||7);
assert.ok(seeds.every(x=>Number.isSafeInteger(x)&&x>0)&&Number.isSafeInteger(days)&&days>0&&days<=365);
const samples=[], parity=[];
for(const seed of seeds){
  const instrumented=Sim.createWorld(seed), control=Sim.createWorld(seed);
  for(let i=0;i<days;i++){
    const phases={};
    const start=performance.now();
    Sim.stepDay(instrumented,{includeSnapshot:false,onSimulationPhase(name,ms){
      assert.ok(!Object.hasOwn(phases,name),'duplicate '+name);
      phases[name]=ms;
    }});
    const duration=performance.now()-start;
    const before=performance.now();
    Sim.stepDay(control,{includeSnapshot:false});
    const baselineMs=performance.now()-before;
    const lhs=authoritativeSnapshotDigest(instrumented),rhs=authoritativeSnapshotDigest(control);
    assert.equal(lhs,rhs,'full world changed under profiling seed='+seed+' day='+instrumented.day);
    samples.push({seed,day:instrumented.day,durationMs:duration,unprofiledMs:baselineMs,phases});
  }
  parity.push({seed,days,exact:true,people:control.people.length,animals:control.animals.length});
}
function stats(values){
  const a=[...values].sort((x,y)=>x-y);const sum=values.reduce((x,y)=>x+y,0);
  return {count:a.length,totalMs:sum,meanMs:sum/a.length,
    p50Ms:a[Math.max(0,Math.ceil(a.length*.5)-1)],
    p95Ms:a[Math.max(0,Math.ceil(a.length*.95)-1)],maxMs:a.at(-1)};
}
const phaseKeys=Object.keys(samples[0].phases);
const phases=Object.fromEntries(phaseKeys.map(key=>[key,stats(samples.map(x=>x.phases[key]))]));
const ranking=Object.entries(phases).sort((a,b)=>b[1].totalMs-a[1].totalMs);
const report={schema:1,sourceCommit:process.env.GITHUB_SHA||'local',seeds,days,parity,
  limitations:['Node CPU wall time, not FPS or GPU','instrumented and control are sequential; not optimizer A/B',
    'source-identical control proves profiling does not mutate simulation'],
  total:stats(samples.map(x=>x.durationMs)),unprofiled:stats(samples.map(x=>x.unprofiledMs)),phases,ranking,samples};
const output=resolve(process.argv[2]||'out/kingdom-v2-phases.json');
await mkdir(dirname(output),{recursive:true});
await writeFile(output,JSON.stringify(report,null,2));
console.log('PERF-V2',JSON.stringify({seeds,days,parity,top:ranking.slice(0,8).map(([name,s])=>({name,p95Ms:s.p95Ms,meanMs:s.meanMs}))}));
