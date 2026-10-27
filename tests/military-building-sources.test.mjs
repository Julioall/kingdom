import test from 'node:test';
import assert from 'node:assert/strict';
import engine from '../src/simulation/engine.js';
import { recruitKingdomSoldier } from '../src/simulation/kingdoms/commands.js';
import { updateServiceGrades } from '../src/simulation/kingdoms/frontier-intelligence.js';
import { advanceKingdomProjects } from '../src/simulation/kingdoms/projects.js';
import { militaryClassSource, MILITARY_CLASS_SOURCE_TYPES } from '../src/simulation/kingdoms/military-sources.js';

const classes = Object.keys(MILITARY_CLASS_SOURCE_TYPES);

function disableSource(source, day = 1) {
  source.complete = false;
  source.destroyedDay = day;
  source.integrity = 0;
  source.health = 0;
}

function restoreSource(world, source) {
  const replacement = { ...source, id: world.nextId++, complete: true, destroyedDay: null, integrity: 1, health: 1 };
  world.structures.push(replacement);
  return replacement;
}

test('every military class resolves only to its operational source and an alternate keeps the class available', () => {
  const world = engine.createWorld(42);
  const kingdom = world.kingdoms[0];

  for (const militaryClass of classes) {
    const source = militaryClassSource(world, kingdom.id, militaryClass);
    assert.ok(source, militaryClass + ' starts with an operational source');
    assert.equal(source.type, MILITARY_CLASS_SOURCE_TYPES[militaryClass]);
    disableSource(source);
    assert.equal(militaryClassSource(world, kingdom.id, militaryClass), null,
      militaryClass + ' loses eligibility when its only source is destroyed');

    const replacement = restoreSource(world, source);
    assert.equal(militaryClassSource(world, kingdom.id, militaryClass).id, replacement.id);
  }

  const archerSource = militaryClassSource(world, kingdom.id, 'arqueiro');
  const alternate = { ...archerSource, id: world.nextId++, complete: true, destroyedDay: null, integrity: 1, health: 1 };
  world.structures.push(alternate);
  disableSource(archerSource);
  assert.equal(militaryClassSource(world, kingdom.id, 'arqueiro').id, alternate.id,
    'a second active source keeps recruitment and progression available');
});

test('recruitment is blocked without its class source and does not charge the treasury', () => {
  for (const militaryClass of classes) {
    const world = engine.createWorld(42);
    const kingdom = world.kingdoms[0];
    disableSource(militaryClassSource(world, kingdom.id, militaryClass));
    const before = structuredClone(kingdom.treasury.stock);

    const result = recruitKingdomSoldier(world, kingdom.id, { militaryClass });

    assert.equal(result.ok, false, militaryClass);
    assert.match(result.reason, /fonte operacional/);
    assert.deepEqual(kingdom.treasury.stock, before);
  }
});

test('a surviving alternate source still allows specialist recruitment and rank progress', () => {
  const world = engine.createWorld(42);
  const kingdom = world.kingdoms[0];
  const source = militaryClassSource(world, kingdom.id, 'arqueiro');
  const alternate = { ...source, id: world.nextId++, complete: true, destroyedDay: null, integrity: 1, health: 1 };
  world.structures.push(alternate);
  disableSource(source);
  const archer = world.people.find(item => item.alive && item.role === 'soldier'
    && item.kingdomId === kingdom.id && item.militaryClass === 'arqueiro');
  archer.militaryMerit = 5;
  archer.militaryLevel = 1;

  updateServiceGrades(world, [archer], 1);
  const recruitment = recruitKingdomSoldier(world, kingdom.id, { militaryClass: 'arqueiro' });

  assert.equal(archer.militaryLevel, 2);
  assert.equal(archer.militaryProgressionStatus, undefined);
  assert.equal(recruitment.ok, true);
});

test('rank progress pauses after the last class source is destroyed and resumes from saved merit', () => {
  for (const militaryClass of classes) {
    const world = engine.createWorld(42);
    const kingdom = world.kingdoms[0];
    const person = world.people.find(item => item.alive && item.role === 'soldier'
      && item.kingdomId === kingdom.id && item.militaryClass === militaryClass);
    assert.ok(person, 'fixture includes a ' + militaryClass);
    person.militaryMerit = 5;
    person.militaryLevel = 1;
    person.militaryGrade = 'soldado';
    disableSource(militaryClassSource(world, kingdom.id, militaryClass));

    updateServiceGrades(world, [person], 1);
    person.militaryMerit = 15;
    updateServiceGrades(world, [person], 2);

    assert.equal(person.militaryLevel, 1, militaryClass + ' does not advance without its source');
    assert.equal(person.militaryMerit, 15, 'combat merit is preserved during the pause');
    assert.equal(person.militaryProgressionStatus.state, 'paused');
    assert.equal(world.chronicle.filter(entry => entry.text.includes(person.name)
      && entry.text.includes('progressão')).length, 1, 'pause is recorded once');

    restoreSource(world, world.structures.find(item => item.kingdomId === kingdom.id
      && item.type === MILITARY_CLASS_SOURCE_TYPES[militaryClass] && item.destroyedDay != null));
    updateServiceGrades(world, [person], 3);

    assert.equal(person.militaryLevel, 2, militaryClass + ' advances from existing merit after rebuilding');
    assert.equal(person.militaryMerit, 15, 'reconstruction grants no duplicate merit');
    assert.equal(person.militaryProgressionExcludedMerit, 10,
      'merit earned while class progression is unavailable does not become a deferred rank jump');
    assert.equal(person.militaryProgressionStatus.state, 'resumed');
    assert.equal(world.chronicle.filter(entry => entry.text.includes(person.name)
      && entry.text.includes('retomou')).length, 1, 'resumption is recorded');
  }
});

test('a class training order pauses on source loss and resumes without charging its purchase twice', () => {
  const world = engine.createWorld(42);
  const kingdom = world.kingdoms[0];
  const source = militaryClassSource(world, kingdom.id, 'arqueiro');
  const result = recruitKingdomSoldier(world, kingdom.id, { militaryClass: 'arqueiro' });
  assert.equal(result.ok, true);
  const trainee = result.person;
  const afterPayment = structuredClone(kingdom.treasury.stock);
  disableSource(source);

  advanceKingdomProjects(world, result.readyDay);

  assert.equal(trainee.role, 'resident');
  assert.equal(trainee.recruitmentOrder.progressionStatus, 'paused');
  assert.deepEqual(kingdom.treasury.stock, afterPayment);

  restoreSource(world, source);
  advanceKingdomProjects(world, result.readyDay + 1);

  assert.equal(trainee.role, 'soldier');
  assert.equal(trainee.militaryClass, 'arqueiro');
  assert.equal(trainee.recruitmentOrder, undefined);
  assert.deepEqual(kingdom.treasury.stock, afterPayment, 'resuming the paid order does not debit recruitment resources again');
  assert.ok(world.chronicle.some(entry => entry.text.includes('treinamento de ' + trainee.name) && entry.text.includes('retomou')));
});

test('a specialist order waits for an operational military center and resumes at a replacement', () => {
  const world = engine.createWorld(42);
  const kingdom = world.kingdoms[0];
  const center = world.structures.find(item => item.id === kingdom.militaryCenterIds[0]);
  const result = recruitKingdomSoldier(world, kingdom.id, { militaryClass: 'arqueiro' });
  assert.equal(result.ok, true);
  disableSource(center);

  advanceKingdomProjects(world, result.readyDay);

  assert.equal(result.person.role, 'resident');
  assert.match(result.person.recruitmentOrder.pauseReason, /centro militar operacional/);

  const replacement = restoreSource(world, center);
  kingdom.militaryCenterIds.push(replacement.id);
  advanceKingdomProjects(world, result.readyDay + 1);

  assert.equal(result.person.role, 'soldier');
  assert.equal(result.person.militaryCenterId, replacement.id);
});

test('source loss and reconstruction produce the same class progression replay from the same seed', () => {
  const replay = () => {
    const world = engine.createWorld(42);
    const kingdom = world.kingdoms[0];
    const person = world.people.find(item => item.alive && item.role === 'soldier'
      && item.kingdomId === kingdom.id && item.militaryClass === 'monge');
    const source = militaryClassSource(world, kingdom.id, 'monge');
    person.militaryMerit = 15;
    person.militaryLevel = 1;
    person.militaryGrade = 'soldado';
    disableSource(source, 2);
    updateServiceGrades(world, [person], 2);
    updateServiceGrades(world, [person], 3);
    restoreSource(world, source);
    updateServiceGrades(world, [person], 4);
    return JSON.stringify({ snapshot: engine.snapshot(world), audit: person.militaryProgressionStatus,
      log: world.chronicle.filter(entry => entry.text.includes(person.name)) });
  };

  assert.equal(replay(), replay());
});
