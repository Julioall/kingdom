import {performance} from 'node:perf_hooks';
import {writeFile,mkdir} from 'node:fs/promises';
import Sim from '../src/simulation/engine.js';
import {createWorldSnapshot,applyWorldSnapshot,applyWorldTileDelta} from '../src/simulation/render-snapshot.js';
import {createTileColumnDelta,tileColumnBytes} from '../src/simulation/tile-delta.js';
import {createFieldTileDelta,fieldTileDeltaBytes} from '../src/simulation/field-delta.js';
import assert from 'node:assert/strict';

const results=[];
for(const seed of [1,42,2026]) {
 const world=Sim.createWorld(seed);
 let prev=createWorldSnapshot(world,{reset:true});
 let sparseView=applyWorldSnapshot(prev);
 let fullView=applyWorldSnapshot(prev);
 for(let day=1;day<=3;day++){
   const simStart=performance.now();
   Sim.stepDay(world,{includeSnapshot:false});
   const simulationMs=performance.now()-simStart;
   const packStart=performance.now();
   const next=createWorldSnapshot(world);
   const packMs=performance.now()-packStart;
   const start=performance.now();
   const sparse=createTileColumnDelta(next.tileColumns,prev.tileColumns)
     || createFieldTileDelta(next.tileColumns,prev.tileColumns);
   const diffMs=performance.now()-start;
   const beforeFull=performance.now();
   fullView=applyWorldSnapshot(next,fullView);
   const fullApplyMs=performance.now()-beforeFull;
   const beforeSparse=performance.now();
   if(sparse){
     sparseView=applyWorldTileDelta({base:next.base,tileColumns:sparse,stats:next.stats,
       events:next.events,logs:next.logs,baseRevision:day-1,reset:false},sparseView);
   }else sparseView=applyWorldSnapshot(next,sparseView);
   const sparseApplyMs=performance.now()-beforeSparse;
   assert.deepEqual(sparseView.tiles,fullView.tiles);
   assert.deepEqual(sparseView.waterTiles.map(t=>t.i),fullView.waterTiles.map(t=>t.i));
   assert.equal(sparseView.people.length,fullView.people.length);
   const count=sparse?.schemaVersion===1?sparse.indices.length:next.tileColumns.tileCount;
   results.push({
     seed,day,people:world.people.length,
     simulationMs,packMs,diffMs,fullApplyMs,sparseApplyMs,
     tileCount:next.tileColumns.tileCount,changedTiles:count,
     usedDelta:!!sparse,deltaSchema:sparse?.schemaVersion||null,
     changedPercent:100*count/next.tileColumns.tileCount,
     fullColumnBytes:tileColumnBytes(next.tileColumns),
     transferredTileBytes:sparse ? (sparse.schemaVersion===2?
       fieldTileDeltaBytes(sparse):tileColumnBytes(sparse)+sparse.indices.byteLength)
       :tileColumnBytes(next.tileColumns)
   });
   console.log('DELTA_DAY',JSON.stringify(results.at(-1)));
   prev=next;
 }
}
const report={schemaVersion:1,commit:process.env.GITHUB_SHA||'unknown',
 caveats:'Full-world A/B of 3 simulated days after new world. Measures typed tile columns only; full base people/kingdoms still transmitted. Diff scans entire tile grid on Worker. No browser FPS or 5000 NPC guarantee.',
 results};
await mkdir('out',{recursive:true});
await writeFile('out/jul277-delta-ab.json',JSON.stringify(report,null,2));
