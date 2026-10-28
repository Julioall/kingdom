import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../src/simulation/engine.js';

test('kingdom communities start and advance a roça despite food-priority assignments', () => {
  const world = Sim.createWorld(42);
  for (let day = 0; day < 120; day++) Sim.stepDay(world, { includeSnapshot: false });

  const farms = world.structures.filter(structure => structure.type === 'roça'
    && structure.communityId != null && structure.destroyedDay == null);
  assert.ok(farms.length > 0, 'the deterministic kingdom simulation should create a roça: '
    + JSON.stringify({
      supply: world.kingdoms.map(kingdom => {
        const people = world.people.filter(person => person.alive && person.communityId === kingdom.communityId);
        return {
          kingdom: kingdom.id, seedMarket: kingdom.market?.stock?.seeds || 0,
          marketTrades: kingdom.market?.transactions || 0,
          freeSeeds: world.communities.find(community => community.id === kingdom.communityId)?.stores?.seeds || 0,
          inNaturalCargo: people.reduce((total, person) => total + (person.carriedSeeds || 0), 0),
          inCourierCargo: people.reduce((total, person) => total + (person.carriedCommunitySeeds || 0), 0),
          seedCourierStates: people.filter(person => (person.carriedSeeds || 0) + (person.carriedCommunitySeeds || 0) > 0)
            .map(person => ({ id: person.id, state: person.state, assignment: person.assignment?.goal,
              expires: person.assignment?.expiresDay, x: person.x, y: person.y })).slice(0, 4)
        };
      }),
      seedsGathered: world.seedProvenance?.gathered,
      seedLog: (world.seedProvenance?.history || []).slice(-3)
    }));
  assert.ok(farms.some(farm => farm.progress > 0), 'at least one roça should receive construction work');
});
