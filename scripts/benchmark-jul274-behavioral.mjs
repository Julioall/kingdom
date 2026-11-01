// JUL-274 — behavior and rollback A/B of full Kingdom worlds.
// Different controllers intentionally produce different trajectories.
// Only seeded reruns *of the same configuration* require equal digests.
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import Sim from '../src/simulation/engine.js';
import {cognitiveDayMetrics} from '../src/ai/policy/cognitive-scheduler.js';
const seeds=[1,42,2026];
// Longer campaign QA is opt-in: six-day historical results remain comparable.
const rawDays=Number(process.env.JUL274_DAYS || 6);
if(!Number.isSafeInteger(rawDays)||rawDays<1||rawDays>90)
 throw Error('JUL274_DAYS must be an integer in [1,90]');
const days=rawDays;
const scenarios=[
 {name:'legacy',controller:'legacy',schedule:null},
 {name:'shared-unlimited',controller:'shared',schedule:null},
 {name:'shared-budgeted',controller:'shared',schedule:{mode:'budgeted',budget:32}}
];
function safe(v){return Number.isFinite(v)?v:0}
function measure(w){
 const alive=w.people.filter(p=>p.alive);
 const byRole=Object.fromEntries(['resident','soldier','ruler'].map(role=>
  [role,alive.filter(p=>p.role===role).length]));
 const result={
  day:w.day,peopleAlive:alive.length,animalCount:w.animals.filter(a=>a.alive).length,
  deaths:w.deaths,births:w.births,deathsByCause:w.deathsByCause,
  trades:w.trades,conflicts:w.conflicts,borderIncidents:w.borderIncidents,
  raidAttempts:w.raidAttempts,successfulRaids:w.successfulRaids,
  structuresComplete:w.structures.filter(s=>s.complete).length,
  activeKingdoms:w.kingdoms.length,
  governmentDecisions:w.strategicAI?.decisions||0,
  byRole,
  meanFoodReserve:alive.length?alive.reduce((n,p)=>n+safe(p.foodReserve),0)/alive.length:0,
  meanHydration:alive.length?alive.reduce((n,p)=>n+safe(p.hydration),0)/alive.length:0,
  meanHealth:alive.length?alive.reduce((n,p)=>n+safe(p.health),0)/alive.length:0,
  cognitionMissing:alive.filter(p=>!p.cognitiveState).length,
  sharedBrainDenseWeights:alive.filter(p=>p.brain?.inputWeights?.length>0).length,
  lastActions:alive.reduce((map,p)=>{
   const action=p.lastDecision?.action||p.brain?.lastAction||'unknown';
   map[action]=(map[action]||0)+1;return map;
  },{}),
  ignoredDanger:alive.filter(p=>p.health<=0||!Number.isFinite(p.health)).length
 };
 return result;
}
function digest(data){return createHash('sha256').update(JSON.stringify(data)).digest('hex')}
function run(seed,scenario){
 const w=Sim.createWorld(seed,scenario.controller==='legacy'?{neuralController:'legacy'}:{});
 if(scenario.schedule)w.neuralOverrides={...w.neuralOverrides,cognitiveSchedule:scenario.schedule};
 const dayTimes=[],trajectory=[],queues=[];
 const startingDay=w.day;
 for(let i=0;i<days;i++){
  const start=performance.now();
  Sim.stepDay(w,{includeSnapshot:false});
  dayTimes.push(performance.now()-start);
  const stats=measure(w);
  if(w.day!==startingDay+i+1)throw Error('Unexpected world day '+seed+'/'+scenario.name);
  trajectory.push(stats);
  const cognitive=cognitiveDayMetrics(w);
  queues.push(cognitive?{day:w.day,budget:cognitive.budget,inferred:cognitive.inferred,
   urgent:cognitive.urgent,utilityOnly:cognitive.utilityOnly,reused:cognitive.reused,
   maxCacheAgeDays:cognitive.maxCacheAgeDays,maxRoutineWaitDays:cognitive.maxRoutineWaitDays}:null);
  if(stats.ignoredDanger||stats.peopleAlive<1||!Number.isFinite(stats.meanFoodReserve)
    ||!Number.isFinite(stats.meanHydration)||!Number.isFinite(stats.meanHealth))
    throw Error('Invalid vital state '+seed+'/'+scenario.name);
  if(scenario.controller==='shared'&&stats.sharedBrainDenseWeights)
    throw Error('Unexpected dense NPC weights '+seed+'/'+scenario.name);
 }
 const summary=trajectory.at(-1);
 return {seed,scenario:scenario.name,digest:digest(trajectory),summary,trajectory,queues,
   meanDayMs:dayTimes.reduce((a,b)=>a+b,0)/dayTimes.length,
   timingsMs:dayTimes};
}
const data=[];
for(const seed of seeds)for(const scenario of scenarios){
 const one=run(seed,scenario);
 const replay=run(seed,scenario);
 if(one.digest!==replay.digest){
  throw Error('Nondeterministic '+seed+'/'+scenario.name+' '+one.digest+' vs '+replay.digest);
 }
 data.push(one);
 console.log('QUALITY',JSON.stringify({seed,scenario:scenario.name,meanDayMs:one.meanDayMs,
  alive:one.summary.peopleAlive,deaths:one.summary.deaths,trades:one.summary.trades,
  buildings:one.summary.structuresComplete,meanFood:one.summary.meanFoodReserve,
  meanHydration:one.summary.meanHydration,successfulReplay:true}));
}
const comparisons=seeds.map(seed=>{
 const rows=data.filter(r=>r.seed===seed);
 return {seed,scenarios:rows.map(r=>({name:r.scenario,alive:r.summary.peopleAlive,
   meanFoodReserve:r.summary.meanFoodReserve,meanHealth:r.summary.meanHealth,
   deaths:r.summary.deaths,trades:r.summary.trades,structuresComplete:r.summary.structuresComplete,
   meanDayMs:r.meanDayMs,actions:r.summary.lastActions}))};
});
const report={schema:1,sourceCommit:process.env.GITHUB_SHA||'unknown',
 methodology:'Same-seed independent full-world runs, every scenario replayed twice for exact within-mode parity. Separate model trajectories are NOT required to match. Not a claim that cognitive quality is equivalent.',
 caveats:`${days} simulated days / three seeds, CPU-only GitHub runner. Scenarios do not force wars or trade; a zero-activity metric is NOT evidence of quality. Manual visual and real GPU validation still necessary.`,
 seeds,days,scenarios,comparisons,data};
const file=resolve(process.argv[2]||'out/jul274-behavioral.json');
await mkdir(dirname(file),{recursive:true});
await writeFile(file,JSON.stringify(report,null,2));
console.log('PASSED within-mode deterministic replays',data.length);
