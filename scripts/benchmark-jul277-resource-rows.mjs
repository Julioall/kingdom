// JUL-277: quantify whether resource-row field patches (keyed by tileIndex)
// can shrink the perception payload WITHOUT changing Worker/UI behavior.
// Only an offline codec/analysis: the live Worker is untouched until the
// full-cost CPU, transfer size and inspector compatibility gates are met.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Sim from '../src/simulation/engine.js';
import {
  diffPerceptionResourceRows, applyPerceptionResourceRowsPatch
} from '../src/simulation/perception-resource-delta.js';

const bytes = value => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const fields=['perception','navigationRoute','knownRoutes','sensoryMemory',
  'brain','militaryBrain','lastDecision','cognitiveState'];
const seeds=[1,42,2026],maxDay=8;
const samples=[];
const round = v => +v.toFixed(4);
function actors(world) {
  return [...world.people,...world.animals].filter(x=>x.alive!==false);
}
function snapshot(world) {
  return new Map(actors(world).map(a=>[a.id,{
    resources:structuredClone(a.perception?.resources||[])
  }]));
}
for(const seed of seeds){
  const world=Sim.createWorld(seed);
  Sim.stepDay(world,{includeSnapshot:false});
  let previous=snapshot(world);
  for(let day=2;day<=maxDay;day++){
    Sim.stepDay(world,{includeSnapshot:false});
    const summary={seed,day,animals:world.animals.length,people:world.people.length,
      actors:0,patched:0,fullFallback:0,
      currentRawBytes:0,encodedBytes:0,
      encodeMs:0,decodeMs:0,
      totalRows:0,updatedRows:0,addedRows:0,removedRows:0,
      fieldJsonBytes:Object.fromEntries(fields.map(f=>[f,0]))};
    for(const actor of actors(world)){
      const rows=actor.perception?.resources||[];
      const old=previous.get(actor.id)?.resources||[];
      const time=performance.now();
      const patch=diffPerceptionResourceRows(old,rows);
      summary.encodeMs+=performance.now()-time;
      const raw=bytes(rows);
      const encoded=patch?bytes(patch):raw;
      summary.actors++;
      summary.totalRows+=rows.length;
      summary.currentRawBytes+=raw;
      summary.encodedBytes+=encoded;
      if(patch){
        const start=performance.now();
        const reconstructed=applyPerceptionResourceRowsPatch(old,structuredClone(patch));
        summary.decodeMs+=performance.now()-start;
        assert.deepEqual(reconstructed,rows,
          'resource projection mismatch seed '+seed+' day '+day+' actor '+actor.id);
        summary.patched++;
        summary.updatedRows+=patch.updated.length;
        summary.addedRows+=patch.added.length;
        summary.removedRows+=patch.removed.length;
      } else summary.fullFallback++;
      for(const key of fields){
        const value=actor[key];
        if(value!==undefined) summary.fieldJsonBytes[key]+=bytes(value);
      }
    }
    summary.reductionPercent=round(100*(1-summary.encodedBytes/summary.currentRawBytes));
    summary.encodeMs=round(summary.encodeMs);
    summary.decodeMs=round(summary.decodeMs);
    samples.push(summary);
    previous=snapshot(world);
    console.log('JUL277-RESOURCE-DAY',JSON.stringify({
      seed,day,actors:summary.actors,rows:summary.totalRows,
      patched:summary.patched,fullFallback:summary.fullFallback,
      rawBytes:summary.currentRawBytes,transmittedProxyBytes:summary.encodedBytes,
      reductionPercent:summary.reductionPercent,
      encodeMs:summary.encodeMs,decodeMs:summary.decodeMs
    }));
  }
}
const sum=k=>samples.reduce((s,row)=>s+row[k],0);
const gross=sum('currentRawBytes'),encoded=sum('encodedBytes');
const report={schema:1,issue:'JUL-277',sourceSha:process.env.GITHUB_SHA||'unknown',
  seeds,daysPerSeed:maxDay-1,days:maxDay,
  summary:{
    samples:samples.length,actors:sum('actors'),rows:sum('totalRows'),
    patched:sum('patched'),fullFallback:sum('fullFallback'),
    rawResourceBytes:gross,encodedResourceBytes:encoded,
    resourceBytesReductionPercent:round(100*(1-encoded/gross)),
    patchEncodeMs:round(sum('encodeMs')),patchDecodeMs:round(sum('decodeMs')),
    currentHotFieldBytes:Object.fromEntries(fields.map(f=>
      [f,samples.reduce((s,row)=>s+row.fieldJsonBytes[f],0)]))
  },
  methodology:'Three seeded, complete simulations days 1..8, resource observations from living people and animals. Compare day N-1 to N by tileIndex with field-level add/update/remove and stable order, independently decode every emitted patch and deep-compare to full actual resources. Estimate JSON byte proxy and Node encode/decode wall time outside the simulation step.',
  caveats:[
    'This is not yet an enabled Worker delta: all model, simulation and UI transport still use current authoritative snapshots.',
    'Savings apply only to perception.resources, not to whole entity JSON, navigationRoute, global snapshots or total structuredClone messages.',
    'UTF-8 encoded JSON bytes are proxies, not actual transferable Worker wire bytes or memory allocation.',
    'Even a large byte reduction can be a CPU regression. Require live browser transfer/heap/latency A/B and inspector-on-demand design before rollout.',
    'Field snapshots can be large. This benchmark retains previous observation arrays only to measure a lower bound; production would need a bounded cache.'
  ],samples};
const out=resolve(process.argv[2]||'out/jul277-resource-row-deltas.json');
mkdirSync(dirname(out),{recursive:true});
writeFileSync(out,JSON.stringify(report,null,2));
console.log('JUL277-RESOURCE-SUMMARY',JSON.stringify(report.summary));
console.log('PASSED JUL-277 resource row codec with lossless simulated-world reconstruction');
