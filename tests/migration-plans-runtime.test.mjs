import test from 'node:test';
import assert from 'node:assert/strict';
import engine from '../src/simulation/engine.js';
import { cellAt } from '../src/simulation/world/spatial.js';

test('forced migration records a persistent destination without adding neural inputs', () => {
  const world = engine.createWorld(42);
  const person = world.people.find(candidate => candidate.alive && candidate.role === 'resident' && candidate.ageDays >= 12 * 365);
  assert.ok(person, 'seed 42 includes an adult resident');
  for (const tile of world.tiles) {
    tile.plants.fill(0);
    if (tile.terrain === 'land') tile.soilWaterMm = 0;
    tile.stoneDeposit = 0;
    tile.goldOre = 0;
  }
  world.animals = [];
  world.structures = [];
  const originX = Math.round(person.x), originY = Math.round(person.y);
  const target = cellAt(world, originX + 3, originY);
  assert.ok(target);
  target.terrain = 'land';
  target.slope = 0;
  target.soilWaterMm = target.soilCapacityMm;
  person.communityId = null;
  person.kingdomId = null;
  person.assignment = null;
  person.foodReserve = 0;
  person.hydration = 100;
  person.energy = 100;
  person.health = 100;
  person.injury = 0;
  person.lastAttackedDay = -100;
  person.socialIntentions = [];

  world.day = 1;
  engine.modules.SocietyExperiment.updatePeople(world);

  const migration = person.socialIntentions.find(intention => intention.type === 'prepare_migration');
  assert.ok(migration, 'the existing forced migration action records its plan');
  assert.deepEqual(migration.destination, { x: target.x, y: target.y });
  assert.ok(['active', 'suspended', 'completed'].includes(migration.status));
  assert.equal(person.lastDecision.action, 'migrate');
  assert.equal(person.lastDecision.scores, null, 'forced survival migration does not query network action scores');
  assert.equal(person.lastDecision.inputs.length, 18, 'the individual network observation vector remains unchanged');

  const initialPlanId = migration.intentionId;
  world.day = 2;
  engine.modules.SocietyExperiment.updatePeople(world);
  const continued = person.socialIntentions.find(intention => intention.intentionId === initialPlanId);
  assert.ok(continued, 'the same intention survives the next simulation day');
  assert.deepEqual(continued.destination, { x: target.x, y: target.y });
});

test('migration suspends at an impassable route and resumes the same destination when it opens', () => {
  const world = engine.createWorld(42);
  const person = world.people.find(candidate => candidate.alive && candidate.role === 'resident' && candidate.ageDays >= 12 * 365);
  assert.ok(person, 'seed 42 includes an adult resident');
  for (const candidate of world.people) if (candidate !== person) candidate.alive = false;

  for (const tile of world.tiles) {
    tile.plants.fill(0);
    if (tile.terrain === 'land') tile.soilWaterMm = 0;
    tile.stoneDeposit = 0;
    tile.goldOre = 0;
  }
  world.animals = [];
  world.structures = [];
  const originX = Math.round(person.x), originY = Math.round(person.y);
  const origin = cellAt(world, originX, originY);
  const target = cellAt(world, originX + 3, originY);
  assert.ok(origin && target);
  origin.terrain = 'land';
  origin.slope = 0;
  origin.soilWaterMm = 0;
  target.terrain = 'land';
  target.slope = 0;
  target.soilWaterMm = target.soilCapacityMm;
  for (const dy of [-1, 0, 1]) for (const dx of [-1, 0, 1]) {
    if (!dx && !dy) continue;
    const tile = cellAt(world, originX + dx, originY + dy);
    if (tile) tile.terrain = 'rock';
  }
  person.communityId = null;
  person.kingdomId = null;
  person.assignment = null;
  person.foodReserve = 0;
  person.hydration = 100;
  person.energy = 100;
  person.health = 100;
  person.injury = 0;
  person.lastAttackedDay = 1;
  person.socialIntentions = [];

  world.day = 1;
  engine.modules.SocietyExperiment.updatePeople(world);

  const blocked = person.socialIntentions.find(intention => intention.type === 'prepare_migration');
  assert.ok(blocked, 'an infeasible migration route still has a tracked plan');
  assert.equal(blocked.status, 'suspended');
  assert.ok(blocked.blockers.includes('route_infeasible'));
  assert.ok(blocked.blockers.includes('critical_hunger'), 'critical hunger also suspends the plan');
  assert.ok(blocked.blockers.includes('recent_attack'), 'a recent threat suspends the plan');
  assert.deepEqual(blocked.destination, { x: target.x, y: target.y });

  for (const x of [originX + 1, originX + 2]) {
    const tile = cellAt(world, x, originY);
    tile.terrain = 'land';
    tile.slope = 0;
    tile.soilWaterMm = tile.soilCapacityMm;
  }
  person.foodReserve = 30;
  person.lastAttackedDay = -100;
  world.day = 2;
  engine.modules.SocietyExperiment.updatePeople(world);

  const resumed = person.socialIntentions.find(intention => intention.intentionId === blocked.intentionId);
  assert.ok(resumed, 'route recovery resumes the original plan instead of creating a replacement');
  assert.equal(resumed.status, 'active');
  assert.deepEqual(resumed.blockers, []);
  assert.deepEqual(resumed.destination, { x: target.x, y: target.y });
  assert.ok(person.x > originX, 'the person advances along the reopened route');
});
