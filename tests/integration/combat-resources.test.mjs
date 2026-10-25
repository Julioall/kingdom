import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../../src/simulation/engine.js';
import { castAreaHealing, fightTacticalRound } from '../../src/simulation/kingdoms/military.js';
import { updateCombatResources } from '../../src/simulation/kingdoms/combat-resources.js';
import { updateTowerShifts, defendTowers, performTowerDuty, towerDutyOrder } from '../../src/simulation/kingdoms/tower-archers.js';
import { campaignOrderFor } from '../../src/simulation/kingdoms/campaigns.js';
import { createActivityEffects } from '../../src/ui/person-animations.js';
import { getUnitAnimation } from '../../src/ui/animations.js';
import { militarySpritePose } from '../../src/ui/military-sprites.js';

const soldier = (id, values = {}) => ({ id, alive: true, role: 'soldier', kingdomId: 1,
  militaryClass: 'arqueiro', x: 5, y: 5, health: 100, energy: 100, hydration: 100,
  foodReserve: 100, stamina: 100, injury: 0, maxCombatHealth: 220, ...values });
function fixture() {
  const a = soldier(1), b = soldier(2, { x: 6 });
  const tower = { id: 10, type: 'torre', kingdomId: 1, x: 5, y: 5,
    entryTile: { x: 5, y: 6 }, complete: true, health: 6000, maxHealth: 6000 };
  return { people: [a, b], structures: [tower], kingdoms: [{ id: 1, palette: 'blue', x: 5, y: 5 }],
    day: 0, seed: 42, rng: 42, campaigns: [], width: 128,
    height: 128, animals: [], communities: [], rngState: 42,
    tiles: Array.from({ length: 128 * 128 }, (_, i) => ({ i, x: i % 128, y: Math.floor(i / 128),
      terrain: 'land', slope: 0, roadWear: 0, plants: Array(8).fill(0), heightM: 0 })) };
}

test('mana is spent once per area spell, exhausted clerics stop and regenerate', () => {
  const w = fixture(), cleric = w.people[0], patient = w.people[1];
  cleric.militaryClass = 'monge'; cleric.mana = 30; patient.health = 10;
  assert.deepEqual(castAreaHealing(w, cleric, w.people, 1), [patient.id]);
  assert.equal(cleric.mana, 0);
  assert.deepEqual(castAreaHealing(w, cleric, w.people, 10), []);
  for (let day = 2; day <= 31; day++) updateCombatResources(w, day);
  assert.equal(cleric.mana, 30);
  assert.ok(castAreaHealing(w, cleric, w.people, 32).length);
  assert.equal(cleric.mana, 0);
});

test('attacks require stamina and cannot be duplicated by campaign and sentry rounds', () => {
  const w = fixture(), archer = w.people[0], enemy = w.people[1];
  enemy.kingdomId = 2; enemy.x = 9; enemy.towerMounted = true;
  archer.stamina = 15;
  fightTacticalRound(w, [archer], [enemy], 1);
  assert.equal(enemy.health, 100); assert.equal(archer.lastArrowSequence, undefined);
  archer.stamina = 16;
  fightTacticalRound(w, [archer], [enemy], 2);
  assert.ok(enemy.health < 100); assert.equal(archer.stamina, 0);
  const health = enemy.health;
  archer.stamina = 100;
  fightTacticalRound(w, [archer], [enemy], 2);
  assert.equal(enemy.health, health); assert.equal(archer.stamina, 100);
  assert.equal(archer.lastArrowSequence, 1);
});

test('tower posts increase range, preserve initial peace and replace exhausted sentries with defensive reserves', () => {
  const w = fixture(), [a, b] = w.people, tower = w.structures[0];
  const enemy = soldier(3, { kingdomId: 2, x: 17, campaignId: 20, towerMounted: true });
  w.people.push(enemy);
  updateTowerShifts(w, 1);
  assert.equal(tower.archerId, a.id); assert.equal(a.towerMounted, false);
  performTowerDuty(w, a, towerDutyOrder(w, a));
  assert.deepEqual([a.x, a.y], [tower.entryTile.x, tower.entryTile.y]);
  performTowerDuty(w, a, towerDutyOrder(w, a));
  assert.equal(a.towerEntryReady, true); assert.equal(a.militaryFacingY, undefined);
  assert.equal(a.towerMounted, false, 'archer pauses at the entrance facing into the tower');
  performTowerDuty(w, a, towerDutyOrder(w, a));
  assert.equal(a.towerMounted, true);
  assert.deepEqual([a.x, a.y], [tower.entryTile.x, tower.entryTile.y],
    'mounting raises the archer without teleporting him from the entrance tile');
  assert.ok(campaignOrderFor(w, a).towerDuty);
  fightTacticalRound(w, [b], [enemy], 1);
  assert.equal(b.lastArrowSequence, undefined, 'ground range is only eight cells');
  defendTowers(w, 1);
  assert.equal(a.lastArrowSequence, undefined, 'no hostile campaign means no opening shots');
  w.campaigns = [{ id: 20, status: 'engaged', attacker: { kingdomId: 2 }, defender: { kingdomId: 1 }, target: tower }];
  defendTowers(w, 2);
  assert.equal(a.lastArrowSequence, 1); assert.equal(a.lastArrow.elevation, 3);
  a.stamina = 0; b.campaignId = 20;
  updateTowerShifts(w, 3);
  assert.equal(tower.archerId, b.id); assert.equal(a.towerMounted, false);
  assert.deepEqual([a.x, a.y], [tower.entryTile.x, tower.entryTile.y + 1]);
  assert.equal(a.towerRecovering, true); assert.equal(b.towerMounted, false);
  assert.equal(tower.archerShiftCount, 2);
  performTowerDuty(w, a, towerDutyOrder(w, a));
  performTowerDuty(w, b, towerDutyOrder(w, b));
  performTowerDuty(w, b, towerDutyOrder(w, b));
  performTowerDuty(w, b, towerDutyOrder(w, b));
  assert.equal(b.towerMounted, true);
  for (let day = 4; day <= 14; day++) updateCombatResources(w, day);
  updateTowerShifts(w, 15);
  assert.equal(a.towerRecovering, false);
  tower.destroyedDay = 16;
  updateTowerShifts(w, 16);
  assert.equal(b.towerDutyId, null); assert.equal(b.towerMounted, false);
});

test('legacy towers move water-blocked entries to the nearest walkable tile', () => {
  const w = fixture(), [archer] = w.people, tower = w.structures[0];
  const blocked = w.tiles[(tower.y + 1) * w.width + tower.x];
  blocked.terrain = 'water';
  tower.entryTile = { x: tower.x, y: tower.y + 1 };
  archer.x = tower.x; archer.y = tower.y + 2; archer.towerDutyId = tower.id;
  tower.archerId = archer.id;
  for (let step = 0; step < 3 && (archer.x !== tower.entryTile.x || archer.y !== tower.entryTile.y); step++)
    performTowerDuty(w, archer, towerDutyOrder(w, archer));
  const entry = w.tiles[tower.entryTile.y * w.width + tower.entryTile.x];
  assert.equal(entry.terrain, 'land');
  assert.notDeepEqual(tower.entryTile, { x: tower.x, y: tower.y + 1 });
  assert.deepEqual([archer.x, archer.y], [entry.x, entry.y]);
});

test('each archer shot produces a rotated projectile with its own lifetime and no replay on redraw', () => {
  const w = fixture(), a = w.people[0], effects = createActivityEffects();
  effects.observe(w, 0);
  a.lastArrowSequence = 1;
  a.lastArrow = { day: 1, x: 5, y: 5, targetX: 17, targetY: 5, elevation: 3, targetElevation: 0 };
  effects.observe(w, 100);
  const arrow = effects.active(101).find(e => e.projectile);
  assert.equal(arrow.animation, 'unit.blue.archer.arrow'); assert.equal(arrow.y, 2);
  assert.equal(arrow.targetX, 17); assert.ok(effects.active(500).includes(arrow));
  effects.observe(w, 501);
  assert.equal(effects.active(501).filter(e => e.projectile).length, 1);
  assert.equal(effects.active(1000).filter(e => e.projectile).length, 0);
});

test('archer identities resolve to archer idle, run and shooting sheets for every kingdom palette', () => {
  for (const palette of ['blue', 'red', 'purple', 'yellow', 'black']) {
    const archer = soldier(1);
    for (const [pose, action] of [[{ moving: false }, 'idle'], [{ moving: true, dirX: -1 }, 'run']]) {
      const sprite = militarySpritePose(archer, pose, 1);
      assert.equal(sprite.unit.folder, 'Archer'); assert.equal(sprite.action, action);
      assert.ok(getUnitAnimation('arqueiro', action, palette).frames > 1);
    }
    assert.equal(militarySpritePose(archer, { moving: true, dirX: 0, dirY: -1 }, 1).rotation, undefined);
    archer.militaryAnimation = 'attack'; archer.militaryAnimationDay = 2;
    assert.equal(militarySpritePose(archer, { moving: false }, 2).action, 'attack');
    assert.ok(getUnitAnimation('arqueiro', 'attack', palette).frames > 1);
  }
});

test('all initial military classes start with stamina and clerics also have mana', () => {
  const w = Sim.createWorld(42);
  for (const p of w.people.filter(p => p.role === 'soldier')) {
    assert.equal(p.stamina, 100);
    if (p.militaryClass === 'monge') assert.equal(p.mana, 100);
  }
});
