import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../src/simulation/engine.js';
import {
  recomputeKingdomTerritories
} from '../src/simulation/kingdoms/territories.js';
import {
  setTerritoryRecomputeMode, territoryRecomputeDiagnostics
} from '../src/simulation/kingdoms/territory-cache.js';
import { createWorldSnapshot } from '../src/simulation/render-snapshot.js';

const ownership = world => ({
  owners: world.tiles.map(t => t.kingdomId),
  kingdomCounts: world.kingdoms.map(k => k.territoryTileCount),
  navigationRevision: world.navigationRevision || 0,
  militaryIntel: world.kingdoms.map(k => structuredClone(k.militaryIntel || [])),
  logs: structuredClone(world.logs),
  wars: structuredClone(world.wars)
});
function worlds(seed = 42) {
  const cached = Sim.createWorld(seed), always = Sim.createWorld(seed);
  setTerritoryRecomputeMode(cached, 'cached');
  setTerritoryRecomputeMode(always, 'always');
  return { cached, always };
}
function compare(pair, label, context = null) {
  const a = pair.cached, b = pair.always;
  recomputeKingdomTerritories(a, context);
  recomputeKingdomTerritories(b, context);
  assert.deepEqual(ownership(a), ownership(b), label);
  assert.equal(a.rngState, b.rngState, label + ' RNG');
}
function both(pair, fn) {
  fn(pair.cached);
  fn(pair.always);
}

test('the guarded projection skips repeated unchanged territory sources without side effects', () => {
  const pair = worlds();
  compare(pair, 'initial');
  const first = territoryRecomputeDiagnostics(pair.cached);
  assert.equal(first.recomputed, 1);
  for (let i = 0; i < 5; i++) compare(pair, 'unchanged ' + i);
  const state = territoryRecomputeDiagnostics(pair.cached);
  assert.equal(state.skipped, 5);
  assert.equal(state.recomputed, 1);
  assert.equal(territoryRecomputeDiagnostics(pair.always).skipped, 0);
  assert.equal(territoryRecomputeDiagnostics(pair.always).recomputed, 6);
});

test('territory sources, tower destruction, radius and source tie order invalidate immediately', () => {
  const pair = worlds();
  compare(pair, 'initial');
  const source = pair.cached.structures.find(s => s.type === 'castelo' && s.complete)
    || pair.cached.structures.find(s => s.type === 'torre' && s.complete);
  assert.ok(source, 'seed has an initial castle or tower');
  const targetId = source.id;
  both(pair, w => {const s = w.structures.find(s => s.id === targetId);s.territoryRadius = (s.territoryRadius || 16) * .7;});
  compare(pair,'radius changed');
  both(pair, w => {const s=w.structures.find(s => s.id === targetId);s.complete=false;s.integrity=0;s.destroyedDay=w.day;});
  compare(pair,'destroyed tower');
  both(pair, w => {const s=w.structures.find(s => s.id === targetId);s.complete=true;s.integrity=1;s.destroyedDay=null;});
  compare(pair,'restored tower');
  both(pair, w => w.structures.reverse());
  compare(pair,'source order reversed');
  assert.ok(territoryRecomputeDiagnostics(pair.cached).recomputed >= 5);
});

test('annexation, expiration on calendar rollover and external tile/kingdom mutations are checked', () => {
  const pair=worlds(1);
  compare(pair,'baseline');
  const ownerId=pair.cached.kingdoms[0].id;
  both(pair,w=>w.territoryClaims.push({
    status:'annexed',ownerId,x:w.width/2,y:w.height/2,
    radius:7,expiresDay:w.day+1
  }));
  compare(pair,'claim starts');
  compare(pair,'same claim unchanged');
  both(pair,w=>{w.day+=1;});
  compare(pair,'claim still live on expiry day');
  both(pair,w=>{w.day+=1;});
  compare(pair,'claim no longer live');
  both(pair,w=>{w.kingdoms[0].territoryTileCount+=1;});
  compare(pair,'external count edit');
  both(pair,w=>{w.tiles.find(t=>t.terrain!=='water').kingdomId=-999;});
  compare(pair,'external owner edit');
  both(pair,w=>{const t=w.tiles.find(t=>t.terrain!=='water'); t.terrain='water';});
  compare(pair,'terrain reclassified');
  assert.ok(territoryRecomputeDiagnostics(pair.cached).skipped >= 1);
});

test('context-dependent siege losses always use full recomputation and retain frontier reports', () => {
  const pair=worlds(2026);
  compare(pair,'initial');
  const tower=pair.cached.structures.find(s=>s.type==='torre'&&s.complete&&s.kingdomId)
    || pair.cached.structures.find(s=>s.type==='castelo'&&s.complete&&s.kingdomId);
  assert.ok(tower);
  const enemy=pair.cached.kingdoms.find(k=>k.id!==tower.kingdomId);
  assert.ok(enemy);
  both(pair,w=>{const s=w.structures.find(t=>t.id===tower.id);s.health=0;s.integrity=0;s.complete=false;s.destroyedDay=w.day;});
  compare(pair,'destroyed source with attacker context',
    {attackerId:enemy.id,defenderId:tower.kingdomId,day:pair.cached.day});
  compare(pair,'repeat context retained',
    {attackerId:enemy.id,defenderId:tower.kingdomId,day:pair.cached.day});
  assert.equal(territoryRecomputeDiagnostics(pair.cached).skipped,0,
    'context path must not skip loss/intelligence reporting');
});

test('full-world, RNG and saveable snapshot parity across daily actors and territory transitions', () => {
  for (const seed of [1,42]) {
    const pair=worlds(seed);
    for(let day=1;day<=4;day++) {
      Sim.stepDay(pair.cached,{includeSnapshot:false});
      Sim.stepDay(pair.always,{includeSnapshot:false});
      assert.deepEqual(createWorldSnapshot(pair.cached),createWorldSnapshot(pair.always),
        'seed '+seed+', day '+day);
    }
    const stats=territoryRecomputeDiagnostics(pair.cached);
    assert.ok(stats.skipped > 0, 'expected skip for stable terrain, seed '+seed);
    assert.ok(stats.recomputed > 0);
  }
});
