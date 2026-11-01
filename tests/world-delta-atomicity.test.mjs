import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../src/simulation/engine.js';
import {createWorldSnapshot, applyWorldSnapshot, applyWorldTileDelta}
  from '../src/simulation/render-snapshot.js';
import {createFieldTileDelta} from '../src/simulation/field-delta.js';
import {createTileColumnDelta} from '../src/simulation/tile-delta.js';

function setup(){
  const world=Sim.createWorld(42);
  const before=createWorldSnapshot(world,{reset:true});
  const view=applyWorldSnapshot(before);
  return {world,before,view};
}
function packet(snapshot,columns) {
  return {base:snapshot.base,tileColumns:columns,reset:false,baseRevision:1,
    stats:snapshot.stats,events:snapshot.events,logs:snapshot.logs};
}
for(const mode of ['row','field']) {
  test(mode+' delta rejects corrupt later tile BEFORE modifying any earlier tile or base',()=>{
    const {world,before,view}=setup();
    world.tiles[1].goldOre+=1;
    world.tiles[100].goldOre+=2;
    world.day=9;
    const after=createWorldSnapshot(world);
    const columns=mode==='row'
      ?createTileColumnDelta(after.tileColumns,before.tileColumns,{maxChangedFraction:1})
      :createFieldTileDelta(after.tileColumns,before.tileColumns);
    assert.ok(columns);
    // The second affected target has incompatible plant storage.
    view.tiles[100].plants=null;
    const originalGold=view.tiles[1].goldOre;
    const originalDay=view.day;
    const originalPeople=view.people;
    assert.throws(()=>applyWorldTileDelta(packet(after,columns),view),/delta/i);
    assert.equal(view.day,originalDay,'base day must remain untouched');
    assert.strictEqual(view.people,originalPeople,'base must not be replaced');
    assert.equal(view.tiles[1].goldOre,originalGold,'earlier tile must remain untouched');
  });
  test(mode+' delta rejects incomplete event collections before mutating view',()=>{
    const {world,before,view}=setup();
    world.tiles[1].goldOre+=1;
    world.day=12;
    const after=createWorldSnapshot(world);
    const columns=mode==='row'
      ?createTileColumnDelta(after.tileColumns,before.tileColumns,{maxChangedFraction:1})
      :createFieldTileDelta(after.tileColumns,before.tileColumns);
    assert.ok(columns);
    const malformed={...packet(after,columns),events:null};
    const beforeDay=view.day,old=view.tiles[1].goldOre;
    assert.throws(()=>applyWorldTileDelta(malformed,view),/delta/i);
    assert.equal(view.day,beforeDay);
    assert.equal(view.tiles[1].goldOre,old);
  });
}
test('valid field delta applies the same final view as the full transport after preflight',()=>{
  const {world,before,view}=setup();
  world.day++;
  Sim.stepDay(world,{includeSnapshot:false});
  const after=createWorldSnapshot(world);
  const columns=createFieldTileDelta(after.tileColumns,before.tileColumns);
  assert.ok(columns);
  const actual=applyWorldTileDelta(packet(after,columns),view);
  const expected=applyWorldSnapshot(after);
  assert.deepEqual(actual.tiles,expected.tiles);
  assert.deepEqual(actual.waterTiles.map(tile=>tile.i),expected.waterTiles.map(tile=>tile.i));
});
