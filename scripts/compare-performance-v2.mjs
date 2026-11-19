// Compare genuine baseline/candidate full worlds on the same CI host.
import assert from 'node:assert/strict';
import { readdir,readFile,writeFile } from 'node:fs/promises';
import { resolve,join } from 'node:path';
const dir=resolve(process.argv[2]||'out/perf-v2');
const names=await readdir(dir);
const baselines=names.filter(x=>/^baseline-\d+-\d+\.json$/.test(x)).sort();
assert.ok(baselines.length>0,'no baseline reports');
const rows=[];
const changedTerrain = process.env.KINGDOM_V2_WORLD_SIZE_CHANGE === '1';
for(const filename of baselines){
  const suffix=filename.slice('baseline-'.length);
  const a=JSON.parse(await readFile(join(dir,filename),'utf8'));
  const b=JSON.parse(await readFile(join(dir,'candidate-'+suffix),'utf8'));
  const replay = changedTerrain
    ? JSON.parse(await readFile(join(dir,'candidate-repeat-'+suffix),'utf8'))
    : null;
  if (replay) {
    assert.equal(replay.commit, b.commit, 'candidate replay must use the same source revision');
    assert.equal(replay.seed, b.seed);
    assert.equal(replay.population, b.population);
    assert.equal(replay.days, b.days);
    assert.equal(replay.configuration, b.configuration);
    assert.deepEqual(replay.host, b.host);
  }
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
    if (changedTerrain) {
      // Two differently-sized islands cannot possibly share a whole-world
      // digest. Require exact candidate-vs-candidate replay instead of
      // falsely calling the intentional terrain change a regression.
      assert.equal(second.snapshotDigest, replay.measurements[i].snapshotDigest,
        'candidate same-size replay divergence '+suffix+' day '+second.day);
      assert.equal(second.alive, replay.measurements[i].alive);
    } else {
      assert.equal(first.snapshotDigest,second.snapshotDigest,
        'semantic divergence '+suffix+' day '+first.day);
      assert.equal(first.alive,second.alive);
    }
    const reductionPercent=100*(1-second.ms/first.ms);
    rows.push({population:a.population,seed:a.seed,day:first.day,baselineMs:first.ms,
      candidateMs:second.ms,reductionPercent,
      crossRevisionExactParity: !changedTerrain,
      candidateSameSizeDeterministicReplay: changedTerrain,
      terrainChanged: changedTerrain});
  }
}
const result={schema:1,comparison:changedTerrain
    ? 'different terrain sizes: same-host timings and exact same-revision candidate replay'
    : 'same-host exact cross-revision full-world parity',
  rows,
  caveats:'A 112x112 vs 160x160 map is NOT semantically equal; candidate parity is tested only within identical world sizes. Timings cannot isolate map cost from behavior. One-day GC/JIT noise and GPU FPS still require separate tests.'};
await writeFile(join(dir,'summary.json'),JSON.stringify(result,null,2));
console.log('PERF-V2-COMPARE',JSON.stringify(result));
