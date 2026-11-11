import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../src/simulation/engine.js';
import { PEOPLE_ACTIONS } from '../src/config/ecosystem.js';
import { actorObservation, forwardBatch, forwardSharedBatch,
  forwardSharedPolicy, getSharedPolicy } from '../src/ai/policy/shared-policy.js';
import { prepareCausalInferenceBatch } from '../src/ai/policy/causal-batch-queue.js';

const inputsFor = person => Array.isArray(person.lastDecision?.inputs)
  && person.lastDecision.inputs.length === 18
  ? person.lastDecision.inputs.slice()
  : Array.from({ length: 18 }, (_, i) => i < 4
    ? [person.foodReserve, person.hydration, person.energy, person.socialNeed][i] / 100
    : 0);
const maskFor = (index) => PEOPLE_ACTIONS.map((_, i) => (i + index) % 5 !== 0);

test('real-world humans: same causal-boundary batches match serial logits exactly', () => {
  for (const seed of [1, 42, 2026]) {
    const world = Sim.createWorld(seed);
    Sim.stepDay(world, { includeSnapshot: false });
    const people = world.people.filter(p => p.alive && p.brain?.mode === 'shared')
      .sort((a, b) => a.id - b.id).slice(0, 64);
    assert.ok(people.length >= 2, 'fixture must include multiple real agents');
    const requests = people.map((actor, i) => ({
      actor, inputs: inputsFor(actor), domain: 'people', allowedActions: maskFor(i)
    }));
    const batched = forwardSharedBatch(world, requests);
    const serial = requests.map(({ actor, inputs, domain, allowedActions }) =>
      forwardSharedPolicy(world, actor, inputs, domain, allowedActions));
    assert.deepEqual(batched, serial, 'kernel parity must hold for seed ' + seed);

    const observations = requests.map(r =>
      actorObservation(world, r.actor, r.inputs, r.domain, r.allowedActions));
    assert.deepEqual(forwardBatch(getSharedPolicy(world).spec, observations)
      .map(o => o.logits.slice(0, PEOPLE_ACTIONS.length)),
      serial.map(o => o.logits), 'direct matrix parity must hold for seed ' + seed);
  }
});

test('real-world queued batches are never committed after an unobserved domain mutation', () => {
  const world = Sim.createWorld(42);
  Sim.stepDay(world, { includeSnapshot: false });
  const people = world.people.filter(p => p.alive && p.brain?.mode === 'shared')
    .sort((a, b) => a.id - b.id).slice(0, 8);
  assert.ok(people.length >= 3);
  const inputs = people.map(inputsFor);
  const original = people.map(p => ({ id: p.id, position: [p.x, p.y],
    reserve: p.foodReserve, kingdomId: p.kingdomId }));
  const queued = prepareCausalInferenceBatch(world, people.map((person, index) =>
    ({ person, inputs: inputs[index] })), {
    budget: people.length, batchSize: 4, requireLiveValidation: true
  });
  const allowed = PEOPLE_ACTIONS.map(() => true);
  // Actor 0: live state still matches. In a real integration, a domain validator
  // must approve dependencies that are not represented in the observation vector.
  assert.ok(queued.consume(world, people[0], inputs[0], allowed, (w, person) =>
    person.id === original[0].id && person.foodReserve === original[0].reserve));
  // Actor 1: a prior NPC changes a food stock outside the neural feature vector.
  // A live guard must reject instead of applying a stale result.
  world.someGlobalMarketBalance = 99;
  assert.equal(queued.consume(world, people[1], inputs[1], allowed,
    w => w.someGlobalMarketBalance !== 99), null);
  // Actor 2: changed identity/role invalidates even before the domain callback.
  people[2].role = people[2].role === 'soldier' ? 'resident' : 'soldier';
  let called = false;
  assert.equal(queued.consume(world, people[2], inputs[2], allowed, () => {
    called = true;
    return true;
  }), null);
  assert.equal(called, false);
  assert.equal(queued.metrics.consumed, 1);
  assert.equal(queued.metrics.domainRejected, 1);
  assert.equal(queued.metrics.rejected, 2);
  assert.ok(queued.metrics.batches >= 1);
  assert.ok(queued.metrics.batches <= 2);
});