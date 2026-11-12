import test from 'node:test';
import assert from 'node:assert/strict';
import { updateCommunityStages } from '../src/simulation/society/communities.js';

function fixture(){
  const people=[],communities=[],socialLinks={};
  for(let c=1;c<=8;c++){
    communities.push({id:c,memberIds:[],stage:'vínculo',previousStage:'vínculo',
      dissolved:false,isKingdomGroup:false,usedCells:{},x:c*4,y:c*5,
      cohesion:.1,history:[],splitCooldown:2});
    for(let k=0;k<2;k++)people.push({id:c*10+k,alive:true,communityId:c,
      x:c*4+k,y:c*5+k,kingdomId:null});
    socialLinks[c*10+':'+(c*10+1)]={a:c*10,b:c*10+1,trust:.2+c*.01,meetings:3};
  }
  socialLinks['10:20']={a:10,b:20,trust:.99,meetings:4};
  people.push({id:999,alive:false,communityId:1,x:0,y:0});
  return {day:10,people,communities,socialLinks};
}

test('community aggregation keeps exact member order, mean trust and lifecycle',()=>{
  const w=fixture(),original=structuredClone(w);
  updateCommunityStages(w);
  for(const c of w.communities){
    const members=original.people.filter(p=>p.alive&&p.communityId===c.id);
    const links=Object.values(original.socialLinks).filter(l=>
      members.some(p=>p.id===l.a)&&members.some(p=>p.id===l.b));
    const expected=links.length?links.reduce((s,l)=>s+l.trust,0)/links.length:.1;
    assert.deepEqual(c.memberIds,members.map(p=>p.id));
    assert.equal(c.cohesion,expected);
    assert.equal(c.splitCooldown,1);
    assert.equal(c.stage,'vínculo');
  }
});
