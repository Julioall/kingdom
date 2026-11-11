import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulationWorkerRuntime} from '../src/simulation/worker-runtime.js';
import {SIMULATION_PROTOCOL_VERSION} from '../src/simulation/protocol-version.js';
import {applyWorldSnapshot,applyWorldTileDelta} from '../src/simulation/render-snapshot.js';

test('opt-in delta protocol keeps legacy full snapshots and supports resync and new epochs',()=>{
 const legacy=createSimulationWorkerRuntime();
 let id=0;
 const send=(runtime,type,extra={},epoch=1)=>
  runtime.handle({protocolVersion:SIMULATION_PROTOCOL_VERSION,requestId:++id,epoch,type,...extra});
 const first=send(legacy,'initialize',{seed:42,config:{scenario:'kingdom'}});
 assert.equal(first.type,'snapshot');assert.equal(first.snapshot.reset,true);
 const legacyDay1=send(legacy,'advance',{days:1,source:'manual'});
 assert.equal(legacyDay1.type,'snapshot',
   'clients that do not negotiate delta continue to receive full snapshots');
 const runtime=createSimulationWorkerRuntime();
 const init=send(runtime,'initialize',{seed:42,config:{scenario:'kingdom'},transport:'tile-delta'});
 assert.equal(init.type,'snapshot');assert.equal(init.snapshot.reset,true);
 const update=send(runtime,'advance',{days:1,source:'manual'});
 assert.equal(update.type,'world-delta','daily fields must use sparse transport');
 assert.equal(update.delta.baseRevision,init.revision);
 assert.equal(update.delta.tileColumns.schemaVersion,2);
 const rendered=applyWorldTileDelta(update.delta,applyWorldSnapshot(init.snapshot));
 const expected=applyWorldSnapshot(legacyDay1.snapshot);
 assert.deepEqual(rendered.tiles,expected.tiles);
 assert.deepEqual(rendered.waterTiles.map(t=>t.i),expected.waterTiles.map(t=>t.i));
 const reloaded=send(runtime,'resync');
 assert.equal(reloaded.type,'snapshot');assert.equal(reloaded.snapshot.reset,true);
 assert.equal(reloaded.snapshot.base.day,1);
 assert.ok(reloaded.revision>update.revision);
 const reset=send(runtime,'reset',{seed:99,kingdomAiEnabled:false,transport:'tile-delta'},2);
 assert.equal(reset.type,'snapshot');assert.equal(reset.snapshot.reset,true);
 assert.equal(reset.snapshot.base.day,0);
 assert.equal(send(runtime,'advance',{days:1},1).type,'error');
 assert.equal(send(runtime,'advance',{days:1},2).type==='error',false);
});
