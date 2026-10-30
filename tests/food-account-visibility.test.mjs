import test from 'node:test';
import assert from 'node:assert/strict';
import { resourceSummary } from '../src/ui/gameplay-data.js';
import { kingdomOverview } from '../src/ui/building-card.js';

test('food summary reconciles distinct owners without treating the unassigned market as local food', () => {
  const first = { id: 1, name: 'Vale', communityId: 11, memberIds: [],
    treasury: { stock: { food: 2, meat: 1 } },
    market: { stock: { food: 3, meat: .4 } } };
  const second = { id: 2, name: 'Serra', communityId: 12, memberIds: [],
    treasury: { stock: { food: 1, meat: 0 } },
    market: { stock: { food: 7, meat: 0 } } };
  const world = {
    kingdoms: [first, second], people: [], structures: [], kingdomRelations: {},
    communities: [
      { id: 11, kingdomId: 1, dissolved: false, stores: { food: 10, meat: 2 } },
      { id: 12, kingdomId: 2, dissolved: false, stores: { food: 8, meat: 0 } }
    ],
    market: { food: 100, meat: 0 }
  };
  const untouched = structuredClone(world);
  const valley = resourceSummary(world, first.id);
  const mountain = resourceSummary(world, second.id);
  const global = resourceSummary(world);

  assert.deepEqual(valley.foodByAccount, {
    community: 30, treasury: 12, market: 7, unassignedMarket: 0
  });
  assert.equal(valley.food, 49);
  assert.deepEqual(mountain.foodByAccount, {
    community: 8, treasury: 1, market: 7, unassignedMarket: 0
  });
  assert.equal(mountain.food, 16);
  assert.deepEqual(global.foodByAccount, {
    community: 38, treasury: 13, market: 14, unassignedMarket: 100
  });
  assert.equal(global.food, 165);
  assert.equal(Object.values(global.foodByAccount).reduce((a, b) => a + b, 0),
    global.food, 'every account contributes exactly once to the unchanged global total');
  assert.equal(Object.values(valley.foodByAccount).reduce((a, b) => a + b, 0),
    valley.food, 'no external market stock becomes owned or accessible to this kingdom');
  assert.deepEqual(world, untouched, 'display metrics never transfer, consume or create food');

  const overview = kingdomOverview(world, first);
  assert.match(overview, /Comida nas contas do reino/);
  assert.match(overview, /No estoque comunitário/);
  assert.match(overview, /No tesouro/);
  assert.match(overview, /No mercado local/);
  assert.doesNotMatch(overview, /não a comida imediatamente acessível/);
  assert.doesNotMatch(overview, /mercado geral sem vínculo não entra no total deste reino/);
  assert.doesNotMatch(overview, /139,5|100 dias equivalentes/,
    'the local report must not present global or unassigned food as local stock');
});

test('empty kingdom and empty global market retain zero food in every account', () => {
  const world = {
    kingdoms: [{ id: 3, communityId: 30, memberIds: [], treasury: { stock: {} }, market: { stock: {} } }],
    communities: [], people: [], structures: []
  };
  const local = resourceSummary(world, 3);
  const global = resourceSummary(world);
  for (const summary of [local, global]) {
    assert.equal(summary.food, 0);
    assert.deepEqual(summary.foodByAccount, {
      community: 0, treasury: 0, market: 0, unassignedMarket: 0
    });
  }
});
