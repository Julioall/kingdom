import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../src/simulation/engine.js';
import { createWorldSnapshot } from '../src/simulation/render-snapshot.js';
import { setTerritoryRecomputeMode, territoryRecomputeDiagnostics } from '../src/simulation/kingdoms/territory-cache.js';
import { applyScriptedTerritorialWarEvents } from '../scripts/support/jul293-war-stress.mjs';

function pair(seed) {
  const cached = Sim.createWorld(seed), full = Sim.createWorld(seed);
  setTerritoryRecomputeMode(cached, 'cached');
  setTerritoryRecomputeMode(full, 'always');
  return { cached, full };
}
function snapshotEqual(p, context) {
  assert.equal(p.cached.rngState,p.full.rngState,context+' RNG state');
  assert.deepEqual(createWorldSnapshot(p.cached),createWorldSnapshot(p.full),context);
}
test('real paid tower builds, destruction, annexations and war preserve identical territory snapshots',()=>{
  for(const seed of [1,42]){
    const p=pair(seed);
    const actions=[];
    for(let day=0;day<12;day++){
      const a=applyScriptedTerritorialWarEvents(p.cached);
      const b=applyScriptedTerritorialWarEvents(p.full);
      assert.deepEqual(a,b,'event side effects differed at seed '+seed+' day '+day);
      actions.push(...a);
      snapshotEqual(p,'before day step: seed='+seed+' day='+day);
      Sim.stepDay(p.cached,{includeSnapshot:false});
      Sim.stepDay(p.full,{includeSnapshot:false});
      snapshotEqual(p,'after day step: seed='+seed+' day='+day);
    }
    assert.ok(actions.some(a=>a.action==='declare-war'&&a.changed));
    assert.ok(actions.some(a=>a.action==='siege-destroy'&&a.changed),
      'At least one real siege must destroy a tower');
    assert.ok(actions.some(a=>a.action==='annexation'&&a.changed));
    const cachedStats=territoryRecomputeDiagnostics(p.cached);
    const fullStats=territoryRecomputeDiagnostics(p.full);
    assert.ok(cachedStats.skipped>0,'Stable intervals must be reused');
    assert.ok(cachedStats.recomputed>1,'Dynamic ownership must be recomputed');
    assert.equal(fullStats.skipped,0,'Uncached control must always recompute');
  }
});
