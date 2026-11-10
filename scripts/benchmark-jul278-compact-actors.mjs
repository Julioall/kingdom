// JUL-278: compare default full snapshot actor objects with explicit compact
// presentation mode after real simulation steps; no production default change.
// JSON bytes and Node clone time are CPU/size proxies, not actual FPS.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { mkdirSync,writeFileSync } from 'node:fs';
import { dirname,resolve } from 'node:path';
import { createSimulationWorkerRuntime } from '../src/simulation/worker-runtime.js';
import { SIMULATION_PROTOCOL_VERSION } from '../src/simulation/protocol-version.js';
import { compactActorSnapshotBase } from '../src/simulation/compact-actor-snapshot.js';

const bytes=v=>new TextEncoder().encode(JSON.stringify(v)).byteLength;
const seeds=[1,42,2026],samples=[];
function create(seed,mode){
  const worker=createSimulationWorkerRuntime();let requestId=0;
  const send=(type,fields={})=>worker.handle({protocolVersion:SIMULATION_PROTOCOL_VERSION,
    requestId:++requestId,epoch:1,type,...fields});
  const init=send('initialize',{seed,config:{scenario:'kingdom'},
    ...(mode==='compact'?{transport:'tile-delta-compact'}:{})});
  assert.equal(init.type,'snapshot');
  return {send,init};
}
function actorFields(base){
  return {people:base.people,animals:base.animals};
}
function measureClone(value,iterations=4){
  let elapsed=0;
  for(let i=0;i<iterations;i++){
    const began=performance.now();
    const copy=structuredClone(value);
    elapsed+=performance.now()-began;
    assert.equal(copy.people.length,value.people.length);
  }
  return elapsed/iterations;
}
for(const seed of seeds){
  const original=create(seed,'full'),compact=create(seed,'compact');
  for(const day of [0,1,2]){
    const full=day?original.send('advance',{days:1,source:'manual'}):original.init;
    const lite=day?compact.send('advance',{days:1,source:'manual'}):compact.init;
    assert.equal(full.type,'snapshot');
    assert.ok(lite.type==='world-delta'||lite.type==='snapshot');
    const fullBase=full.snapshot.base;
    const compactBase=lite.type==='world-delta'?lite.delta.base:lite.snapshot.base;
    assert.deepEqual(compactBase.people,compactActorSnapshotBase(fullBase).people);
    assert.deepEqual(compactBase.animals,compactActorSnapshotBase(fullBase).animals);
    const before=actorFields(fullBase),after=actorFields(compactBase);
    const fullActorBytes=bytes(before),compactActorBytes=bytes(after);
    const fullBaseBytes=bytes(fullBase),compactBaseBytes=bytes(compactBase);
    const record={seed,day,
      people:before.people.length,animals:before.animals.length,
      fullActorBytes,compactActorBytes,fullBaseBytes,compactBaseBytes,
      actorReductionPercent:+(100*(1-compactActorBytes/fullActorBytes)).toFixed(2),
      baseReductionPercent:+(100*(1-compactBaseBytes/fullBaseBytes)).toFixed(2),
      fullActorCloneMs:+measureClone(before).toFixed(3),
      compactActorCloneMs:+measureClone(after).toFixed(3)};
    samples.push(record);
    console.log('JUL278-COMPACT-DAY',JSON.stringify(record));
    assert.ok(compactBaseBytes<fullBaseBytes,
      'compact actor DTO must actually reduce world base bytes');
    const first=compactBase.people[0];
    assert.deepEqual(Object.keys(first.brain),['lastAction'],
      'only lastAction needed for animation may cross the Worker');
    const detail=compact.send('inspect-person',{personId:first.id});
    assert.equal(detail.type,'query');
    assert.ok(detail.result.actor.brain);
    assert.equal(detail.result.day,day);
  }
}
const sum=k=>samples.reduce((n,r)=>n+r[k],0);
const summary={seeds,days:[0,1,2],worlds:samples.length,
  fullActorBytes:sum('fullActorBytes'),compactActorBytes:sum('compactActorBytes'),
  fullBaseBytes:sum('fullBaseBytes'),compactBaseBytes:sum('compactBaseBytes'),
  actorReductionPercent:+(100*(1-sum('compactActorBytes')/sum('fullActorBytes'))).toFixed(2),
  baseReductionPercent:+(100*(1-sum('compactBaseBytes')/sum('fullBaseBytes'))).toFixed(2),
  fullCloneMeanMs:+(sum('fullActorCloneMs')/samples.length).toFixed(3),
  compactCloneMeanMs:+(sum('compactActorCloneMs')/samples.length).toFixed(3)};
const report={schema:1,issue:'JUL-278',sourceSha:process.env.GITHUB_SHA||'unknown',
  summary,samples,
  methodology:'Three real seeded worlds, days 0/1/2 each; full snapshots versus opt-in tile-delta-compact, exact compact projection parity and fetch of full selected person on every day. JSON byte proxy and mean Node structuredClone of actor rows (4 copies) exclude the rest of transport/Worker rendering.',
  limitations:[
    'Compact mode enabled only by explicit negotiation or the DEV-only query flag, never the default game.',
    'JSON bytes and Node structuredClone time are approximate, not measured browser Worker postMessage bandwidth or total memory/CPU.',
    'Only selected cognition fields omitted; rendering and the rest of the world base continue full until UI consumer audit.',
    'Chrome SwiftShader smoke verifies basic inspector; production rollout requires full manual and automated browser GPU/p95/heap A/B.'
  ]};
const target=resolve(process.argv[2]||'out/jul278-compact-actors.json');
mkdirSync(dirname(target),{recursive:true});writeFileSync(target,JSON.stringify(report,null,2));
console.log('JUL278-COMPACT-SUMMARY',JSON.stringify(summary));
console.log('PASSED JUL-278 compact actor opt-in projection A/B with exact cognition queries');
