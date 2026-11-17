import test from 'node:test';
import assert from 'node:assert/strict';
import { withIndividualDayIndexes } from '../src/simulation/individuals/day-index-context.js';
import Sim from '../src/simulation/engine.js';

const soldier = (id, x, y, alive = true) => ({ id, x, y, alive });

test('temporary index exposes actor lookup and movement for exactly one callback', () => {
  const p = soldier(3, 4, 4);
  const world = { people: [p, soldier(7, 25, 25, false)],
    animals: [{ id: 8, x: 2, y: 2 }, { id: 8, x: 3, y: 3 }] };
  const value = withIndividualDayIndexes(world, () => {
    assert.equal(world.peopleById.get(3), p);
    assert.equal(world.animalsById.get(8).x, 2);
    assert.deepEqual(world.peopleSpatialIndex.query(4, 4, 4), [p]);
    p.x = 26; p.y = 26;
    world.peopleSpatialIndex.move(p);
    assert.deepEqual(world.peopleSpatialIndex.query(26, 26, 2), [p]);
    return 42;
  });
  assert.equal(value, 42);
  for (const key of ['peopleById', 'peopleSpatialIndex', 'animalsById'])
    assert.equal(Object.hasOwn(world, key), false);
});

test('preexisting day indices are restored after success or failure', () => {
  const original = { sentinel: true }, world = { people: [soldier(1, 1, 1)], animals: [], peopleById: original };
  assert.throws(() => withIndividualDayIndexes(world, () => {
    assert.notEqual(world.peopleById, original);
    throw new Error('failed action');
  }), /failed action/);
  assert.equal(world.peopleById, original);
  assert.equal(Object.hasOwn(world, 'peopleSpatialIndex'), false);
  assert.throws(() => withIndividualDayIndexes(null, () => {}), TypeError);
});

test('headless profiling exposes NPC preparation, individual work and governance', () => {
  const world = Sim.createWorld(42), phases = new Map();
  Sim.stepDay(world, { includeSnapshot: false,
    onSimulationPhase(name, ms) {
      assert.equal(phases.has(name), false, 'duplicate phase ' + name);
      assert.ok(Number.isFinite(ms) && ms >= 0, name);
      phases.set(name, ms);
    } });
  for (const name of ['societyAndNpcActions', 'npcPerception', 'npcSocialIntentions',
    'npcPreparation', 'npcOtherActorWork', 'npcSocietyMaintenance'])
    assert.equal(phases.has(name), true, name);
  assert.equal(Object.hasOwn(world, 'peopleById'), false);
  assert.equal(Object.hasOwn(world, 'animalsById'), false);
});
