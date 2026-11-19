import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_BROWSER_POPULATION, MIN_INITIAL_POPULATION, MAX_INITIAL_POPULATION,
  parseInitialPopulation
} from '../src/ui/population-preset.js';

test('browser defaults to measured 500 inhabitants without a query override', () => {
  assert.equal(DEFAULT_BROWSER_POPULATION, 500);
  assert.equal(parseInitialPopulation(null), 500);
  assert.equal(parseInitialPopulation(''), 500);
  assert.equal(parseInitialPopulation(undefined), 500);
});

test('population query allows the classic baseline and the 5000 stress ceiling', () => {
  assert.equal(MIN_INITIAL_POPULATION, 96);
  assert.equal(MAX_INITIAL_POPULATION, 5000);
  assert.equal(parseInitialPopulation('96'), 96);
  assert.equal(parseInitialPopulation('500'), 500);
  assert.equal(parseInitialPopulation('5000'), 5000);
  assert.equal(parseInitialPopulation('2500'), 2500);
});

test('invalid, unsafe or excessive population query cannot force an unmeasured world', () => {
  for (const value of ['0', '95', '-1', '5001', '1000000', '1e3',
    'Infinity', '96.5', 'not-a-number', '\\d', ' 500', '500 ']) {
    assert.equal(parseInitialPopulation(value), 500, 'invalid override: ' + value);
  }
});
