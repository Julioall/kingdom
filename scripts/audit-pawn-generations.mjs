#!/usr/bin/env node
// Long-running evidence audit, not a population controller or a victory script.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import engine from '../src/simulation/engine.js';
import { assessCivilizationProgress } from '../src/simulation/society/civilization-progress.js';
import {
  HUMAN_ADOLESCENT_AGE_DAYS, HUMAN_ADULT_AGE_DAYS,
  HUMAN_ELDER_AGE_DAYS
} from '../src/simulation/individuals/human-age.js';

const amount = value => Number.isFinite(value) && value >= 0 ? value : 0;
const round = value => Math.round(value * 100) / 100;

export function snapshotGenerations(world) {
  const people = world.people || [];
  const alive = people.filter(person => person.alive);
  const civilians = alive.filter(person => person.role !== 'soldier');
  const soldierCount = alive.length - civilians.length;
  const groups = {
    criancas: alive.filter(p => p.ageDays < HUMAN_ADOLESCENT_AGE_DAYS).length,
    adolescentes: alive.filter(p => p.ageDays >= HUMAN_ADOLESCENT_AGE_DAYS
      && p.ageDays < HUMAN_ADULT_AGE_DAYS).length,
    adultos: alive.filter(p => p.ageDays >= HUMAN_ADULT_AGE_DAYS
      && p.ageDays < HUMAN_ELDER_AGE_DAYS).length,
    idosos: alive.filter(p => p.ageDays >= HUMAN_ELDER_AGE_DAYS).length
  };
  const marketActivity = people.filter(p => p.lastPersonalSaleDay != null).length;
  const exposed = alive.filter(p => Object.keys(p.familyLearning || {}).length > 0);
  const learnedLessons = exposed.reduce((sum, p) => sum + Object.values(p.familyLearning)
    .reduce((n, skill) => n + (skill.observations || 0), 0), 0);
  const privateHomes = world.structures.filter(s => s.privateOwnerId != null && s.destroyedDay == null);
  const personalGold = alive.reduce((sum, p) => sum + amount(p.personalWallet?.stock?.gold || 0), 0);
  return {
    day: world.day, alive: alive.length, civilian: civilians.length,
    soldiers: soldierCount, groups,
    births: world.births || 0, deaths: world.deaths || 0,
    deathsByCause: { ...world.deathsByCause },
    populationNetFromStart: alive.length - (world.initialPopulationSize || 0),
    peopleWhoHaveSoldPersonalGoods: marketActivity,
    livingPawnsWithFamilyLearning: exposed.length,
    accumulatedObservedFamilyLessons: learnedLessons,
    operationalPrivateHomes: privateHomes.filter(s => s.complete).length,
    privateHomeProjects: privateHomes.filter(s => !s.complete).length,
    personalWalletGold: round(personalGold),
    kingdomEconomies: (world.kingdoms || []).map(kingdom => ({
      kingdomId: kingdom.id,
      living: alive.filter(p => p.kingdomId === kingdom.id).length,
      soldiers: alive.filter(p => p.kingdomId === kingdom.id && p.role === 'soldier').length,
      treasuryGold: round(amount(kingdom.treasury?.stock?.gold || 0)),
      treasuryFood: round(amount(kingdom.treasury?.stock?.food || 0)),
      marketFood: round(amount(kingdom.market?.stock?.food || 0)),
      marketWood: round(amount(kingdom.market?.stock?.wood || 0)),
      marketStone: round(amount(kingdom.market?.stock?.stone || 0))
    })),
    civilizationEvidence: assessCivilizationProgress(world)
  };
}

function argsFrom(argv) {
  const args = new Map();
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i];
    if (!word.startsWith('--') || !argv[i + 1] || argv[i + 1].startsWith('--'))
      throw new RangeError('Argumento inválido: ' + word);
    args.set(word.slice(2), argv[++i]);
  }
  const number = (name, fallback) => {
    const value = args.has(name) ? Number(args.get(name)) : fallback;
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(name + ' deve ser inteiro positivo');
    return value;
  };
  const seed = number('seed', 42);
  const days = number('days', 30);
  const population = number('population', 200);
  const sampleEvery = number('sample-every', 30);
  if (days > 1800 || population < 96 || population > 5000) throw new RangeError('Dias <= 1800 e população entre 96 e 5000');
  for (const key of args.keys()) {
    if (!['seed', 'days', 'population', 'sample-every', 'output'].includes(key))
      throw new RangeError('Argumento desconhecido: ' + key);
  }
  return { seed, days, population, sampleEvery, output: args.get('output') || null };
}

export function auditGenerations({ seed = 42, days = 30, population = 200, sampleEvery = 30 } = {}) {
  const world = engine.createWorld(seed, {
    initialPopulation: population, initialMilitaryShare: .8, trackCivilization: true
  });
  world.initialPopulationSize = population;
  const timeline = [snapshotGenerations(world)];
  for (let day = 1; day <= days; day++) {
    engine.stepDay(world, { includeSnapshot: false });
    if (day % sampleEvery === 0 || day === days) timeline.push(snapshotGenerations(world));
  }
  return {
    scenario: 'prebuilt-kingdoms',
    disclaimer: 'A main inicia com reinos, guarnições e recursos. Esta auditoria não testa a fundação emergente do reino.',
    settings: { seed, days, population, initialMilitaryShare: .8 },
    timeline
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const params = argsFrom(process.argv.slice(2));
  const result = auditGenerations(params);
  if (params.output) {
    fs.mkdirSync(path.dirname(params.output), { recursive: true });
    fs.writeFileSync(params.output, JSON.stringify(result, null, 2) + '\n');
  }
  const last = result.timeline.at(-1);
  console.log(JSON.stringify({ scenario: result.scenario, settings: result.settings,
    finalDay: last.day, alive: last.alive, births: last.births, deaths: last.deaths,
    deathsByCause: last.deathsByCause, independentlyProvisioning:
    last.civilizationEvidence.evidence.independentlyProvisioning,
    familyMentorLessons: last.accumulatedObservedFamilyLessons,
    output: params.output }, null, 2));
}
