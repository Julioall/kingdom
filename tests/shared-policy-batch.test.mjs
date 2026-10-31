import test from 'node:test';
import assert from 'node:assert/strict';
import { PEOPLE_ACTIONS } from '../src/config/ecosystem.js';
import { actorObservation, forwardBatch, forwardSharedBatch,
  forwardSharedPolicy, getSharedPolicy } from '../src/ai/policy/shared-policy.js';
import { createBrain } from '../src/controllers/individual/neural.js';

test('true vector batches equal current individual logits and probabilities at 24–1024 hidden units',()=>{
  for(const width of [24,64,128,256,512,1024]){
    const w={seed:42,epoch:1,day:1,neuralOverrides:{sharedHiddenSize:width}};
    const requests=Array.from({length:16},(_,i)=>{
      const actor={id:i+1,role:i%5===0?'ruler':i%4===0?'soldier':'resident',
        sociability:.2+i*.01,trust:.35,loyalty:.75,physicalStrength:.6,
        skills:{build:.35,diplomacy:.5},kingdomId:1,personalMemory:[]};
      actor.brain=createBrain(w,PEOPLE_ACTIONS,18,actor.id);
      return {actor,inputs:Array.from({length:18},(_,j)=>(i+j)/60),
        domain:'people',allowedActions:PEOPLE_ACTIONS.map((_,j)=>(i+j)%4!==0)};
    });
    const serial=requests.map(r=>forwardSharedPolicy(w,r.actor,r.inputs,'people',r.allowedActions));
    const batch=forwardSharedBatch(w,requests);
    assert.equal(batch.length,serial.length);
    for(let i=0;i<serial.length;i++){
      assert.deepEqual(batch[i].logits,serial[i].logits,'width '+width+' actor '+i);
      assert.deepEqual(batch[i].probs,serial[i].probs,'width '+width+' actor '+i);
    }
    const observations=requests.map(r=>actorObservation(w,r.actor,r.inputs,r.domain,r.allowedActions));
    const matrix=forwardBatch(getSharedPolicy(w).spec,observations);
    assert.equal(matrix.length,16);
    const outcomes=getSharedPolicy(w).inferBatch(observations);
    assert.equal(outcomes.length,16);
    assert.ok(outcomes.every(o=>o && o.actionId.startsWith('people:')));
  }
});
test('empty batches and masked-out actions are handled safely',()=>{
  const w={seed:11,day:1,neuralOverrides:{sharedHiddenSize:64}};
  assert.deepEqual(forwardSharedBatch(w,[]),[]);
  assert.deepEqual(getSharedPolicy(w).inferBatch([]),[]);
  const actor={id:1,role:'resident',skills:{},personalMemory:[]};
  const obs=actorObservation(w,actor,Array(18).fill(.1),'people',PEOPLE_ACTIONS.map(()=>false));
  const pred=forwardBatch(getSharedPolicy(w).spec,[obs])[0];
  assert.equal(pred.probs.reduce((a,b)=>a+b,0),0);
  assert.equal(getSharedPolicy(w).inferBatch([obs])[0],null);
});
