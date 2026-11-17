// Headless, reproducible inspection of emergent strategies. This observes
// outcomes rather than claiming that one policy is "intelligent" or optimal.
// Example: node scripts/evaluate-ai-behavior.mjs --days=45 --seeds=1,42 --interval=5
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import Sim from '../src/simulation/engine.js';
import { evaluateAiBehavior } from '../src/simulation/observability/ai-evaluation.js';

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const position = arg.indexOf('=');
  if (!arg.startsWith('--') || position < 0) throw new Error('Use --key=value');
  return [arg.slice(2, position), arg.slice(position + 1)];
}));
const positiveInt = (value, fallback, max) => {
  const number = value == null ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number <= 0 || number > max)
    throw new Error('Invalid positive integer: ' + value);
  return number;
};
const days = positiveInt(args.days, 45, 365);
const interval = positiveInt(args.interval, 5, 365);
const seeds = (args.seeds || '1,42,2026').split(',').map(value => positiveInt(value, 1, 4294967295));
if (!seeds.length || seeds.length > 12 || new Set(seeds).size !== seeds.length)
  throw new Error('Provide 1 to 12 distinct seeds');

const runs = [];
for (const seed of seeds) {
  const world = Sim.createWorld(seed);
  const initial = evaluateAiBehavior(world);
  const checkpoints = [{ ...initial }];
  const previousGoals = new Map(initial.kingdoms.map(k => [k.id, k.strategy.goal]));
  const strategyTransitions = [];
  for (let step = 1; step <= days; step++) {
    Sim.stepDay(world, { includeSnapshot: false });
    // Count goal changes every simulated day, not just at report checkpoints.
    for (const kingdom of world.kingdoms) {
      const next = kingdom.strategy?.goal || null;
      const previous = previousGoals.get(kingdom.id);
      if (previous !== next) {
        strategyTransitions.push({ day: world.day, kingdomId: kingdom.id, from: previous || null, to: next });
        previousGoals.set(kingdom.id, next);
      }
    }
    if (step % interval === 0 || step === days) checkpoints.push(evaluateAiBehavior(world));
  }
  const final = checkpoints.at(-1);
  runs.push({ seed, initialDay: initial.day, finalDay: final.day,
    strategyTransitions, checkpoints,
    summary: {
      strategyChanges: strategyTransitions.length,
      activeWars: final.warTotals.active, resolvedWars: final.warTotals.resolved,
      kingdoms: final.kingdoms.map(k => ({
        id: k.id, goal: k.strategy.goal, population: k.population.alive,
        soldiers: k.population.soldiers, treasuryGold: k.treasury.gold,
        treasuryFood: k.treasury.food, satisfaction: k.politics.satisfaction,
        activeCampaigns: k.military.activeCampaigns
      }))
    } });
}
const report = {
  schemaVersion: 1, kind: 'kingdom-autonomous-behavior', seeds, days, interval,
  limitations: [
    'Headless Node simulation; not browser FPS, input latency, graphics or GPU.',
    'Changing goals is observable activity, not evidence of better decisions.',
    'Decision adapter events are bounded to 120 retained entries per stream and default to disabled.',
    'Food and treasury are physical kingdom-owned balances; not total society production or market wealth.',
    'Evaluate policy quality on held-out seeds and cost/war outcomes, not only accepted proposal rates.'
  ],
  runs
};
if (args.output) {
  const output = resolve(args.output);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ kind: report.kind, days, seeds,
  summaries: runs.map(run => ({ seed: run.seed, ...run.summary })) }, null, 2));
