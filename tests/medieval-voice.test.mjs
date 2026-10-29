import test from 'node:test';
import assert from 'node:assert/strict';
import { medievalVoice, medievalObservations, observedKingdomDirection } from '../src/ai/medieval-voice.js';

test('compass directions use the kingdom as origin and map rows grow southward', () => {
  const origin = { x: 10, y: 10 };
  for (const [x, y, direction] of [[20,10,'leste'],[0,10,'oeste'],[10,0,'norte'],[10,20,'sul'],[20,0,'nordeste']]) {
    assert.equal(observedKingdomDirection({ x,y }, origin), 'ao ' + direction + ' do reino');
  }
  assert.equal(observedKingdomDirection({}, origin), null);
  assert.equal(observedKingdomDirection(origin, origin), 'junto ao coração do reino');
});

test('prompt observations omit nested coordinates while preserving directions, supplies and action IDs', () => {
  const facts = { campaign: { target: { x: 12, y: 3, directionFromKingdom: 'ao norte do reino' } },
    foodStock: 20, allowedActions: ['hold_position'] };
  assert.deepEqual(medievalObservations(facts), { campaign: { target: { directionFromKingdom: 'ao norte do reino' } },
    foodStock: 20, allowedActions: ['hold_position'] });
  assert.equal(facts.campaign.target.x, 12);
});

test('royal and military voices stay distinct, first-person and grounded', () => {
  assert.match(medievalVoice('king'), /celeiros/);
  assert.match(medievalVoice('general'), /vanguarda/);
  for (const role of ['king','general']) {
    assert.match(medievalVoice(role), /primeira pessoa/);
    assert.match(medievalVoice(role), /Não invente/);
    assert.match(medievalVoice(role), /somente quando o relato indicar/);
  }
});
