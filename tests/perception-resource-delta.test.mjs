import test from 'node:test';
import assert from 'node:assert/strict';
import {
  diffPerceptionResourceRows, applyPerceptionResourceRowsPatch
} from '../src/simulation/perception-resource-delta.js';
import Sim from '../src/simulation/engine.js';

const resource=(id,extras={})=>({
  x:id,y:0,tileIndex:id,distance:id+.25,visible:true,terrain:'land',
  biomass:{grass:20,berry:4},harvestableBiomass:{grass:20,berry:4},
  stone:0,goldOre:0,copperOre:0,silverOre:0,ironOre:0,
  surfaceWaterMm:0,waterSource:null,soilMoisture:.3,slope:0,
  ...extras
});
test('resource patch handles unchanged, changed fields, biomass, reordering and spawn/despawn',()=>{
  const before=Array.from({length:20},(_,id)=>resource(id));
  const after=before.map(row=>structuredClone(row));
  after[4].distance+=.4;
  after[4].soilMoisture=.56;
  after[3].biomass.berry+=2;
  after.splice(6,1);
  after.unshift(resource(40,{distance:2.5}));
  [after[1],after[2]]=[after[2],after[1]];
  const previous=structuredClone(before);
  const patch=diffPerceptionResourceRows(before,after,{force:true});
  assert.ok(patch);
  assert.deepEqual(patch.removed,[6]);
  assert.deepEqual(patch.added.map(x=>x.tileIndex),[40]);
  assert.ok(patch.updated.some(x=>x.tileIndex===4));
  assert.ok(patch.order);
  const recovered=applyPerceptionResourceRowsPatch(before,structuredClone(patch));
  assert.deepEqual(recovered,after);
  assert.deepEqual(before,previous,'decoder must not mutate the cached previous perception');
  assert.equal(recovered.find(r=>r.tileIndex===1),before[1],
    'unmodified resource rows can retain identity after reconstruction');
});
test('unchanged rows preserve ordering and use a small patch',()=>{
  const before=Array.from({length:30},(_,id)=>resource(id));
  const after=structuredClone(before);
  after[20].distance+=1;
  const patch=diffPerceptionResourceRows(before,after);
  assert.ok(patch);
  assert.equal(patch.order,undefined);
  assert.equal(patch.updated.length,1);
  assert.deepEqual(patch.updated[0].set,{distance:21.25});
  assert.deepEqual(applyPerceptionResourceRowsPatch(before,patch),after);
});
test('unsupported and expensive deltas fail closed',()=>{
  assert.equal(diffPerceptionResourceRows([{tileIndex:1,method:()=>true}],[]),null);
  assert.equal(diffPerceptionResourceRows([{tileIndex:1,x:Infinity}],[]),null);
  assert.equal(diffPerceptionResourceRows([{tileIndex:1},{tileIndex:1}],[]),null);
  assert.equal(diffPerceptionResourceRows([],[]),null,'empty patch is not cheaper than an empty array');
  assert.equal(diffPerceptionResourceRows([resource(1)],[resource(1,{distance:4})],
    {maxFraction:.01}),null);
});
test('invalid packet rejects atomically without mutating old resources',()=>{
  const old=Array.from({length:8},(_,id)=>resource(id));
  const next=structuredClone(old);
  next[3].distance=1;
  const patch=diffPerceptionResourceRows(old,next,{force:true});
  const invalid=[
    {...patch,removed:[2,2]},
    {...patch,updated:[{tileIndex:999,set:{distance:1},unset:[]}]},
    {...patch,updated:[{tileIndex:3,set:{tileIndex:4},unset:[]}]},
    {...patch,updated:[{tileIndex:3,set:{},unset:['tileIndex']}]},
    {...patch,added:[resource(3)]},
    {...patch,order:[0,1,2,3,4,5,6,6]},
    {...patch,afterCount:9}
  ];
  const copy=structuredClone(old);
  for(const value of invalid){
    assert.throws(()=>applyPerceptionResourceRowsPatch(old,value),/resource/i);
    assert.deepEqual(old,copy);
  }
});
test('real people and animals keep all resource rows after a day of simulation',()=>{
  for(const seed of [1,42]){
    const world=Sim.createWorld(seed);
    Sim.stepDay(world,{includeSnapshot:false});
    const before=structuredClone([...world.people,...world.animals].map(actor=>({
      id:actor.id,resources:actor.perception?.resources||[]
    })));
    Sim.stepDay(world,{includeSnapshot:false});
    const current=[...world.people,...world.animals];
    let examined=0;
    for(const entry of before){
      const actor=current.find(p=>p.id===entry.id);
      if(!actor)continue;
      const after=actor.perception?.resources||[];
      const patch=diffPerceptionResourceRows(entry.resources,after);
      const output=patch?applyPerceptionResourceRowsPatch(entry.resources,patch):after;
      assert.deepEqual(output,after,'resources differ for actor '+actor.id+' seed '+seed);
      examined++;
    }
    assert.ok(examined>=100);
  }
});
