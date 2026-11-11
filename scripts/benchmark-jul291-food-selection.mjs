// JUL-291: isolated wildlife food-choice microbenchmark from REAL world
// perception records. This is not a frame/whole-world speedup claim.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Sim from '../src/simulation/engine.js';
import Senses from '../src/simulation/individuals/perception.js';
import { ANIMALS, PLANTS } from '../src/config/ecosystem.js';
import { species } from '../src/simulation/core/math.js';
import { animalFoodCell } from '../src/simulation/ecology/animals.js';
import { cellAt } from '../src/simulation/world/spatial.js';
import { resourceUsePressure } from '../src/simulation/world/roads.js';

function legacyFoodCell(w, animal, profile) {
  const resources = animal.perception && animal.perception.resources || [];
  const candidate = resources.filter(resource => (profile.aquatic
    ? resource.terrain === 'water' : resource.terrain !== 'water')
    && profile.diet.some(id => (resource.biomass[id] || 0) > .5))
    .sort((a,b) => {
      const tileA=cellAt(w,a.x,a.y),tileB=cellAt(w,b.x,b.y);
      const scoreA=profile.diet.reduce((sum,id)=>sum+(a.biomass[id]||0),0)
        - a.distance * 4 - resourceUsePressure(tileA)*28;
      const scoreB=profile.diet.reduce((sum,id)=>sum+(b.biomass[id]||0),0)
        - b.distance * 4 - resourceUsePressure(tileB)*28;
      return scoreB-scoreA;
    })[0];
  return candidate ? cellAt(w,candidate.x,candidate.y) : null;
}
const fixtures=[];
for (const seed of [1,42,2026]) {
  const world=Sim.createWorld(seed);
  for (const day of [0,7]) {
    while (world.day < day) Sim.stepDay(world,{includeSnapshot:false});
    for (const animal of world.animals.filter(a => a.alive && !(a.speciesId === 'sheep' && a.herdCommunityId != null))) {
      const profile=species(animal.speciesId,ANIMALS);
      const perception=Senses.observe(world,animal,'animal',PLANTS);
      fixtures.push({world, animal:{...animal,perception}, profile});
    }
  }
}
assert.ok(fixtures.length>20);
for(const {world,animal,profile} of fixtures) {
  assert.equal(animalFoodCell(world,animal,profile),
    legacyFoodCell(world,animal,profile),'Animal choice mismatch');
}
const iterations=Number(process.env.JUL291_FOOD_ITERATIONS || 500);
assert.ok(Number.isSafeInteger(iterations)&&iterations>=10&&iterations<=10000);
let sink=0;
function timeMode(fn) {
  const started=performance.now();
  for(let i=0;i<iterations;i++)
    for(const {world,animal,profile} of fixtures) {
      const tile=fn(world,animal,profile);
      if(tile)sink+=tile.i;
    }
  return performance.now()-started;
}
const rounds=[];
for(let index=0;index<4;index++){
  let originalMs,candidateMs;
  if(index%2===0){
    originalMs=timeMode(legacyFoodCell);
    candidateMs=timeMode(animalFoodCell);
  }else{
    candidateMs=timeMode(animalFoodCell);
    originalMs=timeMode(legacyFoodCell);
  }
  rounds.push({order:index%2===0?'legacy-first':'candidate-first',originalMs,candidateMs,
    improvementPercent:100*(1-candidateMs/originalMs)});
}
const oldTotal=rounds.reduce((a,b)=>a+b.originalMs,0);
const newTotal=rounds.reduce((a,b)=>a+b.candidateMs,0);
const report={schema:1,issue:'JUL-291',fixtures:fixtures.length,
  callsPerMode:fixtures.length*iterations*rounds.length,rounds,
  totalOldMs:oldTotal,totalCandidateMs:newTotal,
  reductionPercent:100*(1-newTotal/oldTotal),
  parity:true,
  caveat:'Isolated function CPU benchmark on real perception records. Costs of observing, moving and simulating whole worlds are excluded. Node timing is not browser FPS.',
  sink};
const out=resolve(process.argv[2]||'out/jul291-food-selection-micro.json');
mkdirSync(dirname(out),{recursive:true});
writeFileSync(out,JSON.stringify(report,null,2));
console.log('JUL291-FOOD-MICRO',JSON.stringify({
  fixtures:report.fixtures,callsPerMode:report.callsPerMode,
  reductionPercent:+report.reductionPercent.toFixed(2),
  rounds:report.rounds.map(r=>({order:r.order,
    oldMs:+r.originalMs.toFixed(2),candidateMs:+r.candidateMs.toFixed(2),
    reductionPercent:+r.improvementPercent.toFixed(2)}))
}));
console.log('PASSED JUL-291 food-selection microbenchmark with exact choices');
