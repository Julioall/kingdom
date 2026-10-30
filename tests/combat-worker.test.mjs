import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Worker } from 'node:worker_threads';
import { SIMULATION_PROTOCOL_VERSION } from '../src/simulation/protocol-version.js';

function normalizeEpochScopedEvidence(value) {
  if (Array.isArray(value)) return value.map(normalizeEpochScopedEvidence);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key,
      key === 'worldEpoch' ? '<run>' : normalizeEpochScopedEvidence(entry)]));
  }
  return typeof value === 'string' ? value.replace(/:epoch:\d+:/g, ':epoch:<run>:') : value;
}

test('production Worker: determinism, real campaign contacts, pause, batching, reset and stale epoch rejection', { timeout: 180000 }, async t => {
  const worker = new Worker(new URL('./support/browser-worker.mjs', import.meta.url));
  t.after(() => worker.terminate());
  const [ready] = await once(worker, 'message'); assert.equal(ready.ready, true);
  let id = 0;
  async function request(type, values = {}, epoch = 1) {
    const response = once(worker, 'message');
    worker.postMessage({ protocolVersion: SIMULATION_PROTOCOL_VERSION, requestId: ++id, epoch, type, ...values });
    const [message] = await response;
    assert.equal(message.requestId, id);
    return message;
  }
  const initialized = await request('initialize', { seed: 42, config: { scenario: 'kingdom' } });
  assert.equal(initialized.type, 'snapshot');
  assert.ok(initialized.snapshot.tileColumns.scalars.byteLength > 0);
  let result = await request('advance', { days: 12 });
  assert.equal(result.type, 'snapshot'); assert.equal(result.snapshot.base.day, 12);
  const day12 = structuredClone(result.snapshot);
  for (let i = 0; i < 3; i++) {
    result = await request('advance', { days: 12 }); assert.equal(result.type, 'snapshot');
  }
  const base = result.snapshot.base;
  const attacker = base.kingdoms[0], defender = base.kingdoms[1];
  const target = base.structures.find(s => s.kingdomId === defender.id && s.type === 'torre' && s.complete && s.destroyedDay == null);
  assert.ok(target, 'scenario needs an intact enemy tower');
  // Terrain and settlement changes can cause rulers to mobilize before day 48.
  // Keep that real campaign when present instead of issuing an incompatible order.
  const mobilized = base.campaigns.some(campaign =>
    [campaign.attackerId, campaign.defenderId].includes(attacker.id)
    && ['mobilizing', 'marching', 'engaged', 'withdrawing'].includes(campaign.status));
  if (!mobilized) {
    const ordered = await request('dispatch', { command: { type: 'attack-installation', kingdomId: attacker.id, structureId: target.id } });
    assert.equal(ordered.type, 'snapshot'); assert.equal(ordered.result.ok, true, ordered.result.reason);
  }
  let contacts = 0, seenCampaign = false;
  for (let i = 0; i < 12; i++) {
    result = await request('advance', { days: 12 }); assert.equal(result.type, 'snapshot');
    const world = result.snapshot.base;
    seenCampaign ||= world.campaigns.length > 0;
    contacts = Math.max(contacts, world.combatSequence || 0);
    for (const event of world.combatEvents || []) {
      assert.equal(event.phase, 'complete'); assert.ok(Number.isFinite(event.result.atMs));
      const actor = world.people.find(person => person.id === event.actorId);
      const maximumTargets = ['lance-charge', 'lance-flurry', 'shield-bash'].includes(event.attackVariant)
        ? world.people.filter(person => person.kingdomId !== actor?.kingdomId).length
        : event.weapon === 'arqueiro' && ['cone', 'rain'].includes(event.attackVariant)
          ? event.arrowCount || (event.attackVariant === 'rain' ? 24 : 3) : 1;
      assert.ok(event.hitTargets.length <= maximumTargets,
        `${event.attackVariant || event.weapon} attack cannot hit more than ${maximumTargets} targets`);
      assert.equal(new Set(event.hitTargets).size, event.hitTargets.length, 'one attack cannot record a target twice');
      if (event.result.damageApplied) assert.ok(event.result.damageApplied > 0);
    }
    for (const person of world.people) {
      assert.ok(Number.isFinite(person.health)); assert.ok(person.health >= 0 && person.health <= 100);
      if (person.stamina != null) assert.ok(person.stamina >= 0 && person.stamina <= 400);
    }
  }
  assert.ok(seenCampaign); assert.ok(contacts > 0, 'real campaign must execute contact resolution');
  t.diagnostic(`Seed 42: day ${result.snapshot.base.day}, ${contacts} combat actions, ${result.snapshot.base.campaigns.length} campaigns`);
  assert.equal((await request('set-paused', { paused: true })).type, 'ack');
  assert.equal((await request('advance', { days: 1, source: 'clock' })).type, 'error');
  assert.equal((await request('advance', { days: 1, source: 'manual' })).type, 'snapshot');
  assert.equal((await request('advance', { days: 13 })).type, 'error');
  const reset = await request('reset', { seed: 42 }, 2);
  assert.equal(reset.type, 'snapshot'); assert.equal(reset.snapshot.base.day, 0);
  assert.equal(reset.snapshot.base.combatSequence, undefined);
  assert.equal((await request('advance', { days: 1 }, 1)).type, 'error');
  result = await request('advance', { days: 12 }, 2);
  assert.equal(result.type, 'snapshot');
  // Reset advances the Worker epoch to keep evidence references from crossing worlds.
  // Compare stable simulation state while treating those run-scoped IDs as equivalent.
  assert.deepEqual(normalizeEpochScopedEvidence(result.snapshot.base.people), normalizeEpochScopedEvidence(day12.base.people));
  assert.deepEqual(result.snapshot.base.structures, day12.base.structures);
  assert.deepEqual(result.snapshot.tileColumns.scalars, day12.tileColumns.scalars);
});
