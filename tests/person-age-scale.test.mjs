import test from 'node:test';
import assert from 'node:assert/strict';
import { personAgeScale, personLifeStage } from '../src/ui/person-age-scale.js';

test('person sprite grows continuously through childhood', () => {
  const birth = personAgeScale(0);
  const yearSix = personAgeScale(6 * 365);
  const yearEleven = personAgeScale(11 * 365);
  const yearTwelve = personAgeScale(12 * 365);
  assert.equal(birth, .6);
  assert.ok(birth < yearSix && yearSix < yearEleven && yearEleven < yearTwelve);
  assert.equal(yearTwelve, 1);
  assert.ok(Math.abs(personAgeScale(12 * 365 - 1) - yearTwelve) < .001);
});

test('older people visually age without sudden size jumps or altering gameplay', () => {
  assert.equal(personAgeScale(65 * 365), 1);
  assert.ok(personAgeScale(75 * 365) < 1 && personAgeScale(75 * 365) > .92);
  assert.equal(personAgeScale(82 * 365), .92);
  assert.equal(personAgeScale(120 * 365), .92);
  assert.equal(personLifeStage(0), 'Criança');
  assert.equal(personLifeStage(12 * 365), 'Adolescente');
  assert.equal(personLifeStage(18 * 365), 'Adulto');
  assert.equal(personLifeStage(65 * 365), 'Idoso');
});
