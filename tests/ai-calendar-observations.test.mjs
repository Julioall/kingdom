import test from 'node:test';
import assert from 'node:assert/strict';
import engine from '../src/simulation/engine.js';
import { stripAbsoluteCalendarFields } from '../src/ai/observations.js';
import {
  observeKingdomStrategy, queueKingdomStrategicAiRequests, setStrategicAiEnabled
} from '../src/simulation/kingdoms/strategy.js';
import { queueCampaignGeneralAiRequests } from '../src/simulation/kingdoms/campaigns.js';

test('absolute date keys are removed recursively while relative durations remain', () => {
  const source = {
    day: 91,
    calendar: { year: 1, season: 0, dayOfSeason: 91, daysInSeason: 91 },
    campaign: {
      startedDay: 80,
      lastBattleDay: 90,
      evidence: [{ incidentDay: 88, reportDate: 'year-one-spring', location: { x: 4, y: 7 } }]
    },
    side: { shortageDays: 4, stalledDays: 2, ageDays: 600 }
  };

  assert.deepEqual(stripAbsoluteCalendarFields(source), {
    campaign: { evidence: [{ location: { x: 4, y: 7 } }] },
    side: { shortageDays: 4, stalledDays: 2, ageDays: 600 }
  });
});

function strategicRequest(day) {
  const world = engine.createWorld(42);
  world.day = day;
  const kingdom = world.kingdoms[0];
  setStrategicAiEnabled(world, true);
  world.strategicAI.nextDecisionDays[String(kingdom.id)] = day;

  const rawReport = observeKingdomStrategy(world, kingdom.id);
  assert.equal(queueKingdomStrategicAiRequests(world), 1);
  const request = world.strategicAI.requests.find(item => item.kingdomId === kingdom.id);
  return { rawReport, request };
}

test('kingdom strategy prompt is season-invariant but request expiry metadata stays internal', () => {
  const spring = strategicRequest(91);
  const summer = strategicRequest(92);

  assert.notEqual(spring.rawReport.calendar.season, summer.rawReport.calendar.season);
  assert.equal(spring.request.reportDay, 91);
  assert.equal(summer.request.reportDay, 92);
  assert.equal(spring.request.expiresDay, 139);
  assert.equal(summer.request.expiresDay, 140);
  assert.deepEqual(spring.request.context, summer.request.context);
  assert.deepEqual(spring.request.context, spring.request.observedFacts);
  assert.equal(Object.hasOwn(spring.request.context.report, 'day'), false);
  assert.equal(Object.hasOwn(spring.request.context.report, 'calendar'), false);
});

function generalRequest(day) {
  const world = engine.createWorld(42);
  world.day = day;
  const [attacker, defender] = world.kingdoms;
  const campaignId = 99001;
  const target = { x: defender.x, y: defender.y, ownerId: defender.id };
  const makeSide = (kingdom, role) => {
    const soldier = world.people.find(person => person.alive && person.role === 'soldier'
      && person.kingdomId === kingdom.id);
    assert.ok(soldier, 'seed 42 supplies a soldier for each kingdom');
    soldier.campaignId = campaignId;
    return {
      campaignId, kingdomId: kingdom.id, role, troopIds: [soldier.id],
      supply: { stock: { food: 35, wood: 8, gold: 4 } },
      supplyShortageDays: 4, stallDays: 2, morale: 72,
      aiOrder: { action: 'advance' }, orderVersion: 3, nextGeneralReviewDay: null,
      formation: { type: 'line', state: 'moving', metrics: { cohesion: .8, outsideSlots: 0 } }
    };
  };
  const campaign = {
    id: campaignId, attackerId: attacker.id, defenderId: defender.id, target,
    status: 'marching', startedDay: day - 8, lastBattleDay: day - 1, battleCount: 1,
    attacker: makeSide(attacker, 'attacker'), defender: makeSide(defender, 'defender'),
    evidence: {
      attacker: { incidentDay: day - 10, reportDay: day - 9, source: 'patrulha', location: target },
      defender: { incidentDay: day - 10, reportDay: day - 8, source: 'guarnição', location: target }
    }
  };
  world.campaigns = [campaign];
  world.strategicAI = { enabled: true };

  assert.equal(queueCampaignGeneralAiRequests(world, day), 2);
  return world.campaignGeneralAi.requests;
}

test('campaign general prompts omit absolute dates and retain relative supply/stall durations', () => {
  const springRequests = generalRequest(91);
  const summerRequests = generalRequest(92);
  assert.equal(springRequests.length, 2);
  assert.equal(summerRequests.length, 2);
  for (let index = 0; index < 2; index++) {
    const spring = springRequests[index];
    const summer = summerRequests[index];
    assert.equal(spring.reportDay, 91);
    assert.equal(summer.reportDay, 92);
    assert.deepEqual(spring.context, summer.context);
    assert.deepEqual(spring.context, spring.observedFacts);
    assert.equal(Object.hasOwn(spring.observedFacts, 'day'), false);
    assert.equal(Object.hasOwn(spring.observedFacts.campaign, 'startedDay'), false);
    assert.equal(Object.hasOwn(spring.observedFacts.campaign, 'lastBattleDay'), false);
    assert.equal(Object.hasOwn(spring.observedFacts.evidence, 'incidentDay'), false);
    assert.equal(spring.observedFacts.side.shortageDays, 4);
    assert.equal(spring.observedFacts.side.stalledDays, 2);
  }
});
