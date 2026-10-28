import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/simulation/world/generation.js';
import { dispatchCommand } from '../src/simulation/commands.js';
import { currencyValueCopper } from '../src/simulation/economy/currency-denominations.js';
import { exchangeAtRoyalCastle, seedRoyalChangeReserve } from '../src/simulation/economy/royal-coin-exchange.js';

function fixture() {
  const w = createWorld(42), kingdom = w.kingdoms[0];
  const castle = w.structures.find(s => s.type === 'castelo' && s.kingdomId === kingdom.id);
  return { w, kingdom, castle, market: kingdom.market.stock, treasury: kingdom.treasury.stock };
}
test('new kings own finite change reserves derived from existing gold value', () => {
  const { kingdom, market, treasury } = fixture();
  assert.equal(treasury.silver, 20);
  assert.equal(treasury.copper, 300);
  assert.ok(treasury.gold > 0 && Number.isSafeInteger(treasury.gold));
  assert.equal(market.silver, 0);
  assert.equal(market.copper, 0);
  const original = currencyValueCopper(treasury);
  assert.equal(seedRoyalChangeReserve(kingdom), false, 'reserve cannot be duplicated after initialization');
  assert.equal(currencyValueCopper(treasury), original);
});
test('merchant exchanges one gold into ten silver pieces at the castle without creating value', () => {
  const { w, kingdom, castle, market, treasury } = fixture();
  const before = [currencyValueCopper(market), currencyValueCopper(treasury)];
  const result = dispatchCommand(w, { type: 'castle-exchange',
    kingdomId: kingdom.id, castleId: castle.id, fromCoin: 'gold', toCoin: 'silver', quantity: 1 });
  assert.equal(result.ok, true);
  assert.equal(result.received, 10);
  assert.equal(currencyValueCopper(market), before[0]);
  assert.equal(currencyValueCopper(treasury), before[1]);
  assert.equal(market.gold, 17);
  assert.equal(market.silver, 10);
  assert.equal(treasury.silver, 10);
  assert.equal(kingdom.coinExchangeLedger.count, 1);
  assert.equal(kingdom.coinExchangeLedger.history[0].valueCopper, 100);
});
test('merchant requests 100 copper at the castle and can swap back only in integer units', () => {
  const { w, kingdom, castle, market, treasury } = fixture();
  const before = currencyValueCopper(market) + currencyValueCopper(treasury);
  assert.equal(exchangeAtRoyalCastle(w, kingdom.id, castle.id, 'gold', 'copper', 1).ok, true);
  assert.equal(market.copper, 100);
  assert.equal(exchangeAtRoyalCastle(w, kingdom.id, castle.id, 'copper', 'silver', 10).ok, true);
  assert.equal(market.silver, 1);
  assert.equal(market.copper, 90);
  assert.equal(exchangeAtRoyalCastle(w, kingdom.id, castle.id, 'silver', 'gold', 1).ok, false);
  assert.equal(currencyValueCopper(market) + currencyValueCopper(treasury), before);
});
test('invalid, ruined, foreign, stale or insufficient castle request never transfers coins', () => {
  const { w, kingdom, castle, treasury, market } = fixture();
  const before = structuredClone({ market, treasury });
  const attempts = [
    () => exchangeAtRoyalCastle(w, kingdom.id, castle.id, 'gold', 'silver', .5),
    () => exchangeAtRoyalCastle(w, kingdom.id, castle.id, 'gold', 'silver', 0),
    () => exchangeAtRoyalCastle(w, kingdom.id, castle.id, 'gold', 'silver', 101),
    () => exchangeAtRoyalCastle(w, kingdom.id, castle.id, 'iron', 'gold', 1),
    () => exchangeAtRoyalCastle(w, kingdom.id, castle.id, 'silver', 'gold', 1),
    () => exchangeAtRoyalCastle(w, kingdom.id, castle.id + 1, 'gold', 'silver', 1),
    () => exchangeAtRoyalCastle(w, w.kingdoms[1].id, castle.id, 'gold', 'silver', 1)
  ];
  for (const attempt of attempts) assert.equal(attempt().ok, false);
  castle.destroyedDay = w.day;
  assert.equal(exchangeAtRoyalCastle(w, kingdom.id, castle.id, 'gold', 'silver', 1).ok, false);
  castle.destroyedDay = null;
  treasury.silver = 0;
  assert.equal(exchangeAtRoyalCastle(w, kingdom.id, castle.id, 'gold', 'silver', 1).ok, false);
  treasury.silver = before.treasury.silver;
  market.gold = .5;
  assert.equal(exchangeAtRoyalCastle(w, kingdom.id, castle.id, 'gold', 'silver', 1).ok, false);
  market.gold = before.market.gold;
  assert.deepEqual({ market, treasury }, before);
  assert.equal(kingdom.coinExchangeLedger, undefined);
});
