import test from 'node:test';
import assert from 'node:assert/strict';
import { PEOPLE_ACTIONS } from '../src/config/ecosystem.js';
import { createBrain, choosePeopleAction, updateBrain, ensureBrainSize } from '../src/controllers/individual/neural.js';
import { forwardSharedPolicy, getSharedPolicy } from '../src/ai/policy/shared-policy.js';
import {
  createCognitiveState, ensureCognitiveState, recordCognitiveOutcome,
  cognitiveActionBias, cognitiveMemoryFeatures, cognitiveTemperamentFeatures,
  cognitiveStateBytes, COGNITIVE_EPISODE_LIMIT, COGNITIVE_EPISODE_TTL_DAYS
} from '../src/ai/policy/individual-state.js';

const world = (mode = 'shared') => ({seed:42, day:20, rngState:42,
  neuralOverrides:{neuralController:mode}});
function human(w, id) {
  const p = {
    id, role:'resident', name:'Actor ' + id, alive:true,
    sociability:.5, trust:.5, loyalty:.5, physicalStrength:.5,
    skills:{build:.5,diplomacy:.5}, socialMemories:[],socialBeliefs:[],
    personalMemory:[], kingdomId:1, communityId:1,lastReward:0,
    brain:createBrain(w, PEOPLE_ACTIONS,18,id)
  };
  p.cognitiveState = createCognitiveState(w, p);
  return p;
}
const inputs = Array.from({length:18},(_,i)=>(i+1)/25);

test('individual state is deterministic, versioned, independent of promotions and actor-only',()=>{
  const w = world(), a = human(w,17), b=human(w,18);
  const encoded=JSON.stringify(a.cognitiveState);
  assert.deepEqual(createCognitiveState(w,{id:a.id}),a.cognitiveState);
  assert.notDeepEqual(a.cognitiveState.temperament,b.cognitiveState.temperament);
  assert.equal(w.rngState,42);
  a.role='soldier';a.militaryRank='general';
  assert.equal(ensureCognitiveState(w,a),a.cognitiveState);
  a.role='ruler';
  assert.equal(JSON.stringify(a.cognitiveState),encoded);
  assert.equal(a.cognitiveState.actorId,17);
  assert.ok(!('weights' in a.cognitiveState));
  assert.ok(!('socialMemories' in a.cognitiveState));
});

test('episodes have TTL, capped count, provenance, version and compact JSON size',()=>{
  const a=human(world(),1);
  for(let i=0;i<30;i++) recordCognitiveOutcome(a,{day:i,domain:'people',action:i%2?'rest':'explore',reward:i%2?-0.8:.6});
  assert.equal(a.cognitiveState.episodes.length,COGNITIVE_EPISODE_LIMIT);
  assert.ok(a.cognitiveState.summary.discarded>=24);
  assert.equal(a.cognitiveState.summary.positive,15);
  assert.equal(a.cognitiveState.summary.negative,15);
  assert.ok(a.cognitiveState.episodes.every(e=>e.source==='self'&&e.eventId.startsWith('1:self:')));
  recordCognitiveOutcome(a,{day:30+COGNITIVE_EPISODE_TTL_DAYS+1,domain:'royal',action:'defensive',reward:.4});
  assert.equal(a.cognitiveState.episodes.length,1);
  assert.ok(cognitiveStateBytes(a)<900,'serialized per-actor cognitive state remains bounded');
  assert.deepEqual(structuredClone(a.cognitiveState),a.cognitiveState);
  assert.deepEqual(JSON.parse(JSON.stringify(a.cognitiveState)),a.cognitiveState);
});

test('same global network with equal observations but opposite personal history selects different actions',()=>{
  const w=world(), a=human(w,1), b=human(w,2);
  const temperament={curiosity:.5,caution:.5,altruism:.5,persistence:.5};
  a.cognitiveState.temperament={...temperament};
  b.cognitiveState.temperament={...temperament};
  recordCognitiveOutcome(a,{domain:'people',day:20,action:'explore',reward:1});
  recordCognitiveOutcome(a,{domain:'people',day:20,action:'rest',reward:-1});
  recordCognitiveOutcome(b,{domain:'people',day:20,action:'explore',reward:-1});
  recordCognitiveOutcome(b,{domain:'people',day:20,action:'rest',reward:1});
  const weights=getSharedPolicy(w,'human').spec.weights.slice();
  assert.deepEqual(Array.from(cognitiveMemoryFeatures(a)),Array.from(cognitiveMemoryFeatures(b)));
  assert.deepEqual(Array.from(cognitiveTemperamentFeatures(a)),Array.from(cognitiveTemperamentFeatures(b)));
  const mask=PEOPLE_ACTIONS.map(x=>x==='explore'||x==='rest');
  const logits=forwardSharedPolicy(w,a,inputs,'people',mask).logits;
  const explore=PEOPLE_ACTIONS.indexOf('explore'),rest=PEOPLE_ACTIONS.indexOf('rest');
  const utility=PEOPLE_ACTIONS.map(()=>-1e9);
  utility[rest]=0;
  utility[explore]=(logits[rest]-logits[explore])*.2;
  assert.equal(choosePeopleAction(w,a,inputs,utility),'explore');
  assert.equal(choosePeopleAction(w,b,inputs,utility),'rest');
  assert.ok(cognitiveActionBias(a,'explore')>cognitiveActionBias(b,'explore'));
  assert.deepEqual(Array.from(getSharedPolicy(w,'human').spec.weights),Array.from(weights));
});

test('private beliefs only affect owner features when their supporting event is known',()=>{
  const w=world(), a=human(w,4), b=human(w,5);
  const evidence={topic:'food_aid_reliability',aboutId:'3',
    evaluation:.8,certainty:.9,supportingEventIds:['evt-1'],opposingEventIds:[]};
  a.socialBeliefs=[evidence];
  b.socialBeliefs=[evidence];
  a.socialMemories=[{rootEventId:'evt-1',source:'direct'}];
  const af=Array.from(cognitiveMemoryFeatures(a)),bf=Array.from(cognitiveMemoryFeatures(b));
  assert.ok(af[4]>0);
  assert.equal(bf[4],0);
  assert.equal(bf[5],0);
  assert.equal(a.cognitiveState.episodes.length,0);
  assert.equal(b.cognitiveState.episodes.length,0);
});

test('rewards update personal preferences without any shared gradient or private weight matrices',()=>{
  const w=world(),a=human(w,8),b=human(w,9);
  const weights=getSharedPolicy(w,'human').spec.weights.slice();
  const utility=PEOPLE_ACTIONS.map(name=>name==='rest'?10:-1e9);
  choosePeopleAction(w,a,inputs,utility);
  updateBrain(a,.9);
  assert.equal(a.cognitiveState.episodes[0].action,'rest');
  assert.equal(a.cognitiveState.episodes[0].reward,.9);
  assert.equal(b.cognitiveState.episodes.length,0);
  assert.ok(a.brain.actionValues[PEOPLE_ACTIONS.indexOf('rest')]>0);
  assert.equal(b.brain.actionValues[PEOPLE_ACTIONS.indexOf('rest')],0);
  assert.deepEqual(Array.from(getSharedPolicy(w,'human').spec.weights),Array.from(weights));
});

test('save/restore, promotion, player/AI control and neural rollback preserve identity and episodes',()=>{
  const w=world(),p=human(w,32);
  recordCognitiveOutcome(p,{domain:'people',day:20,action:'gather',reward:.7});
  const saved=JSON.parse(JSON.stringify(p));
  const restored=structuredClone(saved);
  restored.role='soldier';
  restored.militaryRank='general';
  restored.playerControlled=true;
  restored.playerControlled=false;
  assert.equal(ensureCognitiveState(w,restored).actorId,32);
  assert.deepEqual(restored.cognitiveState,saved.cognitiveState);
  w.neuralOverrides.neuralController='legacy';
  ensureBrainSize(w,restored,9);
  assert.ok(restored.brain.inputWeights);
  w.neuralOverrides.neuralController='shared';
  ensureBrainSize(w,restored,9);
  assert.equal(restored.brain.mode,'shared');
  assert.ok(!('inputWeights' in restored.brain));
  assert.deepEqual(restored.cognitiveState,saved.cognitiveState);
});
