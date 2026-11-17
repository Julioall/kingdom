import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../src/simulation/engine.js';
import { chooseBuildSite, communityStructures, nextCommunityStructure }
  from '../src/simulation/settlements/construction.js';
import { activeCommunityMemberCount } from '../src/simulation/settlements/member-count.js';

function inspectCandidate(world, community) {
  const structures = communityStructures(world, community);
  const size = community.memberIds.filter(id => world.people.some(person => person.id === id && person.alive)).length;
  const plan = nextCommunityStructure(world, community, size, structures);
  const beforeId = world.nextId;
  const candidate = chooseBuildSite(world, community, structures);
  assert.equal(world.nextId, beforeId + (candidate ? 1 : 0));
  if (candidate) {
    assert.equal(candidate.type, plan.type);
    assert.equal(candidate.kingdomId, community.kingdomId);
    assert.equal(candidate.communityId, community.id);
    assert.equal(world.tiles[candidate.y * world.width + candidate.x].terrain, 'land');
    assert.equal(candidate.woodCost, plan.woodCost);
    assert.equal(candidate.stoneCost, plan.stoneCost);
  }
  return candidate;
}

test('site selection is deterministic for identical seeds and communities', () => {
  for (const seed of [1, 42]) {
    const first = Sim.createWorld(seed), second = Sim.createWorld(seed);
    assert.equal(first.communities.length, second.communities.length);
    for (let i = 0; i < first.communities.length; i++) {
      const left = first.communities[i], right = second.communities[i];
      assert.equal(left.id, right.id);
      assert.deepEqual(inspectCandidate(first, left), inspectCandidate(second, right));
    }
  }
});

test('failed site selection never spends resources or reserves an ID', () => {
  const world = Sim.createWorld(42);
  const community = world.communities.find(item => item.isKingdomGroup) || world.communities[0];
  const beforeId = world.nextId;
  const stockBefore = structuredClone(community.stores);
  // Deliberately deny owned land, regardless of ecology and building types.
  // Candidate rejection must be pure and leave economic accounting unchanged.
  const previousKingdomId = community.kingdomId;
  community.kingdomId = -9876;
  try {
    const candidate = chooseBuildSite(world, community, communityStructures(world, community));
    assert.equal(candidate, null);
    assert.equal(world.nextId, beforeId);
    assert.deepEqual(community.stores, stockBefore);
  } finally {
    community.kingdomId = previousKingdomId;
  }
});

test('live community count reuses transient actor IDs and matches fallback scans', () => {
  const world = {
    people: [
      {id: 1, alive: true}, {id: 2, alive: false},
      {id: 3, alive: true}, {id: 4, alive: true}
    ]
  };
  const community = { memberIds: [1, 2, 3, 3, 99] };
  // Duplicated member references retain the original array-filter semantics.
  assert.equal(activeCommunityMemberCount(world, community), 3);
  world.peopleById = new Map(world.people.map(person => [person.id, person]));
  assert.equal(activeCommunityMemberCount(world, community), 3);
  assert.equal(activeCommunityMemberCount(world, {memberIds: []}), 0);
  assert.deepEqual(world.people.map(person => person.alive), [true, false, true, true]);
});
