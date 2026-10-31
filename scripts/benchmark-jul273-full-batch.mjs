// JUL-273: full authoritative-world CPU and neural width benchmarks.
// Results are GitHub Linux CPU-only; they are not browser FPS or 100k proof.
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve,dirname } from 'node:path';
import Sim from '../src/simulation/engine.js';
import { PEOPLE_ACTIONS } from '../src/config/ecosystem.js';
import { createBrain } from '../src/controllers/individual/neural.js';
import { forwardSharedBatch,forwardSharedPolicy,getSharedPolicy } from '../src/ai/policy/shared-policy.js';
const args=Object.fromEntries(process.argv.slice(2).filter(s=>s.startsWith('--'))
  .map(s=>s.slice(2).split('=')));
const sizes=(args.sizes||'50,500').split(',').map(Number);
const widths=(args.widths||'24,64,128,256,512,1024').split(',').map(Number);
const output=resolve(args.output||'out/jul273-full-batch.json');
const worldResults=[],neuralResults=[];
const base = () => Sim.createWorld(42);
function setupPopulation(target,mode){
  const w=base();
  if(target<w.people.length){
    const people=w.people.slice(0,target);
    const ids=new Set(people.map(p=>p.id));
    w.people=people;
    for(const k of w.kingdoms || [])k.memberIds=(k.memberIds||[]).filter(id=>ids.has(id));
    for(const c of w.communities || [])c.memberIds=(c.memberIds||[]).filter(id=>ids.has(id));
  } else if(target>w.people.length)Sim.addIndividuals(w,target-w.people.length,false);
  w.neuralOverrides={...(w.neuralOverrides||{}),
    cognitiveSchedule:{mode,budget:128,batchSize:32}};
  return w;
}
for(const population of sizes) {
  for(const mode of ['budgeted','batched']) {
    const init=performance.now();
    const w=setupPopulation(population,mode);
    const generationMs=performance.now()-init;
    const days=population>=5000?1:population>=500?2:4;
    const timings=[];
    let batchedConsumed=0,batchedRejected=0,batchedPrefetched=0,backs=0,direct=0,precomputeMs=0;
    for(let d=0;d<days;d++){
      const t=performance.now();
      Sim.stepDay(w,{includeSnapshot:false});
      const time=performance.now()-t;
      timings.push(time);
      // No access to internal private batches: published metrics are only in
      // separate diagnostic call, never injected into saves.
      const {cognitiveDayMetrics}=await import('../src/ai/policy/cognitive-scheduler.js');
      const stats=cognitiveDayMetrics(w);
      const b=stats?.batch;
      batchedConsumed+=b?.consumed||0;
      batchedRejected+=b?.rejected||0;
      batchedPrefetched+=b?.queued||0;
      backs+=b?.backlog||0;
      direct+=stats?.directForwards||0;
      precomputeMs+=b?.precomputeMs||0;
    }
    const alive=w.people.filter(p=>p.alive).length;
    if(!timings.every(Number.isFinite) || alive===0)throw Error('Invalid full simulation '+population+'/'+mode);
    worldResults.push({
      requestedPopulation:population,peopleGenerated:w.people.length,alive,mode,
      generationMs,days,timings,meanDayMs:timings.reduce((x,y)=>x+y,0)/days,
      batchedPrefetched,batchedConsumed,batchedRejected,directForwards:direct,
      backlog:backs,precomputeMs,
      acceptanceRate:batchedPrefetched?batchedConsumed/batchedPrefetched:0
    });
    console.log('WORLD',JSON.stringify(worldResults.at(-1)));
  }
}
const widthPopulation=32,repeats=2;
for(const width of widths){
  const w={seed:42,day:1,epoch:1,neuralOverrides:{sharedHiddenSize:width}};
  const actors=Array.from({length:widthPopulation},(_,i)=>({
    id:i+1,role:i%5===0?'ruler':'resident',kingdomId:1,
    sociability:.45,trust:.4,loyalty:.6,physicalStrength:.7,
    skills:{build:.35,diplomacy:.3},brain:createBrain(w,PEOPLE_ACTIONS,18,i+1)
  }));
  const requests=actors.map((actor,i)=>({
    actor,inputs:Array.from({length:18},(_,j)=>(i+j+1)/100),
    domain:'people'
  }));
  const model=getSharedPolicy(w,'human');
  const scalarStart=performance.now();
  let serial;
  for(let j=0;j<repeats;j++) serial=requests.map(request=>
    forwardSharedPolicy(w,request.actor,request.inputs,'people'));
  const scalarMs=performance.now()-scalarStart;
  const batchStart=performance.now();
  let parallel;
  for(let j=0;j<repeats;j++)parallel=forwardSharedBatch(w,requests);
  const batchMs=performance.now()-batchStart;
  if(!parallel.every((r,i)=>r.logits.every((v,o)=>v===serial[i].logits[o]))) {
    throw Error('Scalar batch mismatch at width '+width);
  }
  neuralResults.push({
    hiddenWidth:width,actors:widthPopulation,repeats,
    networkWeightBytes:model.spec.weights.byteLength+model.spec.biases.byteLength,
    scalarMs,batchMs,ratio:batchMs/scalarMs,
    exactLogitParity:true
  });
  console.log('WIDTH',JSON.stringify(neuralResults.at(-1)));
}
const report={schema:1,commit:process.env.GITHUB_SHA||'unknown',
  environment:{node:process.version,cpu:cpus()[0]?.model},
  caveats:['Complete authoritative simulation world for requested populations, including ecology, society, pathfinding and actions; first days not a steady-state equilibrium.','Only cognitiveSchedule mode is varied; distinct simulation trajectories are possible.','Batched model uses speculative previous observation and must revalidate; high rejection may erase any benefit.','Does not test browser FPS, WebGPU, Worker transport or 100000 NPCs.'],
  worldResults,neuralResults};
await mkdir(dirname(output),{recursive:true});
await writeFile(output,JSON.stringify(report,null,2));
