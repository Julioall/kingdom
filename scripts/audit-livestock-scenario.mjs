import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { DOMESTIC_SHEEP_DAILY_FEED, feedRationPortions, MEAT_NUTRITIONAL_VALUE, SHEEP_ADULT_AGE_DAYS } from '../src/config/ecosystem.js';
import engine from '../src/simulation/engine.js';
import { feedCommunalHerds } from '../src/simulation/ecology/animals.js';
import { attemptHumanHunt, nearestEmergencyHerdSheep } from '../src/simulation/individuals/actions.js';

const args = new Map();
for (let index = 2; index < process.argv.length; index++) {
  const key = process.argv[index];
  if (!key.startsWith('--')) throw new Error('Argumento inesperado: ' + key);
  args.set(key, process.argv[++index]);
}

const seeds = (args.get('--seeds') ?? '1,42,987,2026').split(',').map(Number);
const repeatSeed = args.has('--repeat-seed') ? Number(args.get('--repeat-seed')) : 42;
const outputPath = args.get('--output');
if (!seeds.length || seeds.some(seed => !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)) {
  throw new Error('--seeds deve conter inteiros uint32 separados por vírgulas');
}
if (!Number.isInteger(repeatSeed) || repeatSeed < 0 || repeatSeed > 0xffffffff) {
  throw new Error('--repeat-seed deve ser um inteiro uint32');
}

function run(seed) {
  const startedAt = performance.now();
  const world = engine.createWorld(seed);
  const community = world.communities[0];
  const person = world.people.find(item => item.alive && item.communityId === community.id
    && item.role !== 'soldier' && item.ageDays >= 12 * 365);
  const herd = world.animals.filter(item => item.alive && item.speciesId === 'sheep').slice(0, 3);
  if (!person || herd.length !== 3) throw new Error('O mundo não gerou os atores necessários para o cenário.');

  world.day = 1;
  person.foodReserve = 8;
  person.carriedMeat = 0;
  person.carriedFood = 0;
  person.carriedFruit = 0;
  person.skills.hunt = 1;
  person.physicalStrength = 1;
  community.stores.food = 0;
  community.stores.meat = 0;
  community.stores.feed = herd.length * DOMESTIC_SHEEP_DAILY_FEED;
  community.memberIds = [person.id];
  world.people = [person];
  for (const kingdom of world.kingdoms) {
    for (const account of [kingdom.treasury?.stock, kingdom.market?.stock]) {
      if (!account) continue;
      account.food = 0;
      account.feed = 0;
    }
  }
  if (world.market) { world.market.food = 0; world.market.feed = 0; }

  const shelter = {
    id: world.nextId++, type: 'abrigo', complete: true, destroyedDay: null,
    communityId: community.id, x: person.x, y: person.y, integrity: 100, health: 100, meatStored: 0
  };
  world.structures.push(shelter);
  for (const [index, animal] of herd.entries()) {
    animal.herdCommunityId = community.id;
    animal.beingLedBy = null;
    animal.ageDays = Math.max(animal.ageDays, SHEEP_ADULT_AGE_DAYS);
    animal.massKg = 48;
    animal.x = person.x + .45 + index * .2;
    animal.y = person.y;
  }
  person.perception = {
    ...(person.perception || {}),
    animals: herd.map(animal => ({ id: animal.id, speciesId: animal.speciesId, visible: true,
      distance: Math.hypot(person.x - animal.x, person.y - animal.y) }))
  };

  const feedStart = community.stores.feed;
  const feedConsumed = feedCommunalHerds(world);
  world.rngState = 7;
  const target = nearestEmergencyHerdSheep(world, person, community);
  if (!target) throw new Error('O choque controlado não habilitou uma ovelha visível para emergência.');
  if (!attemptHumanHunt(world, person, target, community)) throw new Error('A captura determinística do cenário falhou.');
  engine.modules.SocietyExperiment.updatePeople(world);

  const adultHerdAfter = herd.filter(animal => animal.alive && animal.ageDays >= SHEEP_ADULT_AGE_DAYS).length;
  const meatProduced = Math.round(world.harvests.livestockMeat);
  const result = {
    seed,
    day: world.day,
    scenario: 'low-community-food-visible-domestic-herd-delivery',
    initialCommunityFood: 0,
    initialCommunityRationPortions: feedRationPortions(feedStart),
    adultHerdBefore: herd.length,
    feedStartRationPortions: feedRationPortions(feedStart),
    feedConsumedRationPortions: feedRationPortions(feedConsumed),
    feedRemainingRationPortions: feedRationPortions(community.stores.feed),
    communityFoodAfterAction: Math.round(community.stores.food),
    communityRationPortionsAfterAction: feedRationPortions(community.stores.feed),
    livestockFeedLedgerRationPortions: feedRationPortions(world.ecologyFlows.livestockFeedConsumed),
    harvestedAnimals: world.harvests.livestock,
    adultHerdAfter,
    meatProduced,
    meatCarried: Math.round(person.carriedMeat),
    communityMeat: Math.round(community.stores.meat),
    shelterMeat: Math.round(shelter.meatStored),
    deliveryState: person.state,
    personDaysFromMeat: Math.round(meatProduced * MEAT_NUTRITIONAL_VALUE),
    event: world.events.find(item => /abateu uma ovelha adulta excedente/.test(item.text || ''))?.text || null,
    elapsedSeconds: Number(((performance.now() - startedAt) / 1000).toFixed(3))
  };

  if (Math.abs(feedConsumed - feedStart) > 1e-9 || community.stores.feed < -1e-9
      || feedRationPortions(world.ecologyFlows.livestockFeedConsumed) !== feedRationPortions(feedConsumed) || result.harvestedAnimals !== 1
      || adultHerdAfter !== 2 || Math.abs(person.carriedMeat) > 1e-9
      || Math.abs(community.stores.meat - meatProduced) > 1e-9
      || Math.abs(shelter.meatStored - meatProduced) > 1e-9
      || person.state !== 'carne armazenada no abrigo'
      || community.stores.food < -1e-9 || community.stores.feed > 1e-9 || shelter.meatStored < 0) {
    throw new Error('O ledger do cenário não fechou: ' + JSON.stringify(result));
  }
  return result;
}

const results = seeds.map(run);
const first = results.find(result => result.seed === repeatSeed) || run(repeatSeed);
const repeated = run(repeatSeed);
const comparable = result => {
  const { elapsedSeconds, ...stable } = result;
  return JSON.stringify(stable);
};
const determinismVerified = !!first && comparable(first) === comparable(repeated);
const report = {
  runtime: process.version,
  sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  base: 'engine.createWorld + controlled starting shock + production feed/hunt/individual-action functions',
  limitations: [
    'The scenario assigns three generated sheep to one community and creates a usable shelter so the emergency rule is reachable.',
    'Only the selected resident is active in the individual action phase so other residents cannot consume the stored output during this logistics check.',
    'The resident begins with a low reserve and the community begins with zero food; this is a controlled action and ledger replay, not evidence that an unmodified world autonomously reaches the condition or that a full stepDay creates it.'
  ],
  seeds,
  repeatSeed,
  results,
  repeatedResult: repeated,
  determinismVerified
};
const output = JSON.stringify(report, null, 2) + '\n';
if (outputPath) {
  await writeFile(outputPath, output, 'utf8');
  process.stdout.write(JSON.stringify({
    sourceRevision: report.sourceRevision, seeds, repeatSeed, determinismVerified,
    results: results.map(({ elapsedSeconds, ...result }) => result)
  }, null, 2) + '\n');
} else process.stdout.write(output);
if (!determinismVerified) process.exitCode = 1;
