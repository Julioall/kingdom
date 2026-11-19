import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_BROWSER_POPULATION, MIN_INITIAL_POPULATION, MAX_INITIAL_POPULATION,
  parseInitialPopulation
} from '../src/ui/population-preset.js';

test('browser defaults to 200 inhabitants, 100 per kingdom', () => {
  assert.equal(DEFAULT_BROWSER_POPULATION, 200);
  assert.equal(parseInitialPopulation(null), 200);
  assert.equal(parseInitialPopulation(''), 200);
  assert.equal(parseInitialPopulation(undefined), 200);
});

test('population query allows the classic baseline and the 5000 stress ceiling', () => {
  assert.equal(MIN_INITIAL_POPULATION, 96);
  assert.equal(MAX_INITIAL_POPULATION, 5000);
  assert.equal(parseInitialPopulation('96'), 96);
  assert.equal(parseInitialPopulation('200'), 200);
  assert.equal(parseInitialPopulation('500'), 500);
  assert.equal(parseInitialPopulation('5000'), 5000);
  assert.equal(parseInitialPopulation('2500'), 2500);
});

test('invalid, unsafe or excessive population query cannot force an unmeasured world', () => {
  for (const value of ['0', '95', '-1', '5001', '1000000', '1e3',
    'Infinity', '96.5', 'not-a-number', '\\d', ' 500', '500 ']) {
    assert.equal(parseInitialPopulation(value), 200, 'invalid override: ' + value);
  }
});
