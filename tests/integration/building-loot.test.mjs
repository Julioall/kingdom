import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../../src/simulation/engine.js';
import { damageStructure } from '../../src/simulation/kingdoms/fortifications.js';
import { collectLoot, nearestLoot, dropStructureLoot } from '../../src/simulation/economy/loot.js';
import { rearProjection, safeCorralFootprint } from '../../src/simulation/kingdoms/rear-sites.js';
import { createWorldSnapshot, applyWorldSnapshot } from '../../src/simulation/render-snapshot.js';
import { updatePeople } from '../../src/simulation/individuals/actions.js';

test('castle, houses and corrals have the requested health; corrals lie safely behind each kingdom', () => {
  for (const seed of [1, 42, 987, 2026]) {
    const world = Sim.createWorld(seed);
    for (const kingdom of world.kingdoms) {
      for (const s of world.structures.filter(s => s.kingdomId === kingdom.id)) {
        if (s.type === 'castelo') assert.equal(s.health, 10000);
        if (s.type === 'casa') assert.equal(s.health, 2000);
        if (s.type === 'curral') {
          assert.equal(s.health, 3000);
          assert.ok(rearProjection(world, kingdom, s) >= 6);
          assert.ok(safeCorralFootprint(world, world.tiles[s.y * world.width + s.x]));
        }
      }
    }
  }
});

test('destroying a castle drops exactly its treasury once, without minting or duplicating resources', () => {
  const world = Sim.createWorld(42), [owner, enemy] = world.kingdoms;
  const castle = world.structures.find(s => s.kingdomId === owner.id && s.type === 'castelo');
  const treasury = { ...owner.treasury.stock };
  damageStructure(world, castle, 9999, 1, enemy.id);
  assert.equal(world.loot.length, 0);
  assert.equal(castle.health, 1);
  damageStructure(world, castle, 1, 2, enemy.id);
  assert.equal(castle.complete, false);
  assert.equal(world.loot.length, 1);
  assert.deepEqual(world.loot[0].resources, treasury);
  assert.ok(Object.values(owner.treasury.stock).every(n => n === 0));
  damageStructure(world, castle, 100, 3, enemy.id);
  dropStructureLoot(world, castle, 4);
  assert.equal(world.loot.length, 1);
});

test('house inventories and corral feed fall to the ground and destroyed houses release residents', () => {
  const world = Sim.createWorld(42), [owner, enemy] = world.kingdoms;
  const house = world.structures.find(s => s.kingdomId === owner.id && s.type === 'casa');
  house.stock = { food: 7, wood: 3, gold: 2 };
  damageStructure(world, house, 2000, 1, enemy.id);
  assert.deepEqual(world.loot[0].resources, { food: 7, wood: 3, gold: 2 });
  assert.ok(house.residentIds.every(id => world.people.find(p => p.id === id).homeId === null));
  const corral = world.structures.find(s => s.kingdomId === owner.id && s.type === 'curral');
  const community = world.communities.find(c => c.id === owner.communityId);
  community.stores.feed = 36;
  damageStructure(world, corral, 3000, 2, enemy.id);
  assert.equal(community.stores.feed, 0);
  assert.equal(world.loot[1].resources.feed, 36);
});

test('shelter food location records never duplicate the shared food inventory', () => {
  const world = Sim.createWorld(42), [owner, enemy] = world.kingdoms;
  const community = world.communities.find(c => c.id === owner.communityId);
  community.stores.food = 20; community.stores.meat = 10;
  const shelter = { id: world.nextId++, type: 'abrigo', communityId: community.id, kingdomId: owner.id,
    x: owner.x, y: owner.y, complete: true, integrity: 1, fruitStored: 12, meatStored: 4 };
  world.structures.push(shelter);
  damageStructure(world, shelter, 2000, 1, enemy.id);
  assert.deepEqual(world.loot[0].resources, { food: 12, meat: 4 });
  assert.equal(community.stores.food, 8);
  assert.equal(community.stores.meat, 6);
  const village = world.structures.find(s => s.kingdomId === owner.id && s.type === 'vila');
  damageStructure(world, village, 4000, 2, enemy.id);
  assert.equal(world.loot.reduce((n, pile) => n + (pile.resources.food || 0), 0), 20);
  assert.equal(world.loot.reduce((n, pile) => n + (pile.resources.meat || 0), 0), 10);
});

test('both kingdoms can collect the same pile in capacity-limited trips and empty piles cannot be collected again', () => {
  const world = Sim.createWorld(42);
  const [a, b] = world.kingdoms.map(k => world.people.find(p => p.kingdomId === k.id && p.role === 'resident'));
  const pile = { id: world.nextId++, x: a.x, y: a.y, available: true, resources: { gold: 30, wood: 10 } };
  world.loot.push(pile);
  b.x = a.x; b.y = a.y;
  assert.equal(nearestLoot(world, b).id, pile.id);
  assert.equal(collectLoot(world, a, pile), 24);
  assert.equal(a.carriedGold, 24);
  assert.equal(collectLoot(world, b, pile), 16);
  assert.equal(a.carriedGold + b.carriedGold, 30);
  assert.equal(b.carriedWood, 10);
  assert.equal(pile.available, false);
  assert.equal(collectLoot(world, a, pile), 0);
  const clone = applyWorldSnapshot(structuredClone(createWorldSnapshot(world, { reset: true })));
  assert.deepEqual(clone.loot, world.loot);
});

test('an idle healthy civilian automatically gathers nearby unowned loot', () => {
  const world = Sim.createWorld(42);
  const person = world.people.find(p => p.role === 'resident' && p.ageDays > 18 * 365);
  Object.assign(person, { foodReserve: 80, hydration: 90, energy: 90, health: 100, assignment: null });
  const pile = { id: world.nextId++, x: person.x, y: person.y, available: true, resources: { gold: 10 } };
  world.loot.push(pile);
  updatePeople(world);
  assert.equal(pile.available, false);
  assert.ok(world.people.some(p => p.carriedGold >= 10));
});
