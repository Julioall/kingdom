import { performance } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import { createMagicBattleScenario } from './magic-battle-scenario.mjs';
import { advanceMagic, updatePriestDecisions } from '../src/simulation/magic/system.js';
import { fightTacticalRound, moveCombatPersonTo, MILITARY_CLASSES } from '../src/simulation/kingdoms/military.js';
import { updateCombatResources } from '../src/simulation/kingdoms/combat-resources.js';

const output = process.argv.find(arg => arg.startsWith('--output='))?.slice(9);
const seconds = Number(process.argv.find(arg => arg.startsWith('--seconds='))?.slice(10) || 60);
const rows = [];
for (const seed of [42, 7, 99]) for (const composition of ['none', 'healers', 'mixed']) {
  const world = createMagicBattleScenario(seed, composition), samples = [], magicSamples = [];
  let steps = 0, maxEffects = 0;
  const started = performance.now();
  for (let ms = 0; ms < seconds * 1000; ms += 100) {
    const start = performance.now();
    advanceMagic(world, 100);
    magicSamples.push(performance.now() - start);
    if (ms % 1000 === 0) {
      world.day++;
      updateCombatResources(world, world.day);
      const sides = world.kingdoms.map(kingdom => world.people.filter(person => person.kingdomId === kingdom.id && person.alive));
      if (sides.some(side => !side.length)) break;
      for (let side = 0; side < 2; side++) for (const person of sides[side]) {
        if (person.magicCast || person.militaryClass === 'monge') continue;
        const enemy = sides[1 - side].reduce((best, target) => !best || Math.hypot(person.x - target.x, person.y - target.y)
          < Math.hypot(person.x - best.x, person.y - best.y) ? target : best, null);
        const distance = Math.hypot(person.x - enemy.x, person.y - enemy.y);
        if (distance > MILITARY_CLASSES[person.militaryClass].range * .85)
          moveCombatPersonTo(world, person, { x: person.x + (enemy.x - person.x) / distance * .8,
            y: person.y + (enemy.y - person.y) / distance * .8 });
      }
      updatePriestDecisions(world);
      const first = world.day % 2;
      fightTacticalRound(world, sides[first], sides[1 - first], world.day);
      fightTacticalRound(world, sides[1 - first], sides[first], world.day);
    }
    maxEffects = Math.max(maxEffects, world.people.reduce((sum, person) => sum + (person.magicEffects?.length || 0), 0));
    samples.push(performance.now() - start); steps++;
  }
  samples.sort((a, b) => a - b);
  magicSamples.sort((a, b) => a - b);
  rows.push({ seed, composition, seconds: steps / 10, runtimeMs: performance.now() - started,
    p95TickMs: samples[Math.floor(samples.length * .95)], maxTickMs: samples.at(-1), maxEffects,
    p95MagicMs: magicSamples[Math.floor(magicSamples.length * .95)],
    magic: world.magicStats || {}, sides: world.kingdoms.map(kingdom => {
      const people = world.people.filter(person => person.kingdomId === kingdom.id);
      return { name: kingdom.name, survivors: people.filter(person => person.alive).length,
        remainingCombatHP: people.filter(person => person.alive).reduce((sum, person) => sum + person.health * person.maxCombatHealth / 100, 0),
        damageDealt: people.reduce((sum, person) => sum + (person.combatDamageDealt || 0), 0),
        staminaSpent: people.reduce((sum, person) => sum + (person.combatStaminaSpent || 0), 0),
        remainingStamina: people.reduce((sum, person) => sum + person.stamina, 0) };
    }) });
}
const report = { description: '100 soldiers; alternating initiative; 100 ms magic clock; 1 s tactical rounds', seconds, rows };
if (output) { await mkdir('browser-ui-evidence/magic', { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2)); }
console.log(JSON.stringify(report, null, 2));
