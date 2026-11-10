// JUL-291: exact per-day baseline/candidate SHA256 parity + paired CPU A/B.
// Executed from a workspace containing ./baseline and ./candidate checkouts.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root=resolve(process.cwd());
const output=resolve(root,'out/jul291-branch-ab');
mkdirSync(output,{recursive:true});
const metricTotal=(rows,key)=>rows.reduce((sum,row)=>sum+row[key],0);
const results=[];
for(const [pair,order] of [['baseline','candidate'],['candidate','baseline']].entries()){
  const data={};
  for(const mode of order){
    const destination=resolve(output,'pair'+(pair+1)+'-'+mode+'.json');
    const stdout=execFileSync(process.execPath,
      ['scripts/benchmark-jul291-branch.mjs',destination],{
        cwd:resolve(root,mode),encoding:'utf8',timeout:10*60*1000,maxBuffer:2*1024*1024,
        env:{...process.env,JUL291_BRANCH_DAYS:'14'}
      });
    writeFileSync(destination.replace(/\.json$/,'.log'),stdout);
    data[mode]=JSON.parse(readFileSync(destination,'utf8'));
  }
  const prior=data.baseline,candidate=data.candidate;
  assert.equal(candidate.samples.length,prior.samples.length);
  for(let i=0;i<prior.samples.length;i++){
    const a=prior.samples[i],b=candidate.samples[i];
    assert.equal(a.seed,b.seed);
    assert.equal(a.day,b.day);
    assert.equal(a.rngState,b.rngState,
      'RNG changed seed '+a.seed+' day '+a.day);
    assert.equal(a.digest,b.digest,
      'Full authoritative world changed seed '+a.seed+' day '+a.day);
  }
  const item={pair:pair+1,order,parity:true,days:prior.days,
    seeds:prior.seeds,samples:prior.samples.length};
  for(const key of ['faunaMs','stepMs']){
    const before=metricTotal(prior.samples,key);
    const after=metricTotal(candidate.samples,key);
    item[key]={baselineTotalMs:+before.toFixed(3),
      candidateTotalMs:+after.toFixed(3),changePercent:
        +(100*(after/before-1)).toFixed(2)};
  }
  console.log('JUL291-BRANCH-PAIR',JSON.stringify(item));
  results.push(item);
}
writeFileSync(resolve(output,'summary.json'),JSON.stringify({
  schema:1,issue:'JUL-291',
  baseSha:process.env.BASELINE_SHA||'unknown',
  headSha:process.env.GITHUB_SHA||'unknown',
  methodology:'2 alternating A/B pairs, 3 seeds x 14 full-world days per mode, identical authoritative snapshot digests and RNG at each day, timed fauna/step excluding hashing. Node CPU proxy, not FPS.',
  pairs:results
},null,2));
console.log('PASSED JUL-291 two paired full-world branch comparisons with exact per-day state parity');
