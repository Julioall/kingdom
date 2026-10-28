import test from 'node:test';
import assert from 'node:assert/strict';
import {
  goldPriceToCopper, quoteCoinPayment, settleCoinTrade
} from '../src/simulation/economy/coin-payments.js';

const value = account => account.gold * 100 + account.silver * 10 + account.copper;

test('physical copper, silver and gold settle exact prices with real change', () => {
  const buyer = { gold: 1, silver: 0, copper: 0, food: 0 };
  const seller = { gold: 0, silver: 6, copper: 3, food: 3 };
  const before = value(buyer) + value(seller);
  const quote = quoteCoinPayment(buyer, seller, 37);
  assert.deepEqual(quote.tender, { copper: 0, silver: 0, gold: 1 });
  assert.deepEqual(quote.change, { copper: 3, silver: 6, gold: 0 });
  const result = settleCoinTrade(buyer, seller, 37, seller, buyer, 'food', 1);
  assert.deepEqual(result, quote);
  assert.deepEqual(buyer, { gold: 0, silver: 6, copper: 3, food: 1 });
  assert.deepEqual(seller, { gold: 1, silver: 0, copper: 0, food: 2 });
  assert.equal(value(buyer) + value(seller), before, 'no denomination is minted or destroyed');
});

test('an exact mix of smaller coins avoids unnecessary change', () => {
  const buyer = { gold: 0, silver: 3, copper: 7 };
  const seller = { gold: 0, silver: 0, copper: 0, wood: 3 };
  const q = quoteCoinPayment(buyer, seller, 37);
  assert.deepEqual(q.tender, { copper: 7, silver: 3, gold: 0 });
  assert.deepEqual(q.change, { copper: 0, silver: 0, gold: 0 });
  assert.ok(settleCoinTrade(buyer, seller, 37, seller, { wood: 0 }, 'wood', 1));
  assert.equal(value(buyer), 0);
  assert.equal(value(seller), 37);
});

test('seller without three copper for change rejects entire trade atomically', () => {
  const payer = { gold: 1, silver: 0, copper: 0, food: 0 };
  const seller = { gold: 0, silver: 6, copper: 2, food: 3 };
  const before = structuredClone({ payer, seller });
  assert.equal(quoteCoinPayment(payer, seller, 37), null);
  assert.equal(settleCoinTrade(payer, seller, 37, seller, payer, 'food', 1), null);
  assert.deepEqual({ payer, seller }, before);
});

test('insufficient stock, negative coins, fractional gold and aliases never settle', () => {
  const buyer = { gold: 1, silver: 0, copper: 0, food: 0 };
  const seller = { gold: 0, silver: 6, copper: 3, food: 1 };
  const before = structuredClone({ buyer, seller });
  assert.equal(settleCoinTrade(buyer, seller, 37, seller, buyer, 'food', 2), null);
  assert.equal(settleCoinTrade(buyer, buyer, 37, seller, buyer, 'food', 1), null);
  assert.equal(settleCoinTrade(buyer, seller, 37, seller, seller, 'food', 1), null);
  assert.equal(settleCoinTrade(buyer, seller, 37, seller, buyer, 'gold', 1), null);
  assert.deepEqual({ buyer, seller }, before);
  for (const invalid of [-1, .5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    buyer.gold = invalid;
    assert.equal(quoteCoinPayment(buyer, seller, 37), null);
  }
});

test('legacy price can be represented in copper only at an exact integer value', () => {
  assert.equal(goldPriceToCopper(.37), 37);
  assert.equal(goldPriceToCopper(.35, 4), 140);
  assert.equal(goldPriceToCopper(.335), null);
  assert.equal(goldPriceToCopper(0), null);
  assert.equal(goldPriceToCopper(Infinity), null);
  assert.equal(goldPriceToCopper(.25, 0), null);
});

test('search chooses a valid non-greedy change combination without minting', () => {
  const payer = { gold: 2, silver: 0, copper: 0, wood: 0 };
  const payee = { gold: 1, silver: 5, copper: 0, wood: 1 };
  const total = value(payer) + value(payee);
  assert.ok(settleCoinTrade(payer, payee, 50, payee, payer, 'wood', 1));
  assert.equal(value(payer), 150);
  assert.equal(value(payee), 200);
  assert.equal(value(payer) + value(payee), total);
});
