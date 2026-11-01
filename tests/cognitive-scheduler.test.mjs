import test from 'node:test';
import assert from 'node:assert/strict';
import { PEOPLE_ACTIONS } from '../src/config/ecosystem.js';
import { createBrain, choosePeopleAction } from '../src/controllers/individual/neural.js';
import { beginCognitiveDay, cognitiveDayMetrics, cognitiveMaxWaitDays,
  inferCognitivePeople } from '../src/ai/policy/cognitive-scheduler.js';

const input = Array.from({length:18}, (_,i)=>(i+1)/30);
function setup(count=50,budget=7,mode='budgeted') {
  const w = {seed:42,day:0,epoch:1,rngState:42,
    neuralOverrides:mode==='budgeted' ? {cognitiveSchedule:{mode:'budgeted',budget}} : {},
    people:[]};
  for (let id=1;id<=count;id++) w.people.push({
    id,ageDays:9000,alive:true,role:'resident',health:100,energy:100,
    hydration:100,foodReserve:100,injury:0,kingdomId:1,
    sociability:.5,trust:.5,loyalty:.5,physicalStrength:.5,
    skills:{build:.5,diplomacy:.5},
    brain:createBrain(w,PEOPLE_ACTIONS,18,id),personalMemory:[]
  });
  return w;
}
const utility = action => PEOPLE_ACTIONS.map(name=>name===action?8:-1e9);

test('opt-in only: standard shared policy remains unchanged and budget metadata is absent',()=>{
  const w=setup(4,1,'unlimited');
  beginCognitiveDay(w,w.people);
  for(const person of w.people) {
    choosePeopleAction(w,person,input,utility('rest'));
    assert.equal(person.brain.cognitiveInferenceCache,undefined);
  }
  assert.equal(cognitiveDayMetrics(w),null);
});

test('bounded normal forwards, deterministic rotations and eventual service for all 53 actors',()=>{
  const w=setup(53,7);
  const delivered=new Set();
  for(let day=0;day<cognitiveMaxWaitDays(53,7);day++){
    w.day=day;
    beginCognitiveDay(w,w.people);
    for(const person of w.people) {
      const action=choosePeopleAction(w,person,input,utility('rest'));
      assert.equal(action,'rest','current action legality must never be deferred');
      if(person.brain.cognitiveInferenceCache?.day===day)delivered.add(person.id);
    }
    const stats=cognitiveDayMetrics(w);
    assert.ok(stats.inferred<=7);
    assert.equal(stats.urgent,0);
    assert.equal(stats.eligible,53);
  }
  assert.equal(delivered.size,53,'all actors eventually get their own neural inference');
  assert.equal(cognitiveMaxWaitDays(5000,128),40);
});

test('emergency bypasses neural budget while all actors still decide every simulated day',()=>{
  const w=setup(48,1);
  w.people[30].foodReserve=4;
  w.people[31].playerControlled=true;
  w.people[32].role='ruler';
  w.people[33].campaignId=2;
  beginCognitiveDay(w,w.people);
  for(const person of w.people) {
    choosePeopleAction(w,person,input,utility('rest'));
    assert.ok(person.brain.decisions===1);
  }
  const stats=cognitiveDayMetrics(w);
  assert.ok(stats.urgent>=4);
  assert.ok(stats.inferred>=4);
  for(const i of [30,31,32,33])assert.equal(w.people[i].brain.cognitiveInferenceCache?.day,0);
});

test('fresh utility/action mask is always enforced, even when logits are cached',()=>{
  const w=setup(4,1);
  let actor=w.people[2];
  for(let day=0;day<5;day++){
    w.day=day;
    beginCognitiveDay(w,w.people);
    const desired=day%2?'drink':'rest';
    const action=choosePeopleAction(w,actor,input,utility(desired));
    assert.equal(action,desired);
  }
  assert.equal(actor.brain.decisions,5);
});

test('role, policy-version and epoch mismatches do not expose cached neural results',()=>{
  const w=setup(10,1);let actor=w.people[0];
  w.day=0;beginCognitiveDay(w,w.people);
  choosePeopleAction(w,actor,input,utility('rest'));
  const cache=actor.brain.cognitiveInferenceCache;
  assert.ok(cache);
  actor.role='soldier';w.day=1;beginCognitiveDay(w,w.people);
  // Soldier role changes action semantics: never apply a previous civilian logit.
  const out=inferCognitivePeople(w,actor,input);
  assert.equal(cognitiveDayMetrics(w).invalidated,1);
  assert.ok(!out.logits.some(x=>x!==0));
  assert.equal(actor.brain.cognitiveInferenceCache,undefined);
  actor.role='resident';
  w.epoch++;
  w.day=2;beginCognitiveDay(w,w.people);
  const check=inferCognitivePeople(w,actor,input);
  assert.equal(check.logits.length,PEOPLE_ACTIONS.length);
});

test('deterministic replay: identical worlds with same seed, budget, and day have same choices and telemetry',()=>{
  const a=setup(41,8),b=setup(41,8);
  for(let day=0;day<12;day++){
    for(const w of [a,b]){
      w.day=day;beginCognitiveDay(w,w.people);
      for(const p of w.people)choosePeopleAction(w,p,input,utility('rest'));
    }
    assert.deepEqual(cognitiveDayMetrics(a),cognitiveDayMetrics(b));
    assert.deepEqual(a.people.map(p=>p.brain.cognitiveInferenceCache),
      b.people.map(p=>p.brain.cognitiveInferenceCache));
  }
});

test('NPCs near player receive same-day neural updates even outside routine rotation',()=>{
  const w=setup(40,1);
  const controlled=w.people[38],near=w.people[20],far=w.people[21];
  controlled.playerControlled=true;controlled.x=50;controlled.y=50;
  near.x=53;near.y=49;
  far.x=90;far.y=90;
  w.day=0;beginCognitiveDay(w,w.people);
  inferCognitivePeople(w,near,input);
  inferCognitivePeople(w,far,input);
  assert.equal(near.brain.cognitiveInferenceCache?.day,0);
  assert.equal(far.brain.cognitiveInferenceCache,undefined);
  assert.ok(cognitiveDayMetrics(w).urgent>=1);
});

test('budgeted real-world simulation remains deterministic and still advances physical needs', async()=>{
  const Sim=(await import('../src/simulation/engine.js')).default;
  const create=()=>{const w=Sim.createWorld(42);
    w.neuralOverrides={...(w.neuralOverrides||{}),cognitiveSchedule:{mode:'budgeted',budget:8}};
    return w;
  };
  const a=create(),b=create();
  const before=a.people.map(p=>({id:p.id,age:p.ageDays}));
  for(let day=0;day<4;day++){
    Sim.stepDay(a,{includeSnapshot:false});
    Sim.stepDay(b,{includeSnapshot:false});
    const stats=cognitiveDayMetrics(a);
    assert.ok(stats && stats.inferred>=0);
    assert.ok(stats.inferred-stats.urgent<=stats.budget);
    assert.equal(a.day,day+1);
    assert.equal(b.day,day+1);
  }
  assert.deepEqual(a.people.map(p=>[p.id,p.alive,p.health,p.foodReserve,p.brain?.lastAction]),
    b.people.map(p=>[p.id,p.alive,p.health,p.foodReserve,p.brain?.lastAction]));
  assert.equal(a.rngState,b.rngState);
  assert.ok(a.people.some((p,i)=>p.ageDays>before[i]?.age),
    'daily lifecycle must continue for low-LOD actors');
});

test('read-only LOD coverage telemetry counts cold-start and overdue neural caches',()=>{
  const w=setup(10,2);
  beginCognitiveDay(w,w.people);
  assert.equal(cognitiveDayMetrics(w).neverInferred,10);
  assert.equal(cognitiveDayMetrics(w).oldestCacheAgeDays,0);
  for(const person of w.people)choosePeopleAction(w,person,input,utility('rest'));
  w.day=1;
  beginCognitiveDay(w,w.people);
  assert.equal(cognitiveDayMetrics(w).neverInferred,8);
  assert.equal(cognitiveDayMetrics(w).overdueCached,0);
  assert.equal(cognitiveDayMetrics(w).oldestCacheAgeDays,1);
  // A saved actor may re-enter a world with a cache older than the expected
  // window; telemetry reports this without modifying action or cache.
  w.people[0].brain.cognitiveInferenceCache.day=-30;
  beginCognitiveDay(w,w.people);
  const stats=cognitiveDayMetrics(w);
  assert.equal(stats.overdueCached,1);
  assert.equal(stats.oldestCacheAgeDays,31);
  assert.equal(w.people[0].brain.cognitiveInferenceCache.day,-30);
});
