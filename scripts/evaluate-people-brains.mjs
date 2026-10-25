import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Sim from '../src/simulation/engine.js';
import { HIDDEN_NEURONS } from '../src/config/ecosystem.js';
import { ensureBrainSize } from '../src/controllers/individual/neural.js';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.dirname(scriptDirectory);
const seeds = (process.env.NEURAL_SEEDS || '1,42,987,2026').split(',')
  .map(value => Number(value.trim())).filter(Number.isSafeInteger);
const days = Math.max(1, Math.floor(Number(process.env.NEURAL_DAYS || 730)));
const candidates = (process.env.NEURAL_CANDIDATES || 'rules,4,6,9').split(',')
  .map(value => value.trim()).filter(Boolean).map(value => value === 'rules' ? { name: 'rules', hiddenSize: HIDDEN_NEURONS }
    : { name: 'network-' + Math.max(1, Math.floor(Number(value))), hiddenSize: Math.max(1, Math.floor(Number(value))) });
if (!seeds.length || !candidates.length || candidates.some(candidate => !Number.isFinite(candidate.hiddenSize))) {
  throw new Error('Seeds e candidatos precisam conter valores válidos.');
}

function deathsByCause(people) {
  return people.filter(person => !person.alive).reduce((result, person) => {
    const cause = person.deathCause || 'unknown';
    result[cause] = (result[cause] || 0) + 1;
    return result;
  }, {});
}

function mean(values) { return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length); }
function tCritical95(n) {
  const byDf = [0, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262,
    2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086,
    2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042];
  const df = Math.max(1, n - 1);
  return byDf[df] || 1.96;
}

function pairedSummary(values) {
  if (!values.length) return { n: 0, mean: null, ci95: null };
  const average = mean(values);
  if (values.length < 2) return { n: values.length, mean: Number(average.toFixed(3)), ci95: null };
  const variance = values.length > 1
    ? values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1) : 0;
  const margin = tCritical95(values.length) * Math.sqrt(variance / values.length);
  return { n: values.length, mean: Number(average.toFixed(3)), ci95: [Number((average - margin).toFixed(3)), Number((average + margin).toFixed(3))] };
}

const runs = [];
const startedAt = new Date();
for (const seed of seeds) for (const candidate of candidates) {
  const world = Sim.createWorld(seed);
  // Keep initial generation and RNG consumption identical across candidates.
  // Existing 9-neuron brains are resized deterministically from the same seed.
  world.neuralOverrides = { peopleController: candidate.name === 'rules' ? 'rules' : 'network', peopleHiddenSize: candidate.hiddenSize };
  for (const person of world.people) if (person.role === 'resident') ensureBrainSize(world, person, candidate.hiddenSize);
  const initialPeople = world.people.filter(person => person.alive).length;
  const started = performance.now();
  for (let day = 0; day < days; day++) Sim.stepDay(world, null, { includeSnapshot: false });
  const elapsedSeconds = (performance.now() - started) / 1000;
  const alive = world.people.filter(person => person.alive);
  const residents = world.people.filter(person => person.role === 'resident');
  const run = {
    seed, days, candidate: candidate.name, hiddenSize: candidate.hiddenSize,
    elapsedSeconds: Number(elapsedSeconds.toFixed(3)), simulatedDaysPerSecond: Number((days / Math.max(.001, elapsedSeconds)).toFixed(3)),
    population: { initial: initialPeople, living: alive.length, deaths: deathsByCause(world.people), births: world.births || 0 },
    learning: {
      decisions: residents.reduce((sum, person) => sum + (person.brain?.decisions || 0), 0),
      updates: residents.reduce((sum, person) => sum + (person.brain?.updates || 0), 0),
      hiddenSizes: [...new Set(residents.filter(person => person.brain).map(person => person.brain.hiddenSize))].sort((a, b) => a - b)
    },
    food: {
      plantFoodHarvested: Number((world.harvests.plantFoodBiomass || 0).toFixed(2)),
      cultivatedFoodHarvested: Number((world.harvests.cultivatedFoodBiomass || 0).toFixed(2)),
      communityFoodStores: Number(world.communities.reduce((sum, community) => sum + (community.stores.food || 0), 0).toFixed(2))
    },
    conflicts: world.conflicts || 0
  };
  runs.push(run);
  console.error('Seed ' + seed + ' / ' + candidate.name + ': ' + run.elapsedSeconds + ' s, ' + alive.length + ' pessoas vivas.');
}

const baseline = new Map(runs.filter(run => run.candidate === 'rules').map(run => [run.seed, run]));
const summaries = candidates.map(candidate => {
  const selected = runs.filter(run => run.candidate === candidate.name);
  const paired = selected.map(run => ({ run, control: baseline.get(run.seed) })).filter(pair => pair.control);
  const metrics = ['livingPeople', 'deaths', 'plantFoodHarvested', 'cultivatedFoodHarvested'];
  const comparison = Object.fromEntries(metrics.map(metric => {
    const valueOf = run => metric === 'livingPeople' ? run.population.living
      : metric === 'deaths' ? Object.values(run.population.deaths).reduce((sum, count) => sum + count, 0)
        : metric === 'plantFoodHarvested' ? run.food.plantFoodHarvested
          : run.food.cultivatedFoodHarvested;
    return [metric, pairedSummary(paired.map(({ run, control }) => valueOf(run) - valueOf(control)))];
  }));
  return { candidate: candidate.name, hiddenSize: candidate.hiddenSize, runs: selected.length,
    meanLivingPeople: Number(mean(selected.map(run => run.population.living)).toFixed(2)),
    meanDeaths: Number(mean(selected.map(run => Object.values(run.population.deaths).reduce((sum, count) => sum + count, 0))).toFixed(2)),
    pairedDeltaVsRules: comparison };
});

const timestamp = startedAt.toISOString().replaceAll(':', '-');
const outputDirectory = process.env.NEURAL_REPORT_DIR
  ? path.resolve(process.env.NEURAL_REPORT_DIR)
  : path.join(rootDirectory, 'reports', 'neural-evaluation', timestamp);
await mkdir(outputDirectory, { recursive: true });
const metadata = {
  startedAt: startedAt.toISOString(), runtime: process.version, map: { width: Sim.width, height: Sim.height },
  days, seeds, candidates, control: 'regras determinísticas sem contribuição neural para residentes; governantes permanecem na configuração original',
  note: 'Execução pareada exploratória. O relatório não seleciona tamanho; tamanho inicial e parâmetros de atualização são os mesmos salvo a largura da camada oculta.'
};
const report = [
  '# Avaliação pareada de redes de cidadãos', '',
  `Execução: ${startedAt.toISOString()}. Seeds: ${seeds.join(', ')}. Duração: ${days} dias.`,
  '', 'As diferenças são candidato menos regra, pareadas por seed, com intervalo t de 95%. O intervalo usa aproximação normal para graus de liberdade acima de 30. Desempenho por candidato aparece nas rodadas brutas e não é comparado neste relatório.',
  'Esse piloto não congela pesos, não mede comandantes/soldados e não escolhe automaticamente uma rede.', '',
  '| Candidato | Rodadas | Pessoas vivas (média) | Mortes (média) | Δ pessoas vs regras, IC95% | Δ mortes vs regras, IC95% | Δ alimento vegetal vs regras, IC95% |',
  '|---|---:|---:|---:|---:|---:|---:|',
  ...summaries.map(item => {
    const living = item.pairedDeltaVsRules.livingPeople, deaths = item.pairedDeltaVsRules.deaths;
    const harvest = item.pairedDeltaVsRules.plantFoodHarvested;
    const fmt = entry => entry.mean === null ? '—' : `${entry.mean}${entry.ci95 ? ` [${entry.ci95.join(', ')}]` : ' (IC95% indisponível, n < 2)'}`;
    return `| ${item.candidate} (${item.hiddenSize}) | ${item.runs} | ${item.meanLivingPeople} | ${item.meanDeaths} | ${fmt(living)} | ${fmt(deaths)} | ${fmt(harvest)} |`;
  }), '', '## Leitura', '',
  'Diferenças inconclusivas mantêm a configuração atual. Use ao menos 30 seeds de calibração e outras 30 seeds finais, duração adequada e revisão dos indicadores antes de selecionar qualquer tamanho.'
].join('\n');
await writeFile(path.join(outputDirectory, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
await writeFile(path.join(outputDirectory, 'results.jsonl'), runs.map(run => JSON.stringify(run)).join('\n') + '\n');
await writeFile(path.join(outputDirectory, 'summary.json'), JSON.stringify({ metadata, summaries }, null, 2) + '\n');
await writeFile(path.join(outputDirectory, 'report.md'), report + '\n');
console.log(JSON.stringify({ outputDirectory, runs: runs.length, summaries }, null, 2));
