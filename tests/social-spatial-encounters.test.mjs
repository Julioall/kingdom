import test from 'node:test';
import assert from 'node:assert/strict';
import { updateSocialLinks } from '../src/simulation/society/communities.js';

function bruteSocialLinks(w) {
  const people=w.people.filter(p=>p.alive);
  for(let i=0;i<people.length;i++)for(let j=i+1;j<people.length;j++){
    const a=people[i],b=people[j],d=Math.hypot(a.x-b.x,a.y-b.y);
    if(d>2.2)continue;
    const key=a.id+':'+b.id;
    const link=w.socialLinks[key]||(w.socialLinks[key]={a:a.id,b:b.id,meetings:0,trust:0,sharedFood:0});
    link.meetings++;
    const mutualHelp=a.foodReserve>48&&b.foodReserve>48?.018:.004;
    link.trust=Math.max(0,Math.min(1,link.trust+.045*Math.min(a.sociability,b.sociability)+mutualHelp));
    if(a.state==='conversando'&&b.state==='conversando'){
      a.socialNeed=Math.max(0,a.socialNeed-3);b.socialNeed=Math.max(0,b.socialNeed-3);
    }
  }
}

function fixture(seed,count){
  let state=seed;
  const random=()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/4294967296);
  return {day:1,people:Array.from({length:count},(_,i)=>({
    id:100+i,alive:i%17!==0,x:random()*110,y:random()*110,
    sociability:random(),foodReserve:random()*100,socialNeed:random()*100,
    state:i%3===0?'conversando':'trabalhando',kingdomId:null,communityId:null
  })),socialLinks:{},communities:[]};
}

test('spatial social encounters produce exact brute force state and insertion order',()=>{
  for(const seed of [1,42,2026]){
    const fast=fixture(seed,300),old=structuredClone(fast);
    updateSocialLinks(fast);bruteSocialLinks(old);
    assert.deepEqual(fast.people,old.people,'social needs seed '+seed);
    assert.deepEqual(fast.socialLinks,old.socialLinks,'link state seed '+seed);
    assert.deepEqual(Object.keys(fast.socialLinks),Object.keys(old.socialLinks),'pair order seed '+seed);
  }
});

test('same-tile crowd, dead actor and non-sorted IDs keep ordered pair semantics',()=>{
  const a={id:8,alive:true,x:5,y:5,foodReserve:90,sociability:.9,socialNeed:45,state:'conversando',kingdomId:null,communityId:null};
  const b={...a,id:3,sociability:.2};
  const c={...a,id:10,foodReserve:20};
  const dead={...a,id:4,alive:false};
  const fast={people:[a,b,c,dead],socialLinks:{},communities:[]},old=structuredClone(fast);
  updateSocialLinks(fast);bruteSocialLinks(old);
  assert.deepEqual(Object.keys(fast.socialLinks),['8:3','8:10','3:10']);
  assert.deepEqual(fast,old);
});
