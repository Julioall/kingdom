import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../src/simulation/engine.js';
import { communitySatisfaction } from '../src/simulation/society/governance.js';

test('governance member index returns exactly the same satisfaction as legacy linear lookup',()=>{
  for(const seed of [1,42,2026]){
    const world=Sim.createWorld(seed);
    for(const community of world.communities){
      const legacy=communitySatisfaction(world,community);
      world.peopleById=new Map(world.people.map(person=>[person.id,person]));
      const indexed=communitySatisfaction(world,community);
      assert.equal(indexed,legacy,'seed '+seed+' community '+community.id);
      delete world.peopleById;
    }
  }
});
