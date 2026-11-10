// JUL-291: run on either an unmodified baseline checkout or the candidate.
// The two versions use the same script and verify per-day authoritative state
// outside the timed path. Never use these Node timings as browser FPS evidence.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Sim from '../src/simulation/engine.js';
import { authoritativeSnapshotDigest } from './support/jul274-snapshot-digest.mjs';

const seeds=[1,42,2026],days=Number(process.env.JUL291_BRANCH_DAYS || 14);
assert.ok(Number.isSafeInteger(days) && days >= 7 && days <= 90);
const samples=[];
for(const seed of seeds){
  const world=Sim.createWorld(seed);
  for(let day=1;day<=days;day++){
    let faunaMs=null;
    const began=performance.now();
    Sim.stepDay(world,{
      includeSnapshot:false,
      onEnvironmentPhase:(name,elapsed)=>{if(name==='animals') faunaMs=elapsed;}
    });
    const stepMs=performance.now()-began;
    assert.ok(faunaMs!==null, 'JUL-290 per-subsystem timing unavailable');
    const hash=authoritativeSnapshotDigest(world);
    samples.push({seed,day,stepMs,faunaMs,rngState:world.rngState,digest:hash});
  }
  console.log('JUL291-BRANCH-SEED',JSON.stringify({seed,days,finalDigest:samples.at(-1).digest}));
}
const path=resolve(process.argv[2] || 'out/jul291-branch.json');
mkdirSync(dirname(path),{recursive:true});
writeFileSync(path,JSON.stringify({schema:1,issue:'JUL-291',
  sha:process.env.GITHUB_SHA||'unknown',seeds,days,samples,
  caveat:'Node wall-time CPU proxy; repeat paired A/B and GPU browser QA before claiming FPS improvement.'},null,2));
console.log('PASSED JUL-291 deterministic full-world branch capture');
