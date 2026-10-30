import test from 'node:test';
import assert from 'node:assert/strict';
import { abilityLevel, abilityTargetLimit, canUseAbility, zoneRecipients } from '../src/simulation/kingdoms/ability-progression.js';
import { manualAttackProfile } from '../src/simulation/kingdoms/military.js';
import { trainMilitaryPair } from '../src/simulation/kingdoms/military-learning.js';
import { updateServiceGrades } from '../src/simulation/kingdoms/frontier-intelligence.js';
import { SPELLS, availableSpells, equippedSpells, spellTargetLimit } from '../src/simulation/magic/catalog.js';
import { beginSpell, advanceMagic, chooseMagicAction } from '../src/simulation/magic/system.js';
import { magicModifiers } from '../src/simulation/magic/effects.js';
import { dispatchCommand } from '../src/simulation/commands.js';

function fixture(level = 1) {
  const caster = { id: 1, kingdomId: 1, alive: true, role: 'soldier', militaryClass: 'monge',
    militaryLevel: level, x: 10, y: 10, health: 100, mana: 200, maxMana: 200,
    magicSpells: ['heal', 'area-heal', 'greater-heal', 'sanctuary', 'regeneration'] };
  const people = [caster, ...Array.from({ length: 12 }, (_, i) => ({ id: i + 2,
    kingdomId: 1, alive: true, x: 11 + i * .05, y: 10, health: 50 }))];
  const world = { day: 1, width: 32, height: 32, people, kingdoms: [], structures: [], magicTimeMs: 0, events: [], logs: [] };
  return { caster, world };
}

test('earned training and service levels unlock skills without granting mastery by command rank', () => {
  assert.equal(abilityLevel({ militaryRank: 'general', militaryMerit: 9999 }), 1);
  for (const [training, level] of [[0, 1], [.25, 2], [.5, 3], [.75, 4], [1, 5]])
    assert.equal(abilityLevel({ militaryTraining: training }), level);
  assert.equal(abilityLevel({ militaryTraining: 1, militaryLevel: 6 }), 6);
  assert.equal(abilityLevel({ militaryLevel: 99 }), 7);
  assert.equal(abilityLevel({ militaryLevel: NaN, militaryTraining: NaN }), 1);
  assert.equal(canUseAbility({ militaryTraining: 1 }, 'greater-heal'), false);
  assert.equal(canUseAbility({ militaryLevel: 6 }, 'greater-heal'), true);
});

test('manual specials are locked at recruit level and become available at their exact thresholds', () => {
  for (const [type, key, threshold] of [['guerreiro', '2', 2], ['guerreiro', '3', 4],
    ['lanceiro', '2', 3], ['lanceiro', '3', 4], ['arqueiro', '2', 5], ['arqueiro', '3', 3], ['arqueiro', '4', 4]]) {
    const person = { role: 'soldier', militaryClass: type, militaryLevel: threshold - 1 };
    assert.equal(manualAttackProfile(person, key), null);
    person.militaryLevel++;
    assert.ok(manualAttackProfile(person, key));
    assert.ok(manualAttackProfile({ ...person, militaryLevel: 1 }, '1'));
  }
});

test('a completed training session unlocks the next tier; an inoperable center cannot grant it', () => {
  const center = { id: 20, kingdomId: 1, type: 'centro_militar', complete: true, health: 100, x: 10, y: 10 };
  const trainee = { id: 1, kingdomId: 1, alive: true, role: 'soldier', militaryClass: 'lanceiro',
    x: 10, y: 10, health: 100, energy: 100, foodReserve: 100, hydration: 100, injury: 0, militaryTraining: .49 };
  const partner = { ...trainee, id: 2, x: 11 };
  const world = { day: 1, structures: [center] };
  center.health = 0;
  assert.equal(trainMilitaryPair(world, trainee, { center, partner }), false);
  assert.equal(canUseAbility(trainee, 'lance-flurry'), false);
  center.health = 100;
  assert.equal(trainMilitaryPair(world, trainee, { center, partner }), true);
  assert.equal(canUseAbility(trainee, 'lance-flurry'), true);
});

test('merit earned during a class-source pause cannot bypass promotion gates', () => {
  const { world, caster } = fixture();
  const source = { id: 20, kingdomId: 1, type: 'monasterio', complete: true, health: 100 };
  world.structures = [source]; world.chronicle = []; world.kingdoms = [{ id: 1 }];
  caster.militaryMerit = 5;
  source.health = 0;
  updateServiceGrades(world, [caster], 1);
  caster.militaryMerit = 200;
  updateServiceGrades(world, [caster], 2);
  assert.deepEqual(availableSpells(caster), ['heal']);
  source.health = 100;
  updateServiceGrades(world, [caster], 3);
  assert.equal(caster.militaryLevel, 2);
  assert.equal(canUseAbility(caster, 'greater-heal'), false);
});

test('manual command rejects a locked skill before queuing, spending stamina or locking movement', () => {
  const { world, caster } = fixture();
  Object.assign(caster, { militaryClass: 'guerreiro', playerControlled: true, stamina: 400 });
  world.playerControlledPersonId = caster.id;
  assert.equal(dispatchCommand(world, { type: 'player-action', personId: 1, actionKey: '3', aimX: 12, aimY: 10 }).reason, 'ability-locked');
  assert.equal(caster.stamina, 400);
  assert.equal(caster.playerCommand, undefined);
  assert.equal(caster.playerMovementLockedUntil, undefined);
});

test('AI and manual priests share unlocks; planned loadouts survive progression and serialization', () => {
  const { world, caster } = fixture();
  const planned = caster.magicSpells.slice();
  assert.deepEqual(availableSpells(caster), ['heal']);
  assert.deepEqual(equippedSpells(caster), ['heal']);
  assert.equal(chooseMagicAction(world, caster)?.spellId, 'heal');
  assert.equal(beginSpell(world, caster, 'greater-heal', { x: 11, y: 10 }).ok, false);
  assert.equal(caster.mana, 200);
  caster.militaryLevel = 6;
  assert.deepEqual(equippedSpells(caster), planned);
  const replay = JSON.parse(JSON.stringify(world));
  assert.deepEqual(equippedSpells(replay.people[0]), planned);
  assert.equal(spellTargetLimit(replay.people[0], SPELLS['greater-heal']), 7);
});

test('area healing hits fewer people and grows with earned levels with stable ties', () => {
  for (const level of [3, 4, 5, 6, 7]) {
    const { world, caster } = fixture(level);
    assert.equal(beginSpell(world, caster, 'area-heal', { x: 11, y: 10 }).ok, true);
    advanceMagic(world, SPELLS['area-heal'].castMs);
    const changed = world.people.filter(person => person.id !== 1 && person.health > 50);
    assert.equal(changed.length, abilityTargetLimit(caster));
    assert.deepEqual(changed.map(person => person.id), Array.from({ length: changed.length }, (_, i) => i + 2));
    assert.equal(world.magicEvents.at(-1).targetIds.length, changed.length);
  }
});

test('sanctuary caps real protection and visual recipients, reallocating slots when occupants leave', () => {
  const { world, caster } = fixture(6);
  assert.equal(beginSpell(world, caster, 'sanctuary', { x: 11, y: 10 }).ok, true);
  advanceMagic(world, SPELLS.sanctuary.castMs);
  const zone = world.magicZones[0];
  assert.equal(zone.maxTargets, 7);
  assert.equal(world.people.filter(person => magicModifiers(person, world).incoming < 1).length, 7);
  const recipients = zoneRecipients(world, zone);
  recipients[0].x = 25;
  assert.equal(magicModifiers(recipients[0], world).incoming, 1);
  assert.equal(zoneRecipients(world, zone).length, 7);
  assert.equal(world.people.filter(person => magicModifiers(person, world).incoming < 1).length, 7);
  advanceMagic(world, SPELLS.sanctuary.durationMs);
  assert.ok(world.people.every(person => magicModifiers(person, world).incoming === 1));
});
