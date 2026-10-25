import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../../src/simulation/engine.js';
import { applyWorldSnapshot, createWorldSnapshot, transferablesForSnapshot } from '../../src/simulation/render-snapshot.js';
import { createSimulationWorkerRuntime } from '../../src/simulation/worker-runtime.js';
import { SIMULATION_PROTOCOL_VERSION } from '../../src/simulation/protocol-version.js';

const envelope = (type, requestId, fields = {}, epoch = 1) => ({
  protocolVersion: SIMULATION_PROTOCOL_VERSION, type, requestId, epoch, ...fields
});

function replay(includeDailySnapshots = false) {
  const runtime = createSimulationWorkerRuntime({ includeDailySnapshots });
  const messages = [
    envelope('initialize', 1, { config: { scenario: 'kingdom' }, seed: 42 }),
    envelope('advance', 2, { days: 5 }),
    envelope('dispatch', 3, { command: { type: 'drought', days: 4, intensity: .6 } }),
    envelope('advance', 4, { days: 4 }),
    envelope('dispatch', 5, { command: { type: 'add-individuals', count: 2 } }),
    envelope('advance', 6, { days: 2 })
  ];
  return messages.map(message => runtime.handle(message));
}

test('versioned Worker requests replay to identical snapshots and events', () => {
  assert.deepEqual(replay(), replay());
  assert.deepEqual(replay(), replay(true));
});

test('transferable tile columns hydrate a reusable read-only world view', () => {
  const runtime = createSimulationWorkerRuntime();
  const first = runtime.handle(envelope('initialize', 1, { config: { scenario: 'kingdom' }, seed: 7 }));
  assert.equal(first.type, 'snapshot');
  const transferredClone = structuredClone(first.snapshot);
  const transferables = transferablesForSnapshot(first.snapshot);
  assert.equal(transferables.length, 4);
  assert.ok(first.snapshot.tileColumns.scalars.byteLength < 2_200_000);

  const view = applyWorldSnapshot(transferredClone);
  assert.equal(view.stats.peopleCount, 100);
  assert.equal(view.tiles.length, Sim.width * Sim.height);
  const firstTile = view.tiles[0];
  const inspected = runtime.handle(envelope('inspect-tile', 2, { x: 0, y: 0 }));
  assert.equal(inspected.type, 'query');
  assert.deepEqual(Sim.inspectTile(view, 0, 0), inspected.result);

  const second = runtime.handle(envelope('advance', 3, { days: 1 }));
  applyWorldSnapshot(second.snapshot, view);
  assert.equal(view.tiles[0], firstTile, 'ordinary snapshots reuse tile projection objects');
  assert.deepEqual(view.events, second.snapshot.events);
  assert.deepEqual(view.logs, second.snapshot.logs);

  const fieldWorld = Sim.createWorld(8);
  fieldWorld.tiles[0].cropFieldId = 901;
  const fieldView = applyWorldSnapshot(structuredClone(createWorldSnapshot(fieldWorld)));
  assert.equal(fieldView.tiles[0].cropFieldId, 901, 'the read-only view carries cultivated field ownership for rendering');

  const paused = runtime.handle(envelope('set-paused', 4, { paused: true }));
  assert.equal(paused.type, 'ack');
  assert.deepEqual(paused.result, { paused: true });
  const staleClock = runtime.handle(envelope('advance', 5, { days: 3, source: 'clock' }));
  assert.equal(staleClock.type, 'error');
  assert.match(staleClock.message, /pausada/);
  const manualStep = runtime.handle(envelope('advance', 6, { days: 1, source: 'manual' }));
  assert.equal(manualStep.snapshot.base.day, 2, 'manual advance remains available while paused');

  const reset = runtime.handle(envelope('reset', 7, { seed: 7, strategicAiEnabled: false }, 2));
  const resetView = applyWorldSnapshot(reset.snapshot, view);
  assert.notEqual(resetView, view, 'a reset replaces the view so async AI can detect stale requests');
});

test('Worker rejects invalid protocol versions, stale epochs and invalid commands', () => {
  const runtime = createSimulationWorkerRuntime();
  const initialized = runtime.handle(envelope('initialize', 1, { config: { scenario: 'kingdom' }, seed: 12 }));
  assert.equal(initialized.type, 'snapshot');
  assert.match(runtime.handle({ ...envelope('advance', 2, { days: 1 }), protocolVersion: 99 }).message, /protocolo/);
  assert.match(runtime.handle(envelope('advance', 3, { days: 1 }, 0)).message, /[Éé]poca/);
  assert.match(runtime.handle(envelope('dispatch', 4, { command: { type: 'invented-command' } })).message, /não reconhecido/);
  assert.match(runtime.handle(envelope('advance', 5, { days: 13 })).message, /1 a 12/);
});

test('Worker applies a king decision only for the current request and simulation epoch', () => {
  const runtime = createSimulationWorkerRuntime();
  runtime.handle(envelope('initialize', 1, { config: { scenario: 'kingdom' }, seed: 42 }));
  runtime.handle(envelope('set-kingdom-ai', 2, { enabled: true }));
  runtime.handle(envelope('advance', 3, { days: 2 }));
  const pulled = runtime.handle(envelope('pull-kingdom-ai-request', 4, { limit: 1 }));
  assert.equal(pulled.type, 'kingdom-ai-request');
  assert.ok(pulled.request);
  assert.equal(pulled.request.worldEpoch, 1);
  const decision = { action: pulled.request.allowedActions[0], confidence: .8, reason: 'Manter o plano atual.' };
  const applied = runtime.handle(envelope('apply-kingdom-ai-decision', 5, { aiRequest: pulled.request, decision }));
  assert.equal(applied.result, true);
  const duplicate = runtime.handle(envelope('apply-kingdom-ai-decision', 6, { aiRequest: pulled.request, decision }));
  assert.equal(duplicate.result, false);

  runtime.handle(envelope('reset', 7, { seed: 42, kingdomAiEnabled: true }, 2));
  const fromOldEpoch = runtime.handle(envelope('apply-kingdom-ai-decision', 8, { aiRequest: pulled.request, decision }, 2));
  assert.equal(fromOldEpoch.result, false);
});

test('Worker routes a campaign general proposal through the current epoch and applies its order', () => {
  const createWorldWithWar = seed => {
    const world = Sim.createWorld(seed);
    const [attacker, defender] = world.kingdoms;
    const key = Math.min(attacker.id, defender.id) + ':' + Math.max(attacker.id, defender.id);
    world.kingdomRelations[key] = { a: Math.min(attacker.id, defender.id), b: Math.max(attacker.id, defender.id),
      status: 'at-war', tension: .82, borderIncidents: 1, lastIncidentDay: 0, startedDay: 0 };
    world.wars.push({ id: 9100, a: attacker.id, b: defender.id, attackerId: attacker.id, defenderId: defender.id,
      startedDay: 0, status: 'active', cause: 'incursão observada no limite territorial', evidence: {
        location: { x: defender.x, y: defender.y }, incidentDay: 0,
        source: 'relato confirmado da patrulha',
        attacker: { source: 'relato confirmado', location: { x: defender.x, y: defender.y } },
        defender: { source: 'observação local', location: { x: defender.x, y: defender.y } }
      } });
    return world;
  };
  const runtime = createSimulationWorkerRuntime({ createWorldImpl: createWorldWithWar });
  runtime.handle(envelope('initialize', 1, { config: { scenario: 'kingdom' }, seed: 42 }));
  runtime.handle(envelope('set-kingdom-ai', 2, { enabled: true }));
  runtime.handle(envelope('advance', 3, { days: 1 }));

  let request = null, nextId = 4;
  for (let attempts = 0; attempts < 8 && !request; attempts++) {
    const pulled = runtime.handle(envelope('pull-kingdom-ai-request', nextId++, { limit: 1 }));
    assert.equal(pulled.type, 'kingdom-ai-request');
    if (pulled.request?.role === 'general') request = pulled.request;
    else if (pulled.request) {
      const result = runtime.handle(envelope('apply-kingdom-ai-decision', nextId++, {
        aiRequest: pulled.request,
        decision: { action: pulled.request.allowedActions[0], confidence: .7, reason: 'Aplicar a política de contingência.' }
      }));
      assert.equal(result.result, true);
    }
  }
  assert.ok(request, 'the shared queue eventually returns the general request after higher-priority king work');
  assert.equal(request.role, 'general');
  assert.equal(request.worldEpoch, 1);
  const applied = runtime.handle(envelope('apply-kingdom-ai-decision', nextId++, {
    aiRequest: request,
    decision: { action: 'hold_position', confidence: .8, reason: 'Aguardar e conservar a coesão.' },
    providerMetadata: { provider: 'ollama', model: 'smollm2:135m' }
  }));
  assert.equal(applied.result, true);
  const campaign = applied.snapshot.base.campaigns.find(item => item.id === request.campaignId);
  const side = campaign.attackerId === request.kingdomId ? campaign.attacker : campaign.defender;
  assert.equal(side.aiOrder.action, 'hold_position');
  assert.equal(side.aiOrder.model, 'smollm2:135m');
  assert.equal(side.orderVersion, request.orderVersion + 1);
});
