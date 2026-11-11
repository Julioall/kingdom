// JUL-278 — compare render-only entity transport against the identical full
// authoritative WorldSnapshot base. Browser real GPU/structuredClone latency
// still needs separate headful A/B. Do not infer FPS from Node timings.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import Sim from '../src/simulation/engine.js';
import { createWorldSnapshot } from '../src/simulation/render-snapshot.js';
import { createCompactPresentationBase } from '../src/simulation/compact-presentation.js';

const seeds=[1,42,2026],days=[0,1,7],samples=[];
const jsonBytes=x=>Buffer.byteLength(JSON.stringify(x),'utf8');
for(const seed of seeds){
  const world=Sim.createWorld(seed);
  for(const day of days){
    while(world.day<day)Sim.stepDay(world,{includeSnapshot:false});
    const full=createWorldSnapshot(world).base;
    const began=performance.now();
    const compact=createCompactPresentationBase(full);
    const projectionMs=performance.now()-began;
    assert.equal(compact.people.length,full.people.length);
    assert.equal(compact.animals.length,full.animals.length);
    assert.ok(compact.people.every((actor,i)=>actor.id===full.people[i].id));
    assert.ok(compact.animals.every((actor,i)=>actor.id===full.animals[i].id));
    assert.ok(compact.people.every((actor,i)=>actor.x===full.people[i].x&&actor.y===full.people[i].y));
    const fullBytes=jsonBytes(full),compactBytes=jsonBytes(compact);
    let fullCloneMs,compactCloneMs;
    for(let attempt=0;attempt<2;attempt++){
      const reversed=(day+attempt)%2===0;
      const a=reversed?compact:full,b=reversed?full:compact;
      const first=performance.now();structuredClone(a);
      const firstMs=performance.now()-first;
      const second=performance.now();structuredClone(b);
      const secondMs=performance.now()-second;
      if(attempt===1){
        fullCloneMs=reversed?secondMs:firstMs;
        compactCloneMs=reversed?firstMs:secondMs;
      }
    }
    const row={seed,day,people:full.people.length,animals:full.animals.length,
      fullJsonBytes:fullBytes,compactJsonBytes:compactBytes,
      deltaPercent:+(100*(1-compactBytes/fullBytes)).toFixed(2),
      projectionMs:+projectionMs.toFixed(3),
      fullCloneMs:+fullCloneMs.toFixed(3),
      compactCloneMs:+compactCloneMs.toFixed(3)};
    samples.push(row);
    console.log('JUL278-COMPACT-SAMPLE',JSON.stringify(row));
  }
}
const total=k=>samples.reduce((n,r)=>n+r[k],0);
const summary={
  samples:samples.length,
  fullJsonBytes:total('fullJsonBytes'),
  compactJsonBytes:total('compactJsonBytes'),
  reductionPercent:+(100*(1-total('compactJsonBytes')/total('fullJsonBytes'))).toFixed(2),
  projectionTotalMs:+total('projectionMs').toFixed(3),
  fullCloneTotalMs:+total('fullCloneMs').toFixed(3),
  compactCloneTotalMs:+total('compactCloneMs').toFixed(3)
};
const report={schema:1,issue:'JUL-278',
  seeds,days,summary,samples,
  methodology:'Full authoritative world in 3 seeds and days 0,1,7. createWorldSnapshot base projected into a nonmutating render actor DTO. JSON byte proxy across complete base and structuredClone Node wall-time CPU proxies, alternating A/B order. No browser FPS or real transfer measured.',
  limits:[
    'The scene already uses other collections inside base; these are unchanged. Savings are for the whole base, not tiled binary buffers.',
    'Node clone times are not Chrome Worker postMessage latency, GC, heap or GPU FPS.',
    'Benchmark does not guarantee that every UI component supports stripped cognition; browser inspector regression and real GPU QA are required.',
    'Compact mode is development opt-in; default Worker transport and world behavior are unchanged.'
  ]};
const out=resolve(process.argv[2]||'out/jul278-compact-render.json');
await mkdir(dirname(out),{recursive:true});
await writeFile(out,JSON.stringify(report,null,2));
console.log('JUL278-COMPACT-SUMMARY',JSON.stringify(summary));
console.log('PASSED JUL-278 nonmutating compact transport baseline/clone byte benchmark');
