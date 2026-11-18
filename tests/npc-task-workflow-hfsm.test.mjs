import test from 'node:test';
import assert from 'node:assert/strict';
import {
  npcAssignmentIdentity, npcExecutionStage, beginNpcWorkflow, completeNpcWorkflow
} from '../src/simulation/individuals/task-workflow-hfsm.js';

const project = { id: 91, x: 10, y: 10, complete: false };
const community = { x: 10, y: 10, stores: {wood: 25, stone: 6} };
function setup(action = 'build') {
  const world = { day: 5, structures: [structuredClone(project)] };
  const person = { id: 3, alive: true, role: 'resident', x: 2, y: 2,
    carriedFood: 0, brain: {pending: {actionIndex: 1}, lastAction: action},
    lastDecision: {action, day: 4, scores: [1, 2], inputs: [3]},
    assignment: {action, source: 'community-project', goal: 'complete-funded-project',
      structureId: 91, expiresDay: 20, pauseReason: null}
  };
  return {world, person};
}
test('hierarchy derives stages from real construction, cargo and patrol state', () => {
  const { world, person } = setup();
  assert.equal(npcExecutionStage(world, person, 'build', community), 'travel');
  person.x = 10; person.y = 10;
  assert.equal(npcExecutionStage(world, person, 'build', community), 'work');
  community.stores.wood = 0; community.stores.stone = 0;
  assert.equal(npcExecutionStage(world, person, 'build', community), 'await-materials');
  community.stores.wood = 25;
  world.structures[0].complete = true;
  assert.equal(npcExecutionStage(world, person, 'build', community), 'select-site');
  person.carriedFood = 12; person.x = 2; person.y = 2;
  assert.equal(npcExecutionStage(world, person, 'deliver', community), 'travel');
  person.x = 10; person.y = 10;
  assert.equal(npcExecutionStage(world, person, 'deliver', community), 'unload');
  assert.equal(npcExecutionStage(world, person, 'patrol', community), 'patrol-route');
  assert.equal(npcExecutionStage(world, person, 'campaign', community), 'execute-order');
});
test('survival preempts work, retains paused assignment identity, then can resume', () => {
  const {world, person} = setup();
  const task = npcAssignmentIdentity(person.assignment);
  let choice = beginNpcWorkflow(world, person, {action: 'build', mode: 'work'}, community);
  assert.deepEqual(choice, {action: 'build', mode: 'work'});
  assert.equal(person.activityWorkflow.stage, 'travel');
  assert.equal(person.activityWorkflow.assignmentIdentity, task);
  world.day = 6;
  person.assignment.pauseReason = 'sobrevivência urgente';
  choice = beginNpcWorkflow(world, person, {action: 'drink', mode: 'survival'}, community);
  assert.equal(choice.action, 'drink');
  assert.equal(person.activityWorkflow.status, 'interrupted');
  assert.equal(person.activityWorkflow.resumeAction, 'build');
  assert.equal(person.activityWorkflow.resumeIdentity, task);
  world.day = 7; person.assignment.pauseReason = null;
  person.brain.pending = {actionIndex: 5};
  choice = beginNpcWorkflow(world, person, {action: 'socialize', mode: 'routine'}, community);
  assert.deepEqual(choice, {action: 'build', mode: 'work'});
  assert.equal(person.activityWorkflow.status, 'active');
  assert.equal(person.brain.pending, null, 'forced continuation must not train neural routine');
  assert.equal(person.lastDecision.action, 'build');
  assert.equal(person.lastDecision.scores, null);
});
test('higher-priority military and social directives cannot be overridden by a suspended workflow', () => {
  const {world, person} = setup();
  beginNpcWorkflow(world, person, {action: 'build', mode: 'work'}, community);
  world.day = 6;
  beginNpcWorkflow(world, person, {action: 'rest', mode: 'recovery'}, community);
  world.day = 7;
  const p = beginNpcWorkflow(world, person, {action: 'campaign', mode: 'military'}, community);
  assert.deepEqual(p, {action: 'campaign', mode: 'military'});
  assert.equal(person.activityWorkflow.action, 'campaign');
});
test('expired, replaced or explicitly paused tasks are never resurrected', () => {
  for (const mutate of [
    (p, w) => { p.assignment.expiresDay = w.day - 1; },
    p => { p.assignment.structureId = 92; },
    p => { p.assignment.pauseReason = 'ordem da comunidade'; }
  ]) {
    const {world, person} = setup();
    beginNpcWorkflow(world, person, {action: 'build', mode: 'work'}, community);
    world.day = 6;
    beginNpcWorkflow(world, person, {action: 'drink', mode: 'survival'}, community);
    world.day = 7;
    mutate(person, world);
    const choice = beginNpcWorkflow(world, person, {action: 'socialize', mode: 'routine'}, community);
    assert.equal(choice.action, 'socialize');
  }
});
test('stages refresh after execution without inventing a completed assignment', () => {
  const { world, person } = setup();
  beginNpcWorkflow(world, person, {action: 'build', mode: 'work'}, community);
  person.x = 10; person.y = 10;
  completeNpcWorkflow(world, person, 'build', community);
  assert.equal(person.activityWorkflow.stage, 'work');
  person.assignment = null; // Could be completion OR cancellation: do not guess.
  completeNpcWorkflow(world, person, 'build', community);
  assert.equal(person.activityWorkflow.status, 'released');
  assert.equal(person.activityWorkflow.stage, 'finished');
});
test('HFSM runtime never touches RNG or changes authoritative task objects', () => {
  const {world, person} = setup('forage');
  world.rngState = 44;
  const before = structuredClone(person.assignment);
  beginNpcWorkflow(world, person, {action: 'forage', mode: 'work'}, community);
  completeNpcWorkflow(world, person, 'forage', community);
  assert.deepEqual(person.assignment, before);
  assert.equal(world.rngState, 44);
});
