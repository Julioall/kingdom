import test from 'node:test';
import assert from 'node:assert/strict';
import { personAgeScale, personLifeStage } from '../src/ui/person-age-scale.js';
import {
  HUMAN_ADOLESCENT_AGE_DAYS, HUMAN_ADULT_AGE_DAYS,
  HUMAN_ELDER_AGE_DAYS, HUMAN_MAX_AGE_DAYS
} from '../src/simulation/individuals/human-age.js';

test('pawn visuals grow smoothly from newborn to adulthood at 365 days', () => {
  const birth = personAgeScale(0);
  const ageSixMonths = personAgeScale(180);
  const ageElevenMonths = personAgeScale(330);
  const adult = personAgeScale(HUMAN_ADULT_AGE_DAYS);
  assert.equal(birth, .6);
  assert.ok(birth < ageSixMonths && ageSixMonths < ageElevenMonths && ageElevenMonths < adult);
  assert.equal(adult, 1);
  assert.ok(Math.abs(personAgeScale(HUMAN_ADULT_AGE_DAYS - 1) - adult) < .002);
});

test('pawn becomes old after 730 days and reaches natural maximum at 900', () => {
  assert.equal(personAgeScale(HUMAN_ELDER_AGE_DAYS), 1);
  assert.ok(personAgeScale(800) < 1 && personAgeScale(800) > .92);
  assert.equal(personAgeScale(HUMAN_MAX_AGE_DAYS), .92);
  assert.equal(personAgeScale(HUMAN_MAX_AGE_DAYS + 100), .92);
  assert.equal(personLifeStage(0), 'Criança');
  assert.equal(personLifeStage(HUMAN_ADOLESCENT_AGE_DAYS), 'Adolescente');
  assert.equal(personLifeStage(HUMAN_ADULT_AGE_DAYS), 'Adulto');
  assert.equal(personLifeStage(HUMAN_ELDER_AGE_DAYS), 'Idoso');
});
