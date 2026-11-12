import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../src/simulation/engine.js';
import Senses from '../src/simulation/individuals/perception.js';
import { nearestPerson,nearestWater,nearestHuntable,nearestKnownHuntable,nearestFish }
  from '../src/simulation/individuals/actions.js';

function world() {
  const width=12,height=12;
  return {width,height,tiles:Array.from({length:width*height},(_,i)=>({
    i,x:i%width,y:Math.floor(i/width),terrain:'land',surfaceWaterMm:0
  })),animals:[],people:[]};
}
test('nearest water uses the previous stable distance/confidence order and skips dry sightings',()=>{
  const w=world();
  for(const [x,y] of [[4,1],[2,2],[5,2]]) w.tiles[y*w.width+x].terrain='water';
  const points=[
    {x:4,y:1,distance:2,confidence:.4},
    {x:2,y:2,distance:2,confidence:.9},
    {x:5,y:2,distance:1,confidence:.9},
    {x:0,y:0,distance:1,confidence:1}
  ];
  const p={perception:{knownWater:points}};
  const legacy=(radius)=>points.filter(point=>point.distance<=(radius||Infinity))
    .sort((a,b)=>(a.distance-b.distance)||(b.confidence-a.confidence))
    .map(point=>w.tiles[point.y*w.width+point.x])
    .find(tile=>tile&&(tile.terrain==='water'||(tile.surfaceWaterMm||0)>=1.5))||null;
  for(const radius of [0,1,2,8]) assert.equal(nearestWater(w,p,radius),legacy(radius));
  w.tiles[2*w.width+5].terrain='land';
  for(const radius of [0,1,2,8])assert.equal(nearestWater(w,p,radius),legacy(radius));
});

test('nearest actor selection matches reference stable sort for visible and remembered targets',()=>{
  const w=world();
  const people=[{id:2,x:2,y:0,alive:true},{id:3,x:1,y:0,alive:true},
    {id:4,x:1,y:0,alive:true},{id:5,x:0,y:0,alive:false}];
  const animals=[{id:12,x:2,y:0,alive:true,speciesId:'sheep',herdCommunityId:null,beingLedBy:null},
    {id:13,x:1,y:0,alive:true,speciesId:'sheep',herdCommunityId:null,beingLedBy:null},
    {id:14,x:1,y:0,alive:false,speciesId:'sheep',herdCommunityId:null}];
  w.people=people;w.animals=animals;
  const p={id:1,x:0,y:0,perception:{
    people:people.map(q=>({id:q.id,visible:true,distance:3})),
    animals:animals.map(q=>({id:q.id,visible:true,distance:3,confidence:q.id===12?.9:.7,speciesId:'sheep'}))
  }};
  assert.equal(nearestPerson(w,p,4),people[1]);
  assert.equal(nearestPerson(w,p,4,new Set([3])),people[2]);
  assert.equal(nearestHuntable(w,p,4),animals[1]);
  assert.equal(nearestKnownHuntable(w,p,4).id,12);
  assert.equal(nearestFish(w,p,4),null);
});

test('cached FOV and canopy calculation preserve uncached visibility for real world',()=>{
  const w=Sim.createWorld(42),observer=w.people[0],profiles=Sim.plants;
  const cached={headingLength:Math.hypot(observer.headingX||0,observer.headingY||0),
    minDot:Math.cos(210*Math.PI/360)};
  const cache=new Map();
  for(let i=0;i<50;i++){
    const target={x:(i*3)%w.width,y:(i*7)%w.height};
    assert.equal(Senses.inFieldOfView(observer,target,210),
      Senses.inFieldOfView(observer,target,210,cached));
    assert.equal(Senses.lineOfSight(w,observer,target,profiles),
      Senses.lineOfSight(w,observer,target,profiles,cache));
  }
});
