import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../src/simulation/engine.js';
import { createWorldSnapshot } from '../src/simulation/render-snapshot.js';

const phases = [
  'climate','roads','hydrology','vegetation','animals',
  'territoriesBeforeActors','looseLogs','decomposition',
  'marketMaintenance','territoriesAfterActors'
];

test('opt-in environment timing records each phase once without changing world causality', () => {
  for (const seed of [1,42]) {
    const measured = Sim.createWorld(seed), unmeasured = Sim.createWorld(seed);
    for (let day=1;day<=2;day++) {
      const rows=[];
      const timed=Sim.stepDay(measured, {
        includeSnapshot:false,
        onEnvironmentPhase:(name,elapsed)=>{
          assert.ok(Number.isFinite(elapsed) && elapsed>=0);
          rows.push(name);
        }
      });
      const plain=Sim.stepDay(unmeasured,{includeSnapshot:false});
      assert.equal(timed.snapshot,null);
      assert.equal(plain.snapshot,null);
      assert.deepEqual(timed.weather,plain.weather,
        'weather including RNG must match on seed '+seed+' day '+day);
      assert.deepEqual(rows,phases,'phase ordering must preserve action causality');
      assert.equal(measured.day,day);
      assert.equal(unmeasured.day,day);
    }
    assert.deepEqual(createWorldSnapshot(measured),createWorldSnapshot(unmeasured),
      'all authoritative world fields must match with and without profiler');
  }
});

test('invalid observer values are ignored and regular step semantics are preserved', () => {
  const w=Sim.createWorld(17), before=w.day;
  const result=Sim.stepDay(w,{includeSnapshot:false,onEnvironmentPhase:'not-a-function'});
  assert.equal(w.day,before+1);
  assert.equal(result.snapshot,null);
  assert.ok(result.weather);
});
