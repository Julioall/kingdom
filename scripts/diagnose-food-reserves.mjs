import Sim from '../src/simulation/engine.js';
import { applyFrontierLayout } from './frontier-layout.mjs';

const seed = Math.max(1, Math.floor(Number(process.env.FOOD_RESERVE_SEED || 2026)));
const days = Math.max(1, Math.floor(Number(process.env.FOOD_RESERVE_DAYS || 730)));
const layout = process.env.FOOD_RESERVE_LAYOUT || 'default';
const round = value => Number((value || 0).toFixed(6));
const totalReserve = people => people.reduce((sum, person) => sum + (person.foodReserve || 0), 0);

const world = Sim.createWorld(seed);
const layoutPlacements = layout === 'frontier' ? applyFrontierLayout(world) : [];
if (layout !== 'frontier' && layout !== 'default') {
  throw new Error(`FOOD_RESERVE_LAYOUT inválido: ${layout}`);
}
const categories = new Map();
let activeDay = null;
let maxDailyResidual = 0;
let firstResidualDay = null;
let daysWithResidual = 0;
let operationCount = 0;

function recordFoodReserveFlow({ category, delta }) {
  const key = category || 'uncategorized';
  const totals = categories.get(key) || { added: 0, removed: 0, net: 0, operations: 0 };
  if (delta > 0) totals.added += delta;
  else if (delta < 0) totals.removed -= delta;
  totals.net += delta;
  totals.operations++;
  categories.set(key, totals);
  if (activeDay) {
    activeDay[key] ||= 0;
    activeDay[key] += delta;
    operationCount++;
  }
}

world.foodReserveFlowRecorder = recordFoodReserveFlow;
for (const person of world.people) person.foodReserveFlowRecorder = recordFoodReserveFlow;
const openingReservePoints = totalReserve(world.people);

for (let day = 0; day < days; day++) {
  const before = totalReserve(world.people);
  activeDay = {};
  Sim.stepDay(world, null, { includeSnapshot: false });
  const after = totalReserve(world.people);
  const recordedNet = Object.values(activeDay).reduce((sum, delta) => sum + delta, 0);
  const residual = after - before - recordedNet;
  const absoluteResidual = Math.abs(residual);
  if (absoluteResidual > maxDailyResidual) maxDailyResidual = absoluteResidual;
  if (absoluteResidual > .000001) {
    daysWithResidual++;
    firstResidualDay ??= world.day;
  }
}
activeDay = null;

const closingReservePoints = totalReserve(world.people);
const recordedNet = [...categories.values()].reduce((sum, totals) => sum + totals.net, 0);
for (const person of world.people) delete person.foodReserveFlowRecorder;
delete world.foodReserveFlowRecorder;

console.log(JSON.stringify({
  type: 'personal-food-reserve-audit', seed, days: world.day, layout, layoutPlacements,
  population: {
    living: world.people.filter(person => person.alive).length,
    dead: world.people.filter(person => !person.alive).length,
    deathsByCause: { ...world.deathsByCause }
  },
  reservePoints: {
    opening: round(openingReservePoints),
    closing: round(closingReservePoints),
    recordedNet: round(recordedNet),
    unexplainedNet: round(closingReservePoints - openingReservePoints - recordedNet),
    totalAdded: round([...categories.values()].reduce((sum, totals) => sum + totals.added, 0)),
    totalRemoved: round([...categories.values()].reduce((sum, totals) => sum + totals.removed, 0))
  },
  dailyValidation: {
    daysChecked: world.day,
    daysWithResidual,
    maxAbsoluteResidual: round(maxDailyResidual),
    firstResidualDay,
    operations: operationCount
  },
  flowsByCategory: Object.fromEntries([...categories.entries()].map(([category, totals]) => [category, {
    added: round(totals.added), removed: round(totals.removed), net: round(totals.net), operations: totals.operations
  }]))
}));
