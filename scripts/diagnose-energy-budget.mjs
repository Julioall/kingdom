import Sim from '../src/simulation/engine.js';
import { applyFrontierLayout } from './frontier-layout.mjs';

const seeds = (process.env.ENERGY_BUDGET_SEEDS || '42').split(',')
  .map(value => Number(value.trim())).filter(Number.isSafeInteger);
const days = Math.max(1, Math.floor(Number(process.env.ENERGY_BUDGET_DAYS || 730)));
const layout = process.env.ENERGY_BUDGET_LAYOUT || 'default';
const adultAge = 12 * 365;
const round = value => Number((value || 0).toFixed(2));

if (layout !== 'default' && layout !== 'frontier') {
  throw new Error(`ENERGY_BUDGET_LAYOUT inválido: ${layout}`);
}

const results = [];
for (const seed of seeds) {
  const world = Sim.createWorld(seed);
  const layoutPlacements = layout === 'frontier' ? applyFrontierLayout(world) : [];
  const exposure = {
    adultDays: 0, energyAtOrBelow2: 0, energyBelow9: 0, energyBelow27: 0,
    reserveAtOrBelow8: 0, reserveBelow16: 0, reserveBelow20: 0,
    reserveAtOrBelow8AndEnergyAtOrBelow2: 0,
    reserveBelow20AndEnergyBelow27: 0,
    meanEnergy: 0, meanReserve: 0
  };
  const actions = {};
  const lowReserveLowEnergySamples = [];
  const startedAt = performance.now();

  for (let day = 0; day < days; day++) {
    const beforeEnergy = new Map(world.people.map(person => [person.id, person.energy]));
    Sim.stepDay(world, null, { includeSnapshot: false });
    for (const person of world.people) {
      if (!person.alive || person.ageDays < adultAge) continue;
      const energy = Math.max(0, Number(person.energy) || 0);
      const reserve = Math.max(0, Number(person.foodReserve) || 0);
      const action = person.brain?.lastAction || person.lastDecision?.action || 'unknown';
      const actionStats = actions[action] ||= { adultDays: 0, energyDelta: 0, energyAtOrBelow2: 0,
        reserveBelow20: 0, reserveAtOrBelow8AndEnergyAtOrBelow2: 0 };
      const energyDelta = energy - (beforeEnergy.get(person.id) ?? energy);
      exposure.adultDays++;
      exposure.meanEnergy += energy;
      exposure.meanReserve += reserve;
      actionStats.adultDays++;
      actionStats.energyDelta += energyDelta;
      if (energy <= 2) { exposure.energyAtOrBelow2++; actionStats.energyAtOrBelow2++; }
      if (energy < 9) exposure.energyBelow9++;
      if (energy < 27) exposure.energyBelow27++;
      if (reserve <= 8) exposure.reserveAtOrBelow8++;
      if (reserve < 16) exposure.reserveBelow16++;
      if (reserve < 20) { exposure.reserveBelow20++; actionStats.reserveBelow20++; }
      if (reserve <= 8 && energy <= 2) {
        exposure.reserveAtOrBelow8AndEnergyAtOrBelow2++;
        actionStats.reserveAtOrBelow8AndEnergyAtOrBelow2++;
        if (lowReserveLowEnergySamples.length < 20) lowReserveLowEnergySamples.push({
          day: world.day, personId: person.id, name: person.name, kingdomId: person.kingdomId,
          action, state: person.state, energy: round(energy), reserve: round(reserve)
        });
      }
      if (reserve < 20 && energy < 27) exposure.reserveBelow20AndEnergyBelow27++;
    }
  }

  const elapsedSeconds = (performance.now() - startedAt) / 1000;
  const unfinishedFarms = world.structures.filter(structure => structure.type === 'roça' && !structure.complete)
    .map(farm => {
      const workers = world.people.filter(person => person.alive && person.ageDays >= adultAge
        && person.communityId === farm.communityId && Math.hypot(person.x - farm.x, person.y - farm.y) <= 14)
        .map(person => ({ id: person.id, name: person.name, energy: round(person.energy),
          reserve: round(person.foodReserve), action: person.brain?.lastAction || person.lastDecision?.action || 'unknown' }))
        .sort((a, b) => b.energy - a.energy || b.reserve - a.reserve);
      return { id: farm.id, communityId: farm.communityId, progress: farm.progress,
        required: farm.required, lastProgressDay: farm.lastProgressDay,
        nearbyWorkerCount: workers.length,
        eligibleWorkerCount: workers.filter(person => person.energy > 27 && person.reserve > 16).length,
        strongestNearbyWorkers: workers.slice(0, 5) };
    });

  results.push({
    seed, days: world.day, layout, layoutPlacements,
    elapsedSeconds: round(elapsedSeconds),
    population: {
      living: world.people.filter(person => person.alive).length,
      dead: world.people.filter(person => !person.alive).length,
      deathsByCause: { ...world.deathsByCause }
    },
    adultExposure: {
      ...exposure,
      meanEnergy: exposure.adultDays ? round(exposure.meanEnergy / exposure.adultDays) : 0,
      meanReserve: exposure.adultDays ? round(exposure.meanReserve / exposure.adultDays) : 0
    },
    actions: Object.fromEntries(Object.entries(actions).map(([action, stats]) => [action, {
      adultDays: stats.adultDays,
      meanEnergyChangePerDay: stats.adultDays ? round(stats.energyDelta / stats.adultDays) : 0,
      energyAtOrBelow2: stats.energyAtOrBelow2,
      reserveBelow20: stats.reserveBelow20,
      reserveAtOrBelow8AndEnergyAtOrBelow2: stats.reserveAtOrBelow8AndEnergyAtOrBelow2
    }])),
    lowReserveLowEnergySamples, unfinishedFarms
  });
  console.error(`Energy budget seed ${seed} finished (${world.day} days) in ${elapsedSeconds.toFixed(1)}s.`);
}

console.log(JSON.stringify({ model: process.version, adultThresholdDays: adultAge, results }, null, 2));
