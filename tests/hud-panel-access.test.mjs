import test from 'node:test';
import assert from 'node:assert/strict';
import { syncHudPanelAccess } from '../src/ui/hud-panel-access.js';

function mockPanel() {
  const attributes = new Map();
  return { inert: false, attributes, setAttribute(name, value) { attributes.set(name, value); } };
}

test('closed side panels cannot receive keyboard focus', () => {
  const left = mockPanel(), right = mockPanel();
  syncHudPanelAccess(left, right);
  assert.equal(left.inert, true);
  assert.equal(right.inert, true);
  assert.equal(left.attributes.get('aria-hidden'), 'true');
  assert.equal(right.attributes.get('aria-hidden'), 'true');
});

test('reopening one panel restores its accessibility while hiding the other', () => {
  const left = mockPanel(), right = mockPanel();
  syncHudPanelAccess(left, right, { leftOpen: true });
  assert.equal(left.inert, false);
  assert.equal(right.inert, true);
  syncHudPanelAccess(left, right, { rightOpen: true });
  assert.equal(left.inert, true);
  assert.equal(right.inert, false);
  assert.equal(right.attributes.get('aria-hidden'), 'false');
});
