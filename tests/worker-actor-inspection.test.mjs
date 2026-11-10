import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulationWorkerRuntime } from '../src/simulation/worker-runtime.js';
import { SIMULATION_PROTOCOL_VERSION } from '../src/simulation/protocol-version.js';

function harness() {
  const runtime = createSimulationWorkerRuntime();
  let id = 0;
  const request = (type, extras = {}, epoch = 1) => runtime.handle({
    protocolVersion: SIMULATION_PROTOCOL_VERSION,
    requestId: ++id, epoch, type, ...extras
  });
  return { request };
}
test('actor inspector queries return exact detached cognition without advancing revision',()=>{
  const {request}=harness();
  const init=request('initialize',{seed:42,config:{scenario:'kingdom'}});
  assert.equal(init.type,'snapshot');
  const person=init.snapshot.base.people[0],animal=init.snapshot.base.animals[0];
  const p=request('inspect-person',{personId:person.id});
  const a=request('inspect-animal',{animalId:animal.id});
  assert.equal(p.type,'query');
  assert.equal(a.type,'query');
  assert.equal(p.revision,init.revision);
  assert.equal(a.revision,init.revision);
  assert.equal(p.epoch,1);
  assert.equal(a.epoch,1);
  assert.deepEqual(p.result,{
    kind:'person',actorId:person.id,day:0,actor:person
  });
  assert.deepEqual(a.result,{
    kind:'animal',actorId:animal.id,day:0,actor:animal
  });
  p.result.actor.state='edited from UI';
  a.result.actor.energy=-1;
  assert.equal(request('inspect-person',{personId:person.id}).result.actor.state,
    person.state,'a client cannot mutate Worker state by editing an inspection');
  assert.equal(request('inspect-animal',{animalId:animal.id}).result.actor.energy,
    animal.energy);
  assert.equal(request('inspect-person',{personId:987654321}).result.actor,null);
  assert.equal(request('inspect-animal',{animalId:987654321}).result.actor,null);
});
test('actor detail observes the current causal day and isolates reset epochs',()=>{
  const {request}=harness();
  const init=request('initialize',{seed:1,config:{scenario:'kingdom'}});
  const firstId=init.snapshot.base.people[0].id;
  const ack=request('set-paused',{paused:true});
  assert.equal(ack.type,'ack');
  const before=request('inspect-person',{personId:firstId});
  assert.equal(before.revision,ack.revision,
    'a read-only query must observe the current revision without advancing it');
  const updated=request('advance',{days:1,source:'manual'});
  assert.equal(updated.type,'snapshot');
  const current=request('inspect-person',{personId:firstId});
  assert.equal(current.result.day,1);
  assert.equal(current.revision,updated.revision);
  assert.deepEqual(current.result.actor,updated.snapshot.base.people.find(p=>p.id===firstId));
  const reset=request('reset',{seed:2026,kingdomAiEnabled:false},2);
  assert.equal(reset.type,'snapshot');
  assert.equal(reset.epoch,2);
  const stale=request('inspect-person',{personId:firstId},1);
  assert.equal(stale.type,'error');
  const fresh=request('inspect-animal',{animalId:reset.snapshot.base.animals[0].id},2);
  assert.equal(fresh.type,'query');
  assert.equal(fresh.epoch,2);
  assert.equal(fresh.revision,reset.revision);
  assert.equal(fresh.result.day,0);
});
test('invalid actor IDs fail closed while unaffected tile inspection still works',()=>{
  const {request}=harness();
  const init=request('initialize',{seed:42,config:{scenario:'kingdom'}});
  for(const id of [-1,1.2,Infinity,'1',null]){
    assert.equal(request('inspect-person',{personId:id}).type,'error');
    assert.equal(request('inspect-animal',{animalId:id}).type,'error');
  }
  const tile=request('inspect-tile',{x:8,y:8});
  assert.equal(tile.type,'query');
  assert.equal(tile.revision,init.revision);
});
