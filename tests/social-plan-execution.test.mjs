import test from 'node:test';
import assert from 'node:assert/strict';
import engine from '../src/simulation/engine.js';
import { ensureFoodAidPlan, resolveFoodAidRequest } from '../src/simulation/economy/trade.js';
import { advanceSocialCommitmentDeadlines, advanceSocialIntention, defineSocialIntention, recordSocialBeliefEvidence,
  recordSocialFact, rememberSocialFact, maintainSocialIntentions } from '../src/simulation/society/social-evidence.js';
import { selectFoodHelper, selectSocialPlanAction } from '../src/simulation/society/plan-execution.js';
import { cellAt } from '../src/simulation/world/spatial.js';
import { resolveSocialMeeting } from '../src/simulation/society/social-meetings.js';

function fixture(role = 'resident', separation = 1) {
  const world = engine.createWorld(42);
  const adults = world.people.filter(p => p.role === 'resident' && p.ageDays >= 12 * 365);
  const [person, helper] = adults;
  world.people = [person, helper];
  world.animals = [];
  world.structures = [];
  world.communities = [];
  world.kingdoms = [];
  for (const tile of world.tiles) {
    tile.terrain = 'land'; tile.slope = 0; tile.kingdomId = null;
    tile.plants.fill(0); tile.stoneDeposit = 0; tile.goldOre = 0;
  }
  for (const p of world.people) Object.assign(p, { communityId: null, kingdomId: null, homeId: null,
    campaignId: null, assignment: null, energy: 100, health: 100, hydration: 100,
    injury: 0, lastAttackedDay: -100, headingX: 0, headingY: 0,
    x: 20, y: 20, sensoryMemory: undefined, socialIntentions: [], socialMemories: [], socialBeliefs: [] });
  person.role = role; person.foodReserve = 30;
  helper.x = 20 + separation; helper.foodReserve = 100;
  // The helper is a stationary dependent; the production requester still uses normal perception and actions.
  helper.ageDays = 1;
  return { world, person, helper };
}

function tick(world) { engine.modules.SocietyExperiment.updatePeople(world); world.day++; }

test('a resident executes a food plan through real action selection and conserves the transfer', () => {
  const { world, person, helper } = fixture('resident');
  const control = fixture('resident');
  control.person.foodReserve = 60;
  tick(control.world);
  const before = { values: Array.from(person.brain.actionValues), updates: person.brain.updates,
    reward: person.brain.rewardMean, helper: helper.foodReserve };
  tick(world);
  const plan = person.socialIntentions.find(p => p.type === 'seek_food_aid');
  assert.equal(person.lastDecision.action, 'socialize');
  assert.equal(plan.status, 'completed');
  assert.equal(plan.progress, 3);
  const promise = world.socialEvidence.commitments.find(c => c.record.commitmentId === plan.commitmentId).record;
  assert.equal(promise.status, 'fulfilled');
  assert.equal(promise.deliveredQuantity, 2.5);
  const response = world.socialEvidence.facts.find(f => f.type === 'food_aid_request_resolved');
  assert.equal(response.outcome.amount, 2.5);
  assert.ok(Math.abs(control.helper.foodReserve - helper.foodReserve - 2.5) < 1e-9,
    'the helper loses exactly the transferred amount in addition to normal daily consumption');
  assert.ok(person.socialMemories.some(m => m.rootEventId === response.eventId));
  assert.ok(person.socialBeliefs.some(b => b.topic === 'food_aid_reliability'));
  assert.deepEqual(Array.from(person.brain.actionValues), before.values);
  assert.equal(person.brain.updates, before.updates);
  assert.equal(person.brain.rewardMean, before.reward);
});

test('soldiers do not search for or request food aid outside the military supply path', () => {
  const { world, person, helper } = fixture('soldier');
  person.perception = { people: [{ id: helper.id, visible: true, distance: 1,
    visibleSignals: { foodSurplus: true } }] };

  assert.equal(selectFoodHelper(world, person), null);
  assert.equal(ensureFoodAidPlan(world, person, helper), null);
  const request = resolveFoodAidRequest(world, person, helper);

  assert.deepEqual(request, { requested: false, reason: 'military-duty' });
  assert.equal(person.socialIntentions.length, 0);
  assert.equal(world.socialEvidence?.commitments?.length || 0, 0);
  assert.equal(helper.foodReserve, 100);
});

test('a builder interrupts its assignment, walks to the same helper and finishes before its distance-aware deadline', () => {
  const { world, person, helper } = fixture('resident', 6);
  const community = { id: 900, name: 'Obra', memberIds: [person.id, helper.id], x: 20, y: 20,
    stores: { food: 0, meat: 0, wood: 0, stone: 0 }, stage: 'vínculo', history: [], usedCells: {},
    assignments: [], properties: [], satisfaction: .8, cohesion: .8, createdDay: 0 };
  world.communities.push(community);
  person.communityId = helper.communityId = community.id;
  person.assignment = { action: 'build', communityId: community.id, assignedBy: helper.id,
    expiresDay: 100, source: 'community-project' };
  const origin = person.x;
  tick(world);
  const first = person.socialIntentions.find(p => p.type === 'seek_food_aid');
  assert.equal(person.lastDecision.action, 'socialize');
  assert.ok(person.x > origin);
  assert.equal(first.progress, 1);
  assert.ok(first.dueDay - first.createdDay > 3);
  assert.equal(person.assignment.pauseReason, 'plano individual em execução');
  for (let i = 0; i < 12 && person.socialIntentions[0].status !== 'completed'; i++) tick(world);
  const final = person.socialIntentions.find(p => p.intentionId === first.intentionId);
  assert.equal(final.status, 'completed');
  assert.ok(final.updatedDay <= final.dueDay);
});

test('an assigned food-field builder keeps a social aid plan suspended while personal food is sufficient', () => {
  const { world, person, helper } = fixture('resident');
  person.assignment = { action: 'build', goal: 'invest-in-cultivated-food', communityId: null,
    assignedBy: helper.id, expiresDay: 100, source: 'kingdom-strategy' };
  person.perception = { people: [{ id: helper.id, visible: true, distance: 1,
    visibleSignals: { foodSurplus: true } }] };
  const { intention } = ensureFoodAidPlan(world, person, helper);
  assert.ok(intention);

  const selected = selectSocialPlanAction(world, person, { constructionDuty: true });

  assert.equal(selected, null);
  assert.equal(person.socialIntentions[0].status, 'suspended');
  assert.ok(person.socialIntentions[0].blockers.includes('community_duty'));
});

test('military duty and emergencies suspend a plan, recovery resumes the same ID', () => {
  const { world, person, helper } = fixture('resident');
  person.perception = { people: [{ id: helper.id, visible: true, distance: 1, visibleSignals: { foodSurplus: true } }] };
  const { intention } = ensureFoodAidPlan(world, person, helper);
  person.role = 'soldier';
  assert.equal(selectSocialPlanAction(world, person), null);
  assert.deepEqual(person.socialIntentions[0].blockers, ['military_duty']);
  person.role = 'resident';
  person.hydration = 3;
  assert.equal(selectSocialPlanAction(world, person), null);
  assert.ok(person.socialIntentions[0].blockers.includes('critical_thirst'));
  person.hydration = 100;
  // Normal daily maintenance clears recovered physical impediments before arbitration.
  tick(world);
  assert.equal(person.socialIntentions[0].intentionId, intention.intentionId);
  assert.equal(person.socialIntentions[0].status, 'completed');
});

test('remembered evidence influences helper choice; unknown facts and invisible people do not', () => {
  const { world, person, helper } = fixture();
  helper.ageDays = 20 * 365;
  const other = { ...helper, id: 999, name: 'Outra pessoa', x: 22, socialMemories: [] };
  world.people.push(other);
  person.perception = { people: [helper, other].map(p => ({ id: p.id, distance: p.x - person.x,
    visible: true, visibleSignals: { foodSurplus: true } })) };
  const fact = recordSocialFact(world, { idempotencyKey: 'refusal', type: 'food_aid_request_resolved',
    participantIds: [person.id, helper.id], witnessIds: [person.id, helper.id],
    outcome: { result: 'refused', resource: 'food' } });
  assert.equal(selectFoodHelper(world, person).id, helper.id);
  rememberSocialFact(world, person.id, fact.eventId, { source: 'direct' });
  recordSocialBeliefEvidence(world, person.id, { topic: 'food_aid_reliability', aboutId: helper.id,
    eventId: fact.eventId, polarity: -1 });
  assert.equal(selectFoodHelper(world, person).id, other.id);
  person.perception.people[1].visible = false;
  assert.equal(selectFoodHelper(world, person).id, helper.id);
});

test('an expired uncommunicated proposal is not learned by the distant helper', () => {
  const { world, person, helper } = fixture('resident', 6);
  const { commitment } = ensureFoodAidPlan(world, person, helper);
  world.day = commitment.dueDay + 1;
  advanceSocialCommitmentDeadlines(world);
  const expired = world.socialEvidence.facts.find(f => f.type === 'social_commitment_expired');
  assert.ok(person.socialMemories.some(m => m.rootEventId === expired.eventId));
  assert.ok(!helper.socialMemories.some(m => m.rootEventId === expired.eventId));
});

test('persistent migration is selected after the original neural choice, and cannot replace soldier duty', () => {
  const { world, person } = fixture();
  const destination = cellAt(world, 24, 20);
  defineSocialIntention(world, person.id, { type: 'prepare_migration', priority: .5, dueDay: 20,
    destination: { x: destination.x, y: destination.y }, steps: [{ action: 'reach_destination' }], endsWhen: 'arrival' });
  person.foodReserve = 60;
  tick(world);
  assert.equal(person.lastDecision.action, 'migrate');
  assert.ok(person.x > 20);
  person.role = 'soldier';
  assert.equal(selectSocialPlanAction(world, person), null);
  assert.ok(person.socialIntentions[0].blockers.includes('military_duty'));
});

test('a face-to-face report preserves its source and changes a subsequent helper choice only once', () => {
  const { world, person, helper } = fixture();
  const informant = { ...helper, id: 999, name: 'Informante', x: 20, y: 21,
    ageDays: 20 * 365, socialMemories: [], socialBeliefs: [] };
  world.people.push(informant);
  person.foodReserve = 50;
  person.perception = { people: [{ id: informant.id, visible: true, distance: 1 }] };
  const fact = recordSocialFact(world, { idempotencyKey: 'observed-aid', type: 'food_aid_transferred',
    participantIds: [helper.id, informant.id], targetId: informant.id, witnessIds: [helper.id, informant.id],
    outcome: { resource: 'food', amount: 2.5 } });
  rememberSocialFact(world, informant.id, fact.eventId, { source: 'direct' });
  const unseen = recordSocialFact(world, { idempotencyKey: 'private-aid', type: 'food_aid_transferred',
    participantIds: [helper.id, informant.id], targetId: informant.id, witnessIds: [helper.id, informant.id],
    outcome: { resource: 'food', amount: 3 } });
  const meeting = resolveSocialMeeting(world, person, informant);
  assert.equal(meeting.report.eventId, fact.eventId, 'unknown world facts cannot be reported');
  const memory = person.socialMemories.find(m => m.rootEventId === fact.eventId);
  assert.equal(memory.source, 'reported');
  assert.equal(memory.sourcePersonId, String(informant.id));
  assert.ok(!person.socialMemories.some(m => m.rootEventId === unseen.eventId));
  const belief = person.socialBeliefs.find(b => b.aboutId === String(helper.id));
  assert.equal(belief.supportingEventIds.length, 1);
  const certainty = belief.certainty;
  world.day++;
  resolveSocialMeeting(world, person, informant);
  assert.equal(person.socialBeliefs.find(b => b.aboutId === String(helper.id)).certainty, certainty);
  // The trusted helper is slightly farther away; only the recipient's reported evidence changes the ranking.
  helper.x = 22; informant.x = 21.8;
  person.foodReserve = 30;
  person.perception.people = [helper, informant].map(p => ({ id: p.id, visible: true,
    distance: Math.hypot(p.x - person.x, p.y - person.y), visibleSignals: { foodSurplus: true } }));
  assert.equal(selectFoodHelper(world, person).id, helper.id);
});

test('unavailable helpers close the obligation, and failed plans do not restart immediately', () => {
  const { world, person, helper } = fixture();
  person.perception = { people: [{ id: helper.id, visible: true, distance: 1, visibleSignals: { foodSurplus: true } }] };
  const { intention, commitment } = ensureFoodAidPlan(world, person, helper);
  helper.alive = false;
  maintainSocialIntentions(world, person);
  assert.equal(person.socialIntentions[0].terminationReason, 'target_unavailable');
  assert.equal(world.socialEvidence.commitments.find(c => c.record.commitmentId === commitment.commitmentId).record.status, 'cancelled');
  helper.alive = true;
  assert.equal(selectFoodHelper(world, person), null);
  world.day = intention.createdDay + 4;
  assert.equal(selectFoodHelper(world, person).id, helper.id);
});

test('resupply, carried cargo and occupied participants defer without losing plan progress', () => {
  const { world, person, helper } = fixture('resident');
  person.perception = { people: [{ id: helper.id, visible: true, distance: 1, visibleSignals: { foodSurplus: true } }] };
  const { intention } = ensureFoodAidPlan(world, person, helper);
  for (const [context, blocker] of [[{ resupply: true }, 'garrison_resupply'],
    [{ cargo: true }, 'cargo_delivery'], [{ busy: new Set([helper.id]) }, 'participant_busy']]) {
    assert.equal(selectSocialPlanAction(world, person, context), null);
    assert.deepEqual(person.socialIntentions[0].blockers, [blocker]);
    assert.equal(person.socialIntentions[0].intentionId, intention.intentionId);
  }
  assert.equal(selectSocialPlanAction(world, person).action, 'socialize');
  assert.equal(person.socialIntentions[0].status, 'active');
});

test('recovery does not create a new promise until the NPC can start executing it', () => {
  const { world, person } = fixture('soldier');
  person.energy = 20;
  tick(world);
  assert.equal(person.lastDecision.action, 'rest');
  assert.equal(person.socialIntentions.length, 0);
  assert.equal(world.socialEvidence?.commitments?.length || 0, 0);
  person.energy = 100;
  tick(world);
  assert.equal(person.socialIntentions.length, 0);
  assert.equal(world.socialEvidence?.commitments?.length || 0, 0);
});

test('a food request itself can transmit a previous experience without another meeting or transfer', () => {
  const { world, person, helper } = fixture();
  const earlierRecipient = { ...helper, id: 999, socialMemories: [], socialBeliefs: [] };
  world.people.push(earlierRecipient);
  const prior = recordSocialFact(world, { idempotencyKey: 'prior-gift', type: 'food_aid_transferred',
    participantIds: [helper.id, earlierRecipient.id], targetId: earlierRecipient.id,
    witnessIds: [helper.id, earlierRecipient.id], outcome: { resource: 'food', amount: 3 } });
  rememberSocialFact(world, helper.id, prior.eventId, { source: 'direct' });
  person.perception = { people: [{ id: helper.id, visible: true, distance: 1, visibleSignals: { foodSurplus: true } }] };
  const result = resolveFoodAidRequest(world, person, helper);
  assert.equal(result.amount, 2.5);
  assert.equal(result.report.eventId, prior.eventId);
  assert.equal(person.socialMemories.find(m => m.rootEventId === prior.eventId).source, 'reported');
  assert.equal(helper.foodReserve, 97.5, 'reporting a previous gift does not transfer it again');
});

test('plan progress pins newly used evidence before memory pruning reaches the capacity limit', () => {
  const { world, person, helper } = fixture();
  const priorEvidence = [];
  for (let index = 0; index < 32; index++) {
    const fact = recordSocialFact(world, { idempotencyKey: 'pinned-memory-' + index, type: 'test_memory',
      participantIds: [person.id], witnessIds: [person.id], outcome: { index } });
    rememberSocialFact(world, person.id, fact.eventId, { source: 'direct', deferPrune: true });
    priorEvidence.push(fact.eventId);
  }
  const intention = defineSocialIntention(world, person.id, { type: 'prepare_migration', priority: .5,
    dueDay: world.day + 10, targetId: helper.id, evidenceIds: priorEvidence,
    steps: [{ action: 'reach_destination', targetId: helper.id }], endsWhen: 'destination_reached' });
  const response = recordSocialFact(world, { idempotencyKey: 'new-plan-evidence', type: 'test_response',
    participantIds: [person.id], witnessIds: [person.id], outcome: { result: 'observed' } });
  rememberSocialFact(world, person.id, response.eventId, { source: 'direct', deferPrune: true });

  const advanced = advanceSocialIntention(world, person.id, intention.intentionId,
    { progress: 1, evidenceIds: [response.eventId] });

  assert.ok(advanced.evidenceIds.includes(response.eventId));
  assert.ok(person.socialMemories.some(memory => memory.rootEventId === response.eventId));
});

test('a real food-aid transfer records intention progress when the requester is at the memory limit', () => {
  const { world, person, helper } = fixture();
  person.perception = { people: [{ id: helper.id, visible: true, distance: 1,
    visibleSignals: { foodSurplus: true } }] };
  const { intention } = ensureFoodAidPlan(world, person, helper);
  const priorEvidence = [];
  for (let index = 0; index < 32; index++) {
    const fact = recordSocialFact(world, { idempotencyKey: 'aid-memory-' + index, type: 'test_memory',
      participantIds: [person.id], witnessIds: [person.id], outcome: { index } });
    rememberSocialFact(world, person.id, fact.eventId, { source: 'direct', deferPrune: true });
    priorEvidence.push(fact.eventId);
  }
  advanceSocialIntention(world, person.id, intention.intentionId, { evidenceIds: priorEvidence });

  const result = resolveFoodAidRequest(world, person, helper);

  assert.equal(result.accepted, true);
  assert.equal(result.intention.status, 'completed');
  assert.ok(result.intention.evidenceIds.includes(result.response.eventId));
  assert.ok(person.socialMemories.some(memory => memory.rootEventId === result.response.eventId));
});
