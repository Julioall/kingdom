import { distance } from '../core/math.js';
import { carriedResources, transferResource } from './inventories.js';
import { moveOne } from '../individuals/movement.js';

export const LOOT_CARGO = Object.freeze({ food: 'carriedFood', meat: 'carriedMeat', wood: 'carriedWood',
  stone: 'carriedStone', gold: 'carriedGold', copper: 'carriedCopper',
  silver: 'carriedSilver', iron: 'carriedIron', feed: 'carriedFeed' });

export function dropStructureLoot(world, structure, day) {
  if (structure.lootDroppedDay != null) return null;
  structure.lootDroppedDay = day;
  const resources = {}, seen = new Set();
  const drain = account => {
    if (!account || seen.has(account)) return;
    seen.add(account);
    for (const resource of Object.keys(LOOT_CARGO)) {
      const amount = Math.max(0, Number(account[resource]) || 0);
      if (amount > 0) { resources[resource] = (resources[resource] || 0) + amount; account[resource] = 0; }
    }
  };
  const kingdom = world.kingdoms.find(k => k.id === structure.kingdomId);
  const community = world.communities.find(c => c.id === structure.communityId);
  for (const account of [structure.stock, structure.stores, structure.inventory?.stock || structure.inventory]) drain(account);
  if (structure.type === 'castelo') drain(kingdom?.treasury?.stock);
  if (structure.type === 'mercado') drain(kingdom?.market?.stock);
  if (structure.type === 'vila' && community) {
    drain(community.stores);
    // Shelter food is a location record of the shared inventory, not extra food.
    for (const s of world.structures.filter(s => s.communityId === community.id)) { s.fruitStored = 0; s.meatStored = 0; }
  }
  if (structure.type === 'curral' && community?.stores) {
    resources.feed = (resources.feed || 0) + Math.max(0, community.stores.feed || 0);
    community.stores.feed = 0;
  }
  for (const [field, resource] of [['fruitStored', 'food'], ['meatStored', 'meat']]) {
    const amount = Math.min(Math.max(0, structure[field] || 0), Math.max(0, community?.stores?.[resource] || 0));
    if (amount > 0) { resources[resource] = (resources[resource] || 0) + amount; community.stores[resource] -= amount; }
    structure[field] = 0;
  }
  if (!Object.values(resources).some(n => n > 0)) return null;
  const pile = { id: world.nextId++, x: structure.x, y: structure.y, resources, available: true,
    sourceStructureId: structure.id, droppedDay: day };
  (world.loot ||= []).push(pile);
  structure.droppedLootId = pile.id;
  return pile;
}

export function nearestLoot(world, person, radius = 7) {
  if (!person.alive || carriedResources(person) >= 24) return null;
  return (world.loot || []).filter(p => p.available && Object.entries(p.resources).some(([resource, amount]) =>
    amount > .001 && !(person.role === 'soldier' && resource === 'stone'))
    && distance(person, p) <= radius).sort((a, b) => distance(person, a) - distance(person, b) || a.id - b.id)[0] || null;
}

export function collectLoot(world, person, pile) {
  if (!person.alive || !pile?.available) return 0;
  if (distance(person, pile) > 1.6) { moveOne(world, person, pile, false); person.state = 'indo recolher recursos derrubados'; return 0; }
  let capacity = Math.max(0, 24 - carriedResources(person)), collected = 0;
  const order = person.foodReserve < 24 ? ['food', 'meat', 'gold', 'wood', 'stone', 'feed'] : ['gold', 'wood', 'stone', 'food', 'meat', 'feed'];
  for (const resource of order) {
    if (person.role === 'soldier' && resource === 'stone') continue;
    const moved = transferResource(pile.resources, person, resource, Math.min(capacity, pile.resources[resource] || 0), LOOT_CARGO[resource]);
    capacity -= moved; collected += moved;
  }
  pile.available = Object.values(pile.resources).some(n => n > .001);
  person.state = 'recolhendo recursos derrubados';
  person.lastLesson = 'Os recursos no chão não têm dono; qualquer pessoa pode recolher o que conseguir carregar.';
  return collected;
}
