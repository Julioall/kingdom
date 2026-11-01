// JUL-273 — causal-safe neural batch queue library.
// This module DOES NOT alter the authoritative NPC loop or schedule itself.
import { actorObservation, forwardBatch, getSharedPolicy } from './shared-policy.js';
import { PEOPLE_ACTIONS } from '../../config/ecosystem.js';

const featureKeys = Object.freeze([
  'perceptionFeatures', 'roleFeatures', 'personalityFeatures',
  'memoryFeatures', 'contextFeatures'
]);
const now = () => typeof performance !== 'undefined' ? performance.now() : 0;
const normal = value => Number.isFinite(value) ? value : 0;
const sortedQuantile = (sorted,p) => sorted.length ?
  sorted[Math.max(0,Math.ceil(sorted.length*p)-1)] : 0;
export function batchLatencySummary(samples) {
  // Sort once on demand; spreading large samples into Math.max can overflow.
  const sorted=samples.slice().sort((a,b)=>a-b);
  return {
    count:sorted.length,
    p50Ms:sortedQuantile(sorted,.50),p95Ms:sortedQuantile(sorted,.95),
    p99Ms:sortedQuantile(sorted,.99),
    maxMs:sorted.length?sorted[sorted.length-1]:0
  };
}

export function observationsMatch(prepared,current) {
  if (!prepared || !current || prepared.actor.actorId!==current.actor.actorId
    || prepared.actor.role!==current.actor.role
    || prepared.actor.kingdomId!==current.actor.kingdomId
    || prepared.actor.communityId!==current.actor.communityId
    || prepared.worldEpoch!==current.worldEpoch
    || prepared.revision!==current.revision
    || prepared.simulatedDay!==current.simulatedDay) return false;
  for(const key of featureKeys){
    const a=prepared[key],b=current[key];
    if(a.length!==b.length) return false;
    for(let i=0;i<a.length;i++) if(a[i]!==b[i])return false;
  }
  return true;
}

/**
 * Prepare computations for actors observed at the same causal boundary.
 * Sorting is deterministic. Never apply an output without re-observing the
 * actor and performing LIVE domain validation on resources, ownership,
 * safety, occupancy and action permissions at the application point.
 *
 * candidates: [{person, inputs: number[18], urgent?, waitingDays?, priority?}]
 */
export function prepareCausalInferenceBatch(world,candidates,{budget=128,batchSize=32,requireLiveValidation=false}={}){
  if(!Number.isSafeInteger(budget)||budget<1||budget>100000)throw Error('Invalid cognitive budget');
  if(!Number.isSafeInteger(batchSize)||batchSize<1||batchSize>256)throw Error('Invalid batch size');
  const policy=getSharedPolicy(world,'human');
  const seen=new Set();
  const queue=[];
  for(const c of candidates){
    if(!c?.person||!Number.isSafeInteger(c.person.id)||seen.has(c.person.id)
      || !(Array.isArray(c.inputs)||ArrayBuffer.isView(c.inputs))||c.inputs.length!==18) continue;
    seen.add(c.person.id);
    queue.push(c);
  }
  queue.sort((a,b)=>Number(!!b.urgent)-Number(!!a.urgent)
    || normal(b.waitingDays)-normal(a.waitingDays)
    || normal(a.priority)-normal(b.priority)
    || a.person.id-b.person.id);
  const selected=[];
  let routine=0;
  for(const c of queue){
    if(!c.urgent&&routine>=budget)continue;
    if(!c.urgent)routine++;
    selected.push(c);
  }
  const entries=new Map(), batchDurations=[];
  const start=now();
  for(let offset=0;offset<selected.length;offset+=batchSize){
    const group=selected.slice(offset,offset+batchSize);
    const observations=group.map(c=>actorObservation(world,c.person,c.inputs,'people'));
    const t=now(), outputs=forwardBatch(policy.spec,observations);
    batchDurations.push(now()-t);
    for(let i=0;i<group.length;i++)entries.set(group[i].person.id,{
      observation:observations[i], logits:outputs[i].logits.slice(0,PEOPLE_ACTIONS.length),
      policyId:policy.spec.policyId, policyVersion:policy.spec.policyVersion,
      width:policy.spec.layerWidths[1],seed:policy.spec.seed,createdAtMs:now(),
      createdDay:world.day
    });
  }
  const waitMs=[],waitDays=[];
  const metrics={
    queueDepth:queue.length,selected:selected.length,urgent:selected.filter(c=>!!c.urgent).length,
    routine,backlog:queue.length-selected.length,batches:batchDurations.length,
    prepareMs:now()-start,batchCompute:batchLatencySummary(batchDurations),
    consumed:0,rejected:0,domainRejected:0,missed:0,byRole:{civilian:0,worker:0,military:0,general:0,king:0},
    deadlineMisses:0
  };
  // Percentiles are observational, not part of causal decisions. Computing them
  // after every consume sorts an ever-growing sample list (quadratic cost).
  // Lazy enumerable getters preserve the public metrics/JSON shape, while
  // avoiding that cost unless a profiler actually reads the metrics.
  Object.defineProperties(metrics,{
    latencyMs:{enumerable:true,get(){return batchLatencySummary(waitMs);}},
    waitDays:{enumerable:true,get(){
      const summary=batchLatencySummary(waitDays);
      return {p50:summary.p50Ms,p95:summary.p95Ms,p99:summary.p99Ms};
    }}
  });
  return {
    metrics,
    consume(world,person,inputs,allowed,validateLive=null){
      const entry=entries.get(person?.id);
      if(!entry){metrics.missed++;return null;}
      entries.delete(person.id); // output must be consumed at most once
      const spec=getSharedPolicy(world,'human').spec;
      if(entry.policyId!==spec.policyId||entry.policyVersion!==spec.policyVersion
        ||entry.width!==spec.layerWidths[1]||entry.seed!==spec.seed
        || !observationsMatch(entry.observation,actorObservation(world,person,inputs,'people'))){
        metrics.rejected++;return null;
      }
      // A feature-vector match alone cannot detect all intra-day world effects.\n      // With the opt-in strict gate, a caller MUST recheck live resources,\n      // territory, position, occupancy, and permissions at this exact point.\n      // Fail closed on missing, false or throwing validators.\n      if (requireLiveValidation) {\n        let valid = false;\n        try { valid = typeof validateLive === 'function' && validateLive(world,person) === true; }\n        catch { valid = false; }\n        if (!valid) { metrics.rejected++; metrics.domainRejected++; return null; }\n      }\n      const logits=entry.logits.slice();
      // A mask can change after preparation. Revalidate *at use time*.
      for(let i=0;i<logits.length;i++)if(!allowed?.[i])logits[i]=-1e9;
      metrics.consumed++;
      const role=entry.observation.actor.role;
      metrics.byRole[role]=(metrics.byRole[role]||0)+1;
      waitMs.push(Math.max(0,now()-entry.createdAtMs));
      waitDays.push(Math.max(0,world.day-entry.createdDay));
      if(world.day>entry.createdDay)metrics.deadlineMisses++;
      return {hidden:[],logits,probs:[]};
    },
    remaining(){return entries.size;}
  };
}
