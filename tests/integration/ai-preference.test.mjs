import test from 'node:test';
import assert from 'node:assert/strict';
import { readLocalAiPreference, writeLocalAiPreference } from '../../src/ai/preference.js';

test('local AI preference defaults to disabled and persists enabled state', () => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };

  assert.equal(readLocalAiPreference(storage), false);
  writeLocalAiPreference(storage, true);
  assert.equal(readLocalAiPreference(storage), true);
  writeLocalAiPreference(storage, false);
  assert.equal(readLocalAiPreference(storage), false);
});
