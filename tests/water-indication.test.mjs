import test from 'node:test';
import assert from 'node:assert/strict';
import { WIDTH, HEIGHT } from '../src/config/ecosystem.js';
import { indicateKnownWaterReference } from '../src/simulation/society/water-indication.js';

function fixture({ known = true, water = true } = {}) {
  const informant = { id: 1, alive: true, x: 2, y: 2, hydration: 70, foodReserve: 50, health: 100, energy: 60 };
  const recipient = { id: 2, alive: true, x: 3.5, y: 2, hydration: 50, foodReserve: 50, health: 100, energy: 60,
    sensoryMemory: { actors: {}, water: [], logs: {} } };
  informant.perception = {
    people: [{ id: 2, visible: true, visibleSignals: { waterDistress: true, physicalEmergency: false } }],
    knownWater: known ? [{ x: 10, y: 10, source: 'lake', lastSeenDay: 3, confidence: 0.8 }] : []
  };
  const tiles = Array.from({ length: WIDTH * HEIGHT }, () => ({ terrain: 'land', plants: [] }));
  if (water) tiles[10 * WIDTH + 10] = { terrain: 'water', waterKind: 'lake', plants: [] };
  return { world: { seed: 42, day: 5, width: WIDTH, height: HEIGHT, tiles, people: [informant, recipient] }, informant, recipient };
}

test('water indication sends an observed reference with a reported source and exact location', () => {
  const { world, informant, recipient } = fixture();

  const result = indicateKnownWaterReference(world, informant, recipient);

  assert.equal(result.transferred, true);
  assert.equal(result.fact.type, 'water_source_indicated');
  assert.deepEqual(result.fact.location, { x: 10, y: 10 });
  assert.deepEqual(result.fact.outcome, { resource: 'water', result: 'reference_received', source: 'lake', lastObservedDay: 3 });
  assert.equal(informant.socialMemories[0].source, 'direct');
  assert.equal(recipient.socialMemories[0].source, 'reported');
  assert.equal(recipient.socialMemories[0].sourcePersonId, '1');
  assert.equal(recipient.sensoryMemory.water[0].knowledgeOrigin, 'reported');
  assert.equal(recipient.sensoryMemory.water[0].evidenceEventId, result.fact.eventId);
  assert.equal(recipient.socialRelations[0].trust, 0.01);
  assert.equal(recipient.socialRelations[0].familiarity, 0);
});

test('water indication cannot invent a location or relay a stale physical source', () => {
  const unknown = fixture({ known: false });
  assert.equal(indicateKnownWaterReference(unknown.world, unknown.informant, unknown.recipient).reason, 'no-known-water');
  assert.equal(unknown.world.socialEvidence, undefined);

  const stale = fixture({ water: false });
  assert.equal(indicateKnownWaterReference(stale.world, stale.informant, stale.recipient).reason, 'no-known-water');
  assert.equal(stale.world.socialEvidence, undefined);
});

test('water indication requires visible need, local reach, and no physical emergency', () => {
  const { world, informant, recipient } = fixture();
  informant.perception.people[0].visibleSignals.waterDistress = false;
  assert.equal(indicateKnownWaterReference(world, informant, recipient).reason, 'no-visible-water-need');
  informant.perception.people[0].visibleSignals.waterDistress = true;
  recipient.x = 5;
  assert.equal(indicateKnownWaterReference(world, informant, recipient).reason, 'out-of-reach');
  recipient.x = 3.5;
  recipient.hydration = 8;
  assert.equal(indicateKnownWaterReference(world, informant, recipient).reason, 'physical-emergency');
  assert.equal(world.socialEvidence, undefined);
});
