import test from 'node:test';
import assert from 'node:assert/strict';
import { kingdomCardsHtml } from '../src/ui/kingdom-list.js';
import { formationInspectionHtml, fieldCommandInspectionHtml } from '../src/ui/inspectors/tactical-inspector.js';

const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const fmt = value => String(value);
const personById = new Map([
  [1, { id: 1, role: 'ruler', name: 'Rei <Teste>' }],
  [2, { id: 2, role: 'soldier', name: 'Lanceiro' }],
  [7, { id: 7, role: 'soldier', name: 'General <Mestre>' }]
]);
const getPerson = id => personById.get(id);

test('realm list presenter does not require a DOM and preserves escaping, troops and stocks', () => {
  const world = {
    kingdoms: [{
      id: 3, name: 'Reino <Leste>', color: '#abcdef', memberIds: [1, 2], rulerId: 1,
      homeIds: [1], towerIds: [12], territoryTileCount: 42
    }],
    campaigns: [{ attackerId: 3, defenderId: 4, status: 'engaged' }],
    structures: [{ id: 12, complete: true }]
  };
  const resourceSummary = () => ({ food: 9, gold: 3, people: 2, births: 1, deaths: 0 });
  const html = kingdomCardsHtml(world, { getPerson, resourceSummary, fmt, esc });
  assert.match(html, /Reino &lt;Leste&gt;/);
  assert.match(html, /Rei &lt;Teste&gt;/);
  assert.match(html, /1 soldados/);
  assert.match(html, /1 torres/);
  assert.match(html, /em combate/);
  assert.match(html, /42 células/);
  assert.ok(!html.includes('<Leste>'));
});

test('formation presenter exposes commander, morale and tactical phase using current snapshot', () => {
  const world = {
    campaigns: [{ id: 99, attacker: { kingdomId: 3, squadTactics: {
      memberToSquad: { 2: 0 }, squads: [{
        commanderId: 7, formationType: 'shield_wall', phase: 'holding', role: 'vanguard',
        cohesion: .8, morale: 64
      }]
    } } }]
  };
  const soldier = { id: 2, kingdomId: 3, campaignId: 99 };
  const html = formationInspectionHtml(soldier, world, getPerson, esc);
  assert.match(html, /Muralha de escudos/);
  assert.match(html, /Mantendo reserva\/posição/);
  assert.match(html, /General &lt;Mestre&gt;/);
  assert.match(html, /coesão 80%/);
  assert.equal(formationInspectionHtml({ ...soldier, campaignId: null }, world, getPerson, esc), '');
  assert.equal(formationInspectionHtml({ ...soldier, campaignId: 100 }, world, getPerson, esc), '');
});

test('field order presenter reads commander orders without simulation writes', () => {
  const p = { id: 2, campaignId: 99, fieldCommand: {
    issuerId: 7, reason: 'Manter <linha>', formationType: 'line', target: { x: 4, y: 8 }
  } };
  const html = fieldCommandInspectionHtml(p, getPerson, esc);
  assert.match(html, /Ordem recebida/);
  assert.match(html, /Manter &lt;linha&gt;/);
  assert.match(html, /4,8/);
  assert.equal(fieldCommandInspectionHtml({ ...p, campaignId: null }, getPerson, esc), '');
});
