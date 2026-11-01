import test from 'node:test';
import assert from 'node:assert/strict';
import {createTransportDiagnostics,tileTransportBytes} from '../src/app/worker-transport-diagnostics.js';

const snapshot={type:'snapshot',snapshot:{tileColumns:{
 scalars:new Float32Array(10),ids:new Int32Array(5),
 types:new Uint8Array(8),plants:new Float32Array(20)
}}};
const field={type:'world-delta',delta:{tileColumns:{schemaVersion:2,fields:{
 scalars:[{field:1,values:new Float32Array(4),indices:Uint32Array.from([0,2,4,9])},
          {field:2,values:new Float32Array(10)}],
 ids:[],types:[],plants:[{field:3,values:new Float32Array(1),indices:Uint32Array.of(5)}]
}}}};
const row={type:'world-delta',delta:{tileColumns:{schemaVersion:1,
 indices:Uint32Array.from([1,2]),scalars:new Float32Array(4),
 ids:new Int32Array(2),types:new Uint8Array(2),plants:new Float32Array(3)}}};
test('tracks exact typed bytes without claiming to measure entity structured clone',()=>{
 assert.equal(tileTransportBytes(snapshot),40+20+8+80);
 assert.equal(tileTransportBytes(field),16+16+40+4+4);
 assert.equal(tileTransportBytes(row),8+16+8+2+12);
});
test('tracks latency and resync diagnostics without mutation from readers',()=>{
 const stats=createTransportDiagnostics();
 stats.record(snapshot,12);
 stats.record(field,2);
 stats.record(row,3);
 stats.invalid();
 stats.resync();
 const first=stats.snapshot();
 assert.equal(first.fullSnapshots,1);
 assert.equal(first.fieldDeltas,1);
 assert.equal(first.rowDeltas,1);
 assert.equal(first.resyncRequests,1);
 assert.equal(first.invalidDeltas,1);
 assert.equal(first.packets,3);
 assert.equal(first.lastApplyMs,3);
 assert.equal(first.maxApplyMs,12);
 assert.equal(first.meanApplyMs,17/3);
 assert.equal(first.typedBytes,tileTransportBytes(snapshot)+tileTransportBytes(field)+tileTransportBytes(row));
 first.fullSnapshots=100;
 assert.equal(stats.snapshot().fullSnapshots,1);
});
