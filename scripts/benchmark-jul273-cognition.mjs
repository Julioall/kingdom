// JUL-273 controlled inference microbenchmark. Simulated people only:
// does NOT measure ecology, pathfinding, snapshots, FPS or 100k NPC gameplay.
import { performance } from 'node:perf_hooks';
import { cpus, platform } from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { PEOPLE_ACTIONS } from '../src/config/ecosystem.js';
import { createBrain, choosePeopleAction } from '../src/controllers/individual/neural.js';
import { beginCognitiveDay, cognitiveDayMetrics, cognitiveMaxWaitDays }
  from '../src/ai/policy/cognitive-scheduler.js';

const days=6, budget=128, sizes=[50,500,5000];
const inputs = Array.from({length:18}, (_,i)=>(i+1)/30);
const allowed=PEOPLE_ACTIONS.map(name=>name==='rest'?8:-1e9);
function create(size,enabled) {
 const world={seed:42,day:0,epoch:1,rngState:42,people:[],
   neuralOverrides:enabled ? {cognitiveSchedule:{mode:'budgeted',budget}} : {}};
 for(let id=1;id<=size;id++)world.people.push({
   id,alive:true,ageDays:10000,role:'resident',
   health:100,energy:100,hydration:100,foodReserve:100,injury:0,
   sociability:.5,trust:.5,loyalty:.5,physicalStrength:.5,
   skills:{build:.5,diplomacy:.5},kingdomId:1,
   brain:createBrain(world,PEOPLE_ACTIONS,18,id)
 });
 return world;
}
const results=[];
for (const size of sizes) for (const mode of ['unlimited','budgeted']) {
 const world=create(size,mode==='budgeted'), durations=[], counts={inferred:0,urgent:0,reused:0,utilityOnly:0};
 let decisions=0;
 for(let day=0;day<days;day++){
   world.day=day;beginCognitiveDay(world,world.people);
   const t=performance.now();
   for(const person of world.people){
     const action=choosePeopleAction(world,person,inputs,allowed);
     if(action!=='rest')throw Error('Live action mask changed at actor '+person.id);
     decisions++;
   }
   durations.push(performance.now()-t);
   const stats=cognitiveDayMetrics(world);
   if(stats)for(const key of Object.keys(counts))counts[key]+=stats[key];
 }
 if(decisions!==size*days)throw Error('Missing decisions');
 if(mode==='budgeted' && counts.inferred>Math.min(size,budget)*days)throw Error('Budget exceeded');
 const sorted=durations.slice().sort((a,b)=>a-b);
 const bytes=world.people.reduce((n,p)=>n+
   (p.brain.cognitiveInferenceCache ?
     new TextEncoder().encode(JSON.stringify(p.brain.cognitiveInferenceCache)).byteLength : 0),0);
 results.push({size,mode,days,decisions,budget,
   maxRoutineWaitDays:cognitiveMaxWaitDays(size,budget),
   meanDayMs:durations.reduce((a,b)=>a+b,0)/days,
   p95DayMs:sorted[Math.ceil(sorted.length*.95)-1],
   totalMs:durations.reduce((a,b)=>a+b,0),
   cachedBrainBytes:bytes, counters:counts});
}
const report={schema:1,commit:process.env.GITHUB_SHA||'unknown',
  cpu:cpus()[0]?.model,node:process.version,platform:platform(),
  methodology:'Synthetic actor decision microbenchmark: fixed utilities, no world physics, no worker, no GPU; 50/500/5000 actors, 6 days; cache after decisions only. Do not extrapolate to 100k gameplay.',
  results};
const output=resolve(process.argv[2]||'out/jul273-cognition-ab.json');
await mkdir(dirname(output),{recursive:true});
await writeFile(output,JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
