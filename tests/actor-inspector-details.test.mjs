import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createActorInspectorDetails, isCurrentInspectorResponse
} from '../src/ui/actor-inspector-details.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((res,rej)=>{resolve=res;reject=rej;});
  return {promise,resolve,reject};
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function fixture() {
  const selection={kind:'person',id:101};
  const world={day:4};
  const session={epoch:1,revision:10, calls:[],
    inspectPerson(id) {
      const call=deferred();this.calls.push({kind:'person',id,...call});
      return call.promise;
    },
    inspectAnimal(id) {
      const call=deferred();this.calls.push({kind:'animal',id,...call});
      return call.promise;
    }
  };
  let selected=selection,rendered=0,errors=[];
  const details=createActorInspectorDetails({
    session,readSelection:()=>selected,readWorld:()=>world,
    onDetail:()=>rendered++,
    onError:error=>errors.push(error)
  });
  return {world,session,details,select:s=>selected=s,renders:()=>rendered,
    errors:()=>errors};
}
const reply=(call,actor,options={})=>({
  epoch:options.epoch ?? 1,
  revision:options.revision ?? 10,
  day:options.day ?? 4,
  kind:call.kind,actorId:call.id,actor
});

test('selected actor is fetched at most once per materialized revision', async()=>{
  const f=fixture();
  assert.equal(f.details.read('person',101),undefined);
  assert.equal(f.details.read('person',101),undefined);
  assert.equal(f.session.calls.length,1);
  f.session.calls[0].resolve(reply(f.session.calls[0],{id:101,name:'Builder',brain:{updates:2}}));
  await flush();
  assert.equal(f.renders(),1);
  assert.deepEqual(f.details.read('person',101),{id:101,name:'Builder',brain:{updates:2}});
  assert.equal(f.session.calls.length,1,'no render-loop request storm');
  assert.equal(f.details.snapshot().queries,1);
});

test('changed selection cannot render a previous NPC response',async()=>{
  const f=fixture();
  assert.equal(f.details.read('person',101),undefined);
  f.select({kind:'animal',id:202});
  assert.equal(f.details.read('animal',202),undefined);
  f.session.calls[0].resolve(reply(f.session.calls[0],{id:101,name:'stale'}));
  await flush();
  assert.equal(f.renders(),0);
  assert.equal(f.details.snapshot().discarded,1);
  const second=f.session.calls[1];
  second.resolve(reply(second,{id:202,state:'grazing'}));
  await flush();
  assert.equal(f.renders(),1);
  assert.deepEqual(f.details.read('animal',202),{id:202,state:'grazing'});
});

test('daily updates, reset epochs and invalidation reject obsolete detail',async()=>{
  const f=fixture();
  f.details.read('person',101);
  f.world.day=5;
  f.session.revision=11;
  f.details.read('person',101);
  f.session.calls[0].resolve(reply(f.session.calls[0],{id:101,brain:'old'}));
  await flush();
  assert.equal(f.renders(),0);
  f.session.calls[1].resolve(reply(f.session.calls[1],{id:101,brain:'new'},{
    revision:11,day:5
  }));
  await flush();
  assert.equal(f.renders(),1);
  assert.equal(f.details.read('person',101).brain,'new');
  f.session.epoch=2; f.session.revision=1; f.world.day=0;
  f.details.invalidate();
  f.details.read('person',101);
  f.session.calls[2].resolve(reply(f.session.calls[2],{id:101,brain:'reloaded'},
    {epoch:2,revision:1,day:0}));
  await flush();
  assert.equal(f.details.read('person',101).brain,'reloaded');
  assert.equal(f.renders(),2);
});

test('control ACK revisions ahead of materialized snapshot may be accepted',async()=>{
  const f=fixture();
  f.details.read('person',101);
  const call=f.session.calls[0];
  call.resolve(reply(call,{id:101,name:'Control ack changed revision'},
    {revision:14}));
  await flush();
  assert.equal(f.details.read('person',101).id,101);
  assert.equal(f.renders(),1);
});

test('late replies from unrelated epoch, malformed actor and errors fail closed',async()=>{
  const f=fixture();
  f.details.read('person',101);
  f.session.calls[0].resolve(reply(f.session.calls[0],{id:101},
    {epoch:2}));
  await flush();
  assert.equal(f.details.snapshot().failedKey!==null,true);
  assert.equal(f.details.read('person',101),undefined);
  assert.equal(f.session.calls.length,1,'malformed replies must not loop');
  assert.equal(f.errors().length,1);
  f.details.invalidate();
  f.details.read('person',101);
  f.session.calls[1].reject(Object.assign(new Error('reset'),{name:'AbortError'}));
  await flush();
  assert.equal(f.errors().length,1,'expected reset cancellation is quiet');
  assert.equal(f.details.read('person',101),undefined);
  f.details.invalidate();
  f.details.read('person',101);
  const current=f.session.calls[2];
  current.resolve(reply(current,null));
  await flush();
  assert.equal(f.details.read('person',101),null,
    'authoritative missing actor differs from an unstarted query');
});

test('validator blocks mismatched identity and stale snapshots',()=>{
  const ctx={epoch:1,revision:3,day:7,kind:'person',id:3,key:'1:3:7:person:3'};
  const valid={epoch:1,revision:4,day:7,kind:'person',actorId:3,
    actor:{id:3,brain:{updates:1}}};
  assert.equal(isCurrentInspectorResponse(ctx,valid),true);
  assert.equal(isCurrentInspectorResponse(ctx,{...valid,epoch:2}),false);
  assert.equal(isCurrentInspectorResponse(ctx,{...valid,revision:2}),false);
  assert.equal(isCurrentInspectorResponse(ctx,{...valid,day:8}),false);
  assert.equal(isCurrentInspectorResponse(ctx,{...valid,actorId:99}),false);
  assert.equal(isCurrentInspectorResponse(ctx,{...valid,actor:{id:88}}),false);
  assert.equal(isCurrentInspectorResponse(ctx,{...valid,actor:null}),true);
  assert.equal(isCurrentInspectorResponse(null,valid),false);
});
