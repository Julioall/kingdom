import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../../src/simulation/engine.js';
import { buildKingdomStructure } from '../../src/simulation/kingdoms/commands.js';
import { frontierWorkOrder, performFrontierWork } from '../../src/simulation/kingdoms/frontier-conflicts.js';
import { advanceKingdomProjects } from '../../src/simulation/kingdoms/projects.js';
import { changePersonHealth } from '../../src/simulation/individuals/lifecycle.js';
import { updatePeople } from '../../src/simulation/individuals/actions.js';
import { battlefieldOpponents, fightBattlefieldSkirmishes } from '../../src/simulation/kingdoms/military.js';

function fixture() {
  const world = Sim.createWorld(42), [home, enemyKingdom] = world.kingdoms;
  const project = buildKingdomStructure(world, home.id, 'torre').structure;
  const worker = world.people.find(p => p.role === 'resident' && p.kingdomId === home.id && p.ageDays >= 18 * 365);
  const soldier = world.people.find(p => p.role === 'soldier' && p.kingdomId === enemyKingdom.id);
  Object.assign(worker, { x: project.x, y: project.y, health: 100, injury: 0, energy: 90,
    foodReserve: 90, hydration: 90, constructionProjectId: project.id });
  Object.assign(soldier, { x: project.x + 1, y: project.y, militaryClass: 'lanceiro', stamina: 100 });
  project.workerIds = [worker.id];
  const campaign = { id: 999, status: 'engaged', target: { x: project.x, y: project.y }, attackerId: enemyKingdom.id,
    defenderId: home.id, attacker: { kingdomId: enemyKingdom.id }, defender: { kingdomId: home.id } };
  world.campaigns = [campaign]; world.people = [worker, soldier];
  return { world, worker, soldier, project, campaign };
}

test('hostile workers on an active battlefield are attacked and leave their construction team', () => {
  const { world, worker, soldier, project, campaign } = fixture();
  assert.ok(battlefieldOpponents(world, campaign, soldier.kingdomId).includes(worker));
  for (let day = 1; day <= 10 && worker.health === 100; day++) fightBattlefieldSkirmishes(world, day);
  assert.ok(worker.health < 100);
  assert.equal(worker.constructionRetreating, true);
  assert.ok(!project.workerIds.includes(worker.id));
  assert.equal(frontierWorkOrder(world, worker), null);
});

test('even a small construction wound cancels same-day work and recovery overrides rebuilding', () => {
  const { world, worker, project } = fixture();
  performFrontierWork(world, worker, { project });
  assert.equal(project.lastConstructionWorkerId, worker.id);
  changePersonHealth(world, worker, -1, 'battle');
  assert.equal(worker.health, 99);
  assert.equal(project.lastConstructionWorkerId, null);
  assert.equal(performFrontierWork(world, worker, { project }), false);
  advanceKingdomProjects(world, 1);
  assert.equal(project.progress, 0);
  world.people = [worker];
  updatePeople(world);
  assert.equal(worker.brain.lastAction, 'rest');
  assert.equal(worker.homeRestTargetId, worker.homeId);
  assert.equal(worker.constructionRetreating, true, 'a worker walking home must not be immediately reassigned');
});

test('peace, distance and shelter keep people outside the current battlefield out of targeting', () => {
  const { world, worker, soldier, campaign } = fixture();
  campaign.status = 'complete';
  fightBattlefieldSkirmishes(world, 1);
  assert.equal(worker.health, 100);
  campaign.status = 'engaged'; worker.x += 40;
  assert.ok(!battlefieldOpponents(world, campaign, soldier.kingdomId).includes(worker));
  worker.x -= 40; worker.restingStructureId = worker.homeId;
  assert.ok(!battlefieldOpponents(world, campaign, soldier.kingdomId).includes(worker));
});
