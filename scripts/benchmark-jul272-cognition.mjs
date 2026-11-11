// JUL-272: bounded cognitive footprint and simulation throughput, not a
// 100k-NPC performance certification or a baseline-equivalent replay.
import { performance } from 'node:perf_hooks';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import Sim from '../src/simulation/engine.js';
import { cognitiveStateBytes, COGNITIVE_EPISODE_LIMIT } from '../src/ai/policy/individual-state.js';

const seeds = [1, 42, 2026];
const results = [];
for (const seed of seeds) {
  const world = Sim.createWorld(seed);
  for (let i = 0; i < 3; i++) Sim.stepDay(world);
  const durations = [];
  for (let i = 0; i < 12; i++) {
    const t = performance.now();
    Sim.stepDay(world);
    durations.push(performance.now() - t);
  }
  const alive = world.people.filter(person => person.alive);
  const sizes = alive.map(cognitiveStateBytes);
  const peopleWithoutState = alive.filter(person => !person.cognitiveState ||
    person.cognitiveState.actorId !== person.id ||
    person.cognitiveState.episodes.length > COGNITIVE_EPISODE_LIMIT);
  if (peopleWithoutState.length) {
    throw new Error('State missing, identity mismatch or episode overflow: ' + peopleWithoutState.length);
  }
  const maxBytes = Math.max(...sizes);
  if (maxBytes > 1250) throw new Error('Per-NPC cognitive budget exceeded: ' + maxBytes);
  const ordered = durations.slice().sort((a, b) => a - b);
  results.push({
    seed, worldDay: world.day, alivePeople: alive.length,
    averageStateBytes: +(sizes.reduce((a,b) => a+b, 0) / sizes.length).toFixed(2),
    totalCognitiveBytes: sizes.reduce((a,b) => a+b, 0),
    maxStateBytes: maxBytes, perNpcBudgetBytes: 1250,
    meanDayMs: durations.reduce((a,b) => a+b, 0)/durations.length,
    p95DayMs: ordered[Math.ceil(ordered.length * .95) - 1],
    sharedWeightsPerNpc: 0,
    socialMemoriesRemainSeparate: alive.every(p => !Object.hasOwn(p.cognitiveState, 'socialMemories')
      && !Object.hasOwn(p.cognitiveState, 'socialBeliefs')
      && !Object.hasOwn(p.cognitiveState, 'socialIntentions')),
    samplesMs: durations
  });
}
const report = {schema:1,node:process.version,commit:process.env.GITHUB_SHA||'unknown',
  limitations:'GitHub runner only; short worlds with 96 inhabitants; neither FPS nor a 100k-NPC proof',
  results};
const output=resolve(process.argv[2]||'out/jul272-cognition.json');
await mkdir(dirname(output),{recursive:true});
await writeFile(output,JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
