import test from 'node:test';
import assert from 'node:assert/strict';
import { restPersonInHouse } from '../src/simulation/kingdoms/service.js';

function residence(id, kingdomId, communityId, extra = {}) {
  return { id, type: 'casa', kingdomId, communityId, complete: true,
    destroyedDay: null, integrity: 1, health: 1, x: 0, y: 0, ...extra };
}

function soldier() {
  return { id: 11, role: 'soldier', kingdomId: 1, communityId: 10,
    homeId: 99, x: 0, y: 1, towerMounted: false };
}

test('a stale foreign home assignment never overrides a valid allied residence', () => {
  const person = soldier();
  const foreign = residence(99, 2, 20);
  const allied = residence(100, 1, 10);
  const world = { structures: [foreign, allied] };

  assert.equal(restPersonInHouse(world, person), true);
  assert.equal(person.restingStructureId, allied.id);
  assert.equal(person.militaryRestTargetId, allied.id);
  assert.notEqual(person.restingStructureId, foreign.id);
});

test('a soldier with only a foreign house cannot rest inside it', () => {
  const person = soldier();
  const world = { structures: [residence(99, 2, 20)] };

  assert.equal(restPersonInHouse(world, person), false);
  assert.equal(person.restingStructureId, null);
  assert.equal(person.militaryRestTargetId, null);
});

test('ruined or zero-health homes are skipped and an operational replacement is used', () => {
  const person = soldier();
  const ruined = residence(99, 1, 10, { health: 0 });
  const alternate = residence(100, 1, 10);
  const world = { structures: [ruined, alternate] };

  assert.equal(restPersonInHouse(world, person), true);
  assert.equal(person.restingStructureId, alternate.id);
  assert.equal(person.militaryRestTargetId, alternate.id);

  alternate.destroyedDay = 12;
  assert.equal(restPersonInHouse(world, person), false);
  assert.equal(person.restingStructureId, null);
  assert.equal(person.militaryRestTargetId, null);

  alternate.destroyedDay = null;
  assert.equal(restPersonInHouse(world, person), true);
  assert.equal(person.restingStructureId, alternate.id);
});
