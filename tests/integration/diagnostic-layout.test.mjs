import assert from 'node:assert/strict';
import test from 'node:test';
import Sim from '../../src/simulation/engine.js';
import { cellAt } from '../../src/simulation/world/spatial.js';
import { applyFrontierLayout } from '../../scripts/frontier-layout.mjs';

function assertLand(world, entity, label) {
  assert.equal(cellAt(world, entity.x, entity.y)?.terrain, 'land', label + ' must remain on land');
}

test('frontier diagnostic layout moves all kingdom assets onto land with separated centers', () => {
  for (const seed of [1, 42, 987, 2026]) {
    const world = Sim.createWorld(seed);
    const placements = applyFrontierLayout(world);
    assert.equal(placements.length, 2);

    for (const kingdom of world.kingdoms) {
      assertLand(world, kingdom, kingdom.name + ' center');
      const community = world.communities.find(item => item.id === kingdom.communityId);
      assert.ok(community, kingdom.name + ' community exists');
      assertLand(world, community, kingdom.name + ' community center');
      for (const person of world.people.filter(item => item.kingdomId === kingdom.id)) {
        assertLand(world, person, kingdom.name + ' resident ' + person.id);
        if (Number.isFinite(person.lastSafeX) && Number.isFinite(person.lastSafeY)) {
          assertLand(world, { x: person.lastSafeX, y: person.lastSafeY }, kingdom.name + ' resident last-safe position');
        }
      }
      for (const entity of world.structures.filter(item => item.kingdomId === kingdom.id)) assertLand(world, entity, kingdom.name + ' structure ' + entity.id);
      for (const entity of world.settlements.filter(item => item.kingdomId === kingdom.id)) assertLand(world, entity, kingdom.name + ' settlement ' + entity.id);
      for (const entity of world.animals.filter(item => item.herdCommunityId === community.id)) assertLand(world, entity, kingdom.name + ' herd animal ' + entity.id);
      for (const point of Object.values(community.grounds || {}).filter(item => item && Number.isFinite(item.x) && Number.isFinite(item.y))) {
        assertLand(world, point, kingdom.name + ' community ground');
      }
      for (const property of community.properties || []) assertLand(world, property, kingdom.name + ' property ' + property.id);
    }

    for (let first = 0; first < world.kingdoms.length; first++) for (let second = first + 1; second < world.kingdoms.length; second++) {
      const a = world.kingdoms[first], b = world.kingdoms[second];
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 28, seed + ' kingdom centers stay separated');
    }
  }
});
