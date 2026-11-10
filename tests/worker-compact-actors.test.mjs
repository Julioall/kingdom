import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulationWorkerRuntime } from '../src/simulation/worker-runtime.js';
import { compactActorSnapshotBase, DEFERRED_PERSON_FIELDS,
  DEFERRED_ANIMAL_FIELDS } from '../src/simulation/compact-actor-snapshot.js';
import { SIMULATION_PROTOCOL_VERSION } from '../src/simulation/protocol-version.js';
import { applyWorldSnapshot,applyWorldTileDelta } from '../src/simulation/render-snapshot.js';

function wrap(seed,compact=false){
  const runtime=createSimulationWorkerRuntime();
  let requestId=0,epoch=1;
  const send=(type,extras={},overrideEpoch=epoch)=>runtime.handle({
    protocolVersion:SIMULATION_PROTOCOL_VERSION,requestId:++requestId,
    epoch:overrideEpoch,type,...extras
  });
  const init=send('initialize',{seed,config:{scenario:'kingdom'},
    ...(compact?{transport:'tile-delta-compact'}:{})});
  return {send,init};
}

test('compact projection omits only deferred fields without modifying original world objects',()=>{
  const p={id:1,name:'Example',brain:{updates:9},perception:{resources:[{tileIndex:1}]},
    knownRoutes:[{x:4}],navigationRoute:[{x:3}],skills:{build:2}};
  const a={id:3,speciesId:'sheep',brain:{updates:1},perception:{resources:[]},
    sensoryMemory:{water:[]},energy:70};
  const base={day:7,people:[p],animals:[a],kingdoms:[{id:8}]};
  const projected=compactActorSnapshotBase(base);
  assert.notEqual(projected,base);
  assert.notEqual(projected.people,base.people);
  assert.notEqual(projected.people[0],p);
  assert.notEqual(projected.animals[0],a);
  for(const key of DEFERRED_PERSON_FIELDS)
    if(key!=='brain') assert.equal(Object.hasOwn(projected.people[0],key),false,key);
  for(const key of DEFERRED_ANIMAL_FIELDS)
    if(key!=='brain') assert.equal(Object.hasOwn(projected.animals[0],key),false,key);
  assert.deepEqual(projected.people[0].brain,{lastAction:undefined});
  assert.deepEqual(projected.animals[0].brain,{lastAction:undefined});
  assert.equal(projected.people[0].__compactActorSnapshot,true);
  assert.equal(projected.animals[0].__compactActorSnapshot,true);
  assert.deepEqual(p.brain,{updates:9});
  assert.equal(a.perception.resources.length,0);
  assert.equal(projected.people[0].skills,p.skills);
  assert.equal(projected.kingdoms,base.kingdoms,'other world sections shared only within snapshot');
  assert.equal(projected.day,7);
});

test('opt-in compact worker still has full cognition and preserves legacy snapshots',()=>{
  for(const seed of [1,42,2026]){
    const full=wrap(seed),lite=wrap(seed,true);
    assert.equal(full.init.type,'snapshot');
    assert.equal(lite.init.type,'snapshot');
    assert.deepEqual(lite.init.snapshot.base.people,
      compactActorSnapshotBase(full.init.snapshot.base).people);
    assert.deepEqual(lite.init.snapshot.base.animals,
      compactActorSnapshotBase(full.init.snapshot.base).animals);
    const actor=full.init.snapshot.base.people[0];
    assert.ok(actor.brain,'legacy snapshot still includes neural detail');
    assert.deepEqual(Object.keys(lite.init.snapshot.base.people[0].brain),['lastAction']);
    assert.equal(lite.init.snapshot.base.people[0].brain.lastAction,
      full.init.snapshot.base.people[0].brain.lastAction);
    assert.equal(lite.init.snapshot.base.people[0].perception,undefined);
    const a=full.init.snapshot.base.animals[0];
    assert.ok(a.brain,'legacy animal snapshot still carries brain');
    assert.deepEqual(Object.keys(lite.init.snapshot.base.animals[0].brain),['lastAction']);
    assert.equal(lite.init.snapshot.base.animals[0].brain.lastAction,
      full.init.snapshot.base.animals[0].brain.lastAction);
    const personDetail=lite.send('inspect-person',{personId:actor.id});
    const animalDetail=lite.send('inspect-animal',{animalId:a.id});
    assert.equal(personDetail.type,'query');
    assert.equal(animalDetail.type,'query');
    assert.deepEqual(personDetail.result.actor,actor);
    assert.deepEqual(animalDetail.result.actor,a);
    assert.equal(personDetail.revision,lite.init.revision);
    assert.equal(animalDetail.revision,lite.init.revision);
    const initialView=applyWorldSnapshot(lite.init.snapshot);
    const nextFull=full.send('advance',{days:1,source:'manual'});
    const nextLite=lite.send('advance',{days:1,source:'manual'});
    assert.equal(nextFull.type,'snapshot');
    assert.equal(nextLite.type,'world-delta','compact transport must retain tile deltas');
    assert.equal(nextLite.delta.baseRevision,lite.init.revision);
    assert.deepEqual(nextLite.delta.base.people,
      compactActorSnapshotBase(nextFull.snapshot.base).people);
    assert.deepEqual(nextLite.delta.base.animals,
      compactActorSnapshotBase(nextFull.snapshot.base).animals);
    const view=applyWorldTileDelta(nextLite.delta,initialView);
    const expected=applyWorldSnapshot(nextFull.snapshot);
    assert.deepEqual(view.tiles,expected.tiles);
    assert.deepEqual(view.people,
      compactActorSnapshotBase(nextFull.snapshot.base).people);
    assert.deepEqual(view.animals,
      compactActorSnapshotBase(nextFull.snapshot.base).animals);
    const current=lite.send('inspect-person',{personId:actor.id});
    assert.equal(current.type,'query');
    assert.equal(current.result.day,1);
    assert.ok(current.result.actor.brain);
    assert.deepEqual(current.result.actor,
      nextFull.snapshot.base.people.find(person=>person.id===actor.id));
    const resync=lite.send('resync');
    assert.equal(resync.type,'snapshot');
    assert.equal(resync.snapshot.reset,true);
    assert.deepEqual(Object.keys(resync.snapshot.base.people[0].brain),['lastAction']);
    const reset=lite.send('reset',{seed,kingdomAiEnabled:false,
      transport:'tile-delta-compact'},2);
    assert.equal(reset.type,'snapshot');
    assert.deepEqual(Object.keys(reset.snapshot.base.people[0].brain),['lastAction']);
    assert.ok(lite.send('inspect-person',{personId:reset.snapshot.base.people[0].id},2)
      .result.actor.brain);
  }
});
