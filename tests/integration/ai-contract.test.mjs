import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../../src/simulation/engine.js';
import {
  applyKingdomStrategicAiDecision,
  failKingdomStrategicAiRequest,
  pullKingdomStrategicAiRequests,
  queueKingdomStrategicAiRequests,
  setStrategicAiEnabled
} from '../../src/simulation/kingdoms/strategy.js';
import {
  AI_DECISION_CONTRACT_VERSION,
  validateDecisionRequest,
  validateDecisionResult
} from '../../src/ai/contracts.js';
import { AI_MODEL_MANIFEST, getAiModelForRole } from '../../src/ai/model-manifest.js';

function makePendingKingRequests(seed = 42) {
  const world = Sim.createWorld(seed);
  world.simulationEpoch = 7;
  setStrategicAiEnabled(world, true);
  for (const kingdom of world.kingdoms) world.strategicAI.nextDecisionDays[String(kingdom.id)] = world.day;
  assert.equal(queueKingdomStrategicAiRequests(world), 2);
  const requests = pullKingdomStrategicAiRequests(world, 2);
  return { world, requests };
}

const validDecision = request => ({ action: request.allowedActions.find(action => action === 'maintain_autonomy') || request.allowedActions[0], confidence: .8, reason: 'Manter o plano atual.' });

test('model manifest keeps selected roles and leaves unmeasured installation details unknown', () => {
  assert.equal(getAiModelForRole('king').model, 'qwen2.5:0.5b');
  assert.equal(getAiModelForRole('general').model, 'smollm2:135m');
  assert.deepEqual(AI_MODEL_MANIFEST.models.king.outputTokenCandidates, [96, 192, 256]);
  assert.equal(AI_MODEL_MANIFEST.models.king.selectedOutputTokens, 192);
  assert.equal(AI_MODEL_MANIFEST.models.king.outputBudgetStatus, 'provisional');
  assert.equal(AI_MODEL_MANIFEST.models.king.installedDigest, null);
  assert.equal(AI_MODEL_MANIFEST.models.general.selectedOutputTokens, 192);
  assert.equal(AI_MODEL_MANIFEST.models.general.outputBudgetStatus, 'provisional');
  assert.equal(AI_MODEL_MANIFEST.models.general.status, 'experimental');
  assert.equal(getAiModelForRole('commander'), null, 'commander model is still an experiment, not an active selection');
});

test('king AI request includes the versioned identity, epoch, order, facts and allowed actions', () => {
  const { world, requests } = makePendingKingRequests();
  const request = requests[0];
  assert.equal(request.contractVersion, AI_DECISION_CONTRACT_VERSION);
  assert.match(request.requestId, /^king:\d+:\d+$/);
  assert.equal(request.worldEpoch, 7);
  assert.equal(request.role, 'king');
  assert.equal(request.agentId, world.people.find(person => person.id === request.agentId)?.id);
  assert.equal(request.reportDay, request.requestedDay);
  assert.ok(request.expiresDay > request.reportDay);
  assert.deepEqual(request.allowedActions, request.candidateActions);
  assert.equal(validateDecisionRequest(request), null);
  assert.ok(request.observedFacts.report);
});

test('only the current allowed decision applies, once, and kingdoms keep independent pending requests', () => {
  const { world, requests } = makePendingKingRequests();
  const [first, second] = requests;
  assert.equal(applyKingdomStrategicAiDecision(world, first, validDecision(first)), true);
  assert.equal(applyKingdomStrategicAiDecision(world, first, validDecision(first)), false, 'duplicate response is rejected');
  assert.ok(world.strategicAI.pendingByKingdom[String(second.kingdomId)], 'other kingdom remains pending');
  assert.equal(applyKingdomStrategicAiDecision(world, second, validDecision(second)), true);
  assert.equal(world.strategicAI.decisions, 2);
  const applied = world.strategicAI.events.filter(event => event.type === 'applied');
  assert.equal(applied.length, 2);
  assert.equal(applied[0].provider, 'ollama');
  assert.equal(applied[0].effect.kind, 'kingdom-plan');
});

test('invalid actions and decisions from stale epochs, orders, campaigns or deadlines are rejected', () => {
  {
    const { world, requests: [request] } = makePendingKingRequests();
    const warsBefore = world.wars.length;
    assert.equal(applyKingdomStrategicAiDecision(world, request, { action: 'declare_war', confidence: 1, reason: 'invented' }), false);
    assert.equal(world.wars.length, warsBefore, 'AI cannot create a war through an unlisted action');
  }
  {
    const { world, requests: [request] } = makePendingKingRequests();
    world.simulationEpoch++;
    assert.equal(applyKingdomStrategicAiDecision(world, request, validDecision(request)), false, 'old epoch is rejected');
  }
  {
    const { world, requests: [request] } = makePendingKingRequests();
    const kingdom = world.kingdoms.find(item => item.id === request.kingdomId);
    kingdom.strategy ||= {};
    kingdom.strategy.sinceDay = request.orderVersion + 1;
    assert.equal(applyKingdomStrategicAiDecision(world, request, validDecision(request)), false, 'superseded order is rejected');
  }
  {
    const { world, requests: [request] } = makePendingKingRequests();
    world.day = request.expiresDay + 1;
    assert.equal(applyKingdomStrategicAiDecision(world, request, validDecision(request)), false, 'expired decision is rejected');
  }
  {
    const { world, requests: [request] } = makePendingKingRequests();
    const staleCampaign = { ...request, campaignId: 'closed-campaign' };
    assert.equal(applyKingdomStrategicAiDecision(world, staleCampaign, validDecision(staleCampaign)), false, 'campaign context is revalidated');
  }
});

test('contract validator rejects wrong role, malformed candidate lists and foreign pending IDs', () => {
  const { world, requests: [request] } = makePendingKingRequests();
  const pending = world.strategicAI.pendingByKingdom[String(request.kingdomId)];
  assert.match(validateDecisionRequest({ ...request, role: 'judge' }), /papel/);
  assert.match(validateDecisionRequest({ ...request, allowedActions: ['hold', 'hold'] }), /ações permitidas/);
  assert.match(validateDecisionResult({ request: { ...request, role: 'general' }, pending, worldEpoch: 7,
    currentDay: world.day, orderVersion: request.orderVersion, campaignId: null, role: 'king' }), /papel/);
  assert.match(validateDecisionResult({ request, pending: { ...pending, requestId: 'other-request' }, worldEpoch: 7,
    currentDay: world.day, orderVersion: request.orderVersion, campaignId: null, role: 'king' }), /duplicado/);
});

test('failing an old response cannot clear a newer request for the same kingdom', () => {
  const { world, requests: [oldRequest] } = makePendingKingRequests();
  const id = String(oldRequest.kingdomId);
  const nextRequest = { ...oldRequest, requestId: oldRequest.requestId + ':replacement' };
  world.strategicAI.pendingByKingdom[id].requestId = nextRequest.requestId;
  assert.equal(failKingdomStrategicAiRequest(world, oldRequest), false);
  assert.equal(world.strategicAI.pendingByKingdom[id].requestId, nextRequest.requestId);
});

test('AI decision history is bounded and records fallback reasons', () => {
  const { world, requests: firstRequests } = makePendingKingRequests();
  for (const request of firstRequests) {
    failKingdomStrategicAiRequest(world, request, { reason: 'timeout de teste' });
  }
  for (let index = 0; index < 40; index++) {
    world.day++;
    for (const kingdom of world.kingdoms) world.strategicAI.nextDecisionDays[String(kingdom.id)] = world.day;
    queueKingdomStrategicAiRequests(world);
    for (const request of pullKingdomStrategicAiRequests(world, 2)) {
      failKingdomStrategicAiRequest(world, request, { reason: 'timeout de teste' });
    }
  }
  assert.ok(world.strategicAI.events.length <= 120);
  assert.ok(world.strategicAI.events.some(event => event.type === 'rejected' && event.reason === 'timeout de teste'));
});
