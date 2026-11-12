import test from 'node:test';
import assert from 'node:assert/strict';
import { createNearbyStructureIndex } from '../src/simulation/individuals/nearby-structure-index.js';

const reference = (world,person,community,radius=4)=>world.structures.some(s=>
  s.complete && s.type==='abrigo' && community && person.communityId===s.communityId
  && Math.hypot(person.x-s.x,person.y-s.y)<=radius);

test('shelter broad-phase matches brute force over all community/distance boundaries',()=>{
  const structures=[];
  for(let i=0;i<250;i++)structures.push({id:i+1,x:(i*43)%112+.25,y:(i*19)%88+.4,
    complete:i%3!==0,type:i%4===0?'torre':'abrigo',communityId:i%8});
  const world={structures};
  const idx=createNearbyStructureIndex(world);
  for(let communityId=0;communityId<8;communityId++){
    const community={id:communityId};
    for(let x=0;x<112;x+=7)for(let y=0;y<88;y+=11){
      const person={x:x+.5,y:y+.25,communityId};
      assert.equal(idx.hasShelterNearby(person,community),
        reference(world,person,community),'mismatch '+x+','+y+','+communityId);
    }
  }
  assert.equal(idx.hasShelterNearby({x:0,y:0,communityId:0},null),false);
});

test('shelter index checks mutable completion/community/destroyed fields and appended builds',()=>{
  const base={x:5,y:4,communityId:1,complete:false,type:'abrigo',progress:0};
  const world={structures:[base]};
  const idx=createNearbyStructureIndex(world),person={x:5,y:4,communityId:1},group={id:1};
  assert.equal(idx.hasShelterNearby(person,group),false);
  base.complete=true;
  assert.equal(idx.hasShelterNearby(person,group),true);
  base.communityId=2;
  assert.equal(idx.hasShelterNearby(person,group),false);
  world.structures.push({x:5,y:4,communityId:1,complete:true,type:'abrigo'});
  assert.equal(idx.hasShelterNearby(person,group),true);
  world.structures=[{x:90,y:70,communityId:1,complete:true,type:'abrigo'}];
  assert.equal(idx.hasShelterNearby(person,group),false);
});
