import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../../src/simulation/engine.js';
import { updateMilitaryCommand } from '../../src/simulation/kingdoms/military.js';
import { observeMilitaryFrontiers } from '../../src/simulation/kingdoms/frontier-intelligence.js';
import { recomputeKingdomTerritories, kingdomRelation } from '../../src/simulation/kingdoms/territories.js';
import { prepareFrontierConflicts } from '../../src/simulation/kingdoms/frontier-conflicts.js';
import { borderPatrolCheckpoints } from '../../src/simulation/kingdoms/patrols.js';
import { dispatchCommand } from '../../src/simulation/commands.js';

test('combat merit earns permanent service grades while command remains a separate appointment', () => {
  const world = Sim.createWorld(42);
  const p = world.people.find(p => p.role === 'soldier');
  p.militaryMerit = 70;
  updateMilitaryCommand(world, 100);
  assert.equal(p.militaryLevel, 5);
  assert.equal(p.militaryGrade, 'capitão');
  const prestige = p.prestige;
  updateMilitaryCommand(world, 101);
  assert.equal(p.prestige, prestige, 'the same promotion is not rewarded again');
  assert.ok(p.lastPromotion);
});

test('an enemy territorial advance reports the loss and penalizes leadership exactly once', () => {
  const world = Sim.createWorld(42);
  world.day = 100;
  updateMilitaryCommand(world, 100);
  const [defender, attacker] = world.kingdoms;
  const leaders = world.people.filter(p => p.kingdomId === defender.id && ['general', 'comandante'].includes(p.militaryRank));
  const previous = new Map(leaders.map(p => [p.id, p.prestige || 0]));
  world.territoryClaims.push({ status: 'annexed', ownerId: attacker.id, x: defender.x, y: defender.y, radius: 2 });
  recomputeKingdomTerritories(world);
  assert.ok(defender.lostTerritoryTiles > 0);
  assert.equal(defender.militaryIntel.at(-1).kind, 'territory-lost');
  assert.ok(leaders.some(p => p.prestige < previous.get(p.id)));
  const count = defender.frontierLosses.length;
  const after = leaders.map(p => p.prestige);
  recomputeKingdomTerritories(world);
  assert.equal(defender.frontierLosses.length, count);
  assert.deepEqual(leaders.map(p => p.prestige), after);
});

test('frontier reports require a nearby observer and throttle repeated alerts', () => {
  const world = Sim.createWorld(42);
  const [home, opponent] = world.kingdoms;
  const watcher = world.people.find(p => p.role === 'soldier' && p.kingdomId === home.id);
  const enemy = world.people.find(p => p.role === 'soldier' && p.kingdomId === opponent.id);
  world.people = [watcher, enemy];
  Object.assign(watcher, { x: home.x, y: home.y });
  Object.assign(enemy, { x: home.x + 2, y: home.y });
  observeMilitaryFrontiers(world, 100);
  assert.equal(home.frontierAlert.soldiersObserved, 1);
  const reports = home.militaryIntel.length;
  observeMilitaryFrontiers(world, 101);
  assert.equal(home.militaryIntel.length, reports);
  watcher.restingStructureId = watcher.homeId;
  observeMilitaryFrontiers(world, 111);
  assert.equal(home.militaryIntel.length, reports, 'sleeping troops do not provide reconnaissance');
});

test('patrol checkpoints cover the outside boundary rather than a circle around a barracks', () => {
  const world = Sim.createWorld(42);
  const points = borderPatrolCheckpoints(world, world.kingdoms[0].id);
  assert.ok(points.length >= 3);
  for (const point of points) {
    assert.equal(point.kingdomId, world.kingdoms[0].id);
    assert.ok([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => world.tiles[(point.y + dy) * world.width + point.x + dx]?.kingdomId !== point.kingdomId));
  }
});

test('a royal order mobilizes a finite campaign against a military installation', () => {
  const world = Sim.createWorld(42);
  world.day = 100;
  const [attacker, defender] = world.kingdoms;
  const target = world.structures.find(s => s.kingdomId === defender.id && s.type === 'centro_militar');
  for (const p of world.people) if (p.role === 'soldier') p.towerDutyId = null;
  const result = dispatchCommand(world, { type: 'attack-installation', kingdomId: attacker.id, structureId: target.id });
  assert.equal(result.ok, true);
  assert.equal(result.war.evidence.mission, 'destroy-installation');
  Sim.modules.KingdomCampaigns.prepare(world, 101);
  assert.ok(world.campaigns.some(c => c.evidence.structureId === target.id));
  assert.equal(dispatchCommand(world, { type: 'attack-installation', kingdomId: defender.id, structureId: target.id }).ok, false);
});

test('fresh border reconnaissance can start a new dispute after the armistice expires', () => {
  const world = Sim.createWorld(42);
  world.day = 200;
  const [attacker, defender] = world.kingdoms;
  const target = world.structures.find(s => s.kingdomId === defender.id && s.type === 'centro_militar');
  attacker.knownEnemyInstallations = [{ id: target.id, opponentId: defender.id, type: target.type,
    x: target.x, y: target.y, day: 200 }];
  const relation = kingdomRelation(world, attacker.id, defender.id);
  Object.assign(relation, { tension: .6, ceasefireUntilDay: 200, nextTowerRaidDay: 200, status: 'peace' });
  prepareFrontierConflicts(world, 200);
  assert.equal(world.wars.length, 0, 'the armistice is respected');
  prepareFrontierConflicts(world, 201);
  assert.equal(world.wars.length, 1);
  assert.equal(world.wars[0].attackerId, attacker.id);
  assert.equal(world.wars[0].evidence.structureId, target.id);
  assert.equal(world.wars[0].evidence.mission, 'destroy-installation');
});
