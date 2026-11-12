import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../src/simulation/engine.js';
import { createWorldSnapshot } from '../src/simulation/render-snapshot.js';
import { treeGrowthStructureMask } from '../src/simulation/ecology/tree-growth-structure-mask.js';
import { nearestPrey, nearestThreat } from '../src/simulation/ecology/animals.js';
import { createHtmlDiffWriter } from '../src/ui/html-diff.js';
import { ANIMALS } from '../src/config/ecosystem.js';

const STAGES = [
  'environment','frontierExpansion','combatResources','towerShifts',
  'campaignPreparation','militarySalaries','societyAndNpcActions',
  'clericHealing','battlefieldSkirmishes','campaignResolution',
  'towerDefense','localThreatResponse','resourcesAndMarkets','calendar',
  'socialDeadlines','kingdomProjects','endOfDay'
];

test('whole-world phase timing preserves RNG, state and stage coverage', () => {
  const profiled = Sim.createWorld(42), normal = Sim.createWorld(42);
  const seen = [];
  Sim.stepDay(profiled, {includeSnapshot:false,
    onSimulationPhase(name, ms) {
      seen.push(name);
      assert.ok(Number.isFinite(ms) && ms >= 0);
    }
  });
  Sim.stepDay(normal, {includeSnapshot:false});
  assert.deepEqual(seen, STAGES);
  assert.deepEqual(createWorldSnapshot(profiled),createWorldSnapshot(normal));
});

test('tree blocker mask preserves previous structure checks at borders and fractions', () => {
  const width=32, height=24;
  const structures=[
    {x:3.5,y:4.25,radius:2.6},{x:31,y:0,radius:4},
    {x:12,y:12,radius:0},{x:20.5,y:18.5,radius:1.5},
    {x:7,y:7,radius:-2},{x:9,y:9,radius:null},
    {x:18.4,y:13.7,radius:2.3,complete:false,destroyedDay:10}
  ];
  const world={width,height,structures,tiles:new Array(width*height)};
  const mask=treeGrowthStructureMask(world);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const expected=structures.some(s=>Math.abs(x-s.x)<=(s.radius||1.5)
      && Math.abs(y-s.y)<=(s.radius||1.5));
    assert.equal(mask[y*width+x],Number(expected),'tile '+x+','+y);
  }
});

test('nearest prey and human threats use proximity and stable ties', () => {
  // The production ecosystem presently has only sheep. Exercise generic
  // predator selection with a synthetic profile, without adding new species.
  assert.ok(ANIMALS.some(animal=>animal.id==='sheep'));
  const profile={prey:['sheep']};
  const preyA={id:2,alive:true,speciesId:'sheep',x:1,y:0};
  const preyB={id:3,alive:true,speciesId:'sheep',x:-1,y:0,
    habituation:0,perception:{people:[{id:7,visible:true,distance:1}]}};
  const hunter={id:1,alive:true,speciesId:'sheep',x:0,y:0};
  const human={id:7,alive:true,x:-2,y:0,brain:{lastAction:'hunt'},state:'caçando'};
  const world={animals:[hunter,preyA,preyB],people:[human]};
  assert.equal(nearestPrey(world,hunter,profile),preyA);
  assert.equal(nearestThreat(world,preyB,5.5,new Map([[human.id,human]])),human);
  assert.equal(nearestThreat(world,preyB,5.5),human);
  assert.equal(nearestPrey({...world,animals:[hunter,{...preyA,alive:false},preyB]},hunter,profile),preyB);
});

test('HUD writer does not replace identical DOM, but updates changed values', () => {
  const update=createHtmlDiffWriter();
  const element={writes:0,_html:'',set innerHTML(v){this._html=v;this.writes++;},get innerHTML(){return this._html;}};
  assert.equal(update(element,'<b>1</b>'),true);
  assert.equal(update(element,'<b>1</b>'),false);
  assert.equal(update(element,'<b>2</b>'),true);
  assert.equal(element.writes,2);
});
