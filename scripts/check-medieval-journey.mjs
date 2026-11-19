// Mandatory acceptance gate for the *complete* five-stage battlefield journey.
// The physical safety tests stay green even when this workflow correctly
// reports unfinished military behavior as a failing readiness check.
import { readFileSync } from 'node:fs';

const file = process.argv[2] || 'out/military-journey.json';
const report = JSON.parse(readFileSync(file, 'utf8'));
if (!Array.isArray(report.results) || report.results.length !== 3)
  throw Error('Expected the controlled replay for 3, 4 and 5 units.');

let failures = 0;
for (const result of report.results) {
  const physical = Object.values(result.safety || {}).slice(0, 3).every(n => n === 0);
  const complete = result.sequenceComplete === true;
  const missing = (result.missingStages || []).join(', ') || 'nenhuma';
  const crossing = (result.crossingByUnit || [])
    .map(u => u.unitId + ':' + u.crossed + '/' + u.total).join(' ');
  console.log('MILITARY-JOURNEY-ACCEPTANCE', JSON.stringify({
    units: result.units, seed: result.seed, physical, complete,
    missing, crossing, milestones: result.milestones
  }));
  if (!physical || !complete) failures++;
}
if (failures) {
  console.error('BLOCKED: ' + failures + '/3 scenarios have not demonstrated the entire ' +
    'march → crossing → regrouping → battle formation → contact sequence. ' +
    'No merge readiness is claimed.');
  process.exitCode = 1;
}
