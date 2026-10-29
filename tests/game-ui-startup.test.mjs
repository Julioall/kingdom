import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatWholeMeasure } from '../src/ui/whole-measures.js';

const gameSource = readFileSync(new URL('../src/ui/game.js', import.meta.url), 'utf8');

test('game HUD imports its whole-number formatter before initial rendering', () => {
  assert.match(gameSource, /import \\{ formatWholeMeasure \\} from '\\.\\/whole-measures\\.js';/);
  assert.match(gameSource, /function fmt\\(n\\) \\{ return formatWholeMeasure\\(n\\); \\}/);
  assert.equal(formatWholeMeasure(10), '10');
});
