import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../../src/simulation/engine.js';
import { dispatchCommand } from '../../src/simulation/commands.js';
import { updateTowerTension, prepareFrontierConflicts, frontierWorkOrder, performFrontierWork, FRONTIER_RECOVERY_DAYS } from '../../src/simulation/kingdoms/frontier-conflicts.js';
import { kingdomRelation } from '../../src/simulation/kingdoms/territories.js';
import { advanceTowerCapture } from '../../src/simulation/kingdoms/tower-capture.js';
import { attackTower } from '../../src/simulation/kingdoms/fortifications.js';
import { prepareKingdomCampaigns, resolveKingdomCampaigns } from '../../src/simulation/kingdoms/campaigns.js';
import { buildKingdomStructure } from '../../src/simulation/kingdoms/commands.js';
import { advanceKingdomProjects } from '../../src/simulation/kingdoms/projects.js';
import { assignHome } from '../../src/simulation/kingdoms/initialization.js';

function captureFixture() {
  const w = Sim.createWorld(42); w.day = 60;
  const [attacker, defender] = w.kingdoms;
  const tower = w.structures.find(s => s.kingdomId === defender.id && s.type === 'torre');
  const result = dispatchCommand(w, { type: 'capture-tower', kingdomId: attacker.id, towerId: tower.id });
  assert.equal(result.ok, true);
  prepareKingdomCampaigns(w, 61);
  const campaign = w.campaigns.find(c => c.warId === result.war.id);
  assert.ok(campaign); campaign.status = 'engaged';
  const troops = w.people.filter(p => campaign.attacker.troopIds.includes(p.id));
  for (const p of troops) { p.x = tower.x; p.y = tower.y; }
  for (const p of w.people.filter(p => p.kingdomId === defender.id)) { p.x = defender.x; p.y = defender.y; }
  tower.health = tower.maxHealth * .25;
  return { w, attacker, defender, tower, campaign, troops };
}

test('every nearby hostile tower pair contributes tension and overlap increases it without starting the opening war', () => {
  const w = Sim.createWorld(42), [a, b] = w.kingdoms;
  w.structures = [{ id: 1, type: 'torre', kingdomId: a.id, complete: true, integrity: 1, health: 6000, x: 30, y: 40, territoryRadius: 13 },
    { id: 2, type: 'torre', kingdomId: b.id, complete: true, integrity: 1, health: 6000, x: 60, y: 40, territoryRadius: 13 }];
  const relation = kingdomRelation(w, a.id, b.id); relation.tension = 0;
  updateTowerTension(w, 1); const nearbyGain = relation.towerPressure.dailyGain;
  assert.equal(relation.towerPressure.pairs.length, 1); assert.equal(relation.towerPressure.overlappingPairs, 0);
  updateTowerTension(w, 1); assert.equal(relation.tension, nearbyGain, 'one pressure update per day');
  w.structures[1].x = 50;
  updateTowerTension(w, 2);
  assert.ok(relation.towerPressure.dailyGain > nearbyGain); assert.equal(relation.towerPressure.overlappingPairs, 1);
  for (let day = 3; day <= 45; day++) prepareFrontierConflicts(w, day);
  assert.equal(w.wars.length, 0);
  relation.tension = .8;
  prepareFrontierConflicts(w, 46);
  assert.equal(w.wars.length, 1); assert.equal(w.wars[0].evidence.mission, 'capture-tower');
});

test('autonomous tower conflicts respect the recovery date between campaigns', () => {
  const w = Sim.createWorld(42), [a, b] = w.kingdoms;
  w.structures = [
    { id: 9001, type: 'torre', kingdomId: a.id, complete: true, integrity: 1, health: 6000, x: 30, y: 40, territoryRadius: 13 },
    { id: 9002, type: 'torre', kingdomId: b.id, complete: true, integrity: 1, health: 6000, x: 50, y: 40, territoryRadius: 13 }
  ];
  const relation = kingdomRelation(w, a.id, b.id);
  relation.tension = 1;
  relation.nextTowerRaidDay = 90;

  prepareFrontierConflicts(w, 89);
  assert.equal(w.wars.length, 0, 'tower pressure cannot bypass the recovery date');
  prepareFrontierConflicts(w, 90);
  assert.equal(w.wars.length, 1);
  assert.equal(w.wars[0].evidence.mission, 'capture-tower');
});

test('royal capture orders validate ownership, peace and armistice, then mobilize a real campaign', () => {
  const w = Sim.createWorld(42), [a, b] = w.kingdoms;
  const tower = w.structures.find(s => s.type === 'torre' && s.kingdomId === b.id);
  const command = { type: 'capture-tower', kingdomId: a.id, towerId: tower.id };
  assert.equal(dispatchCommand(w, command).ok, false);
  w.day = 60; const relation = kingdomRelation(w, a.id, b.id); relation.ceasefireUntilDay = 80;
  assert.equal(dispatchCommand(w, command).ok, false);
  relation.ceasefireUntilDay = 59;
  assert.equal(dispatchCommand(w, { ...command, kingdomId: b.id }).ok, false);
  assert.equal(dispatchCommand(w, command).ok, true);
  assert.equal(a.lastTowerCaptureOrder.towerId, tower.id);
  assert.equal(dispatchCommand(w, command).ok, false, 'do not duplicate an active order');
});

test('an explicit royal capture order can mobilize without the autonomous ration preflight', () => {
  const w = Sim.createWorld(42), [attacker, defender] = w.kingdoms;
  w.day = 60;
  const tower = w.structures.find(s => s.type === 'torre' && s.kingdomId === defender.id);
  const order = dispatchCommand(w, { type: 'capture-tower', kingdomId: attacker.id, towerId: tower.id });
  assert.equal(order.ok, true);
  assert.equal(order.war.forceMobilization, true);
  attacker.treasury.stock.food = 0;
  for (const person of w.people.filter(p => p.alive && p.kingdomId === attacker.id && p.role === 'soldier')) person.foodReserve = 0;
  const community = w.communities.find(item => item.id === attacker.communityId);
  community.stores.food = 0;

  prepareKingdomCampaigns(w, w.day + 1);

  assert.ok(w.campaigns.some(c => c.warId === order.war.id));
});

test('capture siege preserves the last quarter of tower health rather than destroying the target', () => {
  const { w, tower, troops } = captureFixture();
  tower.health += 5;
  const soldier = troops.find(p => p.militaryClass === 'guerreiro');
  assert.equal(attackTower(w, soldier, tower, 61), 5);
  assert.equal(tower.health, tower.maxHealth * .25);
  assert.equal(attackTower(w, soldier, tower, 63), 0);
  assert.equal(tower.destroyedDay, undefined);
});

test('enemy resistance interrupts occupation and five consecutive days transfer the tower and its domain', () => {
  const { w, attacker, defender, tower, campaign, troops } = captureFixture();
  for (let day = 61; day <= 63; day++) assert.equal(advanceTowerCapture(w, campaign, tower, troops, [], day), false);
  const guard = w.people.find(p => p.role === 'soldier' && p.kingdomId === defender.id);
  guard.x = tower.x; guard.y = tower.y;
  assert.equal(advanceTowerCapture(w, campaign, tower, troops, [guard], 64), false);
  assert.equal(campaign.captureProgressDays, 0);
  guard.x = defender.x; guard.y = defender.y;
  for (let day = 65; day < 69; day++) assert.equal(advanceTowerCapture(w, campaign, tower, troops, [], day), false);
  assert.equal(advanceTowerCapture(w, campaign, tower, troops, [], 69), true);
  assert.equal(tower.kingdomId, attacker.id); assert.ok(attacker.towerIds.includes(tower.id));
  assert.ok(!defender.towerIds.includes(tower.id)); assert.equal(tower.health, 1500);
  assert.equal(w.tiles[tower.y * w.width + tower.x].kingdomId, attacker.id);
});

test('a successful capture ends the war with a territorial armistice and no duplicate land claim', () => {
  const { w, attacker, tower, campaign } = captureFixture();
  for (let day = 61; day <= 65; day++) resolveKingdomCampaigns(w, day);
  assert.equal(campaign.capturedTowerId, tower.id); assert.equal(campaign.status, 'withdrawing');
  assert.equal(tower.kingdomId, attacker.id);
  assert.equal(kingdomRelation(w, attacker.id, campaign.defenderId).nextTowerRaidDay, 65 + FRONTIER_RECOVERY_DAYS);
  assert.equal(w.treaties.at(-1).kind, 'armistice-with-territory-change');
  assert.equal(w.territoryClaims?.some(c => c.campaignId === campaign.id) || false, false);
});

test('all royal buildings wait for an actual worker action and pause when the worker stops or leaves', () => {
  for (const type of ['centro_militar', 'arquearia', 'monasterio', 'torre']) {
    const w = Sim.createWorld(42), king = w.kingdoms[0];
    const started = buildKingdomStructure(w, king.id, type);
    assert.equal(started.ok, true); const project = started.structure;
    if (type === 'torre') {
      assert.deepEqual(project.entryTile, { x: project.x, y: project.y + 1 });
      assert.equal(w.tiles[project.entryTile.y * w.width + project.entryTile.x].terrain, 'land');
    }
    advanceKingdomProjects(w, 1); assert.equal(project.progress, 0);
    const worker = w.people.find(p => frontierWorkOrder(w, p)?.project.id === project.id && p.role === 'resident');
    assert.ok(worker); worker.x = project.x; worker.y = project.y;
    advanceKingdomProjects(w, 1); assert.equal(project.progress, 0, 'presence without work is insufficient');
    performFrontierWork(w, worker, { project });
    advanceKingdomProjects(w, 1); assert.equal(project.progress, 1);
    assert.equal(worker.visualActivity.kind, 'build'); assert.equal(project.lastConstructionWorkerId, worker.id);
    advanceKingdomProjects(w, 1); assert.equal(project.progress, 1, 'one progress tick per day');
    advanceKingdomProjects(w, 2); assert.equal(project.progress, 1, 'no automatic work the next day');
    w.day = 1; performFrontierWork(w, worker, { project }); worker.x = king.x + 20; worker.y = king.y + 20;
    advanceKingdomProjects(w, 2); assert.equal(project.progress, 1, 'worker must still be on site');
  }
});

test('housing shortages create one unbuilt house and residents only move in after a worker finishes it', () => {
  const w = Sim.createWorld(42), king = w.kingdoms[0];
  for (const home of w.structures.filter(s => s.type === 'casa' && s.kingdomId === king.id)) home.capacity = home.residentIds.length;
  const newcomer = { id: w.nextId++, alive: true, role: 'resident', kingdomId: king.id, homeId: null, ageDays: 0 };
  w.people.push(newcomer);
  assert.equal(assignHome(w, king, newcomer), false);
  const house = w.structures.find(s => s.type === 'casa' && s.kingdomId === king.id && !s.complete);
  assert.ok(house); assert.equal(house.progress, 0); assert.equal(house.health, 500);
  assert.equal(newcomer.homeId, null); assert.equal(assignHome(w, king, newcomer), false);
  assert.equal(w.structures.filter(s => s.type === 'casa' && !s.complete).length, 1);
  const worker = w.people.find(p => p.role === 'resident' && frontierWorkOrder(w, p)?.project.id === house.id);
  assert.ok(worker); worker.x = house.x; worker.y = house.y;
  for (let day = 1; day <= house.required; day++) {
    w.day = day - 1; performFrontierWork(w, worker, { project: house }); advanceKingdomProjects(w, day);
  }
  assert.equal(house.complete, true); assert.equal(newcomer.homeId, house.id);
  assert.ok(house.residentIds.includes(newcomer.id));
});
