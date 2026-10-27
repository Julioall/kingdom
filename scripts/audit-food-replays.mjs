import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import engine from '../src/simulation/engine.js';
import { FOOD_RESERVE_PER_UNIT } from '../src/config/ecosystem.js';
import { communityFoodStock } from '../src/simulation/economy/inventories.js';
import { communityFoodBufferTarget, dailyFoodNeedForMembers, kingdomFoodDemand } from '../src/simulation/economy/food-policy.js';
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

function foodReserveTrackers(world) {
  return (world.communities || []).filter(community => !community.dissolved).map(community => {
    const kingdom = (world.kingdoms || []).find(item => item.communityId === community.id);
    const demand = kingdom ? kingdomFoodDemand(world, kingdom) : dailyFoodNeedForMembers(
      (world.people || []).filter(person => person.alive && community.memberIds.includes(person.id)));
    const stock = communityFoodStock(community);
    const people = (world.people || []).filter(person => person.alive && community.memberIds.includes(person.id));
    const personalReservePoints = people.reduce((sum, person) => sum + Math.max(0, Number(person.foodReserve) || 0), 0);
    const dailyFoodUnits = demand.dailyFoodNeed / FOOD_RESERVE_PER_UNIT;
    return {
      communityId: community.id,
      kingdomId: kingdom?.id ?? community.kingdomId ?? null,
      name: kingdom?.name ?? community.name ?? null,
      initialFood: Number(stock.toFixed(2)),
      minimumFood: stock,
      maximumFood: stock,
      daysBelow300: 0,
      daysBelowDemandBuffer: 0,
      firstDayBelow300: null,
      endingFood: stock,
      minimumCombinedReserveDays: dailyFoodUnits > 0 ? (stock + personalReservePoints / FOOD_RESERVE_PER_UNIT) / dailyFoodUnits : null,
      maximumCombinedReserveDays: dailyFoodUnits > 0 ? (stock + personalReservePoints / FOOD_RESERVE_PER_UNIT) / dailyFoodUnits : null,
      daysBelowCombinedReserve14: 0,
      endingPersonalReservePoints: personalReservePoints,
      endingPersonalReserveRawEquivalent: personalReservePoints / FOOD_RESERVE_PER_UNIT,
      endingAveragePersonalReservePoints: people.length ? personalReservePoints / people.length : 0,
      endingResidentsBelow20: people.filter(person => person.foodReserve < 20).length,
      royalFoodSupportWorkerDays: 0,
      royalFieldWorkerDays: 0,
      maximumConcurrentRoyalFoodWorkers: 0,
      maximumConcurrentRoyalFieldWorkers: 0,
      endingPopulation: demand.members?.length ?? (world.people || []).filter(person =>
        person.alive && community.memberIds.includes(person.id)).length,
      endingDailyDemandRawUnits: dailyFoodUnits,
      endingDemandBufferTarget: communityFoodBufferTarget(demand.dailyFoodNeed),
      endingDomesticatedSheep: (world.animals || []).filter(animal => animal.alive
        && animal.speciesId === 'sheep' && animal.herdCommunityId === community.id).length,
      endingAdultDomesticatedSheep: (world.animals || []).filter(animal => animal.alive
        && animal.speciesId === 'sheep' && animal.herdCommunityId === community.id && animal.ageDays >= 180).length,
      endingFeedStock: Number(community.stores?.feed) || 0
    };
  });
}

function updateFoodReserveTrackers(world, trackers) {
  for (const tracker of trackers) {
    const community = (world.communities || []).find(item => item.id === tracker.communityId && !item.dissolved);
    if (!community) continue;
    const kingdom = (world.kingdoms || []).find(item => item.communityId === community.id);
    const members = kingdom ? kingdomFoodDemand(world, kingdom).members
      : (world.people || []).filter(person => person.alive && community.memberIds.includes(person.id));
    const dailyFoodNeed = dailyFoodNeedForMembers(members).dailyFoodNeed;
    const stock = communityFoodStock(community);
    const personalReservePoints = members.reduce((sum, person) => sum + Math.max(0, Number(person.foodReserve) || 0), 0);
    const dailyFoodUnits = dailyFoodNeed / FOOD_RESERVE_PER_UNIT;
    const combinedReserveDays = dailyFoodUnits > 0
      ? (stock + personalReservePoints / FOOD_RESERVE_PER_UNIT) / dailyFoodUnits : Infinity;
    const royalFoodWorkers = members.filter(person => person.assignment?.source === 'kingdom-strategy'
      && person.assignment.goal === 'secure-shared-food' && person.assignment.expiresDay >= world.day);
    const royalFieldWorkers = royalFoodWorkers.filter(person => person.assignment.foodFieldId != null);
    tracker.minimumFood = Math.min(tracker.minimumFood, stock);
    tracker.maximumFood = Math.max(tracker.maximumFood, stock);
    tracker.endingFood = stock;
    if (Number.isFinite(combinedReserveDays)) {
      tracker.minimumCombinedReserveDays = Math.min(tracker.minimumCombinedReserveDays, combinedReserveDays);
      tracker.maximumCombinedReserveDays = Math.max(tracker.maximumCombinedReserveDays, combinedReserveDays);
      if (combinedReserveDays < 14) tracker.daysBelowCombinedReserve14++;
    }
    tracker.endingPersonalReservePoints = personalReservePoints;
    tracker.endingPersonalReserveRawEquivalent = personalReservePoints / FOOD_RESERVE_PER_UNIT;
    tracker.endingAveragePersonalReservePoints = members.length ? personalReservePoints / members.length : 0;
    tracker.endingResidentsBelow20 = members.filter(person => person.foodReserve < 20).length;
    tracker.royalFoodSupportWorkerDays += royalFoodWorkers.length;
    tracker.royalFieldWorkerDays += royalFieldWorkers.length;
    tracker.maximumConcurrentRoyalFoodWorkers = Math.max(tracker.maximumConcurrentRoyalFoodWorkers, royalFoodWorkers.length);
    tracker.maximumConcurrentRoyalFieldWorkers = Math.max(tracker.maximumConcurrentRoyalFieldWorkers, royalFieldWorkers.length);
    tracker.endingPopulation = members.length;
    tracker.endingDailyDemandRawUnits = dailyFoodNeed / FOOD_RESERVE_PER_UNIT;
    tracker.endingDemandBufferTarget = communityFoodBufferTarget(dailyFoodNeed);
    tracker.endingDomesticatedSheep = (world.animals || []).filter(animal => animal.alive
      && animal.speciesId === 'sheep' && animal.herdCommunityId === community.id).length;
    tracker.endingAdultDomesticatedSheep = (world.animals || []).filter(animal => animal.alive
      && animal.speciesId === 'sheep' && animal.herdCommunityId === community.id && animal.ageDays >= 180).length;
    tracker.endingFeedStock = Number(community.stores?.feed) || 0;
    if (stock < 300) {
      tracker.daysBelow300++;
      tracker.firstDayBelow300 ??= world.day;
    }
    if (stock + 1e-7 < tracker.endingDemandBufferTarget) tracker.daysBelowDemandBuffer++;
  }
}

function finalizeFoodReserveTrackers(trackers) {
  return trackers.map(tracker => ({
    ...tracker,
    minimumFood: Number(tracker.minimumFood.toFixed(2)),
    maximumFood: Number(tracker.maximumFood.toFixed(2)),
    endingFood: Number(tracker.endingFood.toFixed(2)),
    minimumCombinedReserveDays: Number.isFinite(tracker.minimumCombinedReserveDays)
      ? Number(tracker.minimumCombinedReserveDays.toFixed(2)) : null,
    maximumCombinedReserveDays: Number.isFinite(tracker.maximumCombinedReserveDays)
      ? Number(tracker.maximumCombinedReserveDays.toFixed(2)) : null,
    endingPersonalReservePoints: Number(tracker.endingPersonalReservePoints.toFixed(2)),
    endingPersonalReserveRawEquivalent: Number(tracker.endingPersonalReserveRawEquivalent.toFixed(2)),
    endingAveragePersonalReservePoints: Number(tracker.endingAveragePersonalReservePoints.toFixed(2)),
    endingDailyDemandRawUnits: Number(tracker.endingDailyDemandRawUnits.toFixed(2)),
    endingDemandBufferTarget: Number(tracker.endingDemandBufferTarget.toFixed(2)),
    recoveredAbove300AtEnd: tracker.endingFood >= 300
  }));
}

function run(seed) {
  const startedAt = performance.now();
  const world = engine.createWorld(seed);
  // Trade diagnostics are opt-in so normal simulation ticks do not pay for audit counters.
  world.tradeDiagnostics = {};
  const reserveTrackers = foodReserveTrackers(world);
  let adultDaysFoodReserveBelow20 = 0;
  for (let day = 1; day <= days; day++) {
    engine.stepDay(world, { includeSnapshot: false });
    assertNonnegativeStocks(world, seed, day);
    updateFoodReserveTrackers(world, reserveTrackers);
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
    stocks: summarizeStocks(world),
    foodReserveByCommunity: finalizeFoodReserveTrackers(reserveTrackers)
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
      tradeRecords, tradeActivity, stocks, foodReserveByCommunity }) => ({ seed, elapsedSeconds,
      stateSha256, chronicleSha256, determinismVerified, determinismDiff, livingPeople,
      adultDaysFoodReserveBelow20, deathsByCause, births, deaths, foodBiomass,
      deathsByActor, campaignLogistics, cultivatedFields, activeCampaigns, campaignBattles,
      marketTransactions, tradeRecords, tradeActivity, stocks, foodReserveByCommunity })) };
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
} else process.stdout.write(output);
if (repeatSeed !== null && !results.at(-1).determinismVerified) process.exitCode = 1;
