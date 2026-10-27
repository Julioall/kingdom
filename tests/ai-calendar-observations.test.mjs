import test from 'node:test';
import assert from 'node:assert/strict';
import engine from '../src/simulation/engine.js';
import { DAILY_FOOD_NEED, FOOD_RESERVE_PER_UNIT, PLANTS } from '../src/config/ecosystem.js';
import { stripAbsoluteCalendarFields } from '../src/ai/observations.js';
import {
  kingdomStrategyChoices, observeKingdomStrategy, queueKingdomStrategicAiRequests, setStrategicAiEnabled
} from '../src/simulation/kingdoms/strategy.js';
import { queueCampaignGeneralAiRequests } from '../src/simulation/kingdoms/campaigns.js';
import { buildKingdomStrategySystemPrompt } from '../src/ai/kingdom-strategy-prompt.js';
import { assignCommunityTasks, assignKingdomFoodSupportTasks, completeCommunityTask } from '../src/simulation/society/governance.js';
import { communityFoodBufferDays, communityFoodBufferTarget, foodUnitsPerDay } from '../src/simulation/economy/food-policy.js';

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

function strategicRequest(day, prepare = null) {
  const world = engine.createWorld(42);
  world.day = day;
  const kingdom = world.kingdoms[0];
  const community = world.communities.find(item => item.id === kingdom.communityId);
  prepare?.({ world, kingdom, community });
  setStrategicAiEnabled(world, true);
  world.strategicAI.nextDecisionDays[String(kingdom.id)] = day;

  const rawReport = observeKingdomStrategy(world, kingdom.id);
  assert.equal(queueKingdomStrategicAiRequests(world), 1);
  const request = world.strategicAI.requests.find(item => item.kingdomId === kingdom.id);
  return { world, kingdom, community, rawReport, request };
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
  assert.ok(spring.request.context.decisionGuidance.some(rule => rule.includes('Roça')));
  assert.equal(spring.request.context.report.community.foodInfrastructure.completedCorrals, 1);
  assert.equal(spring.request.context.report.community.foodInfrastructure.sheepCapacity, 35);
  assert.equal(spring.rawReport.community.foodBufferTargetDays, 180);
  assert.equal(spring.rawReport.community.foodBufferTarget,
    communityFoodBufferTarget(spring.rawReport.community.dailyFoodNeed));
  assert.equal(spring.request.context.report.community.foodBufferDays, spring.rawReport.community.foodBufferDays);
});

test('food reserves use raw stock units and a demand-based six-month buffer', () => {
  const dailyReservePoints = 50 * DAILY_FOOD_NEED;
  const dailyRawUnits = foodUnitsPerDay(dailyReservePoints);
  const target = communityFoodBufferTarget(dailyReservePoints);

  assert.equal(dailyRawUnits, dailyReservePoints / FOOD_RESERVE_PER_UNIT);
  assert.ok(target > 300, 'the target has useful slack above the observed 300-unit failure threshold');
  assert.equal(communityFoodBufferDays(300, dailyReservePoints), 300 / dailyRawUnits);
  assert.ok(Math.abs(communityFoodBufferDays(target, dailyReservePoints) - 180) < .001);
});

test('kingdom forage policy stops repeating once the observed six-month buffer is reached', () => {
  const { rawReport } = strategicRequest(91);
  rawReport.community.marketFoodTradeable = false;
  rawReport.community.foodBufferDays = 179.99;
  assert.ok(kingdomStrategyChoices(rawReport).some(choice => choice.id === 'forage_for_food'));

  rawReport.community.foodBufferDays = 180;
  assert.ok(!kingdomStrategyChoices(rawReport).some(choice => choice.id === 'forage_for_food'));
});

test('kingdom AI keeps feasible food-production options available during a shortage', () => {
  const { rawReport } = strategicRequest(91);
  rawReport.community.foodPerResident = 1;
  rawReport.community.marketFoodTradeable = false;
  rawReport.community.constructionReady = true;
  rawReport.community.safeBuilderAvailable = true;
  rawReport.community.foodInfrastructure.nextBuildType = 'roça';
  rawReport.community.foodInfrastructure.nextBuildReady = true;
  rawReport.community.foodInfrastructure.openPenSlots = 35;
  rawReport.community.foodInfrastructure.visibleWildSheepCount = 2;

  const ids = kingdomStrategyChoices(rawReport).map(choice => choice.id);
  assert.ok(ids.includes('forage_for_food'), 'immediate food remains an option');
  assert.ok(ids.includes('build_food_field'), 'the ruler can invest in a feasible food field despite the shortage');
  assert.ok(ids.includes('capture_sheep'), 'capture is offered only with visible sheep and free pen capacity');

  rawReport.community.foodInfrastructure.openPenSlots = 0;
  assert.ok(!kingdomStrategyChoices(rawReport).some(choice => choice.id === 'capture_sheep'));
});

test('king receives aggregate crop production and active/blocked royal order status', () => {
  const cropIndex = PLANTS.findIndex(plant => plant.id === 'cultivated-root');
  const { rawReport, request } = strategicRequest(91, ({ world, kingdom, community }) => {
    const fieldTile = world.tiles.find(tile => tile.terrain === 'land' && tile.cropFieldId == null);
    const field = { id: 99001, type: 'roça', communityId: community.id, complete: true,
      fieldTileIndices: [fieldTile.i], cropHarvested: 18 };
    fieldTile.cropFieldId = field.id;
    fieldTile.plants.fill(0);
    fieldTile.plants[cropIndex] = 6;
    world.structures.push(field);
    const worker = world.people.find(person => person.alive && person.communityId === community.id
      && person.role !== 'soldier' && person.id !== kingdom.rulerId && !person.assignment);
    worker.assignment = { source: 'kingdom-strategy', communityId: community.id, action: 'forage',
      goal: 'secure-shared-food', assignedDay: 88, expiresDay: 100,
      supplyPhase: 'communal-delivery', pauseReason: 'rota lenta' };
    kingdom.strategy = { lastOutcome: { status: 'blocked', day: 88, goal: 'secure-shared-food',
      action: 'forage', reason: 'A carga ainda não chegou à reserva comum.' },
    history: [{ status: 'blocked', day: 88, goal: 'secure-shared-food', action: 'forage', reason: 'entrega pendente' }] };
  });

  const food = rawReport.community.foodInfrastructure;
  assert.equal(food.completedFields, 1);
  assert.equal(food.plantedFieldCount, 1);
  assert.equal(food.standingCropBiomass, 6);
  assert.equal(food.harvestableCropPotential, 6);
  assert.equal(food.harvestedCropToDate, 18);
  assert.deepEqual(rawReport.community.activeRoyalOrders, [{
    goal: 'secure-shared-food', action: 'forage', workers: 1, pausedWorkers: 1,
    longestActiveDays: 3, phases: ['communal-delivery']
  }]);
  assert.equal(rawReport.community.lastRoyalOutcome.status, 'blocked');
  assert.equal(rawReport.community.lastRoyalOutcome.daysAgo, 3);
  assert.equal(request.context.report.community.foodInfrastructure.standingCropBiomass, 6);
  assert.equal(request.context.report.community.lastRoyalOutcome.status, 'blocked');
  assert.equal('personId' in request.context.report.community.activeRoyalOrders[0], false);
});

test('kingdom model prompt explains farm, corral, and blocked-order constraints', () => {
  const prompt = buildKingdomStrategySystemPrompt(['forage_for_food', 'build_food_field', 'capture_sheep']);
  assert.match(prompt, /biomassa em pé e colheita histórica não são estoque/i);
  assert.match(prompt, /até 35 ovelhas/i);
  assert.match(prompt, /tarefa bloqueada/i);
  assert.match(prompt, /buffer de 180 dias/i);
  assert.match(prompt, /retira o lote inteiro/i);
  assert.match(prompt, /forage_for_food, build_food_field, capture_sheep/);
});

test('kingdom sheep choice can delegate the existing capture-and-lead pawn task', () => {
  const world = engine.createWorld(42);
  const kingdom = world.kingdoms[0];
  const community = world.communities.find(item => item.id === kingdom.communityId);
  const members = community.memberIds.map(id => world.people.find(person => person.id === id && person.alive)).filter(Boolean);
  const leader = members.find(person => person.id === community.leaderId);
  const worker = members.find(person => person.role !== 'soldier' && person.id !== leader.id
    && person.ageDays >= 12 * 365 && !person.assignment);
  const sheep = world.animals.find(animal => animal.alive && animal.speciesId === 'sheep'
    && animal.herdCommunityId == null && !animal.beingLedBy);
  assert.ok(worker && sheep, 'the seed supplies a resident and a wild sheep');
  worker.perception ||= {};
  worker.perception.animals = [{ id: sheep.id, speciesId: 'sheep', visible: true, distance: 2 }];

  assignCommunityTasks(world, community, leader, members, {
    action: 'capture_sheep', title: 'conduzir ovelha ao curral', skill: 'care',
    goal: 'expand-managed-herd', source: 'kingdom-strategy'
  }, false);

  assert.equal(worker.assignment?.action, 'capture_sheep');
  assert.equal(worker.assignment?.source, 'kingdom-strategy');
});

test('one royal field assignment stays active until the shared stock reaches its per-resident target', () => {
  const leader = { id: 1, alive: true, name: 'Rei', prestige: 0 };
  const worker = { id: 2, alive: true, name: 'Aru', communityId: 3, prestige: 0, assignment: {
    action: 'deliver', title: 'entregar lote da roça', goal: 'secure-shared-food', foodFieldId: 7,
    source: 'kingdom-strategy', communityId: 3, expiresDay: 9
  } };
  const community = { id: 3, kingdomId: 4, leaderId: 1, memberIds: Array.from({ length: 50 }, (_, index) => index + 1), stores: { food: 24 },
    history: [], assignments: [{ personId: 2, status: 'delegada' }] };
  const kingdom = { id: 4, name: 'Valedouro', strategy: { history: [] } };
  const world = { day: 2, people: [leader, worker], communities: [community], kingdoms: [kingdom], events: [] };

  assert.equal(completeCommunityTask(world, worker, 'deliver',
    { food: 0, feed: 0, wood: 0, stone: 0, gold: 0 },
    { food: 24, feed: 0, wood: 0, stone: 0, gold: 0 }), false);
  assert.equal(worker.assignment.action, 'forage');
  assert.equal(community.assignments[0].status, 'delegada');

  community.stores.food = 400;
  assert.equal(completeCommunityTask(world, worker, 'deliver',
    { food: 24, feed: 0, wood: 0, stone: 0, gold: 0 },
    { food: 100, feed: 0, wood: 0, stone: 0, gold: 0 }), true);
  assert.equal(worker.assignment, null);
  assert.equal(community.assignments[0].status, 'concluída');
  assert.equal(kingdom.strategy.lastOutcome.status, 'completed');
});

test('a standard field batch sizes harvest assignments for 49, 50, and 51 residents', () => {
  for (const population of [49, 50, 51]) {
    const leader = { id: 1, alive: true, name: 'Rei', communityId: 3, ageDays: 40 * 365 };
    const members = [leader, ...Array.from({ length: population - 1 }, (_, index) => ({
      id: index + 2, alive: true, name: 'Morador ' + (index + 2), communityId: 3,
      ageDays: 30 * 365, hydration: 100, energy: 100, health: 100, foodReserve: 100,
      skills: { forage: .5 }
    }))];
    const community = { id: 3, kingdomId: 4, isKingdomGroup: true, leaderId: leader.id,
      memberIds: members.map(person => person.id), assignments: [], history: [], stores: { food: 0 } };
    const field = { id: 7, type: 'roça', complete: true, communityId: 3, cropCycleState: 'ready', cropYieldTarget: 10_000 };
    members[1].assignment = { action: 'forage', title: 'colher a roça', goal: 'secure-shared-food',
      source: 'kingdom-strategy', priority: 'urgent', communityId: 3, assignedDay: -2, expiresDay: 9, foodFieldId: 7 };
    const world = { day: 1, people: members, structures: [field], communities: [community], kingdoms: [] };

    assignCommunityTasks(world, community, leader, members, {
      action: 'forage', title: 'colher a roça', skill: 'forage', goal: 'secure-shared-food',
      priority: 'urgent', source: 'kingdom-strategy'
    }, false);

    const assigned = members.filter(person => person.assignment?.goal === 'secure-shared-food');
    assert.equal(assigned.length, 4, population + ' moradores should assign a four-worker team to harvest the standard field batch');
    assert.equal(members[1].assignment.assignedDay, -2, 'an active pawn order is retained instead of duplicated');
    assert.equal(community.assignments.some(record => record.personId === members[1].id), false);
    assert.ok(assigned.length * 2_500 >= 10_000, 'the assigned harvest team can clear one standard field batch');
  }
});

test('food support assigns harvesters alongside a separate active field builder', () => {
  const members = Array.from({ length: 50 }, (_, index) => ({
    id: index + 1, alive: true, communityId: 3, ageDays: 30 * 365, role: 'resident',
    hydration: 100, energy: 100, health: 100, foodReserve: 80, skills: { forage: .5 }
  }));
  const leader = members[0];
  const builder = members[1];
  builder.assignment = { source: 'kingdom-strategy', goal: 'invest-in-cultivated-food', action: 'build',
    communityId: 3, expiresDay: 8 };
  const community = { id: 3, kingdomId: 4, isKingdomGroup: true, leaderId: leader.id,
    memberIds: members.map(person => person.id), assignments: [], history: [], stores: { food: 0 } };
  const field = { id: 7, type: 'roça', complete: true, communityId: 3, cropCycleState: 'ready', cropYieldTarget: 10_000 };
  const world = { day: 1, people: members, structures: [field], communities: [community], kingdoms: [] };

  const addedFoodWorkers = assignKingdomFoodSupportTasks(world, community, leader, members);
  const foodWorkers = members.filter(person => person.assignment?.goal === 'secure-shared-food');

  assert.equal(addedFoodWorkers, 3, 'the four-worker harvest team reserves one slot for the active builder');
  assert.equal(foodWorkers.length, 3);
  assert.equal(builder.assignment.goal, 'invest-in-cultivated-food');
  assert.ok(foodWorkers.every(person => person.assignment.foodFieldId === field.id));
  assert.equal(assignKingdomFoodSupportTasks(world, community, leader, members), 0,
    'a second support pass does not duplicate active food assignments');
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
