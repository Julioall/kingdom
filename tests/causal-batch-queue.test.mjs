import test from 'node:test';
import assert from 'node:assert/strict';
import { PEOPLE_ACTIONS } from '../src/config/ecosystem.js';
import { forwardSharedPolicy } from '../src/ai/policy/shared-policy.js';
import { batchLatencySummary, observationsMatch,
  prepareCausalInferenceBatch } from '../src/ai/policy/causal-batch-queue.js';
import { actorObservation } from '../src/ai/policy/shared-policy.js';

function actor(id){
 return {id,role:'resident',kingdomId:1,communityId:1,
   sociability:.5,trust:.6,loyalty:.7,physicalStrength:.8,
   skills:{build:.4,diplomacy:.3},personalMemory:[],lastReward:0};
}
function make(count=10){
 const world={seed:42,epoch:1,revision:2,day:4,neuralOverrides:{sharedHiddenSize:24}};
 const actors=Array.from({length:count},(_,i)=>actor(i+1));
 const inputs=Array.from({length:18},(_,i)=>(i+1)/40);
 return {world,actors,inputs};
}
const all=()=>PEOPLE_ACTIONS.map(()=>true);

test('real neural kernel processes prioritized observations and matches scalar logits exactly',()=>{
 const {world,actors,inputs}=make(9);
 const list=actors.map((person,i)=>({person,inputs:inputs.slice(),
   urgent:i===8,waitingDays:i,priority:0}));
 const batch=prepareCausalInferenceBatch(world,list,{budget:2,batchSize:2});
 assert.equal(batch.metrics.queueDepth,9);
 assert.equal(batch.metrics.selected,3);
 assert.equal(batch.metrics.backlog,6);
 assert.equal(batch.metrics.batches,2);
 for(const id of [9,8,7]){
   const person=actors[id-1];
   const out=batch.consume(world,person,inputs,all());
   const scalar=forwardSharedPolicy(world,person,inputs,'people');
   assert.deepEqual(out.logits,scalar.logits);
 }
 assert.equal(batch.metrics.consumed,3);
 assert.equal(batch.remaining(),0);
 assert.equal(batch.consume(world,actors[8],inputs,all()),null,'output cannot be reused');
 assert.equal(batch.metrics.missed,1);
 assert.equal(batch.metrics.batchCompute.count,2);
 assert.equal(batch.metrics.latencyMs.count,3);
 assert.ok(batch.metrics.latencyMs.p95Ms>=0);
});
test('mask changes take effect at consumption without poisoning unmasked computation',()=>{
 const {world,actors,inputs}=make(1);
 const batch=prepareCausalInferenceBatch(world,[{person:actors[0],inputs}],{budget:1});
 const mask=PEOPLE_ACTIONS.map(x=>x==='rest');
 const out=batch.consume(world,actors[0],inputs,mask);
 assert.ok(out.logits.every((x,i)=>mask[i]||x===-1e9));
 assert.equal(batch.metrics.consumed,1);
});
test('stale perception, role, identity, ownership, day, epoch and revision all reject cached result',()=>{
 for(const type of ['features','role','kingdom','community','epoch','revision','day']){
   const {world,actors,inputs}=make(1);
   const batch=prepareCausalInferenceBatch(world,[{person:actors[0],inputs}],{budget:1});
   if(type==='features')actors[0].lastReward=.7;
   if(type==='role')actors[0].role='ruler';
   if(type==='kingdom')actors[0].kingdomId=2;
   if(type==='community')actors[0].communityId=2;
   if(type==='epoch')world.epoch++;
   if(type==='revision')world.revision++;
   if(type==='day')world.day++;
   const out=batch.consume(world,actors[0],inputs,all());
   assert.equal(out,null,type);
   assert.equal(batch.metrics.rejected,1,type);
 }
});
test('typed feature vectors, duplicate actors and empty lists obey quotas',()=>{
 const {world,actors,inputs}=make(5);
 const t=new Float32Array(inputs);
 const batch=prepareCausalInferenceBatch(world,[
   {person:actors[0],inputs:t},
   {person:actors[0],inputs:t},
   {person:actors[1],inputs}
 ],{budget:1,batchSize:3});
 assert.equal(batch.metrics.queueDepth,2);
 assert.equal(batch.metrics.selected,1);
 assert.equal(batch.consume(world,actors[0],t,all())?.logits.length,PEOPLE_ACTIONS.length);
 assert.equal(batch.consume(world,actors[1],inputs,all()),null);
 const zero=prepareCausalInferenceBatch(world,[],{budget:1});
 assert.equal(zero.metrics.batches,0);
 assert.deepEqual(batchLatencySummary([]),{count:0,p50Ms:0,p95Ms:0,p99Ms:0,maxMs:0});
});
test('same-seed queues produce identical outputs and priorities, independently of clock timing',()=>{
 const a=make(25),b=make(25);
 const construct=({world,actors,inputs})=>
   prepareCausalInferenceBatch(world,actors.map((person,i)=>({person,inputs,urgent:i===14,
   waitingDays:i%5,priority:i%3})),{budget:7,batchSize:4});
 const x=construct(a),y=construct(b);
 assert.equal(x.metrics.urgent,y.metrics.urgent);
 assert.equal(x.metrics.batches,y.metrics.batches);
 for(let id=1;id<=25;id++){
   const p=x.consume(a.world,a.actors[id-1],a.inputs,all());
   const q=y.consume(b.world,b.actors[id-1],b.inputs,all());
   assert.deepEqual(p?.logits||null,q?.logits||null);
 }
 assert.equal(x.metrics.consumed,y.metrics.consumed);
 assert.equal(x.metrics.backlog,y.metrics.backlog);
});
test('observation identity is checked, not merely actor ID',()=>{
 const {world,actors,inputs}=make(1);
 const a=actorObservation(world,actors[0],inputs,'people');
 const b=actorObservation(world,{...actors[0],role:'ruler'},inputs,'people');
 assert.equal(observationsMatch(a,b),false);
});
