import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/simulation/world/generation.js';
import { updateTowerShifts, performTowerDuty, towerDutyOrder } from '../src/simulation/kingdoms/tower-archers.js';

test('assigned archers navigate to and mount every starting tower without crowd congestion', () => {
  const world = createWorld(42);
  updateTowerShifts(world, 0);
  // Isolate tower deployment from survival, campaigns and the known initial
  // crowd bottleneck. This does not prove that a full seeded crowd can clear.
  world.people = world.people.filter(person => person.towerDutyId != null);
  delete world.peopleSpatialIndex;
  for (let day = 0; day < 60; day++) {
    world.day = day;
    for (const person of world.people) performTowerDuty(world, person, towerDutyOrder(world, person));
    const assigned = world.structures.filter(structure => structure.type === 'torre');
    if (assigned.every(tower => world.people.some(person => person.id === tower.archerId && person.towerMounted))) break;
  }

  const towers = world.structures.filter(structure => structure.type === 'torre' && structure.complete
    && structure.destroyedDay == null);
  assert.equal(towers.length, 8, 'both kingdoms start with four towers');
  for (const tower of towers) {
    const archer = world.people.find(person => person.id === tower.archerId);
    assert.ok(archer, `tower ${tower.id} should have an assigned archer`);
    assert.equal(archer.militaryClass, 'arqueiro');
    assert.equal(archer.towerMounted, true, `archer ${archer.id} should reach and mount tower ${tower.id}`);
    // Tactical state may be watching, shooting or recovering stamina. Deployment
    // is proved by the assigned class, mounted flag and actual entry position.
    assert.deepEqual({ x: archer.x, y: archer.y }, tower.entryTile,
      `archer ${archer.id} should occupy the walkable entry platform for tower ${tower.id}`);
  }
});
