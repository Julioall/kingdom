import { distance } from '../core/math.js';
import { cellAt } from '../world/spatial.js';
import { transferResource } from './inventories.js';
import { moveOne } from '../individuals/movement.js';

// Seed parcels are distinct from generic loot: a bag purchased by a kingdom
// retains its owner and destination even after its courier dies or emigrates.
// Generic loot cannot silently convert community-owned seeds into food.
export const SEED_COURIER_CAPACITY = 8;

function seedHistory(world, entry) {
  world.seedProvenance ||= { gathered: 0, sown: 0, history: [] };
  world.seedProvenance.history ||= [];
  world.seedProvenance.history.push({ day: world.day, ...entry });
  if (world.seedProvenance.history.length > 120) world.seedProvenance.history.shift();
}

function validAmount(amount) {
  return Number.isSafeInteger(amount) && amount >= 0;
}

function dropParcel(world, person, source, ownerCommunityId, purpose, fieldId, reason) {
  const quantity = person[source] ?? 0;
  if (!validAmount(quantity)) throw new Error('Invalid seed cargo: refused to fabricate or destroy a parcel');
  if (!quantity) return null;
  const destination = {
    id: world.nextId++, x: person.x, y: person.y,
    seeds: 0, ownerCommunityId, purpose, fieldId: fieldId ?? null,
    originalCourierId: person.id, reason, droppedDay: world.day,
    available: true
  };
  const moved = transferResource(person, destination, source, quantity, 'seeds');
  if (moved !== quantity) throw new Error('Seed parcel transfer was not conservative');
  (world.seedCargoDrops ||= []).push(destination);
  seedHistory(world, { kind: 'seed-parcel-dropped', personId: person.id,
    parcelId: destination.id, ownerCommunityId, quantity, reason, purpose });
  return destination;
}

export function releaseSeedCargo(world, person, { reason = 'migration', includePersonal = false } = {}) {
  if (!world || !person) return [];
  const parcels = [];
  const communal = person.carriedCommunitySeeds ?? 0;
  if (!validAmount(communal)) throw new Error('Invalid community seed cargo');
  if (communal > 0) {
    const owner = person.seedCargoCommunityId;
    if (owner == null) throw new Error('Community seed cargo has no owner');
    const parcel = dropParcel(world, person, 'carriedCommunitySeeds', owner,
      person.seedCargoPurpose || 'construction', person.seedCargoFieldId, reason);
    if (parcel) parcels.push(parcel);
    person.seedCargoCommunityId = null;
    person.seedCargoPurpose = null;
    person.seedCargoFieldId = null;
  }
  if (includePersonal) {
    const parcel = dropParcel(world, person, 'carriedSeeds', null, 'wild', null, reason);
    if (parcel) parcels.push(parcel);
  }
  return parcels;
}

// A parcel remains on the map if the rightful worker cannot reach it. There
// are no implicit warehouse credits or instant transfers after death/migration.
export function recoverSeedCargo(world, person, community, purpose = 'construction', fieldId = null) {
  if (!world || !person?.alive || !community || person.communityId !== community.id) return 'invalid';
  const personal = purpose === 'wild';
  const key = personal ? 'carriedSeeds' : 'carriedCommunitySeeds';
  const already = person[key] ?? 0;
  if (!validAmount(already) || already > SEED_COURIER_CAPACITY) return 'invalid';
  if (!personal && already > 0 && person.seedCargoCommunityId !== community.id) return 'invalid';
  const parcels = (world.seedCargoDrops || []).filter(parcel =>
    parcel.available && validAmount(parcel.seeds) && parcel.seeds > 0 &&
    (personal ? parcel.purpose === 'wild' && parcel.ownerCommunityId == null
      : parcel.ownerCommunityId === community.id &&
        (parcel.purpose === purpose || purpose === 'construction' && parcel.purpose === 'construction')
        && (fieldId == null || parcel.fieldId == null || parcel.fieldId === fieldId))
    && distance(person, parcel) <= 32
  ).sort((a, b) => distance(person, a) - distance(person, b) || a.id - b.id);
  const parcel = parcels[0];
  if (!parcel) return 'none';
  if (already >= SEED_COURIER_CAPACITY) return 'full';
  if (distance(person, parcel) > 1.6) {
    const tile = cellAt(world, Math.round(parcel.x), Math.round(parcel.y));
    if (!tile || !moveOne(world, person, tile, false)) return 'route-blocked';
    person.state = 'indo recuperar lote físico de sementes';
    return 'approaching';
  }
  const transferred = transferResource(parcel, person, 'seeds',
    Math.min(parcel.seeds, SEED_COURIER_CAPACITY - already), key, SEED_COURIER_CAPACITY);
  if (!(transferred > 0)) return 'invalid';
  parcel.available = parcel.seeds > 0;
  if (!personal) {
    person.seedCargoCommunityId = community.id;
    person.seedCargoPurpose = parcel.purpose;
    person.seedCargoFieldId = parcel.fieldId;
  }
  person.state = 'recuperando sementes de uma carga abandonada';
  seedHistory(world, { kind: 'seed-parcel-recovered', personId: person.id,
    parcelId: parcel.id, ownerCommunityId: parcel.ownerCommunityId,
    quantity: transferred, purpose: parcel.purpose });
  return 'recovered';
}

export function communitySeedSupply(world, communityId, purpose = null) {
  const community = (world.communities || []).find(c => c.id === communityId && !c.dissolved);
  if (!community) return 0;
  const stores = Math.max(0, Number(community.stores?.seeds) || 0);
  const carried = (world.people || []).filter(p => p.alive && p.seedCargoCommunityId === communityId
    && (purpose == null || p.seedCargoPurpose === purpose))
    .reduce((sum, p) => sum + (p.carriedCommunitySeeds || 0), 0);
  const dropped = (world.seedCargoDrops || []).filter(p => p.available && p.ownerCommunityId === communityId
    && (purpose == null || p.purpose === purpose))
    .reduce((sum, p) => sum + (p.seeds || 0), 0);
  return stores + carried + dropped;
}

export function reassignMergedSeedOwnership(world, oldCommunityId, newCommunityId) {
  if (oldCommunityId === newCommunityId) return;
  for (const p of world.people || []) if (p.seedCargoCommunityId === oldCommunityId)
    p.seedCargoCommunityId = newCommunityId;
  for (const parcel of world.seedCargoDrops || []) if (parcel.ownerCommunityId === oldCommunityId)
    parcel.ownerCommunityId = newCommunityId;
}
