import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import engine from '../src/simulation/engine.js';
import { HUMAN_FOOD } from '../src/config/ecosystem.js';
import { plantBiomass } from '../src/simulation/ecology/plants.js';

const values = new Map(process.argv.slice(2).map(value => {
  const [key, ...rest] = value.replace(/^--/, '').split('=');
  return [key, rest.join('=')];
}));
const seed = Number(values.get('seed') ?? 42);
const days = Number(values.get('days') ?? 253);
const limit = Number(values.get('limit') ?? 20);
const world = engine.createWorld(seed);
const seen = new Set();
const deaths = [];

for (let day = 1; day <= days; day++) {
  engine.stepDay(world, { includeSnapshot: false });
  for (const person of world.people) {
    if (person.alive || person.deathCause !== 'starvation' || seen.has(person.id)) continue;
    seen.add(person.id);
    const community = world.communities.find(item => item.id === person.communityId);
    const kingdomId = person.deathKingdomId ?? person.kingdomId;
    const nearestAdults = world.people.filter(item => item.alive && item.id !== person.id
      && item.kingdomId === kingdomId && item.role !== 'soldier')
      .map(item => ({ id: item.id, name: item.name, distance: Math.hypot(item.x - person.x, item.y - person.y),
        foodReserve: item.foodReserve, state: item.state, communityId: item.communityId }))
      .sort((a, b) => a.distance - b.distance || a.id - b.id).slice(0, 3);
    const nearbyFood = world.tiles.filter(tile => Math.hypot(tile.x - person.x, tile.y - person.y) <= 20)
      .map(tile => ({ x: tile.x, y: tile.y, distance: Math.hypot(tile.x - person.x, tile.y - person.y),
        edibleBiomass: plantBiomass(tile, HUMAN_FOOD) }))
      .filter(tile => tile.edibleBiomass > 0)
      .sort((a, b) => a.distance - b.distance || b.edibleBiomass - a.edibleBiomass).slice(0, 5);
    deaths.push({
      day: person.deathDay, id: person.id, name: person.name, role: person.role,
      ageDays: person.ageDays, deathDetails: person.deathDetails, state: person.state,
      lastLesson: person.lastLesson, x: person.x, y: person.y,
      communityId: person.communityId, kingdomId, homeId: person.homeId,
      guardianId: person.guardianId, assignment: person.assignment,
      communityFood: community?.stores?.food ?? 0,
      nearestAdults, nearestFood
    });
    if (deaths.length >= limit) break;
  }
  if (deaths.length >= limit) break;
}

const report = { sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  seed, requestedDays: days, observedThroughDay: world.day, starvationDeaths: world.deathsByCause.starvation,
  deathsCaptured: deaths.length, firstDeaths: deaths };
const output = JSON.stringify(report, null, 2) + '\n';
if (values.has('output')) await writeFile(values.get('output'), output, 'utf8');
process.stdout.write(output);
