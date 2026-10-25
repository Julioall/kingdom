import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../../src/simulation/engine.js';
import { bestPeopleFoodCell, updateKingdomFoodSupplyPhase } from '../../src/simulation/individuals/actions.js';
import { HUMAN_FOOD } from '../../src/config/ecosystem.js';
import { cellAt } from '../../src/simulation/world/spatial.js';
import { canPatrolToday } from '../../src/simulation/kingdoms/patrols.js';
import { assignCommunityTasks, completeCommunityTask, updateCommunityGovernance } from '../../src/simulation/society/governance.js';
import { workOnCommunityStructure } from '../../src/simulation/settlements/construction.js';
import { kingdomStrategyChoices } from '../../src/simulation/kingdoms/strategy.js';

function strategyReport(seed = 42) {
  const world = Sim.createWorld(seed);
  const kingdom = world.kingdoms[0];
  return { world, kingdom, report: Sim.modules.KingdomStrategy.observe(world, kingdom.id) };
}

function ongoingProjectScenario(seed = 42) {
  const world = Sim.createWorld(seed);
  const kingdom = world.kingdoms[0];
  const community = world.communities.find(item => item.id === kingdom.communityId);
  const leader = world.people.find(person => person.id === kingdom.rulerId);
  const builder = world.people.find(person => person.role === 'resident' && person.communityId === community.id
    && person.id !== leader.id);
  const project = { id: world.nextId++, type: 'posto de coleta', kingdomId: kingdom.id, communityId: community.id,
    x: 5, y: 5, complete: false, progress: 3, required: 36, createdDay: 1, lastProgressDay: 4,
    woodCost: 20, stoneCost: 12, foodCost: 1 };
  world.structures.push(project);
  community.stores.food = 0;
  community.stores.wood = 20;
  community.stores.stone = 12;
  community.lastGovernanceDay = 0;
  kingdom.treasury.stock.food = 0;
  kingdom.market.stock.food = 0;
  world.day = 8;
  return { world, kingdom, community, leader, builder, project };
}

test('kingdom reports expose aggregate evidence and produce deterministic fallback plans', () => {
  const first = strategyReport(42);
  const second = strategyReport(42);
  const report = first.report;
  assert.equal(report.population, first.world.people.filter(person => person.alive && person.kingdomId === first.kingdom.id).length);
  assert.equal(report.community.sharedFood, 0);
  assert.equal(report.community.foodPerResident, 0);
  assert.equal(Object.hasOwn(report, 'people'), false);
  assert.equal(Object.hasOwn(report, 'personIds'), false);
  assert.equal(Object.hasOwn(report, 'needs'), false);
  assert.deepEqual(report, second.report);
  assert.deepEqual(Sim.modules.KingdomStrategy.plan(report), Sim.modules.KingdomStrategy.plan(second.report));
  assert.equal(Sim.modules.KingdomStrategy.plan(report).action, 'forage');
});

test('the king observes damaged fortifications and prioritizes a funded repair', () => {
  const { world, kingdom } = strategyReport(42);
  const community = world.communities.find(item => item.id === kingdom.communityId);
  const tower = world.structures.find(item => item.kingdomId === kingdom.id && item.type === 'torre');
  community.stores.food = 1200;
  kingdom.treasury.stock.wood = 12;
  kingdom.treasury.stock.stone = 8;
  tower.integrity = .4;
  tower.health = tower.maxHealth * .35;

  const report = Sim.modules.KingdomStrategy.observe(world, kingdom.id);
  assert.equal(report.community.repairs.damagedStructureCount, 1);
  assert.equal(report.community.repairs.criticalStructureCount, 1);
  assert.deepEqual(report.community.repairs.damagedStructures[0], {
    id: tower.id, type: 'torre', integrity: .4, healthRatio: .35, x: tower.x, y: tower.y
  });
  assert.equal(report.community.repairs.repairReady, true);
  assert.equal(Sim.modules.KingdomStrategy.plan(report).goal, 'repair-damaged-structures');
  assert.ok(kingdomStrategyChoices(report).some(choice => choice.id === 'repair_damaged_structures'));
});

test('the king delegates a damaged structure repair and pays its finite material cost', () => {
  const { world, kingdom } = strategyReport(42);
  const community = world.communities.find(item => item.id === kingdom.communityId);
  const leader = world.people.find(person => person.id === kingdom.rulerId);
  const tower = world.structures.find(item => item.kingdomId === kingdom.id && item.type === 'torre');
  const worker = world.people.find(person => person.role === 'resident' && person.communityId === community.id
    && person.id !== leader.id);
  for (const person of world.people.filter(item => item.communityId === community.id && item.id !== leader.id)) {
    Object.assign(person, { energy: 0, hydration: 0, foodReserve: 0, assignment: null });
  }
  Object.assign(community, { stores: { ...community.stores, food: 1200 } });
  Object.assign(kingdom.treasury.stock, { wood: 12, stone: 8 });
  Object.assign(tower, { integrity: .6, health: tower.maxHealth * .5 });
  Object.assign(worker, { ageDays: 20 * 365, energy: 80, hydration: 80, health: 80, foodReserve: 80,
    buildCooldown: 0, x: tower.x, y: tower.y, assignment: null });
  world.day = 20;

  const report = Sim.modules.KingdomStrategy.observe(world, kingdom.id);
  assignCommunityTasks(world, community, leader, world.people.filter(person => person.communityId === community.id), {
    action: 'build', goal: 'repair-damaged-structures', source: 'kingdom-strategy',
    title: 'reparar construções danificadas', skill: 'build', priority: 'urgent'
  }, false);
  assert.equal(worker.assignment?.goal, 'repair-damaged-structures');
  assert.equal(report.community.repairs.repairReady, true);

  const beforeHealth = tower.health;
  workOnCommunityStructure(world, worker, community, community.memberIds.length);
  kingdom.strategy = { history: [] };
  assert.equal(completeCommunityTask(world, worker, 'build', { buildProgress: 0, repairProgress: 1 },
    { buildProgress: 0, repairProgress: 1.1 }), true);

  assert.equal(kingdom.treasury.stock.wood, 9);
  assert.equal(kingdom.treasury.stock.stone, 6);
  assert.equal(tower.integrity, .7);
  assert.equal(tower.health, beforeHealth + tower.maxHealth * .12);
  assert.equal(tower.lastRepairDay, world.day);
  assert.equal(worker.assignment, null);
  assert.equal(kingdom.strategy.lastOutcome.status, 'completed');
  assert.ok(world.events.some(event => event.text.includes('reparou torre')));
});

test('a roça investment delegates a builder whose movement cooldown will expire during the assignment', () => {
  const { world, kingdom } = strategyReport();
  const community = world.communities.find(item => item.id === kingdom.communityId);
  const leader = world.people.find(person => person.id === kingdom.rulerId);
  world.structures.push({ id: world.nextId++, type: 'abrigo', kingdomId: kingdom.id, communityId: community.id,
    x: community.x, y: community.y, complete: true, builtDay: 0, fruitStored: 0, meatStored: 0 });
  community.stores.wood = 16;
  community.stores.stone = 6;
  community.stores.food = 0;
  community.lastBuildDay = -24;
  for (const person of world.people.filter(item => item.communityId === community.id && item.id !== leader.id)) {
    // A resident moving toward a construction site carries cooldown 2. It ticks
    // down before each daily action, while the strategic assignment remains live.
    Object.assign(person, { ageDays: 20 * 365, foodReserve: 70, hydration: 80, energy: 80, health: 80, buildCooldown: 2 });
    person.assignment = null;
  }

  const report = Sim.modules.KingdomStrategy.observe(world, kingdom.id);
  assert.equal(report.community.buildPlan.type, 'roça');
  assert.equal(report.community.constructionReady, true);
  assignCommunityTasks(world, community, leader, world.people.filter(item => item.communityId === community.id), {
    action: 'build', title: 'construir uma roça e semear raízes', skill: 'build',
    goal: 'invest-in-cultivated-food', source: 'kingdom-strategy'
  }, false);

  const builders = world.people.filter(person => person.assignment && person.assignment.source === 'kingdom-strategy'
    && person.assignment.action === 'build' && person.assignment.goal === 'invest-in-cultivated-food');
  assert.equal(builders.length, 1);
});

test('kingdom strategy delegates a market barter when shared food is low and finite food stock is reachable', () => {
  const { world, kingdom } = strategyReport(42);
  const community = world.communities.find(item => item.id === kingdom.communityId);
  community.stores.wood = 30;
  kingdom.market.stock.food = 168;
  kingdom.treasury.stock.food = 0;

  const report = Sim.modules.KingdomStrategy.observe(world, kingdom.id);
  assert.equal(report.community.marketFoodTradeable, true);
  assert.equal(report.market.foodStock, 168);
  assert.equal(Sim.modules.KingdomStrategy.plan(report).action, 'trade');

  Sim.stepDay(world);
  assert.equal(kingdom.strategy.goal, 'trade-for-shared-food');
  assert.ok(world.people.some(person => person.assignment && person.assignment.source === 'kingdom-strategy'
    && person.assignment.action === 'trade' && person.role === 'resident'));
});

test('a replaceable kingdom planner delegates only to resident workers and leaves individual brains intact', () => {
  const { world, kingdom } = strategyReport(7);
  const community = world.communities.find(item => item.id === kingdom.communityId);
  const person = world.people.find(item => item.role === 'resident' && item.communityId === community.id);
  const brainBefore = structuredClone(person.brain);
  const seenReports = [];
  const planner = report => {
    seenReports.push(report);
    return { goal: 'test-food-order', action: 'forage', priority: 'normal', garrisonMode: 'standby', reason: 'teste da política substituível' };
  };
  const soldier = world.people.find(item => item.role === 'soldier' && item.kingdomId === kingdom.id);
  soldier.foodReserve = 100;
  soldier.hydration = 100;
  soldier.energy = 100;
  soldier.health = 100;
  soldier.injury = 0;
  const post = world.structures.find(item => item.id === soldier.militaryDutyCenterId);
  soldier.x = post.x;
  soldier.y = post.y;
  world.day = (1 - soldier.id % 3 + 3) % 3;
  assert.equal(canPatrolToday(world, soldier, false), true, 'the starting garrison is authorized to patrol');

  Sim.modules.KingdomStrategy.update(world, planner);
  assert.deepEqual(person.brain, brainBefore, 'strategy selection does not replace or rewrite the individual controller');
  Sim.stepDay(world);

  const assigned = world.people.filter(item => item.assignment && item.assignment.source === 'kingdom-strategy'
    && item.assignment.communityId === community.id);
  assert.ok(seenReports.length > 0);
  assert.ok(assigned.length > 0, 'the report-based order reaches community workers');
  assert.ok(assigned.every(item => item.role === 'resident'), 'soldiers stay with the garrison');
  assert.equal(kingdom.strategy.goal, 'test-food-order');
  assert.equal(kingdom.strategy.garrisonMode, 'standby');
  assert.equal(canPatrolToday(world, soldier, false), false, 'the replaceable strategy can change garrison posture');
});

test('invalid strategic tasks are refused with a reason and deterministic fallback', () => {
  const { world, kingdom } = strategyReport(19);
  kingdom.treasury.stock.wood = 0;
  kingdom.treasury.stock.stone = 0;
  const invalidPlanner = () => ({ goal: 'build-now', action: 'build', priority: 'urgent', reason: 'attempt without reported supplies' });
  Sim.modules.KingdomStrategy.update(world, invalidPlanner);

  assert.equal(kingdom.strategy.action, 'forage');
  assert.equal(kingdom.strategy.lastOutcome.status, 'refused');
  assert.match(kingdom.strategy.lastOutcome.reason, /estoques|autorizada/i);
  assert.ok(world.events.some(entry => entry.text.includes('fallback determinístico')));
});

test('one day records a report-based kingdom objective and worker delegation in the chronicle', () => {
  const world = Sim.createWorld(42);
  Sim.stepDay(world);
  const kingdom = world.kingdoms[0];
  const community = world.communities.find(item => item.id === kingdom.communityId);
  const delegated = world.people.filter(person => person.assignment && person.assignment.source === 'kingdom-strategy'
    && person.assignment.communityId === community.id);
  assert.equal(kingdom.strategy.goal, 'invest-in-cultivated-food');
  assert.ok(delegated.length > 0);
  assert.ok(world.events.some(entry => entry.text.includes('definiu o objetivo invest-in-cultivated-food')));
  assert.ok(community.history.some(entry => entry.includes('definiu o objetivo invest-in-cultivated-food')));
});

test('blocked shared-food delegation explains occupied, depleted, and unobserved workers', () => {
  const world = Sim.createWorld(42);
  world.day = 8;
  const kingdom = world.kingdoms[0];
  const community = world.communities.find(item => item.id === kingdom.communityId);
  const leader = world.people.find(person => person.id === kingdom.rulerId);
  const members = world.people.filter(person => person.alive && person.communityId === community.id);
  for (const person of members) {
    Object.assign(person, { ageDays: 20 * 365, hydration: 80, energy: 80, health: 80, foodReserve: 60, assignment: null });
    person.perception = { ...(person.perception || {}), resources: [] };
  }
  const workers = members.filter(person => person.role !== 'soldier');
  const occupied = workers.find(person => person.id !== leader.id);
  const depleted = workers.find(person => person.id !== leader.id && person.id !== occupied.id);
  occupied.assignment = { action: 'gather', expiresDay: 9 };
  depleted.foodReserve = 10;
  kingdom.strategy = { goal: 'secure-shared-food', action: 'forage', history: [] };

  assignCommunityTasks(world, community, leader, members, {
    action: 'forage', title: 'repor a reserva comum de alimento', skill: 'forage',
    goal: 'secure-shared-food', priority: 'urgent', source: 'kingdom-strategy'
  }, false);

  const outcome = kingdom.strategy.lastOutcome;
  assert.equal(outcome.status, 'blocked');
  assert.equal(outcome.workforce.eligibleWorkers, 0);
  assert.equal(outcome.workforce.activeAssignments, 1);
  assert.equal(outcome.workforce.belowFoodReserve, 1);
  assert.ok(outcome.workforce.noFoodPerceivedWithinFive > 0);
  assert.match(outcome.reason, /atribuição ativa/);
  assert.match(outcome.reason, /limites pessoais/);
  assert.match(outcome.reason, /alimento percebido em até 5 células/);
  assert.ok(world.events.some(entry => entry.text.includes(outcome.reason)));
});

test('blocked communal forage diagnoses perceived food below the energy cutoff without assigning it', () => {
  const setup = seed => {
    const world = Sim.createWorld(seed);
    world.day = 8;
    const kingdom = world.kingdoms[0];
    const community = world.communities.find(item => item.id === kingdom.communityId);
    const leader = world.people.find(person => person.id === kingdom.rulerId);
    const members = world.people.filter(person => person.alive && person.communityId === community.id);
    for (const person of members) {
      Object.assign(person, { ageDays: 20 * 365, hydration: 80, energy: 5, health: 80, foodReserve: 60, assignment: null });
      person.perception = { ...(person.perception || {}), resources: [] };
    }
    const lowEnergy = members.find(person => person.role !== 'soldier' && person.id !== leader.id);
    const safeWorker = members.find(person => person.role !== 'soldier' && person.id !== leader.id && person.id !== lowEnergy.id);
    const food = Object.fromEntries(HUMAN_FOOD.map(id => [id, 100]));
    const perceivedFood = person => ({ resources: [{ x: Math.round(person.x), y: Math.round(person.y), distance: 0,
      slope: 0, terrain: 'land', visible: true, biomass: food, harvestableBiomass: food }] });
    Object.assign(lowEnergy, { energy: 12, skills: { ...lowEnergy.skills, forage: 0 }, perception: perceivedFood(lowEnergy) });
    kingdom.strategy = { goal: 'secure-shared-food', action: 'forage', history: [] };
    return { world, kingdom, community, leader, members, lowEnergy, safeWorker, perceivedFood };
  };

  const urgent = setup(42);
  Object.assign(urgent.safeWorker, { energy: 80, skills: { ...urgent.safeWorker.skills, forage: 0 },
    perception: urgent.perceivedFood(urgent.safeWorker) });
  const firstNewDelegation = urgent.community.assignments.length;
  assignCommunityTasks(urgent.world, urgent.community, urgent.leader, urgent.members, {
    action: 'forage', title: 'repor a reserva comum', skill: 'forage', goal: 'secure-shared-food',
    priority: 'urgent', source: 'kingdom-strategy'
  }, false);
  const delegationOrder = urgent.community.assignments.slice(firstNewDelegation);
  assert.deepEqual(delegationOrder.map(item => item.personId), [urgent.safeWorker.id]);
  assert.equal(urgent.lowEnergy.assignment, null, 'urgent forage also preserves the energy floor');

  const urgentBlocked = setup(43);
  assignCommunityTasks(urgentBlocked.world, urgentBlocked.community, urgentBlocked.leader, urgentBlocked.members, {
    action: 'forage', title: 'repor a reserva comum', skill: 'forage', goal: 'secure-shared-food',
    priority: 'urgent', source: 'kingdom-strategy'
  }, false);
  assert.equal(urgentBlocked.lowEnergy.assignment, null);
  assert.equal(urgentBlocked.kingdom.strategy.lastOutcome.status, 'blocked');
  assert.equal(urgentBlocked.kingdom.strategy.lastOutcome.workforce.eligibleWorkers, 0);
  assert.equal(urgentBlocked.kingdom.strategy.lastOutcome.workforce.energy8To14WithFoodPerceived, 1);
  assert.match(urgentBlocked.kingdom.strategy.lastOutcome.reason, /8 < energia < 14 e alimento percebido/);

  const normal = setup(44);
  assignCommunityTasks(normal.world, normal.community, normal.leader, normal.members, {
    action: 'forage', title: 'repor a reserva comum', skill: 'forage', goal: 'secure-shared-food',
    priority: 'normal', source: 'kingdom-strategy'
  }, false);
  assert.equal(normal.lowEnergy.assignment, null, 'normal forage keeps the energy cutoff');
  assert.equal(normal.kingdom.strategy.lastOutcome.status, 'blocked');
});

test('autonomous reinforcement lets the civil reserve refill before spending on a soldier', () => {
  const world = Sim.createWorld(42);
  const kingdom = world.kingdoms[0];
  const community = world.communities.find(item => item.id === kingdom.communityId);
  community.stores.food = 0;
  kingdom.treasury.stock.food = 12;
  kingdom.treasury.stock.wood = 50;
  kingdom.treasury.stock.gold = 58;
  kingdom.militaryIntel = [{ day: 0, kind: 'force-requested', status: 'pending', warId: 9010, opponentId: world.kingdoms[1].id }];

  Sim.modules.KingdomStrategy.update(world);

  assert.equal(kingdom.treasury.stock.food, 0);
  assert.ok(community.stores.food > 0, 'reserve dispatch runs before considering military recruitment');
  assert.equal(kingdom.militaryRecruitments, undefined);
  assert.equal(world.people.some(person => person.recruitmentOrder?.kingdomId === kingdom.id), false);
});

test('shared meals are held for residents below the personal food pressure threshold', () => {
  const world = Sim.createWorld(42);
  const kingdom = world.kingdoms[0];
  const community = world.communities.find(item => item.id === kingdom.communityId);
  const residents = world.people.filter(person => person.alive && person.communityId === community.id);
  const resident = residents.find(person => person.role === 'resident' && person.ageDays >= 12 * 365);
  community.stores.food = 48;
  kingdom.treasury.stock.food = 0;
  for (const person of residents) {
    person.ageDays = Math.max(person.ageDays, 12 * 365);
    person.foodReserve = 100;
  }

  Sim.stepDay(world);
  assert.equal(community.stores.food, 48, 'residents with full personal reserves do not consume the common stock');

  resident.foodReserve = 41;
  Sim.stepDay(world);

  assert.ok(resident.sharedMeals > 0, 'a resident under food pressure receives a shared meal');
  assert.ok(community.stores.food < 48, 'the shared meal is debited from the finite community store');
});

test('hungry residents keep a profitable forage target while moving toward it', () => {
  const world = Sim.createWorld(42);
  Sim.stepDay(world);
  const person = world.people.find(item => item.alive && item.role === 'resident' && item.ageDays >= 12 * 365);
  const safeResources = person.perception.resources.filter(resource => resource.visible && resource.terrain === 'land'
    && (cellAt(world, resource.x, resource.y)?.kingdomId == null
      || cellAt(world, resource.x, resource.y)?.kingdomId === person.kingdomId));
  assert.ok(safeResources.length >= 2, 'the resident sees multiple legal land food locations');
  const target = safeResources[0];
  const alternative = safeResources.find(resource => resource.x !== target.x || resource.y !== target.y);
  const abundantFood = Object.fromEntries(HUMAN_FOOD.map(id => [id, 100]));
  person.foodReserve = 10;
  person.foodTarget = { x: target.x, y: target.y };
  person.perception.resources = [
    { ...target, distance: 3, slope: 0, biomass: abundantFood, harvestableBiomass: abundantFood },
    { ...alternative, distance: 2, slope: 0, biomass: abundantFood, harvestableBiomass: abundantFood }
  ];

  const continued = bestPeopleFoodCell(world, person, 8);
  assert.deepEqual({ x: continued.x, y: continued.y }, { x: target.x, y: target.y },
    'a one-tile-nearer alternative does not discard a productive target already being approached');

  person.foodTarget = { x: target.x, y: target.y };
  person.foodReserve = 60;
  const wellFedChoice = bestPeopleFoodCell(world, person, 8);
  assert.deepEqual({ x: wellFedChoice.x, y: wellFedChoice.y }, { x: alternative.x, y: alternative.y },
    'residents above food pressure do not receive the target-continuity bonus');

  person.foodReserve = 10;
  person.foodTarget = { x: target.x, y: target.y };
  person.perception.resources[0] = { ...person.perception.resources[0], biomass: { [HUMAN_FOOD[0]]: .8 },
    harvestableBiomass: { [HUMAN_FOOD[0]]: .8 } };
  const depletedChoice = bestPeopleFoodCell(world, person, 8);
  assert.deepEqual({ x: depletedChoice.x, y: depletedChoice.y }, { x: alternative.x, y: alternative.y },
    'a target whose remaining yield cannot cover the trip loses its continuity bonus');
});

test('shared-food orders expose personal recovery, communal collection, and delivery phases', () => {
  const world = Sim.createWorld(42);
  const community = world.communities.find(item => item.isKingdomGroup);
  const person = world.people.find(item => item.role === 'resident' && item.communityId === community.id);
  person.assignment = { action: 'forage', title: 'repor a reserva comum', source: 'kingdom-strategy',
    goal: 'secure-shared-food', communityId: community.id, expiresDay: 8 };

  assert.equal(updateKingdomFoodSupplyPhase(person.assignment, 30, 0), 'personal-recovery');
  assert.equal(updateKingdomFoodSupplyPhase(person.assignment, 40, 0), 'communal-collection');

  assert.equal(completeCommunityTask(world, person, 'forage', { carriedFood: 0 }, { carriedFood: 4 }), false);
  assert.equal(person.assignment.action, 'forage');
  assert.equal(person.assignment.supplyPhase, 'communal-collection');
  assert.equal(completeCommunityTask(world, person, 'deliver', { food: 0 }, { food: 0 }), false);
  assert.equal(person.assignment.action, 'deliver');
  assert.equal(person.assignment.supplyPhase, 'communal-delivery');
});

test('one safe worker is reserved for a funded project while the kingdom keeps food first', () => {
  const world = Sim.createWorld(42);
  const kingdom = world.kingdoms[0];
  const community = world.communities.find(item => item.id === kingdom.communityId);
  const leader = world.people.find(person => person.id === kingdom.rulerId);
  const builder = world.people.find(person => person.role === 'resident' && person.communityId === community.id
    && person.id !== leader.id);
  const project = { id: world.nextId++, type: 'posto de coleta', kingdomId: kingdom.id, communityId: community.id,
    x: Math.round(builder.x), y: Math.round(builder.y), complete: false, progress: 0, required: 36,
    woodCost: 20, stoneCost: 12, foodCost: 1 };
  world.structures.push(project);
  community.stores.food = 0;
  community.stores.wood = 20;
  community.stores.stone = 12;
  community.lastGovernanceDay = 0;
  kingdom.treasury.stock.food = 0;
  kingdom.market.stock.food = 0;
  builder.foodReserve = 55;
  builder.ageDays = Math.max(builder.ageDays, 18 * 365);
  builder.energy = 30;
  builder.hydration = 80;
  builder.health = 80;
  builder.buildCooldown = 2;
  builder.perception = null;
  const forageCandidates = world.people.filter(person => person.role === 'resident' && person.communityId === community.id
    && person.id !== leader.id && person.id !== builder.id).slice(0, 5);
  for (const person of forageCandidates) {
    person.ageDays = Math.max(person.ageDays, 18 * 365);
    person.foodReserve = 20;
    person.energy = 40;
    person.hydration = 60;
    person.health = 80;
    person.assignment = null;
    person.perception = { resources: [{ x: Math.round(person.x), y: Math.round(person.y),
      distance: 0, slope: 0, terrain: 'land', biomass: { berry: 10 } }] };
  }
  world.day = 8;

  updateCommunityGovernance(world);

  const foodWorkers = world.people.filter(person => person.assignment && person.assignment.source === 'kingdom-strategy'
    && person.assignment.action === 'forage' && person.assignment.communityId === community.id);
  const projectWorkers = world.people.filter(person => person.assignment && person.assignment.source === 'community-project'
    && person.assignment.communityId === community.id);
  assert.equal(kingdom.strategy.action, 'forage');
  assert.equal(foodWorkers.length, 5, 'the project assignment does not reduce urgent food delegation capacity');
  assert.deepEqual(projectWorkers.map(person => person.id), [builder.id]);
  assert.equal(builder.assignment.structureId, project.id);
  assert.equal(project.workStatus.status, 'delegated');
  assert.equal(project.workStatus.workerId, builder.id);

  project.complete = true;
  world.day = 16;
  updateCommunityGovernance(world);
  assert.equal(builder.assignment, null, 'finishing the funded project returns its worker to the food-first plan');
});

test('a worker below the individual build-energy cutoff is not reserved for a project', () => {
  const { world, community, leader, builder, project } = ongoingProjectScenario();
  Object.assign(builder, { x: project.x + 1, y: project.y, ageDays: 18 * 365,
    foodReserve: 55, hydration: 80, energy: 26.9, health: 80, buildCooldown: 0, assignment: null });
  for (const person of world.people.filter(item => item.communityId === community.id && item.id !== leader.id && item.id !== builder.id)) {
    Object.assign(person, { foodReserve: 20, hydration: 60, energy: 20, health: 80, assignment: null });
  }

  updateCommunityGovernance(world);

  assert.notEqual(builder.assignment && builder.assignment.source, 'community-project',
    'an unavailable build action must not receive a project assignment');
  assert.equal(project.workStatus.status, 'blocked');
  assert.equal(project.workStatus.safeNearby, 0);
});

test('an out-of-range strategic builder is diagnosed as approaching or remote, not delegated', () => {
  const { world, kingdom, community, builder, project } = ongoingProjectScenario();
  world.day = 9;
  community.lastGovernanceDay = world.day;
  kingdom.strategy = { evaluatedDay: world.day, order: { action: 'build' } };
  Object.assign(builder, { x: project.x + 20, y: project.y });
  builder.assignment = { action: 'build', title: 'concluir obra comunitária', source: 'kingdom-strategy',
    communityId: community.id, assignedDay: 2, expiresDay: 30, pauseReason: null };

  updateCommunityGovernance(world);

  assert.equal(project.workStatus.status, 'worker-out-of-range');
  assert.ok(project.workStatus.distance > 14);
  assert.match(project.workStatus.reason, /fora do raio de trabalho de 14/);
});

test('the project diagnosis explains a far assigned worker without changing the assignment', () => {
  const { world, community, builder, project } = ongoingProjectScenario();
  Object.assign(builder, { x: 40, y: 40, foodReserve: 55, hydration: 80, energy: 30, health: 80 });
  builder.state = 'buscando alimento';
  builder.brain.lastAction = 'forage';
  builder.assignment = { action: 'build', title: 'concluir obra comunitária', source: 'community-project',
    communityId: community.id, structureId: project.id, assignedDay: 2, expiresDay: 30, pauseReason: null };

  updateCommunityGovernance(world);

  assert.equal(project.workStatus.status, 'worker-out-of-range');
  assert.ok(project.workStatus.distance > 14);
  assert.equal(project.workStatus.lastProgressDay, 4);
  assert.equal(builder.assignment.action, 'build');
  assert.equal(builder.assignment.source, 'community-project');
  assert.equal(builder.assignment.structureId, project.id);
});

test('the project diagnosis records why no safe nearby worker can continue construction', () => {
  const { world, community, leader, project } = ongoingProjectScenario();
  for (const person of world.people.filter(item => item.role === 'resident' && item.communityId === community.id
    && item.id !== leader.id)) {
    Object.assign(person, { ageDays: 18 * 365, foodReserve: 0, hydration: 0, energy: 0, health: 0, assignment: null });
  }

  updateCommunityGovernance(world);

  assert.equal(project.workStatus.status, 'blocked');
  assert.match(project.workStatus.reason, /adultos|limites|ocupados|alcance/i);
  assert.equal(project.workStatus.safeNearby, 0);
  assert.equal(world.people.some(person => person.assignment && person.assignment.source === 'community-project'
    && person.assignment.structureId === project.id), false);
});

test('community construction dates the most recent day of real progress', () => {
  const { world, community, builder, project } = ongoingProjectScenario();
  world.day = 12;
  builder.x = project.x;
  builder.y = project.y;
  builder.energy = 50;
  builder.foodReserve = 50;

  Sim.modules.SocietyExperiment.workOnCommunityStructure(world, builder, community, community.memberIds.length);

  assert.equal(project.progress, 4);
  assert.equal(project.lastProgressDay, 12);
});

test('treasury food delivery is dated, quantified, and explains the emergency reserve release', () => {
  const world = Sim.createWorld(2026);
  const kingdom = world.kingdoms[0];
  const community = world.communities.find(item => item.id === kingdom.communityId);

  Sim.stepDay(world);

  const delivery = kingdom.reserveTransfers[0];
  assert.equal(delivery.day, 1);
  assert.equal(delivery.source, 'treasury');
  assert.equal(delivery.sourceId, kingdom.treasury.ownerId);
  assert.equal(delivery.destination, 'community');
  assert.equal(delivery.destinationId, community.id);
  assert.equal(delivery.foodReason, 'emergency-community-below-one-day');
  assert.ok(delivery.food > 0);
  assert.equal(delivery.protectedFoodFloor, 0);
  assert.ok(Math.abs(delivery.treasuryFood - (delivery.treasuryFoodBefore - delivery.food)) < 1e-9);
  assert.ok(Math.abs(delivery.communityFood - (delivery.communityFoodBefore + delivery.food)) < 1e-9);

  const entry = world.events.find(event => event.day === 1 && event.text.includes(kingdom.name) && event.text.includes('transferiu')
    && event.text.includes('estoque comunitário'));
  assert.ok(entry);
  assert.ok(entry.text.includes(Number(delivery.food.toFixed(3)).toString().replace('.', ',')));
  assert.match(entry.text, /abaixo de um dia de consumo e o piso de seca foi liberado/);
  assert.match(entry.text, /piso de seca calculado em 0(?:,00)? alimento/);
});
