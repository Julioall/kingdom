import test from 'node:test';
import assert from 'node:assert/strict';
import { createActorViewportIndex } from '../src/ui/actor-viewport-index.js';
import { createMovementInterpolator } from '../src/ui/movement-interpolation.js';

function world(day, people, animals = []) { return {day,width:120,height:90,people,animals}; }
function actor(id,x,y,extra={}) {return {id,x,y,alive:true,...extra};}
const bounds=(minX,maxX,minY,maxY)=>({minX,maxX,minY,maxY});

test('viewport broad-phase returns a superset of every visible interpolated actor in source order',()=>{
  const movement=createMovementInterpolator();
  const p0=[actor(1,1,1),actor(2,90,60),actor(3,25,20),actor(4,30,22,{combatAction:{id:7}})];
  const a0=[actor(11,100,60),actor(12,15,12)];
  movement.observe(world(0,p0,a0),0,{reset:true});
  const p1=[actor(1,75,35),actor(2,90,60),actor(3,26,20),actor(4,30,22,{combatAction:{id:7}})];
  const a1=[actor(11,5,5),actor(12,16,12)];
  const updated=world(1,p1,a1);
  movement.observe(updated,1000);
  const index=createActorViewportIndex(updated,(kind,a)=>movement.sweptBounds(kind,a),10);
  for (const box of [bounds(0,20,0,20),bounds(20,40,15,30),bounds(45,60,20,30),
    bounds(70,85,30,50),bounds(90,110,40,70)]) {
    for(const kind of ['person','animal']){
      const all=kind==='person'?p1:a1;
      for(const time of [1000,1200,1500,2000,3000]) {
        const visible=all.filter(a=>{const pose=movement.pose(kind,a,time);
          return pose.x>=box.minX&&pose.x<=box.maxX&&pose.y>=box.minY&&pose.y<=box.maxY;});
        const selected=index.query(kind,box);
        for(const a of visible)assert.ok(selected.includes(a),'lost '+kind+' '+a.id+' at '+time);
        assert.deepEqual(selected.slice().sort((a,b)=>all.indexOf(a)-all.indexOf(b)),selected);
      }
    }
  }
  assert.deepEqual(index.query('person',bounds(-4,124,-4,94)),p1);
});

test('controlled characters and combat actors are never culled by stale snapshot positions',()=>{
  const w=world(0,[actor(1,70,70,{playerControlled:true}),actor(2,99,99,{combatAction:{id:4}})],[]);
  const index=createActorViewportIndex(w,()=>null);
  const result=index.query('person',bounds(1,10,1,10));
  assert.deepEqual(result,w.people);
});

test('index does not expose dead actors or accept invalid cells/chunk sizes',()=>{
  const w=world(0,[actor(1,4,4),actor(2,8,8,{alive:false})]);
  assert.deepEqual(createActorViewportIndex(w).query('person',bounds(0,16,0,16)).map(a=>a.id),[1]);
  assert.deepEqual(createActorViewportIndex(w).query('animal',bounds(0,16,0,16)),[]);
  assert.throws(()=>createActorViewportIndex(w,null,0));
});
