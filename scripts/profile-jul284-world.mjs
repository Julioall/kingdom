import {performance} from 'node:perf_hooks';
import {writeFile,mkdir} from 'node:fs/promises';
import Sim from '../src/simulation/engine.js';
const requested=Number(process.argv[2]||500);
const seed=42;
const world=Sim.createWorld(seed);
if(requested>world.people.length)Sim.addIndividuals(world,requested-world.people.length,false);
const start=performance.now();
Sim.stepDay(world,{includeSnapshot:false});
const elapsed=performance.now()-start;
const summary={seed,requested,alive:world.people.filter(p=>p.alive).length,msPerDay:elapsed,
  day:world.day,measuredAt:'GitHub runner CPU',notes:'Full simulation including plants, animals, life, paths, economy and AI'};
await mkdir('out',{recursive:true});
await writeFile('out/world-cpu.json',JSON.stringify(summary,null,2));
console.log('WORLD_CPU',JSON.stringify(summary));
