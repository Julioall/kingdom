import test from 'node:test';
import assert from 'node:assert/strict';
import { dominantMetalKind } from '../src/config/mineral-deposits.js';

test('metal dominance preserves threshold, coercion and gold/silver/copper/iron tie order', () => {
  const kinds = ['gold', 'silver', 'copper', 'iron'];
  const values = [undefined, null, NaN, -1, 0, .05, .051, 5, '5', Infinity];
  for (const ore of [false, true]) for (const gold of values) for (const silver of values)
    for (const copper of values) for (const iron of values) {
      const amounts = [gold, silver, copper, iron];
      let expected = null, maximum = .05;
      for (let i = 0; i < kinds.length; i++) {
        const value = Number(amounts[i]) || 0;
        if (value > maximum) { maximum = value; expected = kinds[i]; }
      }
      const reserves = Object.fromEntries(kinds.map((kind, i) => [kind + (ore ? 'Ore' : ''), amounts[i]]));
      assert.equal(dominantMetalKind(reserves, ore), expected);
    }
});
