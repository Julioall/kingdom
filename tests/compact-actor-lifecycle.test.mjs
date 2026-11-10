// JUL-278: deterministic adversarial render/inspector parity for movement,
// combat animation fields, true newborn constructors and death side effects.
// These are scripted QA events on real engine worlds, not emergent battles.
// The runtime and compact projection are the shipping implementations.
import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../src/simulation/engine.js';
import { makePerson, killPerson, changePersonHealth } from '../src/simulation/individuals/lifecycle.js';
import { makeAnimal } from '../src/simulation/ecology/animals.js';
import { recordArrow } from '../src/simulation/kingdoms/combat-resources.js';
import { createMovementInterpolator } from '../src/ui/movement-interpolation.js';
import { residentSpritePose } from '../src/ui/person-animations.js';
import { createCompactPresentationBase, COMPACT_ACTOR_STRIPPED_FIELDS } from '../src/simulation/compact-presentation.js';
import { createSimulationWorkerRuntime } from '../src/simulation/worker-runtime.js';
import { SIMULATION_PROTOCOL_VERSION } from '../src/simulation/protocol-version.js';
import { applyWorldSnapshot, applyWorldTileDelta } from '../src/simulation/render-snapshot.js';

function runtime(seed, mode) {
  let world = null, sequence = 0, epoch = 1;
  const simulation = createSimulationWorkerRuntime({
    createWorldImpl: actualSeed => { world = Sim.createWorld(actualSeed); return world; }
  });
  const send = (type, args = {}) => {
    const response = simulation.handle({
      protocolVersion: SIMULATION_PROTOCOL_VERSION, requestId: ++sequence,
      epoch, type, ...args
    });
    assert.notEqual(response.type, 'error', type + ': ' + response.message);
    return response;
  };
  const initial = send('initialize', {
    seed, config: { scenario: 'kingdom' }, transport: mode
  });
  assert.equal(initial.type, 'snapshot');
  return { send, get world() { return world; }, initial };
}

function scriptedTransition(world, event) {
  const living = world.people.filter(p => p.alive);
  const actor = living.find(p => p.role === 'soldier') || living[0];
  const target = living.find(p => p.id !== actor.id && p.role !== 'ruler')
    || living.find(p => p.id !== actor.id);
  assert.ok(actor && target, 'actors required for QA transitions');

  if (event === 'move') {
    // Small, scripted position change on a real living actor so interpolation
    // can be checked independently of pathfinding and terrain collision.
    actor.x += .25;
    actor.headingX = 1; actor.headingY = 0;
    actor.visualActivity = { kind: 'build', x: actor.x, y: actor.y, day: world.day };
    actor.state = 'construindo torre';
    actor.brain.lastAction = 'build';
    return { person: actor.id };
  }
  if (event === 'fight') {
    // Real arrow record and health accounting, plus current visual combat
    // metadata. This exercises animation fields but is not a real war outcome.
    actor.role = 'soldier';
    actor.militaryClass = 'arqueiro';
    const actionId = 'qa-attack-' + world.day;
    recordArrow(actor, target, world.day, { id: actionId,
      aim: { x: target.x, y: target.y }, windupMs: 400, flightMs: 500 });
    actor.combatAction = { id: actionId, day: world.day, kind: 'arrow',
      targetId: target.id, windupMs: 400, flightMs: 500 };
    actor.combatDefense = { actionId: 'qa-shield-' + world.day,
      day: world.day, kind: 'block' };
    actor.lastMilitaryAttackDay = world.day;
    changePersonHealth(world, target, -12, 'combat');
    return { person: actor.id, target: target.id };
  }
  if (event === 'birth') {
    // Use the actual engine constructors and real world identity allocation.
    // Parent selection/housing gates are intentionally outside this fixture.
    const baby = makePerson(world, actor.x, actor.y, true);
    baby.kingdomId = actor.kingdomId;
    baby.communityId = actor.communityId;
    baby.parents = [actor.id];
    baby.guardianId = actor.id;
    world.people.push(baby);
    const owner = world.kingdoms.find(k => k.id === baby.kingdomId);
    if (owner) owner.memberIds.push(baby.id);
    world.births++; world.birthsByKind.people++;
    const newbornAnimal = makeAnimal(world, 'sheep', actor.x, actor.y, true);
    world.animals.push(newbornAnimal);
    world.birthsByKind.animals++;
    return { person: baby.id, animal: newbornAnimal.id };
  }
  if (event === 'death') {
    killPerson(world, target, 'combat');
    const animal = world.animals.find(a => a.alive);
    assert.ok(animal, 'living animal required for death parity fixture');
    animal.alive = false;
    animal.state = 'morto';
    return { person: target.id, animal: animal.id };
  }
  throw Error('Unknown QA event: ' + event);
}

function checkActorPresentation(fullWorld, compactWorld, label) {
  assert.deepEqual(createCompactPresentationBase(fullWorld),
    compactWorld, 'entire presentation base differs at ' + label);
  assert.deepEqual(compactWorld.people.map(p => p.id),fullWorld.people.map(p=>p.id));
  assert.deepEqual(compactWorld.animals.map(a => a.id),fullWorld.animals.map(a=>a.id));
  for (const [kind, a, b] of [
    ['person',fullWorld.people,compactWorld.people],
    ['animal',fullWorld.animals,compactWorld.animals]
  ]) for (let i = 0; i < a.length; i++) {
    assert.equal(b[i].alive,a[i].alive,kind+' death flag changed '+label);
    assert.equal(b[i].ageDays,a[i].ageDays,kind+' age changed '+label);
    assert.equal(b[i].x,a[i].x,kind+' x changed '+label);
    assert.equal(b[i].y,a[i].y,kind+' y changed '+label);
    assert.equal(b[i].brain?.lastAction,a[i].brain?.lastAction,
      kind+' animation action changed '+label);
    for(const key of COMPACT_ACTOR_STRIPPED_FIELDS)
      assert.ok(!Object.hasOwn(b[i],key),'unwanted cognitive field '+key);
  }
}

function compareResponses(full, compact, label) {
  assert.equal(full.type, compact.type, label+' packet type');
  assert.equal(full.revision, compact.revision,label+' packet revision');
  assert.equal(full.epoch, compact.epoch,label+' packet epoch');
  const f=full.type==='snapshot'?full.snapshot:full.delta;
  const c=compact.type==='snapshot'?compact.snapshot:compact.delta;
  assert.deepEqual(createCompactPresentationBase(f.base),c.base,label+' compact DTO');
  assert.deepEqual(f.tileColumns,c.tileColumns,label+' tile changes');
  assert.deepEqual(f.stats,c.stats,label+' stats');
  assert.deepEqual(f.events,c.events,label+' events');
  assert.deepEqual(f.logs,c.logs,label+' logs');
  return { fullBase:f.base, compactBase:c.base };
}

test('movement, combat, newborns and deaths retain render DTO and inspector parity across Worker captures',()=>{
  for (const seed of [1,42]) {
    const full=runtime(seed,'tile-delta');
    const compact=runtime(seed,'tile-delta-compact');
    let fullView=applyWorldSnapshot(full.initial.snapshot);
    let compactView=applyWorldSnapshot(compact.initial.snapshot);
    compareResponses(full.initial, compact.initial,'initial');
    const fullMotion=createMovementInterpolator();
    const compactMotion=createMovementInterpolator();
    fullMotion.observe(fullView,1000,{reset:true,speed:1});
    compactMotion.observe(compactView,1000,{reset:true,speed:1});

    for(const [index,event] of ['move','fight','birth','death'].entries()){
      const beforeRng=full.world.rngState;
      const effectsA=scriptedTransition(full.world,event);
      const effectsB=scriptedTransition(compact.world,event);
      assert.deepEqual(effectsA,effectsB,'fixture differed '+event);
      assert.equal(full.world.rngState,compact.world.rngState,event+' RNG');
      if(event==='birth')assert.notEqual(full.world.rngState,beforeRng,'constructor should use real world RNG');

      const resyncA=full.send('resync');
      const resyncB=compact.send('resync');
      compareResponses(resyncA,resyncB,event+' immediate resync');
      fullView=applyWorldSnapshot(resyncA.snapshot);
      compactView=applyWorldSnapshot(resyncB.snapshot);
      checkActorPresentation(fullView,compactView,event+' resync');

      for(const [kind,id] of [['person',effectsA.person],['animal',effectsA.animal]]) {
        if(id==null)continue;
        const request=kind==='person'?'inspect-person':'inspect-animal';
        const props=kind==='person'?{personId:id}:{animalId:id};
        const a=full.send(request,props),b=compact.send(request,props);
        assert.deepEqual(a.result,b.result,kind+' full detail after '+event);
        assert.ok(b.result.actor,'actor should still exist even if dead '+event);
        assert.equal(b.revision,resyncB.revision);
        assert.equal(b.result.day,fullView.day);
      }
      if(event==='death'){
        assert.equal(compactView.people.find(p=>p.id===effectsA.person).alive,false);
        assert.equal(compactView.animals.find(a=>a.id===effectsA.animal).alive,false);
      }
      if(event==='birth'){
        assert.equal(compactView.people.find(p=>p.id===effectsA.person).ageDays,0);
        assert.equal(compactView.animals.find(a=>a.id===effectsA.animal).ageDays,0);
      }

      const elapsed=1100+(index+1)*1000;
      fullMotion.observe(fullView,elapsed,{speed:1});
      compactMotion.observe(compactView,elapsed,{speed:1});
      for(const person of fullView.people.filter(p=>p.alive).slice(0,16)){
        const mirror=compactView.people.find(p=>p.id===person.id);
        for(const moving of [false,true]){
          const pose={moving,dirX:1,dirY:0,facingX:1};
          assert.deepEqual(residentSpritePose(person,pose,fullView.day),
            residentSpritePose(mirror,pose,compactView.day),
            'resident sprite diverged after '+event);
        }
        assert.deepEqual(
          fullMotion.pose('person',person,elapsed+300),
          compactMotion.pose('person',mirror,elapsed+300),
          'movement interpolation diverged after '+event);
      }

      const dayA=full.send('advance',{days:1,source:'manual'});
      const dayB=compact.send('advance',{days:1,source:'manual'});
      compareResponses(dayA,dayB,event+' next day');
      assert.equal(dayA.type,dayB.type);
      if(dayA.type==='world-delta'){
        fullView=applyWorldTileDelta(dayA.delta,fullView);
        compactView=applyWorldTileDelta(dayB.delta,compactView);
      }else{
        fullView=applyWorldSnapshot(dayA.snapshot);
        compactView=applyWorldSnapshot(dayB.snapshot);
      }
      checkActorPresentation(fullView,compactView,event+' following day');
      assert.equal(full.world.rngState,compact.world.rngState,event+' next day RNG');
    }

    const dead=compactView.people.find(p=>!p.alive);
    assert.ok(dead,'scenario includes an authoritative death');
    assert.ok(compactView.people.some(p=>p.ageDays<10),'newborn remains represented');
  }
});
