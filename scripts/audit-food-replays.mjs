import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import engine from '../src/simulation/engine.js';
import { summarizeCampaignFoodLogistics, summarizeCultivatedFields, summarizeFoodDeaths, summarizeTradeActivity } from './food-audit-metrics.mjs';

const args = new Map();
for (let index = 2; index < process.argv.length; index++) {
  const key = process.argv[index];
  if (!key.startsWith('--')) throw new Error('Argumento inesperado: ' + key);
  args.set(key, process.argv[++index]);
}

const days = Number(args.get('--days') ?? 730);
const seeds = (args.get('--seeds') ?? '1,42,987,2026').split(',').map(Number);
const repeatSeed = args.has('--repeat-seed') ? Number(args.get('--repeat-seed')) : null;
const outputPath = args.get('--output');
const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (!Number.isInteger(days) || days < 1 || days > 10000) throw new Error('--days deve estar entre 1 e 10000');
if (!seeds.length || seeds.some(seed => !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)) {
  throw new Error('--seeds deve conter inteiros uint32 separados por vírgulas');
}
if (repeatSeed !== null && (!Number.isInteger(repeatSeed) || repeatSeed < 0 || repeatSeed > 0xffffffff)) {
  throw new Error('--repeat-seed deve ser um inteiro uint32');
}

function stockAccounts(world) {
  const accounts = [];
  const add = (label, account) => { if (account && typeof account === 'object') accounts.push([label, account]); };
  for (const kingdom of world.kingdoms || []) {
    add('kingdom ' + kingdom.id + ' treasury', kingdom.treasury?.stock);
    add('kingdom ' + kingdom.id + ' market', kingdom.market?.stock);
  }
  for (const community of world.communities || []) add('community ' + community.id, community.stores);
  add('world market', world.market?.stock || world.market);
  for (const person of world.people || []) {
    for (const key of ['foodReserve', 'carriedFood', 'carriedFruit', 'carriedMeat', 'carriedFeed']) {
      if (person[key] !== undefined) add('person ' + person.id + ' ' + key, { [key]: person[key] });
    }
  }
  for (const structure of world.structures || []) {
    const stock = {};
    for (const key of ['cropSeedStored', 'fruitStored', 'meatStored', 'feedStored']) {
      if (structure[key] !== undefined) stock[key] = structure[key];
    }
    add('structure ' + structure.id, stock);
  }
  for (const campaign of world.campaigns || []) for (const side of [campaign.attacker, campaign.defender]) {
    add('campaign ' + campaign.id + ' supply', side?.supply?.stock);
  }
  return accounts;
}

function assertNonnegativeStocks(world, seed, day) {
  for (const [label, account] of stockAccounts(world)) for (const [resource, value] of Object.entries(account)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < -1e-7) {
      throw new Error('Estoque inválido na seed ' + seed + ', dia ' + day + ': ' + label + '.' + resource + '=' + value);
    }
  }
}

function canonical(value, seen = new WeakSet()) {
  if (value === undefined) return '"[undefined]"';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (seen.has(value)) return '"[circular]"';
  seen.add(value);
  let output;
  if (ArrayBuffer.isView(value)) output = JSON.stringify({ type: value.constructor.name, values: Array.from(value) });
  else if (Array.isArray(value)) output = '[' + value.map(item => canonical(item, seen)).join(',') + ']';
  else if (value instanceof Map) output = '{"map":[' + [...value.entries()].map(([key, item]) => [canonical(key, seen), canonical(item, seen)])
    .sort((a, b) => a[0].localeCompare(b[0])).map(entry => '[' + entry.join(',') + ']').join(',') + ']}';
  else if (value instanceof Set) output = '{"set":[' + [...value].map(item => canonical(item, seen)).sort().join(',') + ']}';
  else output = '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key], seen)).join(',') + '}';
  seen.delete(value);
  return output;
}
function hash(value) { return createHash('sha256').update(value).digest('hex'); }

function summarizeStocks(world) {
  const sum = (accounts, resource) => accounts.reduce((total, account) => total + (Number(account?.[resource]) || 0), 0);
  const communities = world.communities || [];
  const kingdoms = world.kingdoms || [];
  const markets = kingdoms.map(kingdom => kingdom.market?.stock || {});
  const treasuries = kingdoms.map(kingdom => kingdom.treasury?.stock || {});
  const people = (world.people || []).filter(person => person.alive);
  return {
    communityFood: Number(sum(communities.map(item => item.stores), 'food').toFixed(2)),
    communityMeat: Number(sum(communities.map(item => item.stores), 'meat').toFixed(2)),
    treasuryFood: Number(sum(treasuries, 'food').toFixed(2)),
    marketFood: Number(sum(markets, 'food').toFixed(2)),
    personalFoodReserve: Number(sum(people, 'foodReserve').toFixed(2)),
    carriedFood: Number(sum(people, 'carriedFood').toFixed(2)),
    carriedFruit: Number(sum(people, 'carriedFruit').toFixed(2)),
    carriedMeat: Number(sum(people, 'carriedMeat').toFixed(2)),
    campaignFieldFood: Number((world.campaigns || []).reduce((total, campaign) =>
      total + (Number(campaign.attacker?.supply?.stock?.food) || 0) + (Number(campaign.defender?.supply?.stock?.food) || 0), 0).toFixed(2))
  };
}

function run(seed) {
  const startedAt = performance.now();
  const world = engine.createWorld(seed);
  // Trade diagnostics are opt-in so normal simulation ticks do not pay for audit counters.
  world.tradeDiagnostics = {};
  let adultDaysFoodReserveBelow20 = 0;
  for (let day = 1; day <= days; day++) {
    engine.stepDay(world, { includeSnapshot: false });
    assertNonnegativeStocks(world, seed, day);
    adultDaysFoodReserveBelow20 += (world.people || []).filter(person => person.alive && person.ageDays >= 12 * 365
      && person.foodReserve < 20).length;
  }
  const final = engine.snapshot(world);
  const tradeActivity = summarizeTradeActivity(world);
  const stateParts = Object.fromEntries(['day', 'year', 'season', 'seed', 'rngState', 'nextId', 'tiles', 'regions', 'animals', 'people', 'communities', 'kingdoms',
    'settlements', 'structures', 'wars', 'campaigns', 'conflicts', 'territoryClaims', 'treaties', 'socialLinks', 'events',
    'chronicle', 'harvests', 'ecologyFlows', 'deathsByCause', 'tradeRecords'].map(key => [key, hash(canonical(world[key]))]));
  const digest = hash(canonical(world));
  const chronicleDigest = hash(canonical(world.chronicle || []));
  return {
    seed, days, elapsedSeconds: Number(((performance.now() - startedAt) / 1000).toFixed(2)),
    stateSha256: digest, stateParts, chronicleSha256: chronicleDigest,
    determinismVerified: false,
    livingPeople: (world.people || []).filter(person => person.alive).length,
    adultDaysFoodReserveBelow20,
    deathsByCause: { ...(world.deathsByCause || {}) },
    deathsByActor: summarizeFoodDeaths(world),
    campaignLogistics: summarizeCampaignFoodLogistics(world),
    cultivatedFields: summarizeCultivatedFields(world),
    births: world.births || 0, deaths: world.deaths || 0,
    harvests: { ...(world.harvests || {}) },
    ecologyFlows: { ...(world.ecologyFlows || {}) },
    foodBiomass: Number((final.humanFoodBiomass || 0).toFixed(2)),
    activeCampaigns: final.activeCampaigns || 0,
    campaignBattles: final.campaignBattles || 0,
    marketTransactions: tradeActivity.marketTransactions,
    tradeRecords: tradeActivity.totalTradeRecords,
    tradeActivity,
    stocks: summarizeStocks(world)
  };
}

const results = [];
for (const seed of seeds) {
  const result = run(seed);
  results.push(result);
  process.stderr.write('Replay seed ' + seed + ' concluído em ' + result.elapsedSeconds + ' s; estado ' + result.stateSha256.slice(0, 12) + '.\n');
}
if (repeatSeed !== null) {
  const first = results.find(result => result.seed === repeatSeed);
  const repeated = run(repeatSeed);
  const verified = !!first && first.stateSha256 === repeated.stateSha256
    && first.chronicleSha256 === repeated.chronicleSha256
    && Object.keys(first.stateParts).every(key => first.stateParts[key] === repeated.stateParts[key]);
  const determinismDiff = first ? Object.keys(first.stateParts).filter(key => first.stateParts[key] !== repeated.stateParts[key]) : [];
  const repeatedEntry = { ...repeated, repeatedFromSeedIndex: first ? seeds.indexOf(repeatSeed) : null,
    determinismVerified: verified, determinismDiff };
  results.push(repeatedEntry);
  if (first) first.determinismVerified = verified;
  process.stderr.write('Replay repetido da seed ' + repeatSeed + ': ' + (verified ? 'determinístico' : 'divergente') + '.\n');
}
const report = { runtime: process.version, sourceRevision,
  base: 'engine.createWorld + production stepDay', days, seeds, repeatSeed, results };
const output = JSON.stringify(report, null, 2) + '\n';
if (outputPath) {
  await writeFile(outputPath, output, 'utf8');
  const summary = { sourceRevision: report.sourceRevision, days, seeds, repeatSeed,
    results: results.map(({ seed, elapsedSeconds, stateSha256, chronicleSha256, determinismVerified,
      determinismDiff, livingPeople, adultDaysFoodReserveBelow20, deathsByCause, births, deaths,
      deathsByActor, campaignLogistics, cultivatedFields, foodBiomass, activeCampaigns, campaignBattles, marketTransactions,
      tradeRecords, tradeActivity, stocks }) => ({ seed, elapsedSeconds,
      stateSha256, chronicleSha256, determinismVerified, determinismDiff, livingPeople,
      adultDaysFoodReserveBelow20, deathsByCause, births, deaths, foodBiomass,
      deathsByActor, campaignLogistics, cultivatedFields, activeCampaigns, campaignBattles,
      marketTransactions, tradeRecords, tradeActivity, stocks })) };
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
} else process.stdout.write(output);
if (repeatSeed !== null && !results.at(-1).determinismVerified) process.exitCode = 1;
