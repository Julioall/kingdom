// Reproducible comparison of the three Kingdom campaign controllers.
// Run: node scripts/benchmark-squad-hierarchy.mjs --days=45 --seeds=1,42,2026
// Browser FPS, full Flow Fields and long-term balance require separate QA.
import { performance } from 'node:perf_hooks';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Sim from '../src/simulation/engine.js';

const args = Object.fromEntries(process.argv.slice(2)
  .map(value => value.replace(/^--/, '').split('=')));
const days = Math.max(1, Math.min(120, Number(args.days) || 45));
const seeds = (args.seeds || '1,42,2026').split(',').map(Number).filter(Number.isFinite);
const scenario = args.scenario || 'defender';
const modes = ['legacy', 'commanders', 'hierarchical'];
const measures = [];

function warFixture(world) {
  const [attacker, defender] = world.kingdoms;
  if (!attacker || !defender) throw new Error('Requires two initialized kingdoms');
  const key = Math.min(attacker.id, defender.id) + ':' + Math.max(attacker.id, defender.id);
  const requested = scenario === 'midpoint'
    ? { x: (attacker.x + defender.x) / 2, y: (attacker.y + defender.y) / 2 }
    : { x: defender.x, y: defender.y };
  const closestLand = world.tiles.reduce((best, tile) => tile.terrain === 'land'
    && (!best || Math.hypot(tile.x - requested.x, tile.y - requested.y)
      < Math.hypot(best.x - requested.x, best.y - requested.y)) ? tile : best, null);
  if (!closestLand) throw new Error('No accessible land cell for scenario');
  const point = { x: closestLand.x, y: closestLand.y };
  const id = world.nextId++;
  world.kingdomRelations[key] = {
    a: Math.min(attacker.id, defender.id), b: Math.max(attacker.id, defender.id),
    status: 'at-war', tension: 1, warId: id, startedDay: 0,
    borderIncidents: 1, resolvedDay: -1, ceasefireUntilDay: -1
  };
  world.wars.push({
    id, a: attacker.id, b: defender.id, attackerId: attacker.id,
    defenderId: defender.id, status: 'active', startedDay: 0,
    forceMobilization: true, cause: 'benchmark: defesa de fronteira observada',
    evidence: { location: point, attacker: { source: 'sentinela', location: point },
      defender: { source: 'guarnição local', location: point } }
  });
  return { attackerId: attacker.id, defenderId: defender.id, id };
}

function stats(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return { n: sorted.length, median: +(sorted[Math.floor(sorted.length / 2)]).toFixed(3),
    p95: +(sorted[Math.ceil(sorted.length * .95) - 1]).toFixed(3),
    mean: +(values.reduce((sum, v) => sum + v, 0) / values.length).toFixed(3) };
}

for (const seed of seeds) for (const mode of modes) {
  const world = Sim.createWorld(seed, { tacticalCombat: mode });
  const { attackerId, defenderId, id } = warFixture(world);
  const timings = [], cohesions = [], squadCounts = [], routed = [];
  const followerDistances = [], objectiveDistances = [];
  let firstEngagementDay = null, firstDeploymentDay = null;
  for (let i = 0; i < days; i++) {
    const start = performance.now();
    Sim.stepDay(world, { includeSnapshot: false });
    timings.push(performance.now() - start);
    const campaign = world.campaigns.find(c => c.warId === id);
    if (!campaign) continue;
    if (firstEngagementDay == null && campaign.battleCount > 0) firstEngagementDay = world.day;
    const side = campaign.attacker;
    const fighters = side.troopIds.map(id => world.people.find(person => person.id === id && person.alive)).filter(Boolean);
    if (fighters.length) {
      objectiveDistances.push(fighters.reduce((sum, person) => sum
        + Math.hypot(person.x - campaign.target.x, person.y - campaign.target.y), 0) / fighters.length);
      const byId = new Map(fighters.map(person => [person.id, person]));
      const distances = fighters.filter(p => p.commanderId !== p.id && byId.has(p.commanderId))
        .map(p => Math.hypot(p.x - byId.get(p.commanderId).x, p.y - byId.get(p.commanderId).y));
      if (distances.length) followerDistances.push(distances.reduce((a, b) => a + b, 0) / distances.length);
    }
    if (firstDeploymentDay == null && side.formation?.deployed) firstDeploymentDay = world.day;
    if (['marching', 'engaged', 'mobilizing'].includes(campaign.status)) {
      if (Number.isFinite(side.formation?.metrics?.cohesion)) cohesions.push(side.formation.metrics.cohesion);
      squadCounts.push(side.squadTactics?.squads?.length ?? 0);
      routed.push(side.squadTactics?.squads?.filter(s => s.routed).length ?? 0);
    }
  }
  const campaign = world.campaigns.find(c => c.warId === id);
  const war = world.wars.find(w => w.id === id);
  const result = {
    seed, mode, scenario, days, runtime: process.version,
    soldierCount: world.people.filter(p => p.role === 'soldier'
      && (p.kingdomId === attackerId || p.kingdomId === defenderId)).length,
    campaignCreated: !!campaign,
    warStatus: war.status, campaignStatus: campaign?.status || null,
    winnerId: war.winnerId ?? null, firstDeploymentDay, firstEngagementDay,
    battleCount: campaign?.battleCount ?? 0,
    attackerLosses: campaign?.attacker?.losses ?? null,
    defenderLosses: campaign?.defender?.losses ?? null,
    cpuDayMs: stats(timings), cohesion: stats(cohesions),
    meanSquads: stats(squadCounts)?.mean ?? 0,
    followerDistance: stats(followerDistances), objectiveDistance: stats(objectiveDistances),
    finalObjectiveDistance: objectiveDistances.length ? +objectiveDistances.at(-1).toFixed(3) : null,
    totalRoutSquadDays: routed.reduce((sum, count) => sum + count, 0)
  };
  measures.push(result);
  console.log('SQUAD-TRIAL', JSON.stringify(result));
}
const report = {
  schema: 1, name: 'Kingdom general/commander tactical A-B-C benchmark',
  seeds, days, scenario, modes, results: measures,
  notes: [
    'The same deterministic seeds, scenario and observation policy are used in every controller.',
    'Combat outcomes and campaign arrival are measured independently of CPU cost; no automatic winner is declared.',
    'Wall-clock times are Node CPU proxies, not renderer FPS; run multiple warm replicates and browser QA.',
    'An absent battle/deployment yields null: it is not evidence of tactical victory.',
    'Flow Fields/ORCA and ecological cost measurements are not in this initial controller.'
  ]
};
if (args.output) {
  const file = resolve(args.output);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(report, null, 2));
}
console.log('SQUAD-SUMMARY', JSON.stringify(report));
