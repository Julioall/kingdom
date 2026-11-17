import test from 'node:test';
import assert from 'node:assert/strict';
import { constructionTaskProgress }
  from '../src/simulation/individuals/construction-task-progress.js';

test('non-build actions do not scan any structures', () => {
  const world = {
    get structures() { throw new Error('non-building action performed a global scan'); }
  };
  for (const action of ['forage', 'deliver', 'guard', 'campaign', 'drink', 'rest', 'trade',
    'socialize', 'raid', 'gather', 'collect_loot', 'lead_sheep']) {
    assert.equal(constructionTaskProgress(world, { id: 3 }, action), null, action);
  }
  assert.equal(constructionTaskProgress(world, null, null), null);
});

test('building progress retains exact previous community and kingdom accounting', () => {
  const world = {
    structures: [
      { id: 1, communityId: 10, kingdomId: 1, progress: 5, complete: false },
      { id: 2, communityId: 10, kingdomId: 1, progress: 7, complete: true,
        integrity: .6, maxHealth: 100, health: 50 },
      { id: 3, communityId: 11, kingdomId: 1, progress: 10, complete: true,
        maxHealth: 0, health: 3 },
      { id: 4, communityId: 20, kingdomId: 2, progress: 30, complete: true,
        integrity: .9, maxHealth: 100, health: 80 },
      { id: 5, communityId: 10, kingdomId: 1, progress: 2, complete: true,
        destroyedDay: 2, integrity: 0 }
    ]
  };
  const initial = structuredClone(world);
  const progress = constructionTaskProgress(world, { id: 10, kingdomId: 1 }, 'build');
  assert.deepEqual(progress, { buildProgress: 14, repairProgress: 2.1 });
  assert.deepEqual(world, initial, 'audit is read-only');
  world.structures[0].progress += 4;
  const after = constructionTaskProgress(world, { id: 10, kingdomId: 1 }, 'build');
  assert.equal(after.buildProgress - progress.buildProgress, 4);
  assert.equal(after.repairProgress, progress.repairProgress);
});

test('construction recovery counts damage improvements, not unrelated work', () => {
  const world = { structures: [{
    id: 7, kingdomId: 1, communityId: 2, complete: true,
    integrity: .4, health: 40, maxHealth: 100
  }] };
  const community = { id: 2, kingdomId: 1 };
  const before = constructionTaskProgress(world, community, 'build');
  world.structures[0].integrity += .1;
  world.structures[0].health += 5;
  const after = constructionTaskProgress(world, community, 'build');
  assert.ok(Math.abs(after.repairProgress - before.repairProgress - .15) < 1e-12);
  assert.equal(after.buildProgress - before.buildProgress, 0);
});

test('unaffiliated builders preserve the former undefined-community building tally', () => {
  const world = { structures: [
    { id: 1, progress: 3 }, { id: 2, progress: 10, communityId: 2 },
    { id: 3, progress: 4 }
  ] };
  assert.deepEqual(constructionTaskProgress(world, null, 'build'),
    { buildProgress: 7, repairProgress: 0 });
});
