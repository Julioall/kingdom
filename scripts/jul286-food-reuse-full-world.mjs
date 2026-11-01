import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import Sim from '../src/simulation/engine.js';
import {createWorldSnapshot} from '../src/simulation/render-snapshot.js';

const population = Number(process.argv[2]||500);
const seed = Number(process.argv[3]||42);
const w=Sim.createWorld(seed);
if(population>w.people.length)Sim.addIndividuals(w,population-w.people.length,false);
const start=performance.now();
Sim.stepDay(w,{includeSnapshot:false});
const ms=performance.now()-start;
const s=createWorldSnapshot(w);
const hash=createHash('sha256');
hash.update(JSON.stringify(s.base));
for(const k of ['scalars','ids','types','plants'])hash.update(new Uint8Array(s.tileColumns[k].buffer));
hash.update(JSON.stringify({stats:s.stats,events:s.events,logs:s.logs}));
const output={population,seed,alive:w.people.filter(p=>p.alive).length,ms,
  digest:hash.digest('hex'),day:w.day};
await mkdir('out',{recursive:true});
await writeFile('out/jul286-full-world.json',JSON.stringify(output,null,2));
console.log(JSON.stringify(output));
