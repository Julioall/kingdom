import Sim from '../src/simulation/engine.js';
import { carriedResources, communityFoodStock } from '../src/simulation/economy/inventories.js';

const seed = Number(process.env.LATE_SEED || 42);
const days = Math.max(1, Number(process.env.LATE_DAYS || 2100));
const world = Sim.createWorld(seed);
const lastKingdoms = new Map(world.people.map(p => [p.id, p.kingdomId]));
const departures = [];
const detailed = process.env.LATE_DETAILS === '1';
const rootIndex = Sim.plants.findIndex(p => p.id === 'cultivated-root');
function report() {
  const living = world.people.filter(p => p.alive);
  const waiting = living.filter(p => /^aguardando abrigo/.test(p.state || ''));
  const states = {};
  for (const p of living) states[p.state] = (states[p.state] || 0) + 1;
  console.log(JSON.stringify({ seed, day: world.day, living: living.length,
    lowFood: living.filter(p => p.foodReserve < 24).length,
    lowWater: living.filter(p => p.hydration < 22).length,
    independent: living.filter(p => p.kingdomId == null).length,
    departures: departures.length,
    recentDepartures: departures.slice(-4),
    waitingStorage: waiting.length,
    invalidGenerals: living.filter(p => p.militaryRank === 'general'
      && (p.role !== 'soldier' || !world.kingdoms.some(k => k.id === p.kingdomId))).length,
    kingdoms: world.kingdoms.map(k => ({ id: k.id,
      members: living.filter(p => p.kingdomId === k.id).length,
      food: communityFoodStock(world.communities.find(c => c.id === k.communityId && !c.dissolved)),
      satisfaction: world.communities.find(c => c.id === k.communityId)?.satisfaction,
      shelters: world.structures.filter(s => s.communityId === k.communityId && s.complete && s.type === 'abrigo').length,
      fields: world.structures.filter(s => s.communityId === k.communityId && s.complete && s.type === 'roça').length,
      ...(detailed ? {
        fieldResources: world.structures.filter(s => s.communityId === k.communityId && s.type === 'roça').map(s => ({
          id: s.id, x: s.x, y: s.y, complete: s.complete, progress: s.progress, harvested: s.cropHarvested,
          biomass: (s.fieldTileIndices || []).reduce((sum, i) => sum + world.tiles[i].plants[rootIndex], 0)
        })),
        workers: living.filter(p => p.kingdomId === k.id && p.role !== 'soldier' && p.ageDays >= 12 * 365).map(p => ({
          id: p.id, x: p.x, y: p.y, food: p.foodReserve, energy: p.energy, state: p.state, task: p.assignment?.action,
          cargo: p.carriedFood, rootsSeen: (p.perception?.resources || []).filter(r => (r.harvestableBiomass?.['cultivated-root'] || 0) > 1).length
        }))
      } : {}),
      treasuryFood: k.treasury?.stock?.food || 0, marketFood: k.market?.stock?.food || 0 })),
    states, waiting: waiting.slice(0, 8).map(p => ({ id: p.id, role: p.role, kingdomId: p.kingdomId,
      energy: p.energy, food: p.foodReserve, hydration: p.hydration, cargo: carriedResources(p) })) }));
}
report();
for (let day = 0; day < days; day++) {
  Sim.stepDay(world, null, { includeSnapshot: false });
  for (const person of world.people) {
    const before = lastKingdoms.get(person.id);
    if (before != null && person.alive && person.kingdomId == null) departures.push({ day: world.day,
      id: person.id, kingdomId: before, role: person.role, food: person.foodReserve,
      health: person.health, reason: person.lastLesson });
    lastKingdoms.set(person.id, person.kingdomId);
  }
  if (world.day % 100 === 0 || day === days - 1) report();
}
