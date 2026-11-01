import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../src/simulation/world/generation.js';
import {createWorldSnapshot,applyWorldSnapshot,applyWorldTileDelta} from '../src/simulation/render-snapshot.js';
import {createTileColumnDelta,copyTileColumns,validTileColumnDelta,tileColumnBytes,
  transferablesForTileDelta} from '../src/simulation/tile-delta.js';

function make() {
 const w=createWorld(42);
 const first=createWorldSnapshot(w,{reset:true});
 return {w,first,view:applyWorldSnapshot(first)};
}
function packet(w,first,second,maxChangedFraction=1) {
 const tileColumns=createTileColumnDelta(second.tileColumns,first.tileColumns,{maxChangedFraction});
 return {base:second.base,tileColumns,stats:second.stats,events:second.events,
   logs:second.logs,baseRevision:1,reset:false};
}
test('a sparse tile delta preserves fields and full snapshot projection exactly',()=>{
 const {w,first,view}=make();
 const land=w.tiles.find(x=>x.terrain==='land');
 const water=w.tiles.find(x=>x.terrain==='water');
 assert.ok(land && water);
 land.goldOre+=1.25;land.copperOre+=2.5;land.kingdomId=9;
 land.stump={untilDay:75};land.plants[0]+=.125;
 water.terrain='land';water.soilType='loam';water.waterKind=null;
 w.day=1;
 const second=createWorldSnapshot(w);
 const delta=packet(w,first,second);
 assert.ok(delta.tileColumns.indices.length<=3);
 assert.ok(validTileColumnDelta(delta.tileColumns,view.tiles.length,second.tileColumns.plantCount));
 assert.ok(tileColumnBytes(delta.tileColumns)<tileColumnBytes(second.tileColumns)*.01);
 const result=applyWorldTileDelta(delta,view);
 const full=applyWorldSnapshot(second);
 assert.deepEqual(result.tiles,full.tiles);
 assert.deepEqual(result.waterTiles.map(t=>t.i),full.waterTiles.map(t=>t.i));
 assert.equal(result.day,1);
 assert.deepEqual(result.stats,full.stats);
 assert.deepEqual(result.events,full.events);
 assert.deepEqual(result.logs,full.logs);
 assert.equal(transferablesForTileDelta(delta).length,5);
});
test('zero-change tile packet still updates non-tile base, stats, events and logs',()=>{
 const {w,first,view}=make();w.day=3;w.logs.push({day:3,text:'test'});
 const second=createWorldSnapshot(w);
 const delta=packet(w,first,second);
 assert.equal(delta.tileColumns.indices.length,0);
 const before=view.tiles[0];
 const out=applyWorldTileDelta(delta,view);
 assert.strictEqual(out.tiles[0],before);
 assert.equal(out.day,3);
 assert.deepEqual(out.logs,second.logs);
});
test('excessive tile mutations fall back to a full snapshot',()=>{
 const {w,first}=make();
 for(let i=0;i<Math.ceil(w.tiles.length*.4);i++)w.tiles[i].goldOre=(w.tiles[i].goldOre||0)+1;
 const next=createWorldSnapshot(w);
 assert.equal(createTileColumnDelta(next.tileColumns,first.tileColumns),null);
 assert.ok(createTileColumnDelta(next.tileColumns,first.tileColumns,{maxChangedFraction:1}));
});
test('detached full snapshot buffer needs a private retained copy',()=>{
 const {w,first}=make();const saved=copyTileColumns(first.tileColumns);
 const transfer=[first.tileColumns.scalars.buffer,first.tileColumns.ids.buffer,
   first.tileColumns.types.buffer,first.tileColumns.plants.buffer];
 structuredClone(first.tileColumns,{transfer});
 assert.equal(first.tileColumns.scalars.byteLength,0);
 assert.ok(saved.scalars.byteLength>0);
 w.tiles[0].roadWear+=.2;
 assert.ok(createTileColumnDelta(createWorldSnapshot(w).tileColumns,saved,{maxChangedFraction:1}));
});
test('unsorted, duplicate or invalid indices are rejected before mutating view',()=>{
 const {w,first,view}=make();
 w.tiles[0].goldOre+=1;w.tiles[2].ironOre+=1;
 const changed=createWorldSnapshot(w);
 const delta=packet(w,first,changed);
 assert.ok(delta.tileColumns.indices.length>=2);
 delta.tileColumns.indices[1]=delta.tileColumns.indices[0];
 assert.equal(validTileColumnDelta(delta.tileColumns,w.tiles.length,changed.tileColumns.plantCount),false);
 assert.throws(()=>applyWorldTileDelta(delta,view),/delta/i);
});
