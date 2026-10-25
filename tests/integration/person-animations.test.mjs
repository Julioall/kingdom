import test from 'node:test';
import assert from 'node:assert/strict';
import { residentSpritePose, createActorAnimationClock, createActivityEffects } from '../../src/ui/person-animations.js';
import { getUnitAnimation } from '../../src/ui/animations.js';
import { militarySpritePose } from '../../src/ui/military-sprites.js';

const idle = { moving: false, dirX: 0, facingX: -1 };
const moving = { moving: true, dirX: -1 };
const person = (values = {}) => ({ id: 1, role: 'resident', alive: true, state: '', brain: { lastAction: 'rest' }, ...values });

test('residents use real cargo sprites while moving and standing, without duplicate overlays', () => {
  for (const [field, cargo] of [['carriedWood', 'wood'], ['carriedGold', 'gold'], ['carriedMeat', 'meat']]) {
    const carrier = person({ [field]: 4, state: 'levando recursos ao abrigo' });
    assert.equal(residentSpritePose(carrier, moving, 1).action, 'run-' + cargo);
    const standing = residentSpritePose(carrier, idle, 1);
    assert.equal(standing.action, 'idle-' + cargo);
    assert.equal(standing.cargoInSprite, cargo);
    assert.equal(standing.flip, true);
  }
});

test('actual work selects pickaxe, axe, hammer and knife; approaching a job only equips its tool', () => {
  for (const [state, action, tool] of [['extraindo ouro', 'gather', 'pickaxe'], ['extraindo pedra', 'gather', 'pickaxe'],
    ['minerando rocha', 'gather', 'pickaxe'],
    ['derrubando árvore', 'gather', 'axe'], ['construindo abrigo', 'build', 'hammer'], ['pescando', 'hunt', 'knife']]) {
    const worker = person({ state, brain: { lastAction: action } });
    assert.equal(residentSpritePose(worker, idle, 1).action, 'interact-' + tool);
    assert.equal(residentSpritePose(worker, moving, 1).action, 'run-' + tool);
  }
  assert.equal(residentSpritePose(person({ state: 'indo para a construção', brain: { lastAction: 'build' } }), idle, 1).action, 'idle-hammer');
  const miner = person({ carriedGold: 2, visualActivity: { kind: 'mine', day: 3 } });
  assert.equal(residentSpritePose(miner, idle, 3).action, 'interact-pickaxe');
  assert.equal(residentSpritePose(miner, moving, 3).action, 'run-gold');
  assert.equal(residentSpritePose(miner, idle, 4).action, 'idle-gold');
});

test('every selected resident action resolves to an existing catalog animation', () => {
  for (const state of ['extraindo ouro', 'extraindo pedra', 'construindo casa', 'derrubando árvore', 'pescando', 'descansando']) {
    for (const action of ['rest', 'gather', 'build', 'hunt']) {
      for (const pose of [idle, moving]) {
        const sprite = residentSpritePose(person({ state, brain: { lastAction: action } }), pose, 1);
        assert.ok(getUnitAnimation('pawn', sprite.action));
      }
    }
  }
});

test('actor clocks restart on action or event changes and do not restart on redraws', () => {
  const clock = createActorAnimationClock();
  assert.equal(clock.elapsed(1, 'attack:3', 100), 0);
  assert.equal(clock.elapsed(1, 'attack:3', 300), 200);
  assert.equal(clock.elapsed(1, 'attack:4', 400), 0);
  clock.retain(new Set());
  assert.equal(clock.elapsed(1, 'attack:4', 500), 0);
  clock.clear();
  assert.equal(clock.elapsed(1, 'attack:4', 600), 0);
});

test('snapshot effects occur once at the true worksite, expire, and clear on reset', () => {
  const effects = createActivityEffects();
  const resident = person({ x: 1, y: 1 });
  const world = { day: 0, width: 4, people: [resident], tiles: Array.from({ length: 16 }, () => ({ terrain: 'land' })) };
  effects.observe(world, 0, true);
  resident.visualActivity = { day: 1, kind: 'mine', x: 3, y: 1 };
  world.day = 1;
  effects.observe(world, 100);
  effects.observe(world, 100);
  const active = effects.active(200);
  assert.equal(active.length, 1);
  assert.equal(active[0].animation, 'effect.dust-02');
  assert.equal(active[0].x, 3);
  resident.visualActivity = { day: 2, kind: 'drink', x: 2, y: 1 };
  world.day = 2;
  effects.observe(world, 300);
  assert.equal(effects.active(300).filter(effect => effect.animation === 'effect.water-splash').length, 1);
  assert.equal(effects.active(5000).length, 0);
  effects.observe(world, 5100, true);
  assert.equal(effects.active(5100).length, 0);
});

test('movement makes dust only after a real land step and battle animation takes priority', () => {
  const effects = createActivityEffects();
  const soldier = person({ x: 0, y: 0, role: 'soldier', militaryClass: 'guerreiro' });
  const world = { day: 0, width: 3, people: [soldier], tiles: Array.from({ length: 9 }, () => ({ terrain: 'land' })) };
  effects.observe(world, 0, true);
  soldier.x = 1;
  effects.observe(world, 100);
  assert.equal(effects.active(100).length, 1);
  world.tiles[2].terrain = 'water'; soldier.x = 2;
  effects.observe(world, 200);
  assert.equal(effects.active(200).length, 1);
  soldier.militaryAnimation = 'attack'; soldier.militaryAnimationDay = 1;
  assert.equal(militarySpritePose(soldier, moving, 1).action, 'attack-2');
  assert.equal(militarySpritePose(soldier, moving, 2).action, 'run');
});
