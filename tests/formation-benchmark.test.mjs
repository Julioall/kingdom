import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const protocol = JSON.parse(await readFile(new URL('./fixtures/formation-benchmark-v1.json', import.meta.url), 'utf8'));

test('formation benchmark is frozen before policy weights are tuned', () => {
  assert.equal(protocol.version, 1);
  assert.equal(protocol.issue, 'JUL-182');
  assert.equal(protocol.status, 'preregistered-no-weights-tuned');
  assert.equal(protocol.reporting.singleWeightedScore, false);
  assert.equal(protocol.seedPlan.holdoutMayNotTuneWeights, true);
  assert.equal(protocol.reporting.selectionsMustBeFrozenBeforeHoldout, true);
});

test('calibration and holdout seeds are disjoint and fixed across candidate actions', () => {
  const calibration = protocol.seedPlan.calibration;
  const holdout = protocol.seedPlan.holdout;
  assert.equal(new Set(calibration).size, calibration.length);
  assert.equal(new Set(holdout).size, holdout.length);
  assert.equal(calibration.some(seed => holdout.includes(seed)), false);
  assert.ok(protocol.world.identicalSetupPerAction);
  assert.ok(protocol.world.replayDeterminismRequired);
});

test('headless arenas cover mixed-class matchups and the required tactical geometry', () => {
  const ids = protocol.scenarios.map(scenario => scenario.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.length >= 6);
  const classes = new Set(protocol.scenarios.flatMap(scenario => [
    ...Object.keys(scenario.attacker), ...Object.keys(scenario.defender)
  ]));
  for (const type of ['guerreiro', 'lanceiro', 'arqueiro']) assert.ok(classes.has(type));
  assert.ok(protocol.scenarios.some(scenario => scenario.terrain.includes('corridor')));
  assert.ok(protocol.scenarios.some(scenario => scenario.id.includes('arrows')));
  assert.ok(protocol.scenarios.some(scenario => scenario.id.includes('retreat')));
  assert.ok(protocol.scenarios.some(scenario => scenario.visibleObservations.includes('scout_report_age')));
});

test('baseline line and column remain selectable and outcomes retain separate metrics', () => {
  const actions = new Set(protocol.actions.map(action => action.id));
  assert.ok(actions.has('line'));
  assert.ok(actions.has('column'));
  assert.equal(protocol.actions.find(action => action.id === 'line').status, 'existing');
  assert.equal(protocol.actions.find(action => action.id === 'column').status, 'existing');
  const metrics = new Set(protocol.metrics.map(metric => metric.id));
  for (const id of ['objective_success', 'survival_fraction', 'enemy_damage_per_supply', 'days_to_objective',
    'route_distance', 'cohesion_auc', 'blocked_slot_days', 'withdrawal_success']) assert.ok(metrics.has(id));
  assert.equal(protocol.world.biomesAdded, false);
  assert.equal(protocol.world.seasonsAffectGameplay, false);
});
