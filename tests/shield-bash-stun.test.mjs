import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchCommand } from '../src/simulation/commands.js';
import { isCombatDisarmed } from '../src/simulation/kingdoms/combat-resources.js';
import { createActivityEffects } from '../src/ui/person-animations.js';

function fixture() {
  const actor = { id: 1, x: 30, y: 30, alive: true, role: 'soldier', militaryClass: 'guerreiro',
    kingdomId: 1, health: 100, stamina: 200, maxStamina: 200 };
  const victim = { id: 2, x: 32, y: 30, alive: true, role: 'soldier', militaryClass: 'arqueiro',
    kingdomId: 2, health: 100, stamina: 200, maxStamina: 200, combatCombo: { targetId: 1, count: 2 },
    combatOpening: { targetId: 1, expiresDay: 4 } };
  const tiles = Array.from({ length: 128 * 128 }, (_, i) => ({ i, x: i % 128, y: Math.floor(i / 128),
    terrain: 'land', elevationLevel: 0, slope: 0, plants: [] }));
  const world = { day: 1, width: 128, height: 128, nextId: 100, combatEvents: [], kingdoms: [],
    people: [actor, victim], structures: [], tiles };
  dispatchCommand(world, { type: 'player-control', personId: actor.id, enabled: true });
  // Prevent the ordinary AI dodge during this deterministic contact test.
  victim.playerControlled = true;
  return { world, actor, victim };
}

test('warrior shield dash pushes and parry-stuns without damage', () => {
  const { world, actor, victim } = fixture();
  dispatchCommand(world, { type: 'player-action', personId: actor.id, actionKey: '3', aimX: 32, aimY: 30 });

  assert.equal(actor.combatAction.attackVariant, 'shield-bash');
  assert.equal(actor.combatAction.hitEvents[0].targetId, victim.id);
  assert.equal(actor.combatAction.hitEvents[0].kind, 'body');
  assert.equal(victim.health, 100);
  assert.equal(victim.combatDisarmedUntilDay, world.day + 2);
  assert.equal(victim.combatDisarmedById, actor.id);
  assert.equal(victim.state, 'atordoado por pancada de escudo');
  assert.equal(victim.combatCombo, null);
  assert.equal(victim.combatOpening, null);
  assert.equal(isCombatDisarmed(victim, world.day + 1), true);
  assert.equal(isCombatDisarmed(victim, world.day + 2), false);

  const effects = createActivityEffects();
  effects.observe(world, 500);
  const stars = effects.active(500 + actor.combatAction.hitEvents[0].atMs + 600)
    .find(effect => effect.animation === 'parry-stars' && effect.personId === victim.id);
  assert.equal(stars?.duration, 3000);
});
