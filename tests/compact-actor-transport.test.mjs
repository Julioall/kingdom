import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulationWorkerRuntime } from '../src/simulation/worker-runtime.js';
import { SIMULATION_PROTOCOL_VERSION } from '../src/simulation/protocol-version.js';
import { applyWorldSnapshot, applyWorldTileDelta } from '../src/simulation/render-snapshot.js';
import {
  createCompactPresentationBase, COMPACT_ACTOR_STRIPPED_FIELDS
} from '../src/simulation/compact-presentation.js';

const request = (runtime, type, props={}, epoch=1, id=1) =>
  runtime.handle({ protocolVersion:SIMULATION_PROTOCOL_VERSION, requestId:id, epoch, type, ...props });
const deepView = (view) => ({
  ...view,people:view.people.map(p=>({...p})),animals:view.animals.map(a=>({...a}))
});

test('projection preserves IDs, positions, action used by renderer and never mutates authoritative actors',()=>{
  const rt=createSimulationWorkerRuntime();
  const init=request(rt,'initialize',{config:{scenario:'kingdom'},seed:42,transport:'tile-delta'});
  const base=init.snapshot.base;
  const saved=structuredClone(base.people[0]);
  const compact=createCompactPresentationBase(base);
  assert.equal(compact.people.length,base.people.length);
  assert.equal(compact.animals.length,base.animals.length);
  assert.deepEqual(compact.people.map(p=>p.id),base.people.map(p=>p.id));
  assert.deepEqual(compact.animals.map(a=>a.id),base.animals.map(a=>a.id));
  assert.equal(compact.people[0].x,base.people[0].x);
  assert.equal(compact.people[0].brain.lastAction,base.people[0].brain.lastAction);
  assert.equal(compact.animals[0].brain.lastAction,base.animals[0].brain.lastAction);
  for(const p of [...compact.people,...compact.animals])
    for(const key of COMPACT_ACTOR_STRIPPED_FIELDS)
      assert.equal(Object.hasOwn(p,key),false, 'heavy field '+key+' was copied');
  assert.deepEqual(base.people[0],saved);
  assert.notEqual(compact.people[0],base.people[0]);
  assert.ok(Object.hasOwn(base.people[0],'perception'),
    'the authoritative person retains perception for the AI');
});

test('compact opt-in snapshots and deltas preserve render state, while queries return full cognition',()=>{
  for(const seed of [1,42,2026]){
    const full=createSimulationWorkerRuntime(),compact=createSimulationWorkerRuntime();
    let i=0;
    const send=(rt,type,props={},epoch=1)=>request(rt,type,props,epoch,++i);
    const normal=send(full,'initialize',{config:{scenario:'kingdom'},seed,transport:'tile-delta'});
    const min=send(compact,'initialize',{config:{scenario:'kingdom'},seed,transport:'tile-delta-compact'});
    assert.equal(normal.type,'snapshot');
    assert.equal(min.type,'snapshot');
    assert.equal(min.snapshot.base.day,0);
    assert.ok(!Object.hasOwn(min.snapshot.base.people[0],'perception'));
    assert.ok(Object.hasOwn(normal.snapshot.base.people[0],'perception'));
    let normalView=applyWorldSnapshot(normal.snapshot);
    let minView=applyWorldSnapshot(min.snapshot);
    for(let day=1;day<=2;day++){
      const regular=send(full,'advance',{days:1,source:'manual'});
      const thin=send(compact,'advance',{days:1,source:'manual'});
      assert.equal(regular.type,'world-delta');
      assert.equal(thin.type,'world-delta');
      normalView=applyWorldTileDelta(regular.delta,normalView);
      minView=applyWorldTileDelta(thin.delta,minView);
      assert.deepEqual(minView.tiles,normalView.tiles,'tile delta must remain bit-for-bit equivalent');
      assert.equal(minView.people.length,normalView.people.length);
      assert.equal(minView.animals.length,normalView.animals.length);
      assert.deepEqual(minView.people.map(p=>[p.id,p.x,p.y,p.alive,p.brain.lastAction]),
        normalView.people.map(p=>[p.id,p.x,p.y,p.alive,p.brain.lastAction]));
      assert.deepEqual(minView.animals.map(a=>[a.id,a.x,a.y,a.alive,a.brain.lastAction]),
        normalView.animals.map(a=>[a.id,a.x,a.y,a.alive,a.brain.lastAction]));
      const person=normalView.people[0],animal=normalView.animals[0];
      const personDetail=send(compact,'inspect-person',{personId:person.id});
      const animalDetail=send(compact,'inspect-animal',{animalId:animal.id});
      assert.equal(personDetail.type,'query');
      assert.equal(animalDetail.type,'query');
      assert.deepEqual(personDetail.result.actor,person,
        'the inspector query must return unstripped full cognition');
      assert.deepEqual(animalDetail.result.actor,animal);
      assert.equal(personDetail.result.day,day);
      assert.equal(personDetail.revision,thin.revision);
    }
    const resync=send(compact,'resync');
    assert.equal(resync.type,'snapshot');
    assert.equal(resync.snapshot.reset,true);
    assert.ok(!Object.hasOwn(resync.snapshot.base.people[0],'perception'));
    const reset=send(compact,'reset',{seed:seed+1,kingdomAiEnabled:false,transport:'tile-delta'},2);
    assert.equal(reset.type,'snapshot');
    assert.ok(Object.hasOwn(reset.snapshot.base.people[0],'perception'),
      'legacy mode must be restored after reset re-negotiates transport');
  }
});
