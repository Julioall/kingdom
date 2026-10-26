import test from 'node:test';
import assert from 'node:assert/strict';
import { FOOD_RESERVE_PER_UNIT } from '../src/config/ecosystem.js';
import { drawGarrisonRation } from '../src/simulation/kingdoms/service.js';

test('garrison ration withdraws only the food present in the treasury and kingdom community', () => {
  const person = { id: 11, role: 'soldier', kingdomId: 1, campaignId: null, x: 0, y: 0, foodReserve: 0 };
  const center = { id: 4, type: 'centro_militar', kingdomId: 1, complete: true, x: 0, y: 0 };
  const kingdom = { id: 1, communityId: 2, treasury: { stock: { food: 1 } } };
  const community = { id: 2, kingdomId: 1, stores: { food: 1, meat: 0 } };
  const world = { people: [person], structures: [center], kingdoms: [kingdom], communities: [community] };

  const received = drawGarrisonRation(world, person, center, 5);

  assert.ok(Math.abs(received - 2 * FOOD_RESERVE_PER_UNIT) < 1e-9);
  assert.ok(Math.abs(person.foodReserve - received) < 1e-9);
  assert.equal(kingdom.treasury.stock.food, 0);
  assert.equal(community.stores.food, 0);
});
