import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeDecisionHistory, observeAutonomousKingdoms, evaluateAiBehavior }
  from '../src/simulation/observability/ai-evaluation.js';

test('decision evaluation groups request/proposal/outcome by stable request ID', () => {
  const stats = summarizeDecisionHistory([
    { type: 'request', day: 2, request: { requestId: 'king:1' } },
    { type: 'proposal', day: 3, requestId: 'king:1' },
    { type: 'applied', day: 3, requestId: 'king:1' },
    { type: 'request', day: 5, request: { requestId: 'king:2' } },
    { type: 'rejected', day: 7, requestId: 'king:2', reason: 'expired' },
    { type: 'rejected', day: 7, requestId: 'king:2', reason: 'expired' },
    { type: 'request', day: 8, request: { requestId: 'king:3' } }
  ]);
  assert.deepEqual([stats.requested, stats.proposed, stats.applied, stats.rejected, stats.unresolved],
    [3, 1, 1, 1, 1]);
  assert.equal(stats.acceptedRate, .5);
  assert.equal(stats.responseDaysMean, 1.5);
  assert.equal(stats.responseDaysSamples, 2);
  assert.deepEqual(stats.failureReasons, { expired: 1 });
});

test('bounded logs without their original request do not invent prior observations', () => {
  const stats = summarizeDecisionHistory([
    { type: 'applied', day: 100, requestId: 'general:7' },
    { type: 'fallback', day: 101, requestId: 'general:8', reason: 'offline' },
    { type: 'disabled', day: 102 },
    null
  ]);
  assert.equal(stats.requested, 0);
  assert.equal(stats.applied, 1);
  assert.equal(stats.fallback, 1);
  assert.equal(stats.responseDaysSamples, 0);
  assert.equal(stats.acceptedRate, .5);
  assert.equal(stats.failureReasons.offline, 1);
  assert.equal(summarizeDecisionHistory(null).acceptedRate, null);
  assert.equal(summarizeDecisionHistory([]).unresolved, 0);
});

test('autonomous economy and war report labels kingdom-owned assets only', () => {
  const world = {
    day: 12, seed: 42,
    kingdoms: [{ id: 1, name: 'Reino de Exemplo', communityId: 3, satisfaction: .65,
      treasury: { stock: { food: 70, gold: 34, wood: 6, stone: 5 } },
      strategy: { goal: 'defend', action: 'build', reason: 'border', garrisonMode: 'ready' } }],
    communities: [{ id: 3, cohesion: .5 }],
    people: [
      { id: 1, alive: true, kingdomId: 1, role: 'ruler', health: 100 },
      { id: 2, alive: true, kingdomId: 1, role: 'soldier', health: 55 },
      { id: 3, alive: false, kingdomId: 1, role: 'soldier', health: 0 }
    ],
    wars: [{ a: 1, b: 2, status: 'active' }],
    campaigns: [{ attackerId: 1, defenderId: 2, status: 'marching' }]
  };
  const original = structuredClone(world);
  const result = evaluateAiBehavior(world);
  assert.deepEqual(world, original);
  assert.equal(result.kingdoms[0].population.alive, 2);
  assert.equal(result.kingdoms[0].population.soldiers, 1);
  assert.equal(result.kingdoms[0].population.woundedSoldiers, 1);
  assert.equal(result.kingdoms[0].treasury.gold, 34);
  assert.equal(result.kingdoms[0].military.activeWars, 1);
  assert.equal(result.kingdoms[0].military.activeCampaigns, 1);
  assert.equal(result.decisions.kingAdapterEnabled, false);
  assert.equal(result.warTotals.active, 1);
  assert.deepEqual(observeAutonomousKingdoms(world), result.kingdoms);
  assert.throws(() => evaluateAiBehavior({}), TypeError);
});
