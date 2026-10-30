import test from 'node:test';
import assert from 'node:assert/strict';
import { SPELLS } from '../src/simulation/magic/catalog.js';
import { applyMagicEffect, magicModifiers } from '../src/simulation/magic/effects.js';
import { advanceMagic, beginSpell, chooseMagicAction, configureMagicLoadout } from '../src/simulation/magic/system.js';
import { changePersonHealth } from '../src/simulation/individuals/lifecycle.js';
import { spendAttackStamina, spendDefenseStamina, updateCombatResources } from '../src/simulation/kingdoms/combat-resources.js';

function fixture() {
  const person = (id, kingdomId, x, health = 100) => ({ id, kingdomId, x, y: 10, alive: true,
    role: 'soldier', militaryClass: 'guerreiro', health, stamina: 400, maxStamina: 400, maxCombatHealth: 360 });
  const caster = { ...person(1, 1, 10), militaryClass: 'monge', militaryLevel: 7, mana: 200, maxMana: 200 };
  const ally = person(2, 1, 12, 45), enemy = person(3, 2, 13, 65);
  const world = { day: 0, width: 32, height: 32, people: [caster, ally, enemy], kingdoms: [], structures: [],
    magicTimeMs: 0, events: [], logs: [],
    tiles: Array.from({ length: 32 * 32 }, (_, i) => ({ i, x: i % 32, y: Math.floor(i / 32), terrain: 'land', kingdomId: null })) };
  return { world, caster, ally, enemy };
}
const effect = (target, id, intensity, durationMs = 10000) => applyMagicEffect(target, id,
  { now: 0, durationMs, intensity, sourceId: 1, spellId: id });

for (const spell of Object.values(SPELLS)) {
  test(`${spell.name}: valid cast spends mana once and activates actual gameplay`, () => {
    const { world, caster, ally, enemy } = fixture();
    caster.magicSpells = [spell.id];
    const target = ['debuff', 'dispel'].includes(spell.kind) ? enemy : ally;
    if (spell.kind === 'cleanse') effect(ally, 'poison', .01);
    if (spell.kind === 'dispel') effect(enemy, 'fortitude', .2);
    const before = target.health;
    assert.equal(beginSpell(world, caster, spell.id, { targetId: target.id }).ok, true);
    assert.equal(caster.militaryAnimation, 'heal', 'the priest animates during preparation');
    assert.equal(caster.mana, 200 - spell.mana);
    assert.equal(target.health, before, 'a pending cast must not heal or damage');
    advanceMagic(world, spell.castMs);
    assert.equal(caster.magicCast, null);
    assert.equal(caster.militaryAnimation, 'idle', 'the cast animation ends with activation');
    assert.equal(caster.mana, 200 - spell.mana);
    assert.equal(world.magicEvents.at(-1).kind, 'activated');
    if (spell.heal) assert.ok(target.health > before && target.health <= 100);
    if (spell.effect) assert.ok(target.magicEffects.some(effect => effect.id === spell.effect));
    if (spell.kind === 'cleanse') assert.equal(ally.magicEffects.length, 0);
    if (spell.kind === 'dispel') assert.equal(enemy.magicEffects.length, 0);
    if (spell.kind === 'area') assert.equal(world.magicZones.length, 1);
  });
}

test('buff/debuff modifiers change real damage, stamina and healing without changing bases or stacking', () => {
  const { world, ally } = fixture();
  effect(ally, 'fortitude', .2); effect(ally, 'fortitude', .2);
  assert.equal(ally.magicEffects.length, 1);
  assert.equal(spendAttackStamina(ally, 10), true);
  assert.equal(ally.stamina, 400 - 14 * .8);
  const before = ally.stamina;
  spendDefenseStamina(ally);
  assert.ok(Math.abs(ally.stamina - (before - 6 * .8)) < 1e-9);
  effect(ally, 'exhaustion', .2);
  assert.ok(Math.abs(magicModifiers(ally, world).stamina - .96) < 1e-9);
  effect(ally, 'haste', .15); effect(ally, 'slow', .2);
  assert.ok(Math.abs(magicModifiers(ally, world).speed - .92) < 1e-9);
  effect(ally, 'blessed-weapons', .12); effect(ally, 'weakness', .15);
  assert.ok(Math.abs(magicModifiers(ally, world).damage - .952) < 1e-9);
  effect(ally, 'protection', .15);
  assert.ok(Math.abs(changePersonHealth(world, ally, -10, 'battle') + 8.5) < 1e-9);
  effect(ally, 'curse', .4);
  assert.equal(changePersonHealth(world, ally, 10, 'cleric-healing'), 6);
  assert.equal(ally.maxCombatHealth, 360);
  advanceMagic(world, 10000);
  assert.equal(ally.magicEffects.length, 0);
  assert.deepEqual(magicModifiers(ally, world), { stamina: 1, speed: 1, damage: 1, incoming: 1, healing: 1 });
});

test('great heal caps recipients, regenerates for six seconds, and never overheals', () => {
  const { world, caster } = fixture();
  world.people = [caster, ...Array.from({ length: 12 }, (_, index) => ({ id: index + 2,
    kingdomId: 1, alive: true, x: 12, y: 10, health: 50, maxCombatHealth: 300 }))];
  caster.magicSpells = ['greater-heal'];
  beginSpell(world, caster, 'greater-heal', { x: 12, y: 10 });
  advanceMagic(world, SPELLS['greater-heal'].castMs);
  assert.equal(world.people.filter(person => person.health === 58).length, 7);
  advanceMagic(world, 6000);
  assert.equal(world.people.filter(person => person.health === 70).length, 7);
  assert.equal(world.people.filter(person => person.magicEffects?.length).length, 0);
  world.people[1].health = 99;
  assert.equal(changePersonHealth(world, world.people[1], 30, 'cleric-healing'), 1);
});

test('poison refresh preserves cadence, stays bounded and purification only removes magical debuffs', () => {
  const { world, ally } = fixture();
  effect(ally, 'poison', .008, 6000);
  advanceMagic(world, 500);
  applyMagicEffect(ally, 'poison', { now: 500, durationMs: 6000, intensity: .008, sourceId: 2, spellId: 'poison' });
  advanceMagic(world, 500);
  assert.ok(Math.abs(ally.health - 44.2) < 1e-9);
  assert.equal(ally.magicEffects.length, 1);
});

for (const interruption of ['death', 'stun', 'displacement']) {
  test(`cast interrupted by ${interruption} applies nothing`, () => {
    const { world, caster, ally } = fixture();
    caster.magicSpells = ['greater-heal'];
    beginSpell(world, caster, 'greater-heal', { targetId: ally.id });
    if (interruption === 'death') caster.alive = false;
    if (interruption === 'stun') caster.combatDisarmedUntilDay = 3;
    if (interruption === 'displacement') caster.x += 2;
    advanceMagic(world, 2500);
    assert.equal(ally.health, 45);
    assert.equal(caster.magicCast, null);
    assert.equal(world.magicStats.cancelled, 1);
    assert.equal(world.magicStats.effectsApplied, 0);
  });
}

test('allegiance, availability, range and mana are enforced before casting', () => {
  const { world, caster, ally, enemy } = fixture();
  caster.magicSpells = ['heal'];
  assert.equal(beginSpell(world, caster, 'heal', { targetId: enemy.id }).reason, 'invalid-target');
  ally.x = 30;
  assert.equal(beginSpell(world, caster, 'heal', { targetId: ally.id }).reason, 'out-of-range');
  assert.equal(beginSpell(world, caster, 'poison', { targetId: enemy.id }).reason, 'spell-unavailable');
  assert.equal(configureMagicLoadout(caster, ['heal', 'heal']), false);
  assert.equal(configureMagicLoadout(caster, ['heal', 'poison']), true);
  caster.mana = 0;
  assert.equal(beginSpell(world, caster, 'poison', { targetId: enemy.id }).reason, 'not-enough-mana');
});

test('sanctuary protection depends on current position and expires', () => {
  const { world, caster, ally } = fixture();
  caster.magicSpells = ['sanctuary'];
  beginSpell(world, caster, 'sanctuary', { x: 12, y: 10 });
  advanceMagic(world, SPELLS.sanctuary.castMs);
  assert.equal(magicModifiers(ally, world).incoming, .9);
  ally.x = 17;
  assert.equal(magicModifiers(ally, world).incoming, 1);
  ally.x = 12;
  advanceMagic(world, 8000);
  assert.equal(magicModifiers(ally, world).incoming, 1);
  assert.equal(world.magicZones.length, 0);
});

test('area casts lock the ground location and affect occupants there rather than following the original target', () => {
  const { world, caster, ally } = fixture();
  caster.magicSpells = ['area-heal'];
  const occupant = { ...ally, id: 4, health: 40 };
  world.people.push(occupant);
  assert.equal(beginSpell(world, caster, 'area-heal', { targetId: ally.id }).ok, true);
  assert.equal(caster.magicCast.targetId, null);
  const x = caster.magicCast.x, y = caster.magicCast.y;
  ally.x = 25; ally.alive = false;
  advanceMagic(world, SPELLS['area-heal'].castMs);
  assert.equal(occupant.health, 46);
  assert.equal(ally.health, 45);
  const activation = world.magicEvents.at(-1);
  assert.equal(activation.kind, 'activated');
  assert.equal(activation.x, x);
  assert.equal(activation.y, y);
});

test('spell preparation and shared recovery prevent alternating spell spam', () => {
  const { world, caster, ally } = fixture();
  caster.magicSpells = ['heal', 'protection'];
  assert.ok(SPELLS.heal.castMs >= 1200);
  beginSpell(world, caster, 'heal', { targetId: ally.id });
  advanceMagic(world, SPELLS.heal.castMs - 100);
  assert.equal(ally.health, 45);
  advanceMagic(world, 100);
  assert.ok(ally.health > 45);
  assert.equal(beginSpell(world, caster, 'protection', { targetId: ally.id }).reason, 'spell-cooldown');
  advanceMagic(world, 1500);
  assert.equal(beginSpell(world, caster, 'protection', { targetId: ally.id }).ok, true);
});

test('spells have distinct longer preparations and mana recovers only between casts', () => {
  const spells = Object.values(SPELLS);
  assert.equal(new Set(spells.map(spell => spell.castMs)).size, spells.length);
  assert.ok(spells.every(spell => spell.castMs >= 2000 && spell.mana > 0 && spell.mana <= 200));
  assert.ok(SPELLS['greater-heal'].castMs > SPELLS['area-heal'].castMs);
  assert.ok(SPELLS['greater-heal'].mana > SPELLS['area-heal'].mana);
  const { world, caster, ally } = fixture();
  caster.magicSpells = ['heal'];
  beginSpell(world, caster, 'heal', { targetId: ally.id });
  const spent = caster.mana;
  updateCombatResources(world, 1);
  assert.equal(caster.mana, spent, 'preparation cannot refill its own mana cost');
  advanceMagic(world, SPELLS.heal.castMs - 1);
  assert.equal(ally.health, 45);
  advanceMagic(world, 1);
  updateCombatResources(world, 2);
  assert.equal(caster.mana, spent + 10, 'normal recovery resumes after activation');
});

test('hostile magic preserves civilian eligibility and loadout changes cancel pending effects', () => {
  const { world, caster, ally, enemy } = fixture();
  caster.magicSpells = ['poison', 'greater-heal'];
  enemy.role = 'worker';
  enemy.militaryClass = null;
  assert.equal(beginSpell(world, caster, 'poison', { targetId: enemy.id }).reason, 'invalid-target');
  assert.equal(beginSpell(world, caster, 'greater-heal', { targetId: ally.id }).ok, true);
  assert.equal(configureMagicLoadout(caster, ['heal']), true);
  advanceMagic(world, 2500);
  assert.equal(ally.health, 45);
  assert.equal(caster.magicCast, null);
  assert.equal(world.magicStats.cancelled, 1);
});

test('AI reacts to wounds and hostile buffs; commanders can hold magic without changing maneuvers', () => {
  const { world, caster, ally, enemy } = fixture();
  caster.magicSpells = ['heal', 'dispel'];
  ally.health = 10;
  assert.equal(chooseMagicAction(world, caster).spellId, 'heal');
  ally.health = 100;
  effect(enemy, 'protection', .15);
  assert.equal(chooseMagicAction(world, caster).spellId, 'dispel');
  caster.magicOrders = { holdFire: true };
  assert.equal(chooseMagicAction(world, caster), null);
});
