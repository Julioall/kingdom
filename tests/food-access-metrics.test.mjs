import test from 'node:test';
import assert from 'node:assert/strict';
import { foodAuditWorldOptions, observeFoodAccessDay, summarizeFoodAccess } from '../scripts/food-access-metrics.mjs';

const adult = { ageDays: 18 * 365, alive: true };

test('records critical food exposure separately for military and non-military residents', () => {
  const tracker = new Map();
  const world = {
    kingdoms: [{ id: 1, treasury: { stock: { food: 10 } }, market: { stock: { food: 0 } } }],
    communities: [{ id: 2, stores: { food: 0 } }],
    people: [
      { ...adult, id: 10, kingdomId: 1, communityId: 2, role: 'soldier', foodReserve: 1 },
      { ...adult, id: 11, kingdomId: 1, communityId: 2, role: 'resident', foodReserve: 19 },
      { ...adult, id: 12, kingdomId: 1, communityId: 2, role: 'ruler', foodReserve: 30 },
      { ...adult, id: 13, kingdomId: 1, communityId: 2, role: 'soldier', foodReserve: NaN },
      { ...adult, id: 14, kingdomId: 1, communityId: 2, role: 'resident', foodReserve: 0, alive: false, deathCause: 'starvation' },
      { ageDays: 8 * 365, alive: false, id: 15, kingdomId: 1, role: 'resident', deathCause: 'starvation' }
    ]
  };
  observeFoodAccessDay(tracker, world);
  const rows = summarizeFoodAccess(tracker, world);
  const military = rows.find(row => row.cohort === 'military');
  const civilian = rows.find(row => row.cohort === 'non-military');
  assert.deepEqual({ adultDays: military.observedAdultDays, critical: military.criticalAdultDays,
    unknown: military.invalidReserveAdultDays, treasury: military.criticalWithTreasuryStock,
    market: military.criticalWithMarketStock },
  { adultDays: 2, critical: 1, unknown: 1, treasury: 1, market: 0 });
  assert.equal(civilian.observedAdultDays, 2);
  assert.equal(civilian.criticalAdultDays, 1);
  assert.equal(civilian.starvationDeathsAllAges, 2);
  assert.equal(civilian.starvationDeathsAdults, 1);
  assert.equal(civilian.criticalAdultDayRate, 0.5);
  assert.deepEqual(summarizeFoodAccess(tracker, world), rows, 'finalizing twice is read-only');
});

test('does not mistake a different kingdom stockpile for access to food', () => {
  const tracker = new Map();
  const world = {
    kingdoms: [
      { id: 1, treasury: { stock: { food: 100 } }, market: { stock: { food: 50 } } },
      { id: 2, treasury: { stock: { food: 0 } }, market: { stock: { food: 0 } } }
    ],
    communities: [{ id: 3, stores: { food: 0 } }],
    people: [{ ...adult, id: 1, kingdomId: 2, communityId: 3, role: 'soldier', foodReserve: 0 }]
  };
  observeFoodAccessDay(tracker, world);
  let row = summarizeFoodAccess(tracker, world)[0];
  assert.equal(row.criticalWithoutRecordedStock, 1);
  assert.equal(row.criticalWithAnyRecordedStock, 0);
  world.kingdoms[1].market.stock.food = 5;
  observeFoodAccessDay(tracker, world);
  row = summarizeFoodAccess(tracker, world)[0];
  assert.equal(row.criticalWithoutRecordedStock, 1);
  assert.equal(row.criticalWithAnyRecordedStock, 1);
  assert.equal(row.criticalWithMarketStock, 1);
  assert.equal(row.criticalAdultDayRate, 1);
});

test('absent or invalid reserves are unknown, never silently counted as fed', () => {
  const tracker = new Map();
  observeFoodAccessDay(tracker, {
    people: [{ ...adult, kingdomId: null, role: 'resident' },
      { ...adult, kingdomId: null, role: 'soldier', foodReserve: Infinity }]
  });
  const rows = summarizeFoodAccess(tracker, { people: [] });
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.observedAdultDays === 1 && row.invalidReserveAdultDays === 1
    && row.criticalAdultDays === 0));
});

test('world audit options preserve historical seeds and validate the new browser profile', () => {
  assert.deepEqual(foodAuditWorldOptions(), {});
  assert.deepEqual(foodAuditWorldOptions('500', '0.8'),
    { initialPopulation: 500, initialMilitaryShare: 0.8 });
  for (const invalid of ['abc', '95', '5001', '10.5', 'Infinity']) {
    assert.throws(() => foodAuditWorldOptions(invalid), RangeError);
  }
  assert.throws(() => foodAuditWorldOptions('500', '0.9'), RangeError);
});
