import test from 'node:test';
import assert from 'node:assert/strict';
import { createFieldTileDelta } from '../src/simulation/field-delta.js';

test('dense dirty detection copies authoritative changes after the density threshold', () => {
  const make = () => ({ tileCount: 10, plantCount: 2,
    scalars: new Float32Array(250), ids: new Int32Array(70),
    types: new Uint8Array(30), plants: new Float32Array(20) });
  const previous = make(), next = make();
  for (const key of ['scalars', 'ids', 'types', 'plants']) {
    const span = next[key].length / 10;
    const threshold = key === 'types' ? 2 : 5;
    for (let tile = 0; tile < threshold; tile++) next[key][tile * span] = tile + 1;
    next[key][9 * span] = 77;
  }
  const delta = createFieldTileDelta(next, previous);
  assert.ok(delta);
  for (const key of ['scalars', 'ids', 'types', 'plants']) {
    assert.equal(delta.fields[key].length, 1);
    const field = delta.fields[key][0];
    assert.equal(field.field, 0);
    assert.equal(field.indices, undefined);
    assert.equal(field.values.length, 10);
    assert.equal(field.values[9], 77);
  }
  assert.equal(createFieldTileDelta(next, previous, { maxBytesFraction: .01 }), null);
});
