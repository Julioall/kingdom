import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../../src/simulation/engine.js';
import { buildKingdomStructure } from '../../src/simulation/kingdoms/commands.js';
import { frontierWorkOrder } from '../../src/simulation/kingdoms/frontier-conflicts.js';

function fixture() {
  const world = Sim.createWorld(42);
  const kingdom = world.kingdoms[0];
  const result = buildKingdomStructure(world, kingdom.id, 'torre');
  assert.equal(result.ok, true);
  const soldier = world.people.find(p => p.role === 'soldier' && p.kingdomId === kingdom.id && p.militaryRank !== 'general');
  return { world, kingdom, project: result.structure, soldier };
}

test('an empty or exhausted workforce releases the construction escort', () => {
  const { world, kingdom, project, soldier } = fixture();
  for (const p of world.people) if (p.kingdomId === kingdom.id && p.role === 'resident') p.energy = 10;
  assert.equal(frontierWorkOrder(world, soldier), null);
  assert.deepEqual(project.workerIds, []);
  assert.deepEqual(project.escortIds, []);
  assert.equal(project.constructionStatus, 'aguardando trabalhadores aptos');
});

test('construction keeps its workers and replaces a worker who needs recovery', () => {
  const { world, project, soldier } = fixture();
  frontierWorkOrder(world, soldier);
  const initial = project.workerIds.slice();
  assert.equal(initial.length, 3);
  assert.ok(project.escortIds.length <= 2);
  const outsider = world.people.find(p => p.role === 'resident' && p.kingdomId === soldier.kingdomId && !initial.includes(p.id));
  outsider.skills.build = 1;
  frontierWorkOrder(world, soldier);
  assert.deepEqual(project.workerIds, initial, 'skill comparisons cannot reshuffle a team already walking');
  world.people.find(p => p.id === initial[0]).energy = 10;
  frontierWorkOrder(world, soldier);
  assert.ok(!project.workerIds.includes(initial[0]));
  assert.ok(project.workerIds.includes(initial[1]) && project.workerIds.includes(initial[2]));
});

test('workers travel and finish a royal tower through normal daily simulation, then release the team', () => {
  const { world, project } = fixture();
  for (let day = 0; day < 65 && !project.complete; day++) Sim.stepDay(world);
  assert.equal(project.complete, true, 'actual worker movement and daily work must finish the paid project');
  assert.equal(project.progress, project.required);
  assert.ok(project.lastConstructionWorkerId != null);
  assert.deepEqual(project.workerIds, []);
  assert.deepEqual(project.escortIds, []);
  assert.equal(project.constructionStatus, 'obra concluída');
});
