import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../src/simulation/engine.js';
import {createWorldSnapshot,applyWorldSnapshot,applyWorldTileDelta} from '../src/simulation/render-snapshot.js';
import {createFieldTileDelta,fieldTileDeltaBytes,validFieldTileDelta,
  transferablesForFieldTileDelta} from '../src/simulation/field-delta.js';
import {tileColumnBytes} from '../src/simulation/tile-delta.js';
const packet=(next,fields)=>({base:next.base,tileColumns:fields,
  stats:next.stats,events:next.events,logs:next.logs,
  reset:false,baseRevision:1});
const expected=(snapshot)=>({
  tileCount:snapshot.tileColumns.tileCount,
  plantCount:snapshot.tileColumns.plantCount,
  scalarFields:snapshot.tileColumns.scalars.length/snapshot.tileColumns.tileCount,
  idFields:snapshot.tileColumns.ids.length/snapshot.tileColumns.tileCount,
  typeFields:snapshot.tileColumns.types.length/snapshot.tileColumns.tileCount
});
test('field deltas preserve all 12544 tile projections after actual simulation day',()=>{
 const world=Sim.createWorld(42);
 const before=createWorldSnapshot(world,{reset:true});
 const projection=applyWorldSnapshot(before);
 Sim.stepDay(world,{includeSnapshot:false});
 const after=createWorldSnapshot(world);
 const fields=createFieldTileDelta(after.tileColumns,before.tileColumns);
 assert.ok(fields,'a field delta must be smaller than a full snapshot for ordinary daily changes');
 assert.ok(validFieldTileDelta(fields,expected(after)));
 assert.ok(fieldTileDeltaBytes(fields)<tileColumnBytes(after.tileColumns)*.8);
 const result=applyWorldTileDelta(packet(after,fields),projection);
 const full=applyWorldSnapshot(after);
 assert.deepEqual(result.tiles,full.tiles);
 assert.deepEqual(result.waterTiles.map(t=>t.i),full.waterTiles.map(t=>t.i));
 assert.deepEqual(result.stats,full.stats);
 assert.equal(result.people.length,world.people.length);
 assert.ok(transferablesForFieldTileDelta(fields).length>=1);
});
test('sparse field changes preserve ore, plant, stump, and terrain/water membership',()=>{
 const world=Sim.createWorld(17),before=createWorldSnapshot(world);
 const view=applyWorldSnapshot(before);
 const land=world.tiles.find(t=>t.terrain==='land'),water=world.tiles.find(t=>t.terrain==='water');
 land.goldOre+=1;land.plants[0]+=2;land.stump={untilDay:33};
 water.terrain='land';water.waterKind=null;water.soilType='loam';
 const next=createWorldSnapshot(world),delta=createFieldTileDelta(next.tileColumns,before.tileColumns);
 assert.ok(delta);
 const actual=applyWorldTileDelta(packet(next,delta),view);
 const full=applyWorldSnapshot(next);
 assert.deepEqual(actual.tiles,full.tiles);
 assert.deepEqual(actual.waterTiles.map(t=>t.i),full.waterTiles.map(t=>t.i));
});
test('duplicate/out-of-range field positions and unexpected formats fail closed',()=>{
 const world=Sim.createWorld(21),before=createWorldSnapshot(world);
 world.tiles[0].goldOre+=1;
 const after=createWorldSnapshot(world);
 const patch=createFieldTileDelta(after.tileColumns,before.tileColumns);
 assert.ok(patch);
 assert.ok(validFieldTileDelta(patch,expected(after)));
 const bad=structuredClone(patch);
 bad.fields.scalars[0].field=999;
 assert.equal(validFieldTileDelta(bad,expected(after)),false);
 const view=applyWorldSnapshot(before);
 assert.throws(()=>applyWorldTileDelta(packet(after,bad),view),/delta/);
});
