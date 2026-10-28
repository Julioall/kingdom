import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../src/simulation/engine.js';
import { killPerson } from '../src/simulation/individuals/lifecycle.js';
import { joinCommunity, mergeCommunities } from '../src/simulation/society/communities.js';
import { releaseSeedCargo, recoverSeedCargo, communitySeedSupply } from '../src/simulation/economy/seed-cargo.js';
import { workOnReplantingField } from '../src/simulation/settlements/construction.js';
import { purchaseFieldSeedsForConstruction } from '../src/simulation/economy/trade.js';

function fixture() {
  const world = Sim.createWorld(42);
  const kingdom = world.kingdoms[0];
  const community = world.communities.find(c => c.id === kingdom.communityId);
  const residents = world.people.filter(p => p.alive && p.communityId === community.id && p.role !== 'soldier');
  const [courier, replacement] = residents;
  const source = world.structures.find(s => s.communityId === community.id && s.complete
    && ['vila', 'abrigo', 'posto de coleta'].includes(s.type) && s.destroyedDay == null);
  assert.ok(courier && replacement && source);
  return { world, kingdom, community, courier, replacement, source };
}

function spentField(f, { quantity = 8 } = {}) {
  const { world, community, source } = f;
  const tile = world.tiles.find(t => t.terrain === 'land' && t.cropFieldId == null
    && Math.hypot(t.x - source.x, t.y - source.y) >= 4);
  assert.ok(tile);
  const field = { id: world.nextId++, type: 'roça', complete: true, communityId: community.id,
    x: tile.x, y: tile.y, fieldTileIndices: [tile.i], cropCycleState: 'spent',
    cropSeededBiomass: quantity, seedMass: quantity, integrity: 1,
    cropSeedStored: 0, cropSowCount: 1 };
  tile.cropFieldId = field.id;
  tile.plants.fill(0);
  world.structures.push(field);
  return { field, tile };
}

test('courier death drops original funded seed bag and permits exact successor recovery', () => {
  const f = fixture();
  const { world, courier, replacement, community } = f;
  courier.carriedCommunitySeeds = 8;
  courier.seedCargoCommunityId = community.id;
  courier.seedCargoPurpose = 'construction';
  const beforeSupply = communitySeedSupply(world, community.id);
  killPerson(world, courier, 'injury');
  assert.equal(courier.carriedCommunitySeeds, 0);
  assert.equal(courier.seedCargoCommunityId, null);
  assert.equal(world.seedCargoDrops.length, 1);
  const parcel = world.seedCargoDrops[0];
  assert.equal(parcel.ownerCommunityId, community.id);
  assert.equal(parcel.seeds, 8);
  assert.equal(parcel.reason, 'death');
  assert.equal(communitySeedSupply(world, community.id), beforeSupply);
  replacement.x = parcel.x; replacement.y = parcel.y;
  assert.equal(recoverSeedCargo(world, replacement, community, 'construction'), 'recovered');
  assert.equal(parcel.seeds, 0);
  assert.equal(parcel.available, false);
  assert.equal(replacement.carriedCommunitySeeds, 8);
  assert.equal(replacement.seedCargoCommunityId, community.id);
  assert.equal(communitySeedSupply(world, community.id), beforeSupply);
  assert.equal(recoverSeedCargo(world, replacement, community, 'construction'), 'none');
  assert.equal(world.seedCargoDrops.length, 1, 'recovery cannot mint a second parcel');
});

test('changing communities releases commissioned seed cargo at its prior location', () => {
  const f = fixture();
  const { world, courier, replacement, community } = f;
  courier.carriedCommunitySeeds = 8;
  courier.seedCargoCommunityId = community.id;
  courier.seedCargoPurpose = 'construction';
  courier.carriedSeeds = 3; // Personal wild stock stays with its gatherer when emigrating.
  const newcomer = { id: world.nextId++, name: 'Nova comunidade', isKingdomGroup: false,
    kingdomId: courier.kingdomId, memberIds: [], x: courier.x + 1, y: courier.y + 1,
    usedCells: {}, stores: { seeds: 0 }, history: [] };
  world.communities.push(newcomer);
  const before = communitySeedSupply(world, community.id);
  joinCommunity(world, courier, newcomer.id);
  assert.equal(courier.communityId, newcomer.id);
  assert.equal(courier.carriedCommunitySeeds, 0);
  assert.equal(courier.carriedSeeds, 3);
  assert.equal(world.seedCargoDrops[0].ownerCommunityId, community.id);
  assert.equal(communitySeedSupply(world, community.id), before);
  assert.equal(recoverSeedCargo(world, courier, newcomer, 'construction'), 'none');
  replacement.x = world.seedCargoDrops[0].x;
  replacement.y = world.seedCargoDrops[0].y;
  assert.equal(recoverSeedCargo(world, replacement, community, 'construction'), 'recovered');
  assert.equal(communitySeedSupply(world, community.id), before);
});

test('death of a personal wild seed gatherer conserves an unowned natural parcel', () => {
  const { world, courier, replacement, community } = fixture();
  courier.carriedSeeds = 3;
  killPerson(world, courier, 'injury');
  const parcel = world.seedCargoDrops[0];
  assert.equal(parcel.purpose, 'wild');
  assert.equal(parcel.ownerCommunityId, null);
  assert.equal(courier.carriedSeeds, 0);
  replacement.x = parcel.x; replacement.y = parcel.y;
  assert.equal(recoverSeedCargo(world, replacement, community, 'wild'), 'recovered');
  assert.equal(replacement.carriedSeeds, 3);
  assert.equal(parcel.seeds, 0);
  assert.equal(world.seedCargoDrops.length, 1);
});

test('blocked physical route leaves a lost bag and owner unchanged', () => {
  const { world, courier, replacement, community } = fixture();
  courier.carriedCommunitySeeds = 8;
  courier.seedCargoCommunityId = community.id;
  courier.seedCargoPurpose = 'replant';
  courier.seedCargoFieldId = 999;
  const [parcel] = releaseSeedCargo(world, courier, { reason: 'migration' });
  replacement.x = parcel.x + 9; replacement.y = parcel.y + 9;
  world.tiles = [];
  assert.equal(recoverSeedCargo(world, replacement, community, 'replant', 999), 'route-blocked');
  assert.equal(parcel.seeds, 8);
  assert.equal(replacement.carriedCommunitySeeds, 0);
});

test('replanting withdraws seeds at a real storage building before delivery to the field', () => {
  const f = fixture();
  const { world, courier, source, community } = f;
  const { field, tile } = spentField(f);
  community.stores.seeds = 8;
  const beforeSown = world.seedProvenance.sown;
  courier.x = source.x + 8;
  courier.y = source.y + 8;
  workOnReplantingField(world, courier, community, field.id);
  assert.equal(community.stores.seeds, 8, 'no remote withdrawal from warehouse');
  assert.equal(courier.carriedCommunitySeeds, 0);
  courier.x = source.x; courier.y = source.y;
  assert.equal(workOnReplantingField(world, courier, community, field.id), false);
  assert.equal(community.stores.seeds, 0);
  assert.equal(courier.carriedCommunitySeeds, 8);
  assert.equal(courier.seedCargoCommunityId, community.id);
  assert.equal(courier.seedCargoPurpose, 'replant');
  assert.equal(courier.seedCargoFieldId, field.id);
  assert.equal(communitySeedSupply(world, community.id, 'replant'), 8);
  courier.x = tile.x; courier.y = tile.y;
  assert.equal(workOnReplantingField(world, courier, community, field.id), true);
  assert.equal(courier.carriedCommunitySeeds, 0);
  assert.equal(courier.seedCargoCommunityId, null);
  assert.equal(field.cropSeedStored, 0);
  assert.equal(field.cropSeededBiomass, 8);
  assert.equal(field.cropCycleState, 'growing');
  assert.equal(world.seedProvenance.sown, beforeSown + 8);
  assert.equal(communitySeedSupply(world, community.id, 'replant'), 0);
});

test('a dead replant courier is replaced: parcel recovered on site then used exactly once', () => {
  const f = fixture();
  const { world, courier, replacement, source, community } = f;
  const { field, tile } = spentField(f);
  community.stores.seeds = 8;
  courier.x = source.x; courier.y = source.y;
  workOnReplantingField(world, courier, community, field.id);
  assert.equal(courier.carriedCommunitySeeds, 8);
  killPerson(world, courier, 'injury');
  assert.equal(communitySeedSupply(world, community.id, 'replant'), 8);
  const parcel = world.seedCargoDrops[0];
  replacement.x = parcel.x; replacement.y = parcel.y;
  assert.equal(workOnReplantingField(world, replacement, community, field.id), false);
  assert.equal(replacement.carriedCommunitySeeds, 8);
  assert.equal(parcel.available, false);
  replacement.x = tile.x; replacement.y = tile.y;
  assert.equal(workOnReplantingField(world, replacement, community, field.id), true);
  assert.equal(world.seedProvenance.sown, 8);
  assert.equal(communitySeedSupply(world, community.id, 'replant'), 0);
});

test('death parcel release is idempotent and never changes monetary stock', () => {
  const { world, kingdom, courier, community } = fixture();
  const gold = kingdom.treasury.stock.gold + kingdom.market.stock.gold;
  courier.carriedCommunitySeeds = 8;
  courier.seedCargoCommunityId = community.id;
  courier.seedCargoPurpose = 'construction';
  releaseSeedCargo(world, courier, { reason: 'migration' });
  releaseSeedCargo(world, courier, { reason: 'migration' });
  assert.equal(world.seedCargoDrops.length, 1);
  assert.equal(world.seedCargoDrops[0].seeds, 8);
  assert.equal(kingdom.treasury.stock.gold + kingdom.market.stock.gold, gold);
});

test('fractional legacy crop seeds survive death, physical recovery and replanting without rounding', () => {
  const f = fixture();
  const { world, courier, replacement, community } = f;
  const { field, tile } = spentField(f, { quantity: 2.75 });
  courier.carriedCommunitySeeds = 2.75;
  courier.seedCargoCommunityId = community.id;
  courier.seedCargoPurpose = 'replant';
  courier.seedCargoFieldId = field.id;
  killPerson(world, courier, 'injury');
  const parcel = world.seedCargoDrops[0];
  assert.equal(parcel.seeds, 2.75);
  replacement.x = parcel.x; replacement.y = parcel.y;
  assert.equal(recoverSeedCargo(world, replacement, community, 'replant', field.id), 'recovered');
  assert.equal(replacement.carriedCommunitySeeds, 2.75);
  replacement.x = tile.x; replacement.y = tile.y;
  assert.equal(workOnReplantingField(world, replacement, community, field.id), true);
  assert.equal(world.seedProvenance.sown, 2.75);
  assert.equal(parcel.seeds, 0);
  assert.equal(replacement.carriedCommunitySeeds, 0);
});

test('already paid construction seeds can be recovered after destruction of the market station', () => {
  const { world, courier, replacement, community, kingdom } = fixture();
  courier.carriedCommunitySeeds = 8;
  courier.seedCargoCommunityId = community.id;
  courier.seedCargoPurpose = 'construction';
  const [parcel] = releaseSeedCargo(world, courier, { reason: 'migration' });
  const station = world.structures.find(s => s.type === 'mercado' && s.kingdomId === kingdom.id);
  assert.ok(station);
  station.destroyedDay = world.day;
  replacement.x = parcel.x; replacement.y = parcel.y;
  assert.equal(purchaseFieldSeedsForConstruction(world, replacement, community), 'recovered');
  assert.equal(replacement.carriedCommunitySeeds, 8);
  assert.equal(parcel.seeds, 0);
  assert.equal(kingdom.market.stock.seeds, 0);
});

test('a worker cannot mix a construction parcel with a replant order', () => {
  const { world, courier, replacement, community } = fixture();
  courier.carriedCommunitySeeds = 5;
  courier.seedCargoCommunityId = community.id;
  courier.seedCargoPurpose = 'replant';
  courier.seedCargoFieldId = 901;
  const [parcel] = releaseSeedCargo(world, courier, { reason: 'migration' });
  replacement.x = parcel.x; replacement.y = parcel.y;
  replacement.carriedCommunitySeeds = 3;
  replacement.seedCargoCommunityId = community.id;
  replacement.seedCargoPurpose = 'construction';
  const before = parcel.seeds + replacement.carriedCommunitySeeds;
  assert.equal(recoverSeedCargo(world, replacement, community, 'replant', 901), 'invalid');
  assert.equal(parcel.seeds + replacement.carriedCommunitySeeds, before);
  assert.equal(replacement.seedCargoPurpose, 'construction');
  assert.equal(replacement.carriedCommunitySeeds, 3);
});
