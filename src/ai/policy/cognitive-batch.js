// JUL-273: speculative *real* neural batches, validated before each
// authoritative actor decision. Not serialized into saves or render snapshots.
import { actorObservation, forwardBatch, getSharedPolicy } from './shared-policy.js';
import { PEOPLE_ACTIONS } from '../../config/ecosystem.js';

const featureKeys = ['perceptionFeatures','roleFeatures','personalityFeatures','memoryFeatures','contextFeatures'];
const clock = () => typeof performance !== 'undefined' ? performance.now() : 0;

function sameObservation(a,b) {
  if (!a || !b || a.actor.actorId !== b.actor.actorId
      || a.actor.role !== b.actor.role || a.worldEpoch !== b.worldEpoch) return false;
  for (const key of featureKeys) {
    const x=a[key],y=b[key];
    if (x.length!==y.length) return false;
    for(let i=0;i<x.length;i++) if (x[i]!==y[i]) return false;
  }
  return true;
}
function percentile(values, p) {
  if (!values.length) return 0;
  const ordered=values.slice().sort((a,b)=>a-b);
  return ordered[Math.max(0,Math.ceil(ordered.length*p)-1)];
}
export function batchTimingSummary(timings) {
  return {count:timings.length,p50Ms:percentile(timings,.5),
    p95Ms:percentile(timings,.95),p99Ms:percentile(timings,.99),
    maxMs:timings.length?Math.max(...timings):0};
}

/**
 * candidates: {person, inputs, urgency, waitingDays, queuePriority}
 * Inputs may be speculative. The consumer MUST compare the entire feature
 * observation on the live world before accepting a precomputed output.
 */
export function prepareInferenceBatches(world,candidates,{budget=128,batchSize=32}={}) {
  const model=getSharedPolicy(world,'human');
  const queue=candidates.filter(c=>Array.isArray(c.inputs) && c.inputs.length===18);
  queue.sort((a,b)=>Number(!!b.urgency)-Number(!!a.urgency)
    || (b.waitingDays||0)-(a.waitingDays||0)
    || (a.queuePriority||0)-(b.queuePriority||0)
    || a.person.id-b.person.id);
  const selected=[];
  let routine=0;
  for(const candidate of queue) {
    if(!candidate.urgency && routine>=budget) continue;
    selected.push(candidate);
    if(!candidate.urgency) routine++;
  }
  const results=new Map(),computeTimes=[];
  const initial=clock();
  for(let start=0;start<selected.length;start+=batchSize) {
    const group=selected.slice(start,start+batchSize);
    // Reading observations occurs before the loop mutates authoritative state.
    const observations=group.map(c=>actorObservation(world,c.person,c.inputs,'people'));
    const t=clock();
    const predictions=forwardBatch(model.spec,observations);
    computeTimes.push(clock()-t);
    for(let i=0;i<group.length;i++)results.set(group[i].person.id,{
      observation:observations[i], output:predictions[i], role:observations[i].actor.role,
      policyVersion:model.spec.policyVersion, seed:model.spec.seed,
      width:model.spec.layerWidths[1],actorId:group[i].person.id,
      createdDay:world.day,createdAtMs:clock()
    });
  }
  const metrics={
    queueDepth:queue.length, queued: selected.length, urgentQueued:selected.filter(c=>c.urgency).length,
    routineQueued:routine,backlog:queue.length-selected.length,
    batches:computeTimes.length,precomputeMs:clock()-initial,
    batchCompute:batchTimingSummary(computeTimes),
    consumed:0,rejected:0,missed:0,deadlineMisses:0,
    byRole:{civilian:0,worker:0,military:0,general:0,king:0},
    latencyMs:{count:0,p50Ms:0,p95Ms:0,p99Ms:0,maxMs:0},
    waitDaysP50:0,waitDaysP95:0,waitDaysP99:0
  };
  const waiting=[],latencies=[];
  return {
    metrics,
    consume(world,person,inputs,allowed) {
      const entry=results.get(person.id);
      if(!entry){metrics.missed++;return null;}
      results.delete(person.id); // never apply a prediction twice.
      const spec=getSharedPolicy(world,'human').spec;
      if(entry.policyVersion!==spec.policyVersion||entry.seed!==spec.seed
        ||entry.width!==spec.layerWidths[1]||entry.actorId!==person.id) {
        metrics.rejected++;return null;
      }
      const current=actorObservation(world,person,inputs,'people');
      if(!sameObservation(entry.observation,current)){
        metrics.rejected++;return null;
      }
      metrics.consumed++;
      metrics.byRole[entry.role]=(metrics.byRole[entry.role]||0)+1;
      const elapsed=Math.max(0,clock()-entry.createdAtMs);
      latencies.push(elapsed);
      metrics.latencyMs=batchTimingSummary(latencies);
      const age=Math.max(0,world.day-entry.createdDay);
      if(age>0)metrics.deadlineMisses++;
      waiting.push(age);
      metrics.waitDaysP50=percentile(waiting,.5);
      metrics.waitDaysP95=percentile(waiting,.95);
      metrics.waitDaysP99=percentile(waiting,.99);
      // Return complete logits. The live action mask is applied after
      // caching, so a previously forbidden action can become legal later.
      const logits=entry.output.logits.slice(0,PEOPLE_ACTIONS.length);
      return {hidden:[],logits,probs:[]};
    },
    remaining(){return results.size;}
  };
}
