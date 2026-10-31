import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { PEOPLE_ACTIONS } from '../src/config/ecosystem.js';
import { actorObservation, forwardBatch, forwardSharedPolicy,
  forwardSharedBatch, getSharedPolicy } from '../src/ai/policy/shared-policy.js';
import { prepareInferenceBatches } from '../src/ai/policy/cognitive-batch.js';
import { beginCognitiveDay, cognitiveDayMetrics, inferCognitivePeople } from '../src/ai/policy/cognitive-scheduler.js';
import { createBrain, choosePeopleAction } from '../src/controllers/individual/neural.js';
import { createCognitiveState } from '../src/ai/policy/individual-state.js';

const inputs = Array.from({length:18},(_,i)=>(i+1)/24);
const utility = PEOPLE_ACTIONS.map(action=>action==='rest'?8:-1e9);
function world(count=12,width=24,mode='batched'){
  const w={seed:42,day:0,epoch:1,rngState:42,people:[],neuralOverrides:{
    sharedHiddenSize:width,cognitiveSchedule:{mode,budget:count,batchSize:8}
  }};
  for(let id=1;id<=count;id++){
    const p={id,alive:true,ageDays:9000,role:'resident',health:100,energy:100,
      hydration:100,foodReserve:100,injury:0,kingdomId:1,
      sociability:.4,trust:.5,loyalty:.6,physicalStrength:.7,
      skills:{build:.4,diplomacy:.5},personalMemory:[]};
    p.brain=createBrain(w,PEOPLE_ACTIONS,18,id);
    p.cognitiveState=createCognitiveState(w,p);
    p.lastDecision={day:0,inputs:inputs.slice(),action:'rest'};
    w.people.push(p);
  }
  return w;
}
test('true contiguous MLP batches are exactly equivalent to independent inference for 24/64/256/1024 widths',()=>{
  for(const width of [24,64,256,1024]){
    const w=world(9,width);
    const requests=w.people.map((actor,i)=>({actor,
      inputs:inputs.map((x,j)=>x+i*j*.0001),domain:'people',
      allowedActions:PEOPLE_ACTIONS.map((_,j)=>(j+i)%3!==0)}));
    const individual=requests.map(r=>forwardSharedPolicy(w,r.actor,r.inputs,'people',r.allowedActions));
    const batched=forwardSharedBatch(w,requests);
    assert.equal(batched.length,9);
    for(let i=0;i<9;i++){
      assert.deepEqual(batched[i].logits,individual[i].logits);
      assert.deepEqual(batched[i].probs,individual[i].probs);
    }
    const observations=requests.map(r=>actorObservation(w,r.actor,r.inputs,r.domain,r.allowedActions));
    assert.equal(forwardBatch(getSharedPolicy(w).spec,observations).length,9);
  }
});
test('priority queue runs urgent first and respects routine budget',()=>{
  const w=world(9);
  const arr=w.people.map((person,i)=>({person,inputs:inputs.slice(),
    urgency:i===8,waitingDays:i,queuePriority:0}));
  const batch=prepareInferenceBatches(w,arr,{budget:2,batchSize:2});
  assert.equal(batch.metrics.queueDepth,9);
  assert.equal(batch.metrics.queued,3);
  assert.equal(batch.metrics.batches,2);
  assert.equal(batch.metrics.urgentQueued,1);
  assert.equal(batch.metrics.backlog,6);
  const allowed=PEOPLE_ACTIONS.map(()=>true);
  assert.ok(batch.consume(w,w.people[8],inputs,allowed));
  assert.ok(batch.consume(w,w.people[7],inputs,allowed));
  assert.ok(batch.consume(w,w.people[6],inputs,allowed));
  assert.equal(batch.consume(w,w.people[0],inputs,allowed),null);
  assert.equal(batch.metrics.consumed,3);
  assert.equal(batch.remaining(),0);
  assert.ok(batch.metrics.batchCompute.p95Ms>=0);
});
test('batched logits are used in the real action adapter when observation stays identical',()=>{
  const w=world(18);
  beginCognitiveDay(w,w.people);
  for(const p of w.people)assert.equal(choosePeopleAction(w,p,inputs,utility),'rest');
  const stats=cognitiveDayMetrics(w);
  assert.equal(stats.batch.consumed,18);
  assert.equal(stats.batch.rejected,0);
  assert.equal(stats.directForwards,0);
});
test('changed inputs, personality, role, epoch and individual memories reject stale batched logits',()=>{
  for(const type of ['inputs','personality','role','epoch','memory']){
    const w=world(2);
    beginCognitiveDay(w,w.people);
    const p=w.people[0];
    if(type==='personality')p.sociability=.9;
    if(type==='role')p.role='soldier';
    if(type==='epoch')w.epoch++;
    if(type==='memory')p.lastReward=.8;
    const modified=type==='inputs'?inputs.map(x=>x+.3):inputs;
    const score=inferCognitivePeople(w,p,modified,utility.map(v=>v>-1e8));
    const actual=forwardSharedPolicy(w,p,modified,'people',utility.map(v=>v>-1e8));
    assert.deepEqual(score.logits,actual.logits,type);
    const metrics=cognitiveDayMetrics(w);
    assert.equal(metrics.batch.rejected,1,type);
    assert.equal(metrics.directForwards,1,type);
  }
});
test('batched priority selection and results are reproducible without using wall time for gameplay',()=>{
  const a=world(70),b=world(70);
  for(let day=0;day<3;day++){
    for(const w of [a,b]){
      w.day=day;
      beginCognitiveDay(w,w.people);
      for(const p of w.people){
        choosePeopleAction(w,p,inputs,utility);
        p.lastDecision={day,inputs:inputs.slice(),action:'rest'};
      }
    }
    assert.deepEqual(a.people.map(p=>p.brain.lastAction),b.people.map(p=>p.brain.lastAction));
    assert.deepEqual(a.people.map(p=>p.brain.cognitiveInferenceCache),
      b.people.map(p=>p.brain.cognitiveInferenceCache));
    // Wall-clock profiling is deliberately excluded from gameplay equality.
    assert.equal(cognitiveDayMetrics(a).batch.consumed,cognitiveDayMetrics(b).batch.consumed);
  }
});
