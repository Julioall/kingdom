// Compare genuine baseline/candidate full worlds on the same CI host.
import assert from 'node:assert/strict';
import { readdir,readFile,writeFile } from 'node:fs/promises';
import { resolve,join } from 'node:path';
const dir=resolve(process.argv[2]||'out/perf-v2');
const names=await readdir(dir);
const baselines=names.filter(x=>/^baseline-\d+-\d+\.json$/.test(x)).sort();
assert.ok(baselines.length>0,'no baseline reports');
const rows=[];
for(const filename of baselines){
  const suffix=filename.slice('baseline-'.length);
  const a=JSON.parse(await readFile(join(dir,filename),'utf8'));
  const b=JSON.parse(await readFile(join(dir,'candidate-'+suffix),'utf8'));
  assert.equal(a.population,b.population);
  assert.equal(a.seed,b.seed);
  assert.equal(a.days,b.days);
  assert.equal(a.node,b.node);
  assert.deepEqual(a.host,b.host);
  assert.equal(a.configuration,b.configuration);
  assert.ok(a.commit && b.commit && a.commit!==b.commit,'distinct revisions required');
  assert.equal(a.measurements.length,b.measurements.length);
  for(let i=0;i<a.measurements.length;i++){
    const first=a.measurements[i],second=b.measurements[i];
    assert.equal(first.snapshotDigest,second.snapshotDigest,
      'semantic divergence '+suffix+' day '+first.day);
    assert.equal(first.alive,second.alive);
    const reductionPercent=100*(1-second.ms/first.ms);
    rows.push({population:a.population,seed:a.seed,day:first.day,baselineMs:first.ms,
      candidateMs:second.ms,reductionPercent,exactReplay:true});
  }
}
const result={schema:1,comparison:'same-host full-world benchmark, independent checkouts',rows,
  caveats:'One-day samples are sensitive to GC/JIT/runner noise; browser FPS and real GPU must be tested separately.'};
await writeFile(join(dir,'summary.json'),JSON.stringify(result,null,2));
console.log('PERF-V2-COMPARE',JSON.stringify(result));
