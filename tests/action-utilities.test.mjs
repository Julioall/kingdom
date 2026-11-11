import test from 'node:test';
import assert from 'node:assert/strict';
import { PEOPLE_ACTIONS } from '../src/config/ecosystem.js';
import { buildPeopleActionUtilities } from '../src/simulation/individuals/action-utilities.js';

function fixture() {
  const p = {
    skills: { forage: .5, hunt: .6, gather: .5, care: .4, diplomacy: .3 },
    sociability: .5, injury: 1, carriedMeat: 0, carriedWood: 0,
    leadingSheepId: null
  };
  return {
    w: { day: 1 }, p, inputs: Array(18).fill(.5), food: null,
    community: null, groupFood: 0, shelter: null, preyNearby: null,
    herdPrey: null, huntGround: null, foodNeed: .7, huntAccess: .3,
    deliveryNeed: .4, waterTarget: null, socialTarget: null,
    localSuitability: .2, risk: .1, borderRisk: .2,
    canBuild: false, canGather: false, materialNeed: .4, goldNeed: .2,
    storage: { destination: null }, looseLog: null,
    pen: null, browseFood: null, herd: [], browseAccess: .3, feedNeed: .5,
    communityFoodAidAvailable: false, voluntaryFoodAidAvailable: false,
    tradePartner: null, marketTrust: .4, canMigrate: false,
    hasFoodPressure: false, hasWaterPressure: false,
    availablePen: null, sheepSighting: null, raidTarget: null, communitySize: 4
  };
}
function spySelectors(calls) {
  return {
    communityBuildUtility: () => { calls.build++; return .77; },
    carriedResources: () => { calls.cargo++; return 0; },
    communityHerd: () => { calls.herd++; return [{}, {}]; },
    communityFoodStock: () => { calls.food++; return 4; }
  };
}
function assertUtilities(actual, expected) {
  assert.equal(actual.length, PEOPLE_ACTIONS.length,
    'the order must match the shared-policy action catalog');
  assert.equal(expected.length, PEOPLE_ACTIONS.length);
  for (let i = 0; i < expected.length; i++)
    assert.ok(Math.abs(actual[i] - expected[i]) < 1e-10,
      PEOPLE_ACTIONS[i] + ' expected ' + expected[i] + ' got ' + actual[i]);
}

test('causal utility projection preserves the 17 disabled/default action scores', () => {
  const ctx = fixture();
  const calls = { build: 0, cargo: 0, herd: 0, food: 0 };
  const original = JSON.stringify(ctx);
  assertUtilities(buildPeopleActionUtilities(ctx, spySelectors(calls)), [
    -.6, -.65, -.7, -.5,
    .5 * .5 * .82 - .35,
    .5 * .92 + .045 + .04,
    .08 + .08 * .7 + .1 * .16 - .2 * .8,
    -1, -.55, -.65, -.65, -.55, -.55, -.7, -.8, -.8, -.85
  ]);
  assert.deepEqual(calls, { build: 0, cargo: 0, herd: 0, food: 0 },
    'disabled actions must never perform expensive live world queries');
  assert.equal(JSON.stringify(ctx), original, 'the projection must not mutate NPC state');
});

test('causal utility projection preserves live selectors and all enabled action scores', () => {
  const ctx = fixture();
  ctx.community = { id: 1, stores: { wood: 0, feed: 10 } };
  ctx.food = {}; ctx.groupFood = 5; ctx.shelter = {}; ctx.preyNearby = {};
  ctx.waterTarget = {}; ctx.socialTarget = {}; ctx.canBuild = true;
  ctx.canGather = true; ctx.storage = { destination: {}, community: ctx.community };
  ctx.looseLog = {}; ctx.pen = {}; ctx.browseFood = {}; ctx.herd = [{}];
  ctx.communityFoodAidAvailable = true; ctx.tradePartner = {};
  ctx.canMigrate = true; ctx.hasFoodPressure = true; ctx.hasWaterPressure = true;
  ctx.availablePen = {}; ctx.sheepSighting = { visible: true, distance: 1 };
  ctx.raidTarget = { relation: { tension: .5 } };
  const calls = { build: 0, cargo: 0, herd: 0, food: 0 };
  const original = JSON.stringify(ctx);
  assertUtilities(buildPeopleActionUtilities(ctx, spySelectors(calls)), [
    1.425, .896, -.7, 1.345, .325, .545, -.008,
    .77, .82, .87, .55, .614, .633, 1.754, 1.176, -.8, .34
  ]);
  assert.deepEqual(calls, { build: 1, cargo: 1, herd: 1, food: 2 },
    'live selectors must keep the original lazy evaluation and call counts');
  assert.equal(JSON.stringify(ctx), original);
});

test('utility scoring calls live world selectors at the current causal point', () => {
  const ctx = fixture();
  ctx.community = { id: 1, stores: { wood: 0, feed: 10 } };
  ctx.canBuild = true;
  ctx.raidTarget = { relation: { tension: 1 } };
  ctx.communitySize = 1;
  let stock = 0, builds = 0;
  const selectors = {
    communityBuildUtility: () => ++builds,
    carriedResources: () => 0,
    communityHerd: () => [],
    communityFoodStock: () => stock
  };
  const first = buildPeopleActionUtilities(ctx, selectors);
  assert.equal(first[7], 1);
  assert.ok(first[16] > 0);
  stock = 20; ctx.canBuild = false;
  const second = buildPeopleActionUtilities(ctx, selectors);
  assert.equal(second[7], -1);
  assert.equal(second[16], -.85);
  assert.equal(builds, 1, 'build utility must not be queried after it becomes unavailable');
});
