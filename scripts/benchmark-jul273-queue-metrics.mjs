// JUL-273: isolated A/B harness for causal queue instrumentation overhead.
// Not a full-world benchmark; the queue is not connected to updatePeopleCore.
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const root=resolve(process.argv[2]||'.');
const {prepareCausalInferenceBatch}=await import(pathToFileURL(resolve(root,'src/ai/policy/causal-batch-queue.js')).href);
const {PEOPLE_ACTIONS}=await import(pathToFileURL(resolve(root,'src/config/ecosystem.js')).href);
const allowed=PEOPLE_ACTIONS.map(()=>true);
function actor(id){
  return {id,role:'resident',kingdomId:1,communityId:1,
    sociability:.5,trust:.6,loyalty:.7,physicalStrength:.8,
    skills:{build:.4,diplomacy:.3},personalMemory:[],lastReward:0};
}
function run(count){
  const world={seed:42,epoch:1,revision:2,day:4,
    neuralOverrides:{sharedHiddenSize:24}};
  const actors=Array.from({length:count},(_,i)=>actor(i+1));
  const inputs=Array.from({length:18},(_,i)=>(i+1)/40);
  const start=performance.now();
  const batch=prepareCausalInferenceBatch(world,actors.map(person=>({person,inputs})),
    {budget:count,batchSize:64});
  const preparedMs=performance.now()-start;
  const outputs=[];
  const consumeStart=performance.now();
  for(const person of actors){
    const result=batch.consume(world,person,inputs,allowed);
    if(!result)throw Error('Missing causal result for actor '+person.id);
    outputs.push(result.logits);
  }
  const latency=batch.metrics.latencyMs,wait=batch.metrics.waitDays;
  const consumedMs=performance.now()-consumeStart;
  if(batch.metrics.consumed!==count||latency.count!==count||wait.p99!==0)
    throw Error('Invalid queue metrics');
  const digest=createHash('sha256').update(JSON.stringify(outputs)).digest('hex');
  return {count,digest,preparedMs,consumedMs,batches:batch.metrics.batches,
    consumed:batch.metrics.consumed};
}
run(10); // warm up the module and JIT without including it in the report
for(const count of [50,500,2000,5000])console.log('QUEUE_AB',JSON.stringify(run(count)));
