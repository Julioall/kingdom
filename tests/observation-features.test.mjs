import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPeoplePolicyInputs} from '../src/simulation/individuals/observation-features.js';
test('pure mapping preserves all 18 legacy input features and order',()=>{
 const person={x:10,y:10,foodReserve:34,hydration:35,energy:35,socialNeed:50,injury:6};
 const community={stores:{gold:27.5}};
 const food={x:13,y:14},waterTarget={x:10,y:26},preyNearby={x:16,y:18};
 const context={person,food,waterTarget,groupFood:22.5,groupMaterial:45,
  risk:.3,huntAccess:.25,deliveryNeed:.2,preyNearby,browseAccess:.6,
  feedNeed:.35,materialNeed:.45,looseLog:{distance:3.5},community};
 const input=buildPeoplePolicyInputs(context);
 assert.equal(input.length,18);
 assert.deepEqual(input,[.5,.5,.5,.5,0,.5,.5,.5,.3,.5,.25,.2,0,.6,.35,.45,.5,.5]);
 const prev=JSON.stringify(context);
 assert.deepEqual(buildPeoplePolicyInputs(context),input);
 assert.equal(JSON.stringify(context),prev,'feature mapping must not mutate world/actor');
});
test('no targets, no community and out-of-range needs retain old zero/clamp semantics',()=>{
 const person={x:0,y:0,foodReserve:130,hydration:130,energy:130,socialNeed:-20,injury:0};
 const input=buildPeoplePolicyInputs({person,food:null,waterTarget:null,groupFood:0,groupMaterial:0,
  risk:0,huntAccess:0,deliveryNeed:0,preyNearby:null,browseAccess:0,
  feedNeed:0,materialNeed:0,looseLog:null,community:null});
 assert.equal(input.length,18);
 assert.ok(input.every(value=>value===0));
});
