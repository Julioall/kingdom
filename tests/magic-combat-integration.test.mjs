import test from 'node:test';
import assert from 'node:assert/strict';
import { PLANTS } from '../src/config/ecosystem.js';
import { applyMagicEffect } from '../src/simulation/magic/effects.js';
import { SPELLS } from '../src/simulation/magic/catalog.js';
import { beginSpell, advanceMagic } from '../src/simulation/magic/system.js';
import { fightTacticalRound } from '../src/simulation/kingdoms/military.js';
import { applyManualMovement } from '../src/simulation/individuals/manual-movement.js';
import { queueCampaignGeneralAiRequests, pullCampaignGeneralAiRequest,
  applyCampaignGeneralAiDecision } from '../src/simulation/kingdoms/campaigns.js';

function fixture(weapon = 'guerreiro') {
  const actor = { id: 1, alive: true, role: 'soldier', militaryClass: weapon, kingdomId: 1,
    x: 10, y: 10, health: 100, maxCombatHealth: 360, stamina: 400, maxStamina: 400,
    playerControlled: true, militaryTraining: 0 };
  const target = { ...actor, id: 2, kingdomId: 2, militaryClass: 'guerreiro', militaryFacingX: 1,
    x: weapon === 'arqueiro' ? 16 : weapon === 'lanceiro' ? 12.5 : 11.3 };
  const world = { day: 1, width: 32, height: 32, rngState: 42, nextId: 10,
    magicTimeMs: 0, people: [actor, target], structures: [], kingdoms: [], campaigns: [], events: [], logs: [],
    tiles: Array.from({ length: 32 * 32 }, (_, i) => ({ i, x: i % 32, y: Math.floor(i / 32),
      terrain: 'land', elevationLevel: 0, slope: 0, plants: new Float32Array(PLANTS.length) })) };
  return { world, actor, target };
}
const add = (target, id, intensity, durationMs = 10000) => applyMagicEffect(target, id,
  { now: 0, durationMs, intensity, sourceId: 1, spellId: id });

for (const weapon of ['guerreiro', 'lanceiro', 'arqueiro']) {
  test(`${weapon}: blessing and weakness modify actual confirmed weapon damage`, () => {
    const damage = effects => {
      const { world, actor, target } = fixture(weapon);
      for (const [id, intensity] of effects) add(actor, id, intensity);
      actor.playerCommand = { actionKey: '1', aimX: target.x, aimY: target.y, targetId: target.id, expiresDay: 2 };
      fightTacticalRound(world, [actor], [target], 1);
      assert.ok(actor.combatAction?.result.damageApplied > 0);
      return actor.combatAction.result.damageApplied;
    };
    const baseline = damage([]);
    assert.ok(Math.abs(damage([['blessed-weapons', .12]]) / baseline - 1.12) < 1e-8);
    assert.ok(Math.abs(damage([['weakness', .15]]) / baseline - .85) < 1e-8);
  });
}

test('haste/slow alter authoritative manual movement and still obey solid collisions', () => {
  const { world, actor } = fixture(); world.people = [actor];
  add(actor, 'haste', .15);
  applyManualMovement(world, actor, { moveX: 1, moveY: 0, dt: .1 });
  assert.ok(Math.abs(actor.x - 10.46) < 1e-8);
  add(actor, 'slow', .2);
  actor.x = 10;
  applyManualMovement(world, actor, { moveX: 1, moveY: 0, dt: .1 });
  assert.ok(Math.abs(actor.x - 10.368) < 1e-8);
  actor.x = 10.4;
  world.tiles[10 * 32 + 11].terrain = 'rock';
  applyManualMovement(world, actor, { moveX: 1, moveY: 0, dt: .1 });
  assert.ok(actor.x < 10.5, 'a speed buff cannot skip the solid tile boundary');
});

test('curse reduces both great heal and its regeneration; purify preserves permanent and non-magic states', () => {
  const { world, actor, target } = fixture();
  actor.militaryClass = 'monge'; actor.magicSpells = ['greater-heal', 'purify']; actor.mana = 200;
  target.kingdomId = 1; target.health = 50; target.militaryTraining = .8;
  add(target, 'curse', .4, 30000); add(target, 'fortitude', .2, 30000);
  beginSpell(world, actor, 'greater-heal', { targetId: target.id });
  advanceMagic(world, SPELLS['greater-heal'].castMs);
  assert.ok(Math.abs(target.health - 54.8) < 1e-8);
  advanceMagic(world, 1000);
  assert.ok(Math.abs(target.health - 56) < 1e-8);
  target.combatDisarmedUntilDay = 4;
  advanceMagic(world, 1500);
  beginSpell(world, actor, 'purify', { targetId: target.id });
  advanceMagic(world, SPELLS.purify.castMs);
  assert.ok(!target.magicEffects.some(effect => effect.id === 'curse'));
  assert.ok(target.magicEffects.some(effect => effect.id === 'fortitude'));
  assert.equal(target.militaryTraining, .8);
  assert.equal(target.combatDisarmedUntilDay, 4);
});

test('general can request magical protection while preserving an advance order', () => {
  const { world, actor, target } = fixture();
  actor.playerControlled = false; actor.militaryClass = 'monge'; actor.campaignId = 900;
  target.campaignId = 900;
  world.strategicAI = { enabled: true };
  world.kingdoms = [{ id: 1, name: 'A', x: 10, y: 10 }, { id: 2, name: 'B', x: 16, y: 10 }];
  const side = (id, role, person) => ({ campaignId: 900, kingdomId: id, role, troopIds: [person.id],
    supply: { stock: { food: 40, wood: 10, gold: 10 } }, morale: 90, supplyShortageDays: 0,
    stallDays: 0, orderVersion: 0, aiOrder: { action: 'advance' } });
  const campaign = { id: 900, attackerId: 1, defenderId: 2, status: 'marching', target: { x: 13, y: 10 },
    startedDay: 0, battleCount: 0, history: [], attacker: side(1, 'attacker', actor), defender: side(2, 'defender', target) };
  world.campaigns = [campaign];
  queueCampaignGeneralAiRequests(world, 1);
  const request = pullCampaignGeneralAiRequest(world);
  assert.ok(request.candidateActions.includes('magic_protection'));
  assert.ok(request.observedFacts.side.magicSupport.length > 0);
  assert.equal(applyCampaignGeneralAiDecision(world, request,
    { action: 'magic_protection', confidence: .9, reason: 'Proteger a formação sob ataque.' }), true);
  assert.equal(campaign.attacker.aiOrder.action, 'advance');
  assert.equal(campaign.attacker.magicOrders.policy, 'protection');
});
