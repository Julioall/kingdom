import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../src/simulation/engine.js';
import { INITIAL_SOLDIERS_PER_KINGDOM } from '../src/simulation/kingdoms/initialization.js';

function validateWorld(world, population, military, civilians) {
  const living = world.people.filter(person => person.alive);
  const soldiers = living.filter(person => person.role === 'soldier');
  const nonSoldiers = living.filter(person => person.role !== 'soldier');
  assert.equal(living.length, population);
  assert.equal(soldiers.length, military);
  assert.equal(nonSoldiers.length, civilians);
  assert.ok(soldiers.every(p => p.ageDays >= 15 * 365
    && p.militaryCenterId != null && p.militaryDutyCenterId != null
    && ['guerreiro', 'lanceiro', 'arqueiro', 'monge'].includes(p.militaryClass)));
  let accumulated = 0, priorQuota = 0;
  for (const kingdom of world.kingdoms) {
    const members = living.filter(p => p.kingdomId === kingdom.id);
    const soldiersHere = members.filter(p => p.role === 'soldier');
    accumulated += members.length;
    const quota = Math.round(accumulated * .8);
    assert.equal(soldiersHere.length, quota - priorQuota);
    priorQuota = quota;
    assert.equal(members.length - soldiersHere.length,
      members.filter(p => p.role !== 'soldier').length);
    const ruler = members.find(p => p.id === kingdom.rulerId);
    assert.equal(ruler?.role, 'ruler', 'a starting general may never overwrite the monarch');
    const barracks = world.structures.filter(s => s.kingdomId === kingdom.id
      && s.type === 'centro_militar' && s.complete);
    assert.ok(barracks.length > 0);
    const assignedIds = new Set(barracks.flatMap(s => s.soldierIds || []));
    assert.equal(assignedIds.size, soldiersHere.length);
    assert.ok(barracks.every(s => (s.soldierIds || []).length <= s.capacity));
    assert.ok(soldiersHere.every(p => assignedIds.has(p.id)
      && p.militaryRank != null && p.militaryUnitId != null
      && p.commanderId != null && p.generalId != null));
    const units = kingdom.militaryCommand.units;
    assert.ok(units.every(unit => unit.memberIds.length <= 10));
    assert.equal(units.reduce((sum, unit) => sum + unit.memberIds.length, 0),
      soldiersHere.length);
    assert.ok(kingdom.treasury.stock.food >= 0 && kingdom.treasury.stock.wood >= 0
      && kingdom.treasury.stock.gold >= 0, 'founding garrison cannot mint or overdraft resources');
  }
}

test('500 inhabitants have 400 real soldiers and 100 civilians', () => {
  const world = Sim.createWorld(42, { initialPopulation: 500, initialMilitaryShare: .8 });
  validateWorld(world, 500, 400, 100);
  assert.equal(world.initialMilitaryShare, .8);
});

test('classic 96 inhabitant browser option limits civilian pawns to twenty percent', () => {
  const world = Sim.createWorld(2026, { initialPopulation: 96, initialMilitaryShare: .8 });
  validateWorld(world, 96, 77, 19);
});

test('engine worlds without explicit military share keep the legacy initial roster', () => {
  const world = Sim.createWorld(42);
  assert.equal(world.people.length, 96);
  assert.equal(world.people.filter(p => p.role === 'soldier').length,
    INITIAL_SOLDIERS_PER_KINGDOM * 2);
  assert.equal(world.initialMilitaryShare, undefined);
});

test('invalid initial garrison shares cannot create arbitrary unbalanced troop counts', () => {
  assert.throws(() => Sim.createWorld(42, { initialMilitaryShare: .9 }), RangeError);
  assert.throws(() => Sim.createWorld(42, { initialMilitaryShare: -1 }), RangeError);
});
