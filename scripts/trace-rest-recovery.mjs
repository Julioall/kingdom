import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import engine from '../src/simulation/engine.js';
import { structureInteractionPoint } from '../src/simulation/physics/hitboxes.js';

const options = new Map(process.argv.slice(2).map(value => {
  const [key, ...rest] = value.replace(/^--/, '').split('=');
  return [key, rest.join('=')];
}));
const seed = Number(options.get('seed') ?? 42);
const personId = Number(options.get('person') ?? 87);
const days = Number(options.get('days') ?? 365);
const fromDay = Number(options.get('from') ?? 240);
if (![seed, personId, days, fromDay].every(Number.isInteger)
    || seed < 0 || personId < 0 || days < 1 || fromDay < 1 || fromDay > days) {
  throw new Error('Use valores inteiros válidos para seed, person, days e from.');
}
const world = engine.createWorld(seed);
const person = world.people.find(item => item.id === personId);
if (!person) throw new Error('Pessoa não encontrada na seed: ' + personId);
const samples = [];
for (let day = 1; day <= days; day++) {
  engine.stepDay(world, { includeSnapshot: false });
  if (day < fromDay) continue;
  const home = world.structures.find(item => item.id === person.homeId);
  const entry = home && structureInteractionPoint(home);
  const campaign = world.campaigns.find(item => item.id === person.campaignId);
  const side = [campaign?.attacker, campaign?.defender].find(item => item?.kingdomId === person.kingdomId);
  const community = world.communities.find(item => item.id === person.communityId);
  const kingdom = world.kingdoms.find(item => item.id === person.kingdomId);
  samples.push({
    day: world.day, alive: person.alive, deathCause: person.deathCause ?? null,
    x: person.x, y: person.y, energy: person.energy, foodReserve: person.foodReserve,
    hydration: person.hydration, health: person.health, state: person.state,
    decision: person.lastDecision?.action ?? null,
    homeId: person.homeId ?? null, entry: entry || null,
    entryDistance: entry ? Math.hypot(person.x - entry.x, person.y - entry.y) : null,
    restTarget: (person.role === 'soldier' ? person.militaryRestTargetId : person.homeRestTargetId) ?? null,
    restingStructureId: person.restingStructureId ?? null,
    campaignId: person.campaignId ?? null, campaignStatus: campaign?.status ?? null,
    campaignReturnedHome: person.campaignReturnedHome ?? false,
    sideContainsPerson: side ? side.troopIds.includes(person.id) : null,
    campaignFood: side?.supply?.stock?.food ?? null, communityFood: community?.stores?.food ?? null,
    treasuryFood: kingdom?.treasury?.stock?.food ?? null, marketFood: kingdom?.market?.stock?.food ?? null,
    walletGold: person.militaryWallet?.stock?.gold ?? null
  });
}
const report = {
  sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  seed, personId, name: person.name, role: person.role, days, fromDay, samples
};
if (options.has('output')) await writeFile(options.get('output'), JSON.stringify(report, null, 2) + '\n', 'utf8');
process.stdout.write(JSON.stringify({ sourceRevision: report.sourceRevision, seed, personId,
  name: person.name, final: samples.at(-1), samples: samples.length }, null, 2) + '\n');
