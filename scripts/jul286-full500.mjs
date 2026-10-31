import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {writeFile,mkdir} from 'node:fs/promises';
import Sim from '../src/simulation/engine.js';
import {createWorldSnapshot} from '../src/simulation/render-snapshot.js';
const n=500,w=Sim.createWorld(42);
if(n>w.people.length)Sim.addIndividuals(w,n-w.people.length,false);
const t=performance.now();
Sim.stepDay(w,{includeSnapshot:false});
const elapsed=performance.now()-t;
const snapshot=createWorldSnapshot(w);
const digest=createHash('sha256').update(JSON.stringify(snapshot.base));
for(const key of ['scalars','ids','types','plants'])
 digest.update(new Uint8Array(snapshot.tileColumns[key].buffer));
digest.update(JSON.stringify({stats:snapshot.stats,events:snapshot.events,logs:snapshot.logs}));
const summary={seed:42,people:500,alive:w.people.filter(p=>p.alive).length,
 day:w.day,elapsedMs:elapsed,stateDigest:digest.digest('hex')};
await mkdir('out',{recursive:true});
await writeFile('out/full-500.json',JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary,null,2));
