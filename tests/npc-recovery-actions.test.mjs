import test from 'node:test';
import assert from 'node:assert/strict';
import {
  executeFieldRecovery, executeHomeRecovery, executeGarrisonReturn
} from '../src/simulation/individuals/recovery-actions.js';

test('a soldier recovers alongside their formation without teleporting or spending kingdom resources', () => {
  const soldier = {
    id: 1, alive: true, role: 'soldier', kingdomId: 2, militaryUnitId: 7,
    x: 3, y: 5, energy: 20, health: 50, injury: 3, restingOutdoors: true
  };
  const commander = { id: 9, alive: true, kingdomId: 2, x: 4, y: 5 };
  const world = { day: 4,
    kingdoms: [{ id: 2, militaryCommand: { units: [{ id: 7, commanderId: 9 }] } }],
    people: [soldier, commander], structures: [], magicZones: [] };
  const before = { x: soldier.x, y: soldier.y, treasury: structuredClone(world.kingdoms) };
  executeFieldRecovery(world, soldier);
  assert.equal(soldier.energy, 32);
  assert.ok(Math.abs(soldier.injury - 2.8) < 1e-12);
  assert.ok(Math.abs(soldier.health - 51.1) < 1e-10);
  assert.equal(soldier.restingOutdoors, false);
  assert.equal(soldier.state, 'recuperando o fôlego junto à formação');
  assert.deepEqual({ x: soldier.x, y: soldier.y }, { x: before.x, y: before.y });
  assert.deepEqual(world.kingdoms, before.treasury);
  assert.equal(soldier.healthHistory[0].source, 'field-recovery');
});

test('field recovery without a unit still rests locally and does not invent a commander', () => {
  const soldier = { id: 1, role: 'soldier', kingdomId: 1, militaryUnitId: null,
    energy: 92, health: 70, injury: 0, x: 3, y: 4 };
  const world = { day: 3, kingdoms: [{id: 1, militaryCommand: { units: [] }}], people: [soldier] };
  executeFieldRecovery(world, soldier);
  assert.equal(soldier.energy, 100);
  assert.equal(soldier.state, 'recuperando o fôlego junto à formação');
  assert.equal(soldier.health, 70);
});

test('a civilian with no home rests outdoors with bounded energy and physical injury recovery', () => {
  const person = {id: 5, role: 'civilian', kingdomId: null, communityId: null,
    homeId: null, militaryRestTargetId: null, homeRestTargetId: null,
    energy: 20, health: 62, injury: 1, restingOutdoors: false};
  const world = {day: 10, structures: []};
  executeHomeRecovery(world, person);
  assert.ok(Math.abs(person.energy - 24.2) < 1e-10);
  assert.ok(Math.abs(person.injury - .965) < 1e-10);
  assert.ok(Math.abs(person.health - 62.08) < 1e-10);
  assert.equal(person.state, 'descansando');
  assert.equal(person.restingOutdoors, true);
  assert.equal(person.healthHistory[0].source, 'recovery');
});

test('a medically recovered builder releases their temporary construction retreat', () => {
  const person = {id: 5, role: 'civilian', kingdomId: null, communityId: null,
    homeId: null, militaryRestTargetId: null, homeRestTargetId: null,
    energy: 70, health: 90, injury: 1,
    constructionRetreating: true, constructionRecoveryHealth: 85};
  executeHomeRecovery({day: 4, structures: []}, person);
  assert.equal(person.constructionRetreating, false);
  assert.equal(person.constructionRecoveryHealth, null);
  // The original UI description for that day's recovery is retained.
  assert.equal(person.state, 'retirando-se da obra para tratar ferimentos');
});

test('returning to garrison clears a tower duty even if the center is unavailable', () => {
  const person = { id: 4, role: 'soldier', towerDutyId: 6, towerMounted: true, towerRecovering: false };
  const world = { structures: [{id: 6, archerId: 4}] };
  executeGarrisonReturn(world, person, null);
  assert.equal(world.structures[0].archerId, null);
  assert.equal(person.towerMounted, false);
  assert.equal(person.towerRecovering, true);
  assert.equal(person.state, 'aguardando repouso na guarnição');
  assert.match(person.lastLesson, /ração reduzida/);
});
