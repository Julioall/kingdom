import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceKingdomProjects } from '../src/simulation/kingdoms/projects.js';

test('siege pauses an exposed kingdom worksite and construction resumes when the threat leaves', () => {
  const worksite = {
    id: 101, kingdomId: 1, type: 'torre', x: 10, y: 10,
    kingdomProject: true, complete: false, builtDay: null,
    progress: 2, required: 10, lastProgressDay: null,
    lastConstructionWorkerId: 1,
    lastConstructionWorkPosition: { x: 10, y: 10 },
    lastConstructionWorkDay: 10
  };
  const worker = {
    id: 1, alive: true, role: 'resident', kingdomId: 1,
    homeId: 11, x: 10, y: 10, state: 'construindo torre'
  };
  const threat = {
    id: 2, alive: true, role: 'soldier', kingdomId: 2,
    homeId: 22, campaignId: 202, x: 14, y: 10
  };
  const world = {
    day: 10, people: [worker, threat], structures: [worksite],
    kingdoms: [{ id: 1, name: 'Azul', structureIds: [] }],
    events: [], chronicle: []
  };

  advanceKingdomProjects(world, world.day);

  assert.equal(worksite.siegeBlocked, true);
  assert.equal(worksite.progress, 2, 'the worksite must not gain progress while an enemy campaign is within six tiles');
  assert.deepEqual({ x: worker.x, y: worker.y }, { x: 10, y: 10 },
    'the current implementation pauses progress but does not evacuate the worker');

  threat.alive = false;
  world.day = 11;
  worksite.lastConstructionWorkDay = 11;
  advanceKingdomProjects(world, world.day);

  assert.equal(worksite.siegeBlocked, false);
  assert.equal(worksite.progress, 3, 'the same paid worksite resumes when the threat is gone and its worker is present');
  assert.equal(worksite.complete, false);
});
