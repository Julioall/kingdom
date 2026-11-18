import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createHybridQualityTracker, sampleHybridQuality, summarizeTiming
} from '../scripts/support/npc-hybrid-quality.mjs';

function actor(id, properties = {}) {
  return {id, alive: true, x: id, y: 2,
    role: 'resident', health: 90, energy: 75,
    hydration: 65, foodReserve: 35,
    brain: {lastAction: 'build'}, ...properties};
}
function world(people = [actor(1)]) {
  return {
    day: 1, people, animals: [], structures: [
      {id: 7, complete: true, destroyedDay: null},
      {id: 8, complete: false, destroyedDay: null}
    ],
    communities: [{
      id: 10, stores: {food: 55},
      assignments: [{personId: 1, assignedDay: 0,
        action: 'build', goal: 'complete-funded-project',
        status: 'delegada'}]
    }],
    trades: 0, deaths: 0, births: 0,
    raidAttempts: 0, conflicts: 0
  };
}
test('records no fake completions or action switches at baseline', () => {
  const w = world();
  const tracker = createHybridQualityTracker(w);
  const first = sampleHybridQuality(w, tracker);
  assert.equal(first.population.alive, 1);
  assert.equal(first.economy.completedStructures, 1);
  assert.equal(first.behavior.dailyObservedTaskCompletions, 0);
  assert.equal(first.behavior.dailyNewCompletedStructures, 0);
  assert.equal(first.behavior.dailyActionSwitches, 0);
  assert.equal(first.navigation.stationaryWhileRoutedDays, 0);
  assert.equal(first.vital.meanEnergy, 75);
});
test('counts task completion, constructed structures, retries and stalled travel once', () => {
  const p = actor(1, {
    navigationRoute: {path: [4, 5], cursor: 0, completed: false},
    navigationLocalDetours: 2,
    navigationCacheHits: 3,
    navigationFailureCacheHits: 0,
    activityWorkflow: {action: 'build', status: 'interrupted',
      resumeAction: 'build', stage: 'travel'}
  });
  const w = world([p]);
  const tracker = createHybridQualityTracker(w);
  sampleHybridQuality(w, tracker);
  w.day++;
  w.communities[0].assignments[0].status = 'concluída';
  w.structures[1].complete = true;
  p.brain.lastAction = 'deliver';
  p.navigationLocalDetours = 4;
  p.navigationCacheHits = 7;
  p.navigationFailureCacheHits = 1;
  p.navigationCongestion = {blockedDays: 4};
  p.passageRequestSent = {day: 2};
  p.activityWorkflow = {action: 'build', status: 'active', stage: 'work'};
  const second = sampleHybridQuality(w, tracker);
  assert.equal(second.behavior.dailyObservedTaskCompletions, 1);
  assert.equal(second.behavior.dailyNewCompletedStructures, 1);
  assert.equal(second.behavior.dailyActionSwitches, 1);
  assert.equal(second.behavior.dailyWorkflowStageChanges, 1);
  assert.equal(second.behavior.dailyWorkflowResumptions, 1);
  assert.equal(second.navigation.dailyDetours, 2);
  assert.equal(second.navigation.dailyRouteCacheHits, 4);
  assert.equal(second.navigation.dailyFailureCacheHits, 1);
  assert.equal(second.navigation.dailyPassageRequests, 1);
  assert.equal(second.navigation.stationaryWhileRoutedDays, 1);
  assert.equal(second.navigation.longBlockedRouteActors, 1);
  assert.equal(second.navigation.maxBlockedDays, 4);
  w.day++;
  p.passageRequestSent = {day: 2};
  const third = sampleHybridQuality(w, tracker);
  assert.equal(third.behavior.dailyObservedTaskCompletions, 0);
  assert.equal(third.behavior.dailyNewCompletedStructures, 0);
  assert.equal(third.navigation.dailyDetours, 0);
  assert.equal(third.navigation.dailyPassageRequests, 0);
  assert.equal(third.cumulative.observedCompletedTasks, 1);
});
test('observes assignment pauses, campaign soldiers and lifecycle changes', () => {
  const soldier = actor(2, {role: 'soldier', campaignId: 55,
    assignment: {action: 'patrol', expiresDay: 5, pauseReason: 'rest'}});
  const w = world([actor(1, {
    assignment: {action: 'build', expiresDay: 0}}), soldier]);
  const tracker = createHybridQualityTracker(w);
  const data = sampleHybridQuality(w, tracker);
  assert.equal(data.population.soldiersOnCampaign, 1);
  assert.equal(data.economy.activeAssignments, 1);
  assert.equal(data.economy.pausedAssignments, 1);
  assert.equal(data.economy.overdueAssignments, 1);
  w.day = 2; soldier.alive = false;
  const after = sampleHybridQuality(w, tracker);
  assert.equal(after.population.alive, 1);
  assert.equal(tracker.previousActors.has(2), false);
});
test('rejects NaN and zero-population states rather than claiming a healthy world', () => {
  const w = world([actor(1, {hydration: NaN})]);
  const t = createHybridQualityTracker(w);
  assert.throws(() => sampleHybridQuality(w, t), /Invalid physical state/);
  w.people = [];
  assert.throws(() => sampleHybridQuality(w, t), /No living NPCs/);
  assert.throws(() => sampleHybridQuality(w, null), TypeError);
});
test('timing summary computes p50, p95 and p99 without sum-of-durations bias', () => {
  assert.deepEqual(summarizeTiming([90, 10, 20, 30, 40]), {
    count: 5, meanMs: 38, p50Ms: 30, p95Ms: 90, p99Ms: 90, maxMs: 90
  });
  assert.throws(() => summarizeTiming([]), /Empty/);
});
