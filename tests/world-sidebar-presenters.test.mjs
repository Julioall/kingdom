import test from 'node:test';
import assert from 'node:assert/strict';
import { speciesRowsHtml, chronicleHtml } from '../src/ui/presenters/world-sidebar.js';

const esc = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

test('species presenter formats counts independently of the DOM and escapes labels', () => {
  const animals = [{ id: 'sheep', role: 'Rebanho <silvestre>', name: 'Ovelha & cria', color: '#ffffff' }];
  const a = speciesRowsHtml(animals, { sheep: 7 }, esc);
  assert.match(a, /Rebanho &lt;silvestre&gt;/);
  assert.match(a, /Ovelha &amp; cria/);
  assert.match(a, /<b>7<\/b>/);
  const flora = [{ id: 'field', guild: 'Agricultura', name: 'Trigo', color: '#abc123' }];
  const b = speciesRowsHtml(flora, { field: 1200 }, esc, value => value.toLocaleString('pt-BR'), 'guild');
  assert.match(b, /<b>1\.200<\/b>/);
  assert.match(b, /Agricultura/);
});

test('chronicle presentation preserves existing limit, chronology and empty copy', () => {
  const events = Array.from({ length: 45 }, (_, index) =>
    ({ category: 'Conflito', text: 'Vitória <' + index + '>', day: index + 1 }));
  const calendarDate = day => ({ dayOfYear: day, year: 1 });
  const result = chronicleHtml(events, calendarDate, esc);
  assert.equal((result.match(/class="event"/g) || []).length, 40);
  assert.match(result, /Vitória &lt;0&gt;/);
  assert.doesNotMatch(result, /Vitória &lt;44&gt;/);
  assert.match(chronicleHtml([], calendarDate, esc), /A história começa aqui/);
  assert.match(chronicleHtml(null, calendarDate, esc), /A história começa aqui/);
});
