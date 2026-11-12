import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulationWorkerRuntime } from '../src/simulation/worker-runtime.js';
import { SIMULATION_PROTOCOL_VERSION } from '../src/simulation/protocol-version.js';

function send(runtime,type,props={},requestId=1,epoch=1) {
  return runtime.handle({protocolVersion:SIMULATION_PROTOCOL_VERSION,requestId,epoch,type,...props});
}

test('Worker reports simulation and snapshot timing only when enabled', () => {
  const rt=createSimulationWorkerRuntime();
  const init=send(rt,'initialize',{config:{scenario:'kingdom'},seed:42,
    transport:'tile-delta-compact',profileTiming:true,cognitiveBudget:128});
  assert.equal(init.type,'snapshot');
  assert.equal(init.snapshot.base.neuralOverrides.cognitiveSchedule.mode,'budgeted');
  assert.equal(init.snapshot.base.neuralOverrides.cognitiveSchedule.budget,128);
  assert.ok(!Object.hasOwn(init.snapshot.base.people[0],'perception'));
  const advanced=send(rt,'advance',{days:1,source:'manual'},2);
  assert.ok(['snapshot','world-delta'].includes(advanced.type));
  assert.equal(advanced.workerTiming.days,1);
  assert.ok(Number.isFinite(advanced.workerTiming.simulationMs));
  assert.ok(Number.isFinite(advanced.workerTiming.captureMs));
  assert.ok(advanced.workerTiming.phases.societyAndNpcActions >= 0);
  const actor=send(rt,'inspect-person',{personId:init.snapshot.base.people[0].id},3);
  assert.equal(actor.type,'query');
  assert.ok(actor.result.actor.brain);
  assert.ok(Object.hasOwn(actor.result.actor,'perception'));
  const reset=send(rt,'reset',{seed:43,kingdomAiEnabled:false,transport:'tile-delta',profileTiming:true,
    cognitiveBudget:64},4,2);
  assert.equal(reset.type,'snapshot');
  assert.equal(reset.snapshot.base.neuralOverrides.cognitiveSchedule.budget,64);
});

test('adaptive cognition must be explicit and reports effective budget',()=>{
  const rt=createSimulationWorkerRuntime();
  const init=send(rt,'initialize',{config:{scenario:'kingdom'},seed:42,
    profileTiming:true,cognitiveBudget:'adaptive'});
  assert.equal(init.type,'snapshot');
  assert.equal(init.snapshot.base.neuralOverrides.cognitiveSchedule.budget,'adaptive');
  const next=send(rt,'advance',{days:1,source:'manual'},2);
  assert.equal(next.workerTiming.cognitive.budget,128);
  assert.ok(next.workerTiming.cognitive.maxRoutineWaitDays<=8);
});

test('default Worker remains unprofiled and uses full rendering state', () => {
  const rt=createSimulationWorkerRuntime();
  const init=send(rt,'initialize',{config:{scenario:'kingdom'},seed:1});
  assert.equal(init.type,'snapshot');
  assert.equal(init.snapshot.base.neuralOverrides?.cognitiveSchedule,undefined);
  assert.ok(Object.hasOwn(init.snapshot.base.people[0],'perception'));
  const next=send(rt,'advance',{days:1,source:'manual'},2);
  assert.equal(next.workerTiming,undefined);
  assert.equal(next.type,'snapshot');
});
