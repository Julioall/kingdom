import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../../src/simulation/engine.js';
import { updateMilitaryCommand, fightTacticalRound } from '../../src/simulation/kingdoms/military.js';
import { prepareFrontierConflicts, frontierWorkOrder, performFrontierWork } from '../../src/simulation/kingdoms/frontier-conflicts.js';
import { recruitKingdomSoldier, buildKingdomStructure } from '../../src/simulation/kingdoms/commands.js';
import { advanceKingdomProjects } from '../../src/simulation/kingdoms/projects.js';
import { createDamageBarTracker } from '../../src/ui/health-bars.js';

test('two populated capitals start at opposite north-south ends with combined infantry, spears and healers', () => {
  for (const seed of [1, 42, 987, 2026]) {
    const w = Sim.createWorld(seed);
    assert.ok(w.kingdoms[1].y - w.kingdoms[0].y > w.height * .4);
    assert.ok(Math.abs(w.kingdoms[1].x - w.kingdoms[0].x) < w.width * .1);
    for (const k of w.kingdoms) {
      assert.equal(k.memberIds.length, 50);
      const troops = w.people.filter(p => p.kingdomId === k.id && p.role === 'soldier');
      assert.deepEqual(['guerreiro', 'lanceiro', 'arqueiro', 'monge'].map(c => troops.filter(p => p.militaryClass === c).length), [10, 5, 4, 2]);
      assert.ok(w.people.filter(p => p.kingdomId === k.id).every(p => p.homeId));
      assert.equal(k.militaryCommand.generalIds.length, 1);
      assert.equal(k.militaryCommand.units.length, 3);
      assert.ok(k.militaryCommand.units.every(u => u.memberIds.length <= 10));
    }
    prepareFrontierConflicts(w, 45);
    assert.equal(w.wars.length, 0);
  }
});

test('a dead general and commander are succeeded by the surviving member with most merit', () => {
  const w = Sim.createWorld(42), k = w.kingdoms[0];
  const unit = k.militaryCommand.units[0];
  const previousGeneral = w.people.find(p => p.id === k.militaryCommand.generalIds[0]);
  const previousCommander = w.people.find(p => p.id === unit.commanderId);
  const successor = w.people.find(p => unit.memberIds.includes(p.id) && ![previousGeneral.id, previousCommander.id].includes(p.id));
  successor.militaryMerit = 500;
  previousGeneral.alive = false;
  updateMilitaryCommand(w, 50);
  assert.equal(k.militaryCommand.generalIds[0], successor.id);
  const nextUnit = k.militaryCommand.units.find(u => u.id === unit.id);
  const currentCommander = w.people.find(p => p.id === nextUnit.commanderId);
  const nextOfficer = w.people.find(p => nextUnit.memberIds.includes(p.id) && ![successor.id, currentCommander.id].includes(p.id));
  nextOfficer.militaryMerit = 200;
  currentCommander.alive = false;
  updateMilitaryCommand(w, 51);
  assert.equal(k.militaryCommand.units.find(u => u.id === unit.id).commanderId, nextOfficer.id);
  assert.ok(!k.militaryCommand.units.flatMap(u => u.memberIds).includes(currentCommander.id));
});

test('schools gate specialist training and the king trains archers after the initial patrol period', () => {
  const w = Sim.createWorld(42), k = w.kingdoms[0];
  const school = w.structures.find(s => s.kingdomId === k.id && s.type === 'arquearia');
  school.complete = false;
  assert.equal(recruitKingdomSoldier(w, k.id, { militaryClass: 'arqueiro' }).ok, false);
  school.complete = true;
  w.people.find(p => p.kingdomId === k.id && p.militaryClass === 'arqueiro').role = 'resident';
  advanceKingdomProjects(w, 24);
  assert.ok(w.people.some(p => p.kingdomId === k.id && p.recruitmentOrder?.militaryClass === 'arqueiro'));
  advanceKingdomProjects(w, 30);
  assert.ok(w.people.some(p => p.kingdomId === k.id && p.role === 'soldier' && p.militaryClass === 'arqueiro'));
});

test('archers fire at range, infantry cannot, healers recover allies without attacking', () => {
  const w = Sim.createWorld(42);
  const troops = w.people.filter(p => p.role === 'soldier');
  const fighter = troops.find(p => p.militaryClass === 'guerreiro');
  const healer = troops.find(p => p.militaryClass === 'monge');
  const enemy = troops.find(p => p.kingdomId !== fighter.kingdomId);
  fighter.x = healer.x = 30; fighter.y = healer.y = 60;
  enemy.x = 36; enemy.y = 60;
  fightTacticalRound(w, [fighter], [enemy], 1);
  assert.equal(enemy.lastAttackedDay, undefined);
  fighter.militaryClass = 'arqueiro';
  w.day = 1;
  fightTacticalRound(w, [fighter], [enemy], 2);
  assert.equal(enemy.lastAttackedDay, 2);
  assert.equal(enemy.alive, true);
  fighter.health = 40;
  const before = enemy.health;
  fightTacticalRound(w, [healer, fighter], [enemy], 3);
  assert.ok(fighter.health > 40);
  assert.equal(healer.militaryAnimation, 'heal');
  assert.ok(enemy.health <= before);
});

test('tower works have a civilian team and military escort, and observed towers trigger raids after peace', () => {
  const w = Sim.createWorld(42), k = w.kingdoms[0];
  const result = buildKingdomStructure(w, k.id, 'torre', { frontierOutpost: true, requireNeutral: true, maxProjection: 42, maxDistance: 48 });
  assert.equal(result.ok, true);
  const soldiers = w.people.filter(p => p.role === 'soldier' && p.kingdomId === k.id);
  const orders = soldiers.map(p => frontierWorkOrder(w, p)).filter(Boolean);
  assert.ok(orders.length > 0);
  assert.equal(result.structure.workerIds.length, 3);
  assert.ok(result.structure.escortIds.length <= 10);
  const progress = result.structure.progress;
  advanceKingdomProjects(w, 1);
  assert.equal(result.structure.progress, progress, 'work waits for builders to reach the site');
  prepareFrontierConflicts(w, 46);
  assert.equal(w.wars.length, 0, 'an unstarted, invisible construction plan is not yet an observed incursion');
  const builder = w.people.find(p => p.id === result.structure.workerIds[0]);
  builder.x = result.structure.x; builder.y = result.structure.y;
  w.day = 45; performFrontierWork(w, builder, { project: result.structure });
  advanceKingdomProjects(w, 46);
  prepareFrontierConflicts(w, 47);
  assert.equal(w.wars.length, 1);
  assert.equal(w.wars[0].evidence.structureId, result.structure.id);
});

test('damage bars last five real seconds, refresh on a new attack and clear on reset', () => {
  const bars = createDamageBarTracker(), p = { id: 1, alive: true };
  bars.observe([p], 0, true);
  assert.equal(bars.visible(1, 1), false);
  p.lastAttackSequence = 1;
  bars.observe([p], 100);
  assert.equal(bars.visible(1, 5099), true);
  assert.equal(bars.visible(1, 5100), false);
  p.lastAttackSequence++;
  bars.observe([p], 6000);
  assert.equal(bars.visible(1, 10999), true);
  bars.observe([p], 7000, true);
  assert.equal(bars.visible(1, 7001), false);
});
