import test from 'node:test';
import assert from 'node:assert/strict';
import {
  browserDecisionContextVariants,
  browserInputFitsTokenBudget,
  browserInputTokenBudget
} from '../src/ai/browser-decision-context.js';

function kingRequest() {
  const choice = (id, reason) => ({ id, label: id, goal: 'goal-' + id, action: 'forage', priority: 'urgent', reason });
  return {
    role: 'king',
    candidateActions: ['forage_for_food', 'build_food_field'],
    allowedActions: ['forage_for_food', 'build_food_field'],
    context: {
      ruler: { name: 'King' },
      kingdom: { id: 'k1', name: 'Kingdom' },
      decisionGuidance: ['duplicated lengthy guidance'],
      recentDecisions: Array.from({ length: 4 }, (_, i) => ({ reason: 'old decision ' + i })),
      currentPlan: { goal: 'secure-food', action: 'forage', reason: 'long plan reason', garrisonMode: null },
      choices: [choice('forage_for_food', 'The shared food stock is low.'), choice('build_food_field', 'The field can increase food.'), choice('unallowed', 'must not leak')],
      report: {
        kingdom: { id: 'k1', name: 'Kingdom' }, population: 50,
        community: {
          sharedFood: 12, foodPerResident: .24, dailyFoodNeed: 54.17, feedStock: 5, feedTarget: 20,
          sheepCount: 4, woodStock: 100, stoneStock: 50, goldStock: 12, marketFoodTradeable: true,
          buildPlan: { type: 'roça', woodCost: 16, stoneCost: 6, foodCost: 0, required: 34 },
          constructionReady: true, safeBuilderAvailable: true, activeCropProject: false, constructionMaterialNeed: 0,
          foodInfrastructure: { completedFields: 1, standingCropBiomass: 80, harvestableCropPotential: 65,
            benefits: { roça: 'duplicate descriptions' }, buildSiteRequirement: 'duplicate instructions' },
          activeRoyalOrders: [{ goal: 'secure-food', action: 'forage', workers: 2, pausedWorkers: 1,
            longestActiveDays: 4, phases: ['communal-delivery', 'blocked'] }],
          lastRoyalOutcome: { status: 'blocked', action: 'forage', daysAgo: 2, reason: 'route blocked' },
          recentRoyalOutcomes: [{ status: 'blocked', action: 'forage', daysAgo: 3, reason: 'old outcome' }],
          repairs: { damagedStructureCount: 2, criticalStructureCount: 1, repairCost: { wood: 3, stone: 2 }, repairReady: true,
            damagedStructures: [{ id: 'huge payload omitted' }] }
        },
        treasury: { food: 10, feed: 4, wood: 50, stone: 20, gold: 100 },
        market: { foodPrice: 1, foodStock: 400, foodSupply: 15, foodDemand: 20 },
        military: { activeCampaign: null, knownEvidence: [{ kind: 'enemy-approach', opponentId: 'k2' }],
          pendingForceRequests: [], availableSoldiers: 8, recruitment: { available: false, slots: 0, eligibleResidents: 0,
            trainingOrders: 0, cost: { gold: 12 } }, knownEnemyInstallations: Array.from({ length: 30 }, () => ({ id: 'noise' })) },
        territoryTiles: 600, garrisonSize: 8, policy: { priorities: ['food'], droughtReserveDays: 3 }
      }
    }
  };
}

test('king browser context removes duplicate guidance but preserves observed decision facts and all allowed choices', () => {
  const request = kingRequest();
  const [compact, minimal] = browserDecisionContextVariants(request);

  for (const context of [compact, minimal]) {
    assert.deepEqual(context.choices.map(choice => choice.id), request.allowedActions);
    assert.equal(context.report.community.sharedFood, 12);
    assert.equal(context.report.community.foodInfrastructure.harvestableCropPotential, 65);
    assert.equal(context.report.community.lastRoyalOutcome.status, 'blocked');
    assert.equal(context.report.community.lastRoyalOutcome.reason, 'route blocked');
    assert.equal(context.report.community.activeRoyalOrders[0].pausedWorkers, 1);
    assert.equal(context.report.military.knownEvidence[0].kind, 'enemy-approach');
    assert.deepEqual(context.report.policy.priorities, ['food']);
    assert.equal(Object.hasOwn(context, 'decisionGuidance'), false);
    assert.equal(Object.hasOwn(context, 'recentDecisions'), false);
    assert.equal(JSON.stringify(context).includes('duplicate descriptions'), false);
    assert.equal(JSON.stringify(context).includes('unallowed'), false);
  }
  assert.equal(compact.choices[0].reason, 'The shared food stock is low.');
  assert.equal(minimal.choices[0].reason, undefined);
  assert.equal(compact.report.community.activeRoyalOrders[0].phases.length, 2);
  assert.equal(minimal.report.military.knownEvidence.length, 1);
  assert.deepEqual(request.context.choices.map(choice => choice.id), ['forage_for_food', 'build_food_field', 'unallowed'],
    'projection must not mutate queued simulation facts');
});

test('general browser request preserves its full campaign observation object', () => {
  const context = { campaign: { side: { shortageDays: 4 } }, allowedActions: ['hold_position'] };
  const variants = browserDecisionContextVariants({ role: 'general', context });
  assert.deepEqual(variants, [context]);
  assert.equal(variants[0], context);
});

test('browser model reserves output capacity before accepting the prompt length', () => {
  const inputBudget = browserInputTokenBudget(2048, 96);
  assert.equal(inputBudget, 1952);
  assert.equal(browserInputFitsTokenBudget(1952, inputBudget), true);
  assert.equal(browserInputFitsTokenBudget(1953, inputBudget), false);
  assert.equal(browserInputFitsTokenBudget(0, inputBudget), false);
  assert.equal(browserInputTokenBudget(undefined, 96), null);
  assert.equal(browserInputTokenBudget(2048, 2048), null);
});
