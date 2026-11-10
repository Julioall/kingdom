import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../src/simulation/engine.js';
import Senses from '../src/simulation/individuals/perception.js';
import { PLANTS, ANIMALS } from '../src/config/ecosystem.js';
import { animalFoodCell } from '../src/simulation/ecology/animals.js';
import { species } from '../src/simulation/core/math.js';
import { cellAt } from '../src/simulation/world/spatial.js';
import { resourceUsePressure } from '../src/simulation/world/roads.js';

function oldSortedFoodCell(w, animal, profile) {
  const resources = animal.perception && animal.perception.resources || [];
  const candidate = resources.filter(resource =>
    (profile.aquatic ? resource.terrain === 'water' : resource.terrain !== 'water')
      && profile.diet.some(id => (resource.biomass[id] || 0) > .5))
    .sort((a,b) => {
      const tileA = cellAt(w,a.x,a.y), tileB=cellAt(w,b.x,b.y);
      const valueA = profile.diet.reduce((sum,id)=>sum+(a.biomass[id]||0),0)
        -a.distance*4-resourceUsePressure(tileA)*28;
      const valueB = profile.diet.reduce((sum,id)=>sum+(b.biomass[id]||0),0)
        -b.distance*4-resourceUsePressure(tileB)*28;
      return valueB-valueA;
    })[0];
  return candidate ? cellAt(w,candidate.x,candidate.y) : null;
}

test('one-pass animal food selection matches stable-sort legacy with real perception across seeds', () => {
  for(const seed of [1,42,2026]){
    const world=Sim.createWorld(seed);
    for(let day=0;day<3;day++){
      if(day)Sim.stepDay(world,{includeSnapshot:false});
      for(const animal of world.animals.filter(a=>a.alive)){
        const profile=species(animal.speciesId,ANIMALS);
        const perception=Senses.observe(world,animal,'animal',PLANTS);
        const synthetic={...animal,perception};
        const got=animalFoodCell(world,synthetic,profile);
        const expected=oldSortedFoodCell(world,synthetic,profile);
        assert.equal(got,expected,
          'Different food choice: seed '+seed+', day '+day+', animal '+animal.id);
      }
    }
  }
});

test('one-pass wildlife food selection retains tie order, pressure and missing-food fallback', () => {
  const tiles=Array.from({length:16},(_,i)=>({
    i,x:i%4,y:Math.floor(i/4),terrain:'land',
    peoplePresence:0,roadWear:0,civilizationPressure:0
  }));
  const world={width:4,height:4,tiles};
  const profile={aquatic:false,diet:['grass']};
  const animal={perception:{resources:[
    {x:1,y:0,terrain:'land',biomass:{grass:10},distance:1},
    {x:2,y:0,terrain:'land',biomass:{grass:10},distance:1},
    {x:0,y:0,terrain:'land',biomass:{grass:50},distance:20},
    {x:3,y:0,terrain:'water',biomass:{grass:200},distance:0}
  ]}};
  assert.equal(animalFoodCell(world,animal,profile),tiles[1],
    'stable tie must prefer the first eligible resource');
  assert.equal(animalFoodCell(world,animal,profile),
    oldSortedFoodCell(world,animal,profile));
  tiles[1].civilizationPressure=.95;
  assert.equal(animalFoodCell(world,animal,profile),tiles[2]);
  assert.equal(animalFoodCell(world,animal,profile),
    oldSortedFoodCell(world,animal,profile));
  animal.perception.resources=[{x:1,y:1,terrain:'water',biomass:{grass:80},distance:0}];
  assert.equal(animalFoodCell(world,animal,profile),null);
  assert.equal(animalFoodCell(world,animal,profile),
    oldSortedFoodCell(world,animal,profile));
  // Old comparator treats nonfinite distances as sort ties. Rare malformed
  // mods should still follow exactly the old comparator semantics.
  animal.perception.resources=[
    {x:1,y:0,terrain:'land',biomass:{grass:10},distance:Infinity},
    {x:2,y:0,terrain:'land',biomass:{grass:11},distance:2}
  ];
  assert.equal(animalFoodCell(world,animal,profile),
    oldSortedFoodCell(world,animal,profile));
});
