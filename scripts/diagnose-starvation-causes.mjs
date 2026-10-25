import Sim from '../src/simulation/engine.js';
import { bestPeopleFoodCell } from '../src/simulation/individuals/actions.js';
import { distance } from '../src/simulation/core/math.js';

const seeds = (process.env.STARVATION_DIAGNOSE_SEEDS || '1,42').split(',')
  .map(value => Number(value.trim())).filter(Number.isSafeInteger);
const days = Math.max(1, Math.floor(Number(process.env.STARVATION_DIAGNOSE_DAYS || 1460)));
const adultAgeDays = 12 * 365;
const round = value => Number((Number(value) || 0).toFixed(2));

function summarizeFoodPerception(world, person) {
  const resources = (person.perception?.resources || [])
    .filter(resource => resource.terrain === 'land')
    .map(resource => {
      const biomass = resource.harvestableBiomass || resource.biomass || {};
      const available = (biomass.berry || 0) + (biomass['cultivated-root'] || 0);
      return {
        x: resource.x,
        y: resource.y,
        distance: round(resource.distance),
        availableBiomass: round(available),
        harvestableBiomass: round(Math.min(available, 1.8 + (person.skills?.forage || 0) * 3.2)),
        slope: round(resource.slope),
        visible: !!resource.visible
      };
    })
    .filter(resource => resource.availableBiomass > .8)
    .sort((a, b) => a.distance - b.distance || b.availableBiomass - a.availableBiomass)
    .slice(0, 5);
  const selected = bestPeopleFoodCell(world, person, 8);
  return {
    selectedTarget: selected ? { x: selected.x, y: selected.y } : null,
    nearestFood: resources
  };
}

function summarizeDeath(world, person, recentHistory = [], emergencyFoodConsumed = 0) {
  const community = world.communities.find(item => item.id === person.communityId);
  const kingdom = world.kingdoms.find(item => item.id === person.kingdomId);
  const familyIds = new Set([...(person.parents || []), person.guardianId].filter(Number.isInteger));
  const family = [...familyIds].map(id => {
    const relative = world.people.find(item => item.id === id);
    return relative ? {
      id: relative.id,
      name: relative.name,
      alive: relative.alive,
      ageYears: round(relative.ageDays / 365),
      distance: round(distance(person, relative)),
      reserve: round(relative.foodReserve),
      action: relative.brain?.lastAction || relative.lastDecision?.action || null,
      state: relative.state || null
    } : { id, missing: true };
  });
  const nearbyAdults = world.people.filter(item => item.alive && item.ageDays >= adultAgeDays
      && item.kingdomId === person.kingdomId && item.id !== person.id)
    .map(item => ({
      id: item.id,
      name: item.name,
      distance: round(distance(person, item)),
      reserve: round(item.foodReserve),
      energy: round(item.energy),
      action: item.brain?.lastAction || item.lastDecision?.action || null,
      state: item.state || null,
      onCampaign: item.campaignId != null
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 5);

  return {
    id: person.id,
    name: person.name,
    cause: person.deathCause,
    day: person.deathDay ?? world.day,
    ageDays: person.ageDays,
    ageYears: round(person.ageDays / 365),
    dependent: person.ageDays < adultAgeDays,
    role: person.role,
    kingdom: kingdom?.name || null,
    kingdomId: person.kingdomId ?? null,
    community: community?.name || null,
    communityId: person.communityId ?? null,
    position: { x: round(person.x), y: round(person.y) },
    health: round(person.health),
    reserve: round(person.foodReserve),
    hydration: round(person.hydration),
    energy: round(person.energy),
    injury: round(person.injury),
    action: person.brain?.lastAction || person.lastDecision?.action || null,
    state: person.state || null,
    assignment: person.assignment ? {
      action: person.assignment.action,
      goal: person.assignment.goal || null,
      pausedFor: person.assignment.pauseReason || null,
      expiresDay: person.assignment.expiresDay
    } : null,
    carried: {
      food: round(person.carriedFood),
      fruit: round(person.carriedFruit),
      meat: round(person.carriedMeat)
    },
    communityFood: round(community?.stores?.food),
    kingdomTreasuryFood: round(kingdom?.treasury?.stock?.food),
    family,
    nearbyAdults,
    foodPerception: summarizeFoodPerception(world, person),
    recentHistory,
    emergencyFoodConsumed: round(emergencyFoodConsumed)
  };
}

function summarizeDailyState(person, day) {
  return {
    day,
    x: round(person.x),
    y: round(person.y),
    target: person.foodTarget ? { x: person.foodTarget.x, y: person.foodTarget.y } : null,
    reserve: round(person.foodReserve),
    energy: round(person.energy),
    hydration: round(person.hydration),
    health: round(person.health),
    action: person.brain?.lastAction || person.lastDecision?.action || null,
    state: person.state || null,
    carriedFood: round(person.carriedFood),
    movementCooldown: round(person.moveCooldown)
  };
}

const results = [];
for (const seed of seeds) {
  const startedAt = performance.now();
  const world = Sim.createWorld(seed);
  const seenDead = new Set(world.people.filter(person => !person.alive).map(person => person.id));
  const deaths = [];
  const recentHistory = new Map();
  const emergencyFoodConsumedByPerson = new Map();
  for (const person of world.people) {
    person.inventoryFlowRecorder = (category, delta) => {
      if (category !== 'emergency-carried-food-consumption') return;
      emergencyFoodConsumedByPerson.set(person.id,
        (emergencyFoodConsumedByPerson.get(person.id) || 0) - (delta.carriedFood || 0));
    };
  }

  for (let index = 0; index < days; index++) {
    Sim.stepDay(world, null, { includeSnapshot: false });
    for (const person of world.people) {
      const history = recentHistory.get(person.id);
      const atRisk = person.foodReserve <= 40 || person.energy <= 5 || person.hydration <= 15;
      const diedToday = !person.alive && person.deathDay === world.day;
      if ((!history && !atRisk) || (!person.alive && !diedToday)) continue;
      const nextHistory = history || [];
      nextHistory.push(summarizeDailyState(person, world.day));
      if (nextHistory.length > 60) nextHistory.shift();
      recentHistory.set(person.id, nextHistory);
    }
    for (const person of world.people) {
      if (person.alive || seenDead.has(person.id)) continue;
      seenDead.add(person.id);
      deaths.push(summarizeDeath(world, person, recentHistory.get(person.id) || [],
        emergencyFoodConsumedByPerson.get(person.id) || 0));
    }
  }

  results.push({
    seed,
    days: world.day,
    elapsedSeconds: round((performance.now() - startedAt) / 1000),
    population: {
      living: world.people.filter(person => person.alive).length,
      deathsByCause: { ...world.deathsByCause }
    },
    emergencyFoodPolicy: {
      totalCarriedFoodConsumed: round([...emergencyFoodConsumedByPerson.values()].reduce((sum, amount) => sum + amount, 0)),
      peopleRationed: emergencyFoodConsumedByPerson.size
    },
    starvationDeaths: deaths.filter(death => death.cause === 'starvation'),
    otherDeaths: deaths.filter(death => death.cause !== 'starvation')
  });
  console.error(`Starvation diagnosis seed ${seed} finished (${world.day} days).`);
}

console.log(JSON.stringify({ model: process.version, adultAgeDays, results }, null, 2));
