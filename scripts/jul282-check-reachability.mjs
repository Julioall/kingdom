// JUL-282: direct ordered reachability parity and microtiming against legacy source.
// Run the exact same script under baseline/ and candidate/ checkouts.
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import sim from '../src/simulation/engine.js';
import { reachableAreaAround } from '../src/simulation/individuals/movement.js';

const result = { schema: 1, source: process.env.SOURCE_COMMIT || 'unknown', cases: [] };
for (const seed of [1, 42, 2026]) {
  const world = sim.createWorld(seed);
  const people = world.people.filter(p => p.alive);
  const agents = [people[0], people.find(p => p.role === 'soldier'), people.find(p => p.role === 'ruler')].filter(Boolean);
  if (!agents.length) throw new Error('Fixture world has no people: ' + seed);
  const seen = new Set();
  for (const agent of agents) {
    if (seen.has(agent.id)) continue;
    seen.add(agent.id);
    for (const radius of [3, 12, 32, Math.hypot(world.width, world.height)]) {
      const before = performance.now();
      const tiles = reachableAreaAround(world, agent, agent, radius);
      const durationMs = performance.now() - before;
      const orderedIds = tiles.map(tile => tile.i);
      result.cases.push({
        seed, agentId: agent.id, role: agent.role, radius,
        origin: { x: agent.x, y: agent.y }, tileCount: orderedIds.length,
        orderedDigest: createHash('sha256').update(JSON.stringify(orderedIds)).digest('hex'),
        durationMs
      });
    }
  }
}
const output = resolve(process.argv[2] || 'out/jul282-reachability.json');
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify({
  source: result.source, cases: result.cases.length,
  totalMeasuredMs: +result.cases.reduce((sum, x) => sum + x.durationMs, 0).toFixed(2)
}));
