import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceKingdomProjects } from '../src/simulation/kingdoms/projects.js';
import { frontierWorkOrder, performFrontierWork } from '../src/simulation/kingdoms/frontier-conflicts.js';
import { constructionWorkPositions } from '../src/simulation/settlements/construction-workstations.js';
import { HEIGHT, PLANTS, WIDTH } from '../src/config/ecosystem.js';

function constructionWorld({ withThreat = true, obstructed = false, workers = 1 } = {}) {
  const width = WIDTH, height = HEIGHT;
  const tiles = Array.from({ length: width * height }, (_, i) => ({
    i, x: i % width, y: Math.floor(i / width), terrain: 'land', slope: 0,
    kingdomId: null, plants: Array(PLANTS.length).fill(0)
  }));
  if (obstructed) {
    // A rock screen makes the worker route around a blocked approach.
    for (let y = 4; y < 19; y++) tiles[y * width + 8].terrain = 'rock';
    tiles[10 * width + 8].terrain = 'land';
    const treeIndex = PLANTS.findIndex(plant => plant.id === 'broadleaf');
    tiles[6 * width + 6].plants[treeIndex] = PLANTS[treeIndex].max * .8;
  }
  const project = {
    id: 101, kingdomId: 1, type: 'torre', x: 10, y: 10, radius: 0,
    kingdomProject: true, complete: false, builtDay: null, integrity: 1,
    progress: 0, required: 10, lastProgressDay: null,
    workerIds: Array.from({ length: workers }, (_, index) => index + 1),
    constructionWorkerIds: Array.from({ length: workers }, (_, index) => index + 1),
    constructionWorkerLastSeen: Object.fromEntries(Array.from({ length: workers }, (_, index) => [index + 1, 10])),
    paidCosts: { food: 24, wood: 16, gold: 3 }
  };
  const people = [];
  for (let id = 1; id <= workers; id++) people.push({
    id, name: 'Construtor ' + id, alive: true, role: 'resident', kingdomId: 1,
    communityId: 1, homeId: 11, ageDays: 18 * 365, x: id === 1 ? 10 : 11, y: 11,
    energy: 90, foodReserve: 60, hydration: 80, health: 100, injury: 0,
    skills: { build: .3 }, brain: { lastAction: '', actionValues: Array(17).fill(0) }
  });
  if (withThreat) people.push({ id: 9, name: 'Soldado rival', alive: true, role: 'soldier',
    kingdomId: 2, campaignId: 202, x: 13, y: 11, health: 100 });
  return { day: 10, width, height, tiles, people, structures: [project], kingdoms: [
    { id: 1, name: 'Azul', x: 10, y: 10, memberIds: [1], structureIds: [], homeIds: [], treasury: { stock: { wood: 0, stone: 0 } } },
    { id: 2, name: 'Vermelho', x: 13, y: 11, memberIds: [9], structureIds: [], homeIds: [], treasury: { stock: { wood: 0, stone: 0 } } }
  ], events: [], chronicle: [], campaigns: [], wars: [], project, worker: people[0] };
}

function work(world, person = world.worker) {
  const order = frontierWorkOrder(world, person);
  assert.ok(order?.construction, 'an eligible royal worker should retain the funded project order');
  assert.ok(constructionWorkPositions(world, world.project, person), 'fixture should have a valid worksite point');
  performFrontierWork(world, person, order);
  return order;
}

test('nearby campaign threat evacuates worker through terrain-safe route without charging or losing the work slot', () => {
  const world = constructionWorld({ obstructed: true });
  const { project, worker } = world;
  const start = { x: worker.x, y: worker.y };
  const paidCosts = structuredClone(project.paidCosts);

  work(world);

  assert.notDeepEqual({ x: worker.x, y: worker.y }, start, 'worker should move away from the exposed work point: ' + JSON.stringify({ state: worker.state, decision: worker.constructionPolicyDecision, threatState: worker.constructionThreatState, project: project.constructionRiskHistory }));
  assert.equal(world.tiles[Math.round(worker.y) * world.width + Math.round(worker.x)].terrain, 'land', 'route must not cross rock');
  assert.equal(worker.constructionThreatState.status, 'retreating');
  assert.equal(worker.constructionPolicyDecision.action, 'flee');
  assert.equal(worker.constructionPolicyDecision.risk > worker.constructionPolicyDecision.threshold, true);
  assert.deepEqual(project.constructionWorkerIds, [], 'evacuation releases the physical work slot immediately');
  assert.deepEqual(project.workerIds, [], 'the evacuee stays linked only through its recovery target, not the active crew');
  assert.equal(worker.constructionProjectId, project.id);
  assert.ok(Math.hypot(worker.x - 13, worker.y - 11) >= 3.5, 'the first evacuation step respects the enemy path buffer');
  assert.equal(project.progress, 0);
  assert.deepEqual(project.paidCosts, paidCosts);
  assert.equal(project.lastConstructionWorkDay, undefined);
  assert.ok(project.constructionIncidents.some(entry => entry.action === 'flee' && entry.threatId === 9));
});

test('a threat appearing during hammer work freezes progress, releases the slot and preserves paid materials', () => {
  const world = constructionWorld({ withThreat: false, obstructed: true });
  const { project, worker } = world;
  const paidCosts = structuredClone(project.paidCosts);

  for (let attempts = 0; attempts < 12 && project.progress === 0; attempts++) {
    work(world);
    world.day++;
    advanceKingdomProjects(world, world.day);
  }
  assert.ok(project.progress > 0, 'the worker must have started paid construction before the threat appears');
  const safeProgress = project.progress;
  const threat = { id: 9, name: 'Soldado rival', alive: true, role: 'soldier',
    kingdomId: 2, campaignId: 202, x: 13, y: 11, health: 100 };
  world.people.push(threat);

  work(world, worker);

  assert.equal(worker.constructionThreatState.status, 'retreating');
  assert.deepEqual(project.constructionWorkerIds, []);
  assert.equal(project.progress, safeProgress, 'the interrupted work cannot award phantom progress');
  assert.equal(project.complete, false);
  assert.deepEqual(project.paidCosts, paidCosts, 'the project is not charged again when the worker evacuates');
});

test('an evacuated worker releases a workstation so a third worker can take the same funded project', () => {
  const world = constructionWorld({ obstructed: true, workers: 3 });
  const { project, worker } = world;
  const alreadyAssigned = world.people[1];
  const substitute = world.people[2];

  work(world, worker);

  assert.equal(worker.constructionThreatState.status, 'retreating');
  assert.deepEqual(project.constructionWorkerIds, [alreadyAssigned.id]);
  assert.deepEqual(project.workerIds, [alreadyAssigned.id]);

  world.people.find(person => person.id === 9).alive = false;
  world.day++;
  work(world, substitute);

  assert.deepEqual(project.constructionWorkerIds, [alreadyAssigned.id, substitute.id]);
  assert.deepEqual(project.workerIds, [alreadyAssigned.id, substitute.id]);
  assert.equal(substitute.constructionProjectId, project.id);
  assert.equal(project.complete, false);
  assert.equal(project.paidCosts.food, 24);
  assert.equal(project.paidCosts.wood, 16);
  assert.equal(project.paidCosts.gold, 3);
});

test('safe return waits for hysteresis, resumes the same project and advances progress only at the work point', () => {
  const world = constructionWorld({ obstructed: true });
  const { project, worker } = world;
  const paidCosts = structuredClone(project.paidCosts);
  work(world);
  world.day++;
  advanceKingdomProjects(world, world.day);
  const threat = world.people.find(person => person.id === 9);
  threat.alive = false;

  const retreatStart = { x: worker.x, y: worker.y };
  work(world);
  assert.equal(worker.constructionThreatState.status, 'retreating');
  assert.equal(worker.constructionThreatState.clearDays, 1);
  assert.deepEqual({ x: worker.x, y: worker.y }, retreatStart, 'first safe observation must not trigger oscillation');
  world.day++;
  advanceKingdomProjects(world, world.day);

  let resumed = false;
  for (let attempts = 0; attempts < 60 && !resumed; attempts++) {
    work(world);
    world.day++;
    advanceKingdomProjects(world, world.day);
    resumed = project.progress > 0;
  }

  assert.equal(resumed, true, 'a safe, reachable worksite should not remain stuck: ' + JSON.stringify({ position: [worker.x, worker.y], state: worker.state, threat: worker.constructionThreatState, status: project.constructionStatus, slots: project.constructionWorkerIds, incidents: project.constructionIncidents }));
  assert.equal(project.complete, false, 'the site must not complete without its remaining work');
  assert.deepEqual(project.paidCosts, paidCosts);
  assert.equal(project.workerIds.includes(worker.id), true);
  assert.ok(project.constructionIncidents.some(entry => entry.action === 'retry-build'
    && entry.reason.includes('ameaça afastada')));
  assert.ok(project.constructionPolicyTraining.some(entry => entry.action === 'flee'), 'the selected risk policy receives an observed outcome');
  assert.ok(world.chronicle.some(entry => entry.text.includes('se retirou da obra')));
  assert.ok(world.chronicle.some(entry => entry.text.includes('retomou a obra')));
});

test('a dead builder releases the occupied slot and a living substitute takes over the paid project', () => {
  const world = constructionWorld({ withThreat: false, workers: 2 });
  const { project } = world;
  const original = world.worker;
  const substitute = world.people[1];
  project.workerIds = [original.id];
  project.constructionWorkerIds = [original.id];
  original.alive = false;
  world.day = 12;
  const paidCosts = structuredClone(project.paidCosts);

  const order = frontierWorkOrder(world, substitute);
  assert.equal(order.project, project);
  performFrontierWork(world, substitute, order);

  assert.deepEqual(project.workerIds, [substitute.id]);
  assert.deepEqual(project.constructionWorkerIds, [substitute.id]);
  assert.equal(project.progress, 0, 'replacement assignment must not award construction progress');
  assert.deepEqual(project.paidCosts, paidCosts);
  assert.equal(project.complete, false);
});

test('occupied construction workstations cannot be overbooked', () => {
  const world = constructionWorld({ withThreat: false, workers: 3 });
  const overflowWorker = world.people[2];
  world.project.workerIds = [world.people[0].id, world.people[1].id];
  world.project.constructionWorkerIds = [world.people[0].id, world.people[1].id];

  assert.equal(frontierWorkOrder(world, overflowWorker), null);
  assert.deepEqual(world.project.workerIds, [world.people[0].id, world.people[1].id]);
  assert.deepEqual(world.project.constructionWorkerIds, [world.people[0].id, world.people[1].id]);
});

test('capturing a funded worksite releases the former kingdom worker and clears the recovery link', () => {
  const world = constructionWorld({ withThreat: false });
  const { project, worker } = world;
  work(world);
  project.constructionIncidents = Array.from({ length: 40 }, (_, index) => ({ reason: 'retained-' + index }));
  project.kingdomId = 2;
  world.day++;

  assert.equal(frontierWorkOrder(world, worker), null);
  assert.deepEqual(project.workerIds, []);
  assert.deepEqual(project.constructionWorkerIds, []);
  assert.equal(worker.constructionProjectId, null);
  assert.equal(worker.constructionThreatState, null);
  assert.equal(project.constructionIncidents.length, 40, 'project incident history remains bounded during abandonment');
  assert.equal(project.constructionIncidents[0].reason, 'retained-1');
  assert.ok(world.chronicle.some(entry => entry.text.includes('abandonou a obra') && entry.text.includes('capturada')));
});

test('the policy chooses a documented preventive wait inside siege radius and retries when it clears', () => {
  const world = constructionWorld();
  const { project, worker } = world;
  const threat = world.people.find(person => person.id === 9);
  threat.x = 15;

  work(world);
  assert.equal(worker.constructionPolicyDecision.action, 'wait');
  assert.equal(project.progress, 0);
  assert.deepEqual(project.workerIds, [worker.id]);
  assert.ok(world.chronicle.some(entry => entry.category === 'Construção' && entry.text.includes('pausa preventiva protegeu')));

  threat.x = 40;
  world.day++;
  work(world);
  assert.equal(worker.constructionThreatState, null);
  assert.ok(project.constructionIncidents.some(entry => entry.reason.includes('pausa preventiva encerrada')));
});

test('an active arrow aimed at the worker selects cover and records the individual safety choice', () => {
  const world = constructionWorld();
  const { worker, project } = world;
  const archer = world.people.find(person => person.id === 9);
  const treeIndex = PLANTS.findIndex(plant => plant.id === 'broadleaf');
  world.tiles[19 * world.width + 10].plants[treeIndex] = PLANTS[treeIndex].max * .8;
  archer.combatAction = { weapon: 'arqueiro', targetId: worker.id, phase: 'windup', result: null };

  work(world);

  assert.equal(worker.constructionPolicyDecision.action, 'seek-cover');
  assert.equal(worker.state, 'buscando abrigo para proteger a obra');
  assert.equal(worker.constructionPolicyDecision.threatId, archer.id);
  assert.equal(worker.constructionThreatState.coverTarget, true, 'safe destination should have nearby canopy cover');
  assert.deepEqual(project.constructionWorkerIds, []);
  assert.deepEqual(project.workerIds, []);
  assert.ok(project.constructionIncidents.some(entry => entry.action === 'seek-cover'));
});

test('destroying an exposed project releases its reserved slot and clears the worker recovery target', () => {
  const world = constructionWorld();
  const { project, worker } = world;
  work(world);
  assert.equal(worker.constructionThreatState.status, 'retreating');
  project.integrity = 0;

  assert.equal(frontierWorkOrder(world, worker), null);
  assert.deepEqual(project.workerIds, []);
  assert.deepEqual(project.constructionWorkerIds, []);
  assert.equal(worker.constructionProjectId, null);
  assert.equal(worker.constructionThreatState, null);
  assert.ok(world.chronicle.some(entry => entry.text.includes('abandonou a obra')));
});

test('completing a project while a builder is evacuated clears the orphaned recovery state', () => {
  const world = constructionWorld({ workers: 3 });
  const { project, worker } = world;
  work(world, worker);
  assert.equal(worker.constructionThreatState.status, 'retreating');
  assert.equal(project.workerIds.includes(worker.id), false);
  assert.equal(worker.constructionProjectId, project.id);

  const finisher = world.people[1];
  const position = { x: 10, y: 11 };
  finisher.x = position.x;
  finisher.y = position.y;
  finisher.constructionProjectId = project.id;
  project.workerIds = [finisher.id];
  project.constructionWorkerIds = [finisher.id];
  project.progress = project.required - 1;
  project.lastConstructionWorkerId = finisher.id;
  project.lastConstructionWorkDay = world.day + 1;
  project.lastConstructionWorkPosition = position;
  world.people.find(person => person.id === 9).alive = false;
  world.day++;

  advanceKingdomProjects(world, world.day);

  assert.equal(project.complete, true);
  assert.deepEqual(project.workerIds, []);
  assert.deepEqual(project.constructionWorkerIds, []);
  assert.equal(worker.constructionProjectId, null);
  assert.equal(worker.constructionThreatState, null);
  assert.equal(worker.constructionRiskPending, null);
});
