import test from 'node:test';
import assert from 'node:assert/strict';
import engine from '../src/simulation/engine.js';
import { cellAt } from '../src/simulation/world/spatial.js';
import { createPersonSpatialIndex } from '../src/simulation/individuals/spatial-index.js';
import { observeTowerIntruders, isTerritorialIntruder } from '../src/simulation/kingdoms/border-defense.js';
import { defendTowers } from '../src/simulation/kingdoms/tower-archers.js';
import { respondToLocalThreats } from '../src/simulation/kingdoms/military.js';

function watchFixture() {
  const world = engine.createWorld(42);
  const owner = world.kingdoms[0], rival = world.kingdoms[1];
  const site = world.tiles.find(tile => tile.terrain === 'land' && tile.kingdomId === owner.id
    && cellAt(world, tile.x + 1, tile.y)?.kingdomId === owner.id
    && cellAt(world, tile.x + 2, tile.y)?.kingdomId === owner.id);
  assert.ok(site, 'world has continuous defended tiles');
  const archer = world.people.find(person => person.alive && person.role === 'soldier'
    && person.kingdomId === owner.id && person.militaryClass === 'arqueiro');
  const intruder = world.people.find(person => person.alive && person.role !== 'soldier'
    && person.kingdomId === rival.id);
  assert.ok(archer && intruder);
  const tower = {
    id: world.nextId++, x: site.x, y: site.y, kingdomId: owner.id, type: 'torre',
    complete: true, integrity: 1, health: 4000, maxHealth: 4000, archerId: archer.id
  };
  Object.assign(archer, {
    x: site.x, y: site.y, towerMounted: true, towerDutyId: tower.id,
    restingStructureId: null, militaryRestTargetId: null,
    militaryRank: 'soldado', health: 100, stamina: 100, energy: 100, hydration: 100, foodReserve: 80
  });
  Object.assign(intruder, { x: site.x + 2, y: site.y, role: 'resident', restingStructureId: null,
    health: 100, alive: true });
  world.structures.push(tower);
  world.people = [archer, intruder];
  world.peopleSpatialIndex = createPersonSpatialIndex(world.people);
  world.campaigns = [];
  world.day = 19;
  return { world, owner, rival, archer, intruder, tower, site };
}

test('occupied tower reports one civilian trespasser exactly once until a new entry', () => {
  const { world, owner, archer, intruder, tower } = watchFixture();
  assert.equal(isTerritorialIntruder(world, owner.id, intruder), true);
  const first = observeTowerIntruders(world, tower, archer, 20);
  assert.equal(first.length, 1);
  assert.equal(first[0].kind, 'tower-intrusion');
  assert.equal(first[0].intruderCount, 1);
  assert.equal(first[0].civiliansObserved, 1);
  assert.equal(first[0].soldiersObserved, 0);
  assert.equal(first[0].alarmCount, 1);
  assert.equal(first[0].towerId, tower.id);
  assert.equal(first[0].observerId, archer.id);
  assert.deepEqual(owner.militaryIntel.at(-1), first[0]);
  assert.deepEqual(owner.frontierAlert, first[0]);
  assert.deepEqual(observeTowerIntruders(world, tower, archer, 21), [], 'no daily horn spam');
  assert.equal(owner.militaryIntel.filter(item => item.kind === 'tower-intrusion').length, 1);

  const territory = cellAt(world, intruder.x, intruder.y);
  territory.kingdomId = null;
  assert.deepEqual(observeTowerIntruders(world, tower, archer, 22), []);
  territory.kingdomId = owner.id;
  const again = observeTowerIntruders(world, tower, archer, 23);
  assert.equal(again.length, 1, 'a return crossing is a new event');
  assert.notEqual(again[0].id, first[0].id);
});

test('a tower counts observed groups and issues multiple bounded alarm calls', () => {
  const { world, owner, rival, archer, intruder, tower, site } = watchFixture();
  const second = { ...intruder, id: world.nextId++, x: site.x + 1, role: 'soldier',
    kingdomId: rival.id };
  world.people.push(second);
  const report = observeTowerIntruders(world, tower, archer, 20)[0];
  assert.equal(report.intruderCount, 2);
  assert.equal(report.civiliansObserved, 1);
  assert.equal(report.soldiersObserved, 1);
  assert.equal(report.alarmCount, 2);
  assert.equal(report.severity, 'group-incursion');
  assert.deepEqual(report.intruderIds, [intruder.id, second.id].sort((a, b) => a - b));
  assert.equal(owner.frontierAlert.intruderCount, 2);
  assert.equal(world.campaigns.length, 0, 'an alert is information, not an army-wide command');

  for (let i = 0; i < 4; i++) {
    const next = { ...intruder, id: world.nextId++, role: 'resident',
      x: site.x + 1.5, y: site.y };
    world.people.push(next);
  }
  const larger = observeTowerIntruders(world, tower, archer, 21)[0];
  assert.equal(larger.intruderCount, 6);
  assert.equal(larger.alarmCount, 3, 'alarm bursts are capped regardless of group size');
});

test('empty, unmounted, destroyed and blind towers do not announce foreign civilians', () => {
  const { world, archer, intruder, tower, rival } = watchFixture();
  archer.towerMounted = false;
  assert.deepEqual(observeTowerIntruders(world, tower, archer, 20), []);
  archer.towerMounted = true;
  tower.complete = false;
  assert.deepEqual(observeTowerIntruders(world, tower, archer, 21), []);
  tower.complete = true;
  tower.health = 0;
  assert.deepEqual(observeTowerIntruders(world, tower, archer, 22), []);
  tower.health = 4000;
  intruder.x += 15;
  assert.deepEqual(observeTowerIntruders(world, tower, archer, 23), []);
  intruder.x -= 15;
  cellAt(world, intruder.x, intruder.y).kingdomId = rival.id;
  assert.deepEqual(observeTowerIntruders(world, tower, archer, 24), []);
});

test('tower defense recognizes an unauthorized civilian without launching a formal campaign', () => {
  const { world, owner, archer, intruder, tower } = watchFixture();
  const beforeHealth = intruder.health;
  defendTowers(world, 20);
  assert.ok(owner.militaryIntel.some(item => item.kind === 'tower-intrusion'
    && item.intruderIds.includes(intruder.id)));
  assert.equal(world.campaigns.length, 0);
  assert.equal(archer.towerDutyId, tower.id);
  assert.equal(archer.combatAction?.targetId, intruder.id,
    'the defending archer initiates a real combat action against an observed intruder');
  assert.ok(intruder.health <= beforeHealth, 'a visible trespasser may be targeted, not healed by combat');
});

test('general receives a counted local warning but no automatic campaign order', () => {
  const { world, owner, archer, tower, rival } = watchFixture();
  const general = { ...archer, id: world.nextId++, militaryRank: 'general',
    towerMounted: false, towerDutyId: null, x: archer.x - 1, y: archer.y };
  world.people.push(general);
  owner.militaryCommand = { generalIds: [general.id], units: [] };
  const second = { ...world.people[1], id: world.nextId++, role: 'soldier',
    kingdomId: rival.id, x: archer.x + 1 };
  world.people.push(second);
  const result = observeTowerIntruders(world, tower, archer, 20)[0];
  assert.deepEqual(result.notifiedGeneralIds, [general.id]);
  assert.equal(general.lastBorderAlert.intruderCount, 2);
  assert.equal(general.lastBorderAlert.soldiersObserved, 1);
  assert.equal(general.lastBorderAlert.civiliansObserved, 1);
  assert.equal(general.lastBorderAlert.towerId, tower.id);
  assert.equal(world.campaigns.length, 0);
});

test('tower detection flows through alarm and general report into a bounded defensive action', () => {
  const { world, owner, archer, intruder, tower, site } = watchFixture();
  const general = { ...archer, id: world.nextId++, militaryRank: 'general', militaryClass: 'guerreiro',
    towerMounted: false, towerDutyId: null, x: site.x + 6, y: site.y,
    lastMilitaryAttackDay: -Infinity, combatAction: null, campaignId: null,
    militaryRestTargetId: null };
  world.people.push(general);
  world.peopleSpatialIndex = createPersonSpatialIndex(world.people);
  owner.militaryCommand = { generalIds: [general.id], units: [] };

  defendTowers(world, 20);
  const report = owner.frontierAlert;
  assert.equal(report?.kind, 'tower-intrusion');
  assert.deepEqual(report?.intruderIds, [intruder.id]);
  assert.deepEqual(report?.notifiedGeneralIds, [general.id]);
  assert.equal(report?.alarmCount, 1);
  assert.ok(world.events.some(event => /alarme da torre/.test(event.text)));
  assert.equal(general.lastBorderAlert.reportId, report.id);

  const distanceBeforeResponse = Math.hypot(general.x - intruder.x, general.y - intruder.y);
  const healthBeforeResponse = intruder.health;
  const responses = respondToLocalThreats(world, 20);
  assert.equal(responses.length, 1, 'one civilian receives at most one local responder');
  assert.equal(responses[0].soldierId, general.id);
  assert.equal(responses[0].targetId, intruder.id);
  assert.equal(owner.militaryCommand.lastFrontierResponse.reportId, report.id);
  assert.equal(owner.militaryCommand.lastFrontierResponse.defenderLimit, 1);
  if (responses[0].action === 'intercept') {
    assert.ok(Math.hypot(general.x - intruder.x, general.y - intruder.y) < distanceBeforeResponse,
      'an interception order must move the general closer to the reported intruder');
  } else {
    assert.equal(responses[0].action, 'engage');
    assert.ok(intruder.health < healthBeforeResponse,
      'an engagement order must cause a real combat consequence');
  }
  assert.equal(world.campaigns.length, 0, 'a single civilian does not mobilize a kingdom-wide campaign');
});

test('one simulation day runs tower detection through the general response in system order', () => {
  const { world, owner, archer, intruder, site } = watchFixture();
  const general = { ...archer, id: world.nextId++, militaryRank: 'general', militaryClass: 'guerreiro',
    towerMounted: false, towerDutyId: null, x: site.x + 6, y: site.y,
    lastMilitaryAttackDay: -Infinity, combatAction: null, campaignId: null, militaryRestTargetId: null };
  world.people.push(general);
  world.peopleSpatialIndex = createPersonSpatialIndex(world.people);
  owner.militaryCommand = { generalIds: [general.id], units: [] };
  const initialDistance = Math.hypot(general.x - intruder.x, general.y - intruder.y);

  engine.stepDay(world, { includeSnapshot: false });

  const report = owner.frontierAlert;
  const response = owner.militaryCommand.lastFrontierResponse;
  assert.equal(world.day, 20);
  assert.equal(report?.kind, 'tower-intrusion');
  assert.deepEqual(report?.intruderIds, [intruder.id]);
  assert.deepEqual(report?.notifiedGeneralIds, [general.id]);
  assert.equal(general.lastBorderAlert?.reportId, report.id);
  assert.equal(response?.reportId, report.id);
  assert.equal(response?.generalId, general.id);
  assert.equal(response?.targetId, intruder.id);
  assert.equal(response?.action, 'intercept');
  assert.equal(response?.defenderLimit, 1);
  assert.equal(general.state, 'interceptando invasor no território');
  assert.ok(Math.hypot(general.x - intruder.x, general.y - intruder.y) < initialDistance,
    'the general advances toward the reported intruder during the actual day update');
  assert.equal(cellAt(world, intruder.x, intruder.y)?.kingdomId, owner.id,
    'the incursion remains inside the defended territory during the response');
  assert.equal(world.campaigns.length, 0, 'local defense does not mobilize a kingdom-wide campaign');
});
