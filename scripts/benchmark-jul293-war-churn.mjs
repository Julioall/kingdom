// JUL-293: stress territory cache under real tower damage and project commands,
// with scripted annexations/completions to force rare events repeatedly.
// Every event boundary and daily step compares authoritative world + RNG.
// Node wall times are CPU proxies, not Chrome GPU frame measurements.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Sim from '../src/simulation/engine.js';
import { setTerritoryRecomputeMode, territoryRecomputeDiagnostics } from '../src/simulation/kingdoms/territory-cache.js';
import { authoritativeSnapshotDigest } from './support/jul274-snapshot-digest.mjs';
import { applyScriptedTerritorialWarEvents, WAR_STRESS_DAYS } from './support/jul293-war-stress.mjs';

const seeds=[1,42,2026];
const samples=[];
const eventCounts={};
function measureStep(world) {
  const phases={};
  const start=performance.now();
  Sim.stepDay(world,{includeSnapshot:false,onEnvironmentPhase:(name,ms)=>{
    if(name==='territoriesBeforeActors'||name==='territoriesAfterActors') phases[name]=ms;
  }});
  return {ms:performance.now()-start,territoryMs:
    phases.territoriesBeforeActors+phases.territoriesAfterActors};
}
function measureEvents(world) {
  const start=performance.now();
  const events=applyScriptedTerritorialWarEvents(world);
  return {ms:performance.now()-start,events};
}
function assertParity(a,b,label){
  assert.equal(a.rngState,b.rngState,label+' rng');
  assert.equal(authoritativeSnapshotDigest(a),authoritativeSnapshotDigest(b),
    label+' full authoritative state');
}
for(const seed of seeds){
  const cached=Sim.createWorld(seed),full=Sim.createWorld(seed);
  setTerritoryRecomputeMode(cached,'cached');
  setTerritoryRecomputeMode(full,'always');
  const events=[];
  for(let day=0;day<WAR_STRESS_DAYS;day++){
    const reverse=day%2===0;
    const firstEvents=reverse?measureEvents(cached):measureEvents(full);
    const secondEvents=reverse?measureEvents(full):measureEvents(cached);
    const eventA=reverse?firstEvents:secondEvents;
    const eventB=reverse?secondEvents:firstEvents;
    assert.deepEqual(eventA.events,eventB.events,
      'Event command differed seed '+seed+' day '+day);
    assertParity(cached,full,'after event seed '+seed+' day '+day);
    for(const event of eventA.events){
      const key=event.action+(event.changed?' success':' unchanged');
      eventCounts[key]=(eventCounts[key]||0)+1;
      events.push(event);
    }
    const first=reverse?measureStep(cached):measureStep(full);
    const second=reverse?measureStep(full):measureStep(cached);
    const measuredCached=reverse?first:second;
    const measuredFull=reverse?second:first;
    assertParity(cached,full,'after day step seed '+seed+' day '+day);
    samples.push({seed,day:cached.day,order:reverse?'cached-first':'full-first',
      events:eventA.events,
      cached:{...measuredCached,eventMs:eventA.ms},
      full:{...measuredFull,eventMs:eventB.ms},
      cacheDiagnostics:territoryRecomputeDiagnostics(cached)});
  }
  const stats=territoryRecomputeDiagnostics(cached);
  assert.ok(stats.skipped>0,'No territory cache hits for seed '+seed);
  assert.ok(stats.recomputed>=5,'War stress did not invalidate enough times seed '+seed);
  assert.ok(events.some(e=>e.action==='siege-destroy'&&e.changed),
    'No real siege caused tower destruction seed '+seed);
  assert.ok(events.some(e=>e.action==='annexation'&&e.changed),
    'No annexation injected seed '+seed);
  assert.ok(events.some(e=>e.action==='build-project'&&e.changed),
    'No real paid construction project succeeded seed '+seed);
  assert.ok(events.some(e=>e.action==='complete-project'&&e.changed),
    'No construction completion occurred seed '+seed);
  console.log('JUL293-WAR-SEED',JSON.stringify({
    seed,days:WAR_STRESS_DAYS,parity:true,stats,
    successfulBuilds:events.filter(e=>e.action==='build-project'&&e.changed).length,
    sieges:events.filter(e=>e.action==='siege-destroy'&&e.changed).length,
    annexations:events.filter(e=>e.action==='annexation'&&e.changed).length
  }));
}
function stats(metric,mode) {
  const values=samples.map(row=>row[mode][metric]);
  const total=values.reduce((a,b)=>a+b,0);
  const sorted=[...values].sort((a,b)=>a-b);
  return {n:values.length,totalMs:+total.toFixed(3),meanMs:+(total/values.length).toFixed(3),
    p95Ms:+sorted[Math.ceil(.95*sorted.length)-1].toFixed(3)};
}
const comparison=Object.fromEntries(['territoryMs','eventMs','ms'].map(metric=>{
  const full=stats(metric,'full'),cached=stats(metric,'cached');
  return [metric,{full,cached,
    changePercent:+((cached.totalMs/full.totalMs-1)*100).toFixed(2)}];
}));
const report={schema:1,issue:'JUL-293',sourceSha:process.env.GITHUB_SHA||'unknown',
  seeds,days:WAR_STRESS_DAYS,events:eventCounts,parity:true,comparison,samples,
  methodology:'Real-world deterministic simulation with actual Kingdom paid tower projects and damageStructure siege destruction; deliberate accelerated construction completions and annexed claims to stress rare invalidations; comparisons of SHA256 full WorldSnapshot + RNG at each scripted event and each full simulation day.',
  caveats:[
    'Accelerated completion and forced claims/movement are QA injections, not a player-controlled normal campaign or observed emergent war.',
    'Linux/Node wall times are CPU proxies subject to runner noise, not browser GPU FPS.',
    'The scripted stress is bounded to 35 days and 3 world seeds; follow with longer campaigns and local GPU QA.'
  ]};
const file=resolve(process.argv[2]||'out/jul293-war-churn.json');
mkdirSync(dirname(file),{recursive:true});
writeFileSync(file,JSON.stringify(report,null,2));
console.log('JUL293-WAR-SUMMARY',JSON.stringify({events:eventCounts,comparison}));
console.log('PASSED JUL-293 repeated real siege and construction event parity, 3 seeds x 35 days');
