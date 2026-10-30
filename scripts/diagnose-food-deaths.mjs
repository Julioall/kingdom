import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import engine from '../src/simulation/engine.js';
import { HUMAN_FOOD } from '../src/config/ecosystem.js';
import { cellsWithin } from '../src/simulation/world/spatial.js';
import { isBushAnchor, plantBiomass } from '../src/simulation/ecology/plants.js';
import { bestPeopleFoodCell } from '../src/simulation/individuals/actions.js';

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
const recentHistoryByPerson = new Map();
const PRE_DEATH_HISTORY_DAYS = 14;

function rememberVulnerablePeople() {
  for (const person of world.people) {
    if (!person.alive || !(person.foodReserve < 20 || person.health < 40)) continue;
    const history = recentHistoryByPerson.get(person.id) || [];
    history.push({
      day: world.day, x: person.x, y: person.y, health: person.health, foodReserve: person.foodReserve,
      hydration: person.hydration, energy: person.energy, state: person.state,
      action: person.lastDecision?.action || person.brain?.lastAction || null,
      foodTarget: person.foodTarget || null, movementCooldown: person.movementCooldown || 0
    });
    if (history.length > PRE_DEATH_HISTORY_DAYS) history.splice(0, history.length - PRE_DEATH_HISTORY_DAYS);
    recentHistoryByPerson.set(person.id, history);
  }
}

for (let day = 1; day <= days; day++) {
  rememberVulnerablePeople();
  engine.stepDay(world, { includeSnapshot: false });
  for (const person of world.people) {
    if (person.alive || person.deathCause !== 'starvation' || seen.has(person.id)) continue;
    seen.add(person.id);
    const community = world.communities.find(item => item.id === person.communityId);
    const kingdomId = person.deathKingdomId ?? person.kingdomId;
    const nearestAdults = world.people.filter(item => item.alive && item.id !== person.id
      && item.kingdomId === kingdomId)
      .map(item => ({ id: item.id, name: item.name, distance: Math.hypot(item.x - person.x, item.y - person.y),
        role: item.role, ageDays: item.ageDays, foodReserve: item.foodReserve, state: item.state,
        campaignId: item.campaignId ?? null, communityId: item.communityId }))
      .sort((a, b) => a.distance - b.distance || a.id - b.id).slice(0, 3);
    const nearbyFood = cellsWithin(world, person.x, person.y, 20,
      tile => plantBiomass(tile, HUMAN_FOOD) > 0)
      .map(tile => {
        const perceived = person.perception?.resources?.find(resource => resource.x === tile.x && resource.y === tile.y);
        return { x: tile.x, y: tile.y, distance: Math.hypot(tile.x - person.x, tile.y - person.y),
          edibleBiomass: plantBiomass(tile, HUMAN_FOOD), berryAnchor: isBushAnchor(world, tile, 'berry'),
          cropFieldId: tile.cropFieldId ?? null,
          perceived: perceived ? { distance: perceived.distance, biomass: perceived.biomass,
            harvestableBiomass: perceived.harvestableBiomass } : null };
      })
      .sort((a, b) => a.distance - b.distance || b.edibleBiomass - a.edibleBiomass).slice(0, 5);
    deaths.push({
      day: person.deathDay, id: person.id, name: person.name, role: person.role,
      ageDays: person.ageDays, deathDetails: person.deathDetails, state: person.state,
      lastLesson: person.lastLesson, x: person.x, y: person.y,
      communityId: person.communityId, kingdomId, homeId: person.homeId,
      guardianId: person.guardianId, parents: person.parents || [], assignment: person.assignment,
      campaignId: person.campaignId ?? null, militaryCenterId: person.militaryCenterId ?? null,
      towerDutyId: person.towerDutyId ?? null, towerRecovering: person.towerRecovering ?? false,
      preDeathState: recentHistoryByPerson.get(person.id)?.at(-1) || null,
      recentHistory: recentHistoryByPerson.get(person.id) || [],
      foodTarget: person.foodTarget || null,
      selectedFoodTarget: (() => { const target = bestPeopleFoodCell(world, person, 8); return target && { x: target.x, y: target.y }; })(),
      lastDecision: person.lastDecision || null,
      communityFood: community?.stores?.food ?? 0,
      nearestAdults, nearestFood: nearbyFood
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
