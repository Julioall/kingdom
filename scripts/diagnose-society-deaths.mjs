import Sim from '../src/simulation/engine.js';

const seeds = (process.env.SOCIETY_SEEDS || '987,1').split(',')
  .map(value => Number(value.trim())).filter(Number.isSafeInteger);
const days = Math.max(1, Math.floor(Number(process.env.SOCIETY_DAYS || 730)));
const historyDays = Math.max(1, Math.floor(Number(process.env.SOCIETY_HISTORY_DAYS || 45)));

function snapshot(person, day) {
  return {
    id: person.id,
    name: person.name,
    day,
    alive: person.alive,
    deathCause: person.deathCause || null,
    deathDay: person.deathDay ?? null,
    ageDays: person.ageDays,
    foodReserve: Number((person.foodReserve || 0).toFixed(2)),
    carriedFood: Number((person.carriedFood || 0).toFixed(2)),
    hydration: Number((person.hydration || 0).toFixed(2)),
    health: Number((person.health || 0).toFixed(2)),
    injury: Number((person.injury || 0).toFixed(2)),
    energy: Number((person.energy || 0).toFixed(2)),
    action: person.lastDecision?.action || person.brain?.lastAction || null,
    state: person.state || '',
    kingdomId: person.kingdomId ?? null,
    communityId: person.communityId ?? null,
    homeId: person.homeId ?? null,
    role: person.role || null,
    parents: person.parents ? [...person.parents] : [],
    guardianId: person.guardianId ?? null,
    assignment: person.assignment ? {
      action: person.assignment.action,
      phase: person.assignment.supplyPhase || null,
      progress: person.assignment.progress || 0,
      priority: person.assignment.priority || null
    } : null,
    x: Number((person.x || 0).toFixed(1)),
    y: Number((person.y || 0).toFixed(1)),
    exposure: person.territoryExposure ? { ...person.territoryExposure } : null,
    lesson: person.lastLesson || ''
  };
}

function run(seed) {
  const world = Sim.createWorld(seed);
  const histories = new Map();
  const deathRecords = new Map();
  const events = [];
  const eventList = world.events;
  const nativeUnshift = eventList.unshift;
  Object.defineProperty(eventList, 'unshift', {
    configurable: true,
    enumerable: false,
    writable: true,
    value(...items) {
      events.push(...items);
      return nativeUnshift.apply(this, items);
    }
  });

  for (let i = 0; i < days; i++) {
    Sim.stepDay(world, null, { includeSnapshot: false });
    for (const person of world.people) {
      const history = histories.get(person.id) || [];
      history.push(snapshot(person, world.day));
      if (history.length > historyDays) history.shift();
      histories.set(person.id, history);
      if (!person.alive && !deathRecords.has(person.id)) {
        const familyIds = new Set([...(person.parents || []), person.guardianId].filter(Number.isInteger));
        const careNetwork = world.people.filter(other => other.alive
          && (familyIds.has(other.id) || (other.kingdomId === person.kingdomId
            && Math.hypot(other.x - person.x, other.y - person.y) <= 6)))
          .map(other => snapshot(other, world.day));
        const community = world.communities.find(item => item.id === person.communityId) || null;
        deathRecords.set(person.id, {
          history: history.slice(), careNetwork,
          familyAtDeath: world.people.filter(other => familyIds.has(other.id))
            .map(other => snapshot(other, world.day)),
          community: community ? {
            id: community.id, name: community.name, stage: community.stage,
            lastGovernanceDay: community.lastGovernanceDay,
            stores: { ...community.stores },
            foodStock: community.foodStock ?? null
          } : null
        });
      }
    }
  }
  delete eventList.unshift;

  const deaths = world.people.filter(person => !person.alive).map(person => {
    const deathDay = person.deathDay ?? world.day;
    return {
      name: person.name,
      id: person.id,
      cause: person.deathCause || 'unknown',
      deathDay,
      lastState: snapshot(person, deathDay),
      history: deathRecords.get(person.id)?.history || histories.get(person.id) || [],
      careNetworkAtDeath: deathRecords.get(person.id)?.careNetwork || [],
      familyAtDeath: deathRecords.get(person.id)?.familyAtDeath || [],
      communityAtDeath: deathRecords.get(person.id)?.community || null,
      nearbyEvents: events.filter(event => event.day >= deathDay - 14 && event.day <= deathDay + 1
        && (event.text.includes(person.name) || /alimento|fome|forag|reserva|expuls|territ[oó]rio|morreu/i.test(event.text)))
    };
  });

  return {
    seed,
    days: world.day,
    livingPeople: world.people.filter(person => person.alive).length,
    deathsByCause: { ...world.deathsByCause },
    deaths
  };
}

console.log(JSON.stringify({ runtime: process.version, results: seeds.map(run) }, null, 2));
