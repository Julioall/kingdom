import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../../src/simulation/engine.js';
import { PLANTS } from '../../src/config/ecosystem.js';
import { createBrain } from '../../src/controllers/individual/neural.js';
import { kingdomBuildSiteCandidates, chooseKingdomBuildSite, buildKingdomStructure } from '../../src/simulation/kingdoms/commands.js';
import { SITING_STRATEGIES, recordRoyalSitingOutcome, recordRoyalSitingOutcomes } from '../../src/simulation/kingdoms/royal-siting.js';
import { recomputeKingdomTerritories } from '../../src/simulation/kingdoms/territories.js';

function symmetricWorld() {
  const world = { width: Sim.width, height: Sim.height, seed: 42, rngState: 42, day: 0, nextId: 100, events: [],
    people: [], structures: [], kingdomRelations: {}, territoryClaims: [], kingdoms: [] };
  world.tiles = Array.from({ length: world.width * world.height }, (_, i) => ({ i, x: i % world.width, y: Math.floor(i / world.width),
    terrain: 'land', plants: new Float32Array(PLANTS.length), slope: 0, elevationLevel: 0, kingdomId: null }));
  for (const [index, y] of [Math.floor(world.height / 4), world.height - 1 - Math.floor(world.height / 4)].entries()) {
    const id = index + 1;
    const x = index === 0 ? Math.floor(world.width / 2) : world.width - 1 - Math.floor(world.width / 2);
    const kingdom = { id, x, y, name: 'Reino ' + id, rulerId: id + 10, communityId: id + 20,
      treasury: { stock: { wood: 1000, stone: 1000, gold: 1000 } }, structureIds: [id + 30], towerIds: [], militaryCenterIds: [] };
    world.kingdoms.push(kingdom);
    world.structures.push({ id: id + 30, type: 'castelo', kingdomId: id, x, y, complete: true, integrity: 1 });
    world.people.push({ id: id + 40, alive: true, role: 'resident', kingdomId: id, communityId: id + 20,
      ageDays: 8000, x, y, health: 100, foodReserve: 100, hydration: 100 });
  }
  recomputeKingdomTerritories(world);
  return world;
}

test('royal site options are distinct, reachable and previews do not change simulation state', () => {
  const world = Sim.createWorld(42), kingdom = world.kingdoms[0];
  const rng = world.rngState;
  const candidates = kingdomBuildSiteCandidates(world, kingdom, 'torre');
  assert.ok(candidates.length >= 3);
  assert.equal(new Set(candidates.map(c => c.tile.i)).size, candidates.length);
  assert.ok(candidates.every(c => c.tile.terrain === 'land' && c.metrics.access >= 0 && c.reason.includes('Acesso terrestre confirmado')));
  const first = chooseKingdomBuildSite(world, kingdom, 'torre');
  assert.deepEqual(chooseKingdomBuildSite(world, kingdom, 'torre'), first);
  assert.equal(world.rngState, rng);
  assert.equal(kingdom.royalSitingBrain, undefined);
});

test('mirrored kingdoms receive mirrored options and equal policies produce mirrored choices', () => {
  const world = symmetricWorld(), [north, south] = world.kingdoms;
  const a = kingdomBuildSiteCandidates(world, north, 'torre');
  const b = kingdomBuildSiteCandidates(world, south, 'torre');
  assert.equal(a.length, b.length);
  for (const option of a) {
    const mirror = b.find(c => c.strategy === option.strategy);
    assert.equal(mirror.tile.x, world.width - 1 - option.tile.x);
    assert.equal(mirror.tile.y, world.height - 1 - option.tile.y);
    assert.deepEqual(mirror.metrics.gain, option.metrics.gain);
  }
  for (const k of world.kingdoms) {
    k.royalSitingBrain = createBrain({ seed: 42, rngState: 42 }, SITING_STRATEGIES, 8, 1);
    k.royalSitingBrain.outputWeights.fill(0);
  }
  const first = chooseKingdomBuildSite(world, north, 'torre'), second = chooseKingdomBuildSite(world, south, 'torre');
  assert.equal(second.x, world.width - 1 - first.x);
  assert.equal(second.y, world.height - 1 - first.y);
});

test('the king commits a real site choice once and learns completion and loss outcomes once each', () => {
  const world = symmetricWorld(), kingdom = world.kingdoms[0];
  const result = buildKingdomStructure(world, kingdom.id, 'torre');
  assert.equal(result.ok, true);
  assert.equal(kingdom.royalSitingBrain.decisions, 1);
  assert.ok(result.structure.sitingDecision.alternatives.length >= 3);
  result.structure.complete = true;
  recordRoyalSitingOutcomes(world, 30);
  recordRoyalSitingOutcomes(world, 31);
  assert.equal(kingdom.royalSitingBrain.updates, 1);
  const index = SITING_STRATEGIES.indexOf(result.structure.sitingDecision.strategy);
  const beforeLoss = kingdom.royalSitingBrain.actionValues[index];
  recordRoyalSitingOutcome(world, result.structure, 'lost', 50);
  recordRoyalSitingOutcome(world, result.structure, 'lost', 51);
  assert.equal(kingdom.royalSitingBrain.updates, 2);
  assert.ok(kingdom.royalSitingBrain.actionValues[index] < beforeLoss);
  assert.equal(kingdom.sitingHistory.length, 2);
});

test('failed funding does not commit or train a royal site policy', () => {
  const world = symmetricWorld(), kingdom = world.kingdoms[0];
  kingdom.treasury.stock.wood = 0;
  assert.equal(buildKingdomStructure(world, kingdom.id, 'torre').ok, false);
  assert.equal(kingdom.royalSitingBrain, undefined);
  assert.equal(kingdom.lastSitingDecision, undefined);
});
