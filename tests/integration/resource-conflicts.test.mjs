import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../../src/simulation/engine.js';
import { PLANTS } from '../../src/config/ecosystem.js';
import { distance } from '../../src/simulation/core/math.js';
import { claimForagePatch } from '../../src/simulation/individuals/actions.js';
import { communityRelation } from '../../src/simulation/society/governance.js';

function claimPair(world, people, tile) {
  world.resourceClaims = new Map();
  world.contestedResources = new Set();
  claimForagePatch(world, people[0], tile, 'berry');
  return claimForagePatch(world, people[1], tile, 'berry');
}

test('a resource fight opens a patch truce for 14 days, then allows a new contest', () => {
  const world = Sim.createWorld(42);
  const people = world.kingdoms.map(kingdom => world.people.find(person => person.alive
    && person.role === 'resident' && person.communityId === kingdom.communityId));
  assert.ok(people[0] && people[1]);
  assert.notEqual(people[0].communityId, people[1].communityId);
  people.forEach(person => { person.foodReserve = 20; });

  const berryIndex = PLANTS.findIndex(plant => plant.id === 'berry');
  assert.ok(berryIndex >= 0);
  const tile = world.tiles.find(candidate => candidate.terrain === 'land');
  assert.ok(tile);
  tile.plants[berryIndex] = 80;

  const firstFight = claimPair(world, people, tile);
  assert.ok(firstFight, 'the first overlapping claim produces a dispute');
  const communityA = world.communities.find(community => community.id === people[0].communityId);
  const communityB = world.communities.find(community => community.id === people[1].communityId);
  const relation = communityRelation(world, communityA, communityB);
  assert.equal(relation.conflicts, 1);
  const injuriesAfterFirstFight = people.map(person => person.injury);

  world.day += 1;
  assert.equal(claimPair(world, people, tile), undefined, 'the same pair shares this patch during the truce');
  assert.equal(relation.conflicts, 1);
  assert.deepEqual(people.map(person => person.injury), injuriesAfterFirstFight);

  const otherTile = world.tiles.find(candidate => candidate.terrain === 'land' && distance(candidate, tile) > 4.5);
  assert.ok(otherTile);
  otherTile.plants[berryIndex] = 80;
  assert.ok(claimPair(world, people, otherTile), 'the truce does not cover a different patch');
  assert.equal(relation.conflicts, 2);

  world.day += 14;
  assert.ok(claimPair(world, people, tile), 'the original patch can be contested after the truce expires');
  assert.equal(relation.conflicts, 3);
});
