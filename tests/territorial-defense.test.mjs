import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../src/simulation/engine.js';
import { fightTacticalRound, respondToLocalThreats } from '../src/simulation/kingdoms/military.js';
import { createCombatAction, resolveCombatAction } from '../src/simulation/kingdoms/combat-contact.js';
import { markTerritoryStep } from '../src/simulation/kingdoms/territories.js';
import { createPersonSpatialIndex } from '../src/simulation/individuals/spatial-index.js';
import { cellAt } from '../src/simulation/world/spatial.js';
import { distance } from '../src/simulation/core/math.js';
import { invalidateNavigation } from '../src/simulation/individuals/navigation-cache.js';

function defenseFixture({ enemyRole = 'soldier', guardClass = 'lanceiro', distance: separation = 1.2,
  evidenceOfAggression = false } = {}) {
  const world = Sim.createWorld(42);
  const home = world.kingdoms[0], enemyKingdom = world.kingdoms[1];
  const guard = world.people.find(person => person.alive && person.role === 'soldier'
    && person.kingdomId === home.id && person.militaryClass === guardClass);
  const intruder = world.people.find(person => person.alive && person.role === enemyRole
    && person.kingdomId === enemyKingdom.id);
  assert.ok(guard && intruder, 'seed 42 contains the required defender and intruder');
  const site = world.tiles.find(tile => tile.terrain === 'land'
    && tile.x > 5 && tile.y > 5 && tile.x < world.width - 10 && tile.y < world.height - 5
    && world.structures.every(structure => distance(tile, structure) > 12));
  assert.ok(site, 'the fixture has a safe test area away from structures');
  for (let y = site.y - 1; y <= site.y + 2; y++) for (let x = site.x - 1; x <= site.x + 8; x++) {
    const tile = cellAt(world, x, y);
    if (!tile) continue;
    tile.terrain = 'land'; tile.kingdomId = home.id; tile.slope = 0;
    tile.elevationLevel = 0; tile.stoneDeposit = 0; tile.goldOre = 0;
    tile.silverOre = 0; tile.copperOre = 0; tile.ironOre = 0;
    tile.plants?.fill(0);
  }
  invalidateNavigation(world);
  const day = 115;
  Object.assign(guard, { x: site.x + 1, y: site.y, health: 100, stamina: 100,
    energy: 100, hydration: 100, foodReserve: 100, injury: 0, restingStructureId: null,
    militaryRestTargetId: null, towerMounted: false, lastMilitaryAttackDay: -Infinity });
  Object.assign(intruder, { x: site.x + 1 + separation, y: site.y, health: 100,
    stamina: 100, restingStructureId: null, militaryRestTargetId: null, towerMounted: false });
  const people = [guard, intruder];
  if (evidenceOfAggression) {
    const witness = world.people.find(person => person.alive && person.role !== 'soldier'
      && person.kingdomId === home.id && person.id !== intruder.id);
    assert.ok(witness, 'seed 42 contains a civilian witness');
    Object.assign(witness, { x: site.x + 2, y: site.y, lastAttackedById: intruder.id,
      lastAttackedDay: day, health: 100, restingStructureId: null });
    people.push(witness);
  }
  world.people = people;
  world.peopleSpatialIndex = createPersonSpatialIndex(people);
  world.campaigns = [];
  world.day = day;
  // Combat randomness must not depend on how much terrain generation consumed.
  world.rngState = 42;
  return { world, home, enemyKingdom, guard, intruder, site, day };
}

test('a peaceful civilian from another kingdom is not a tactical target', () => {
  const { world, guard, intruder } = defenseFixture({ enemyRole: 'resident' });
  const before = intruder.health;

  fightTacticalRound(world, [guard], [intruder], world.day);

  assert.equal(intruder.health, before);
  assert.equal(intruder.lastAttackedById, undefined);
});

test('projectile contact rejects a peaceful civilian even if a caller passes it as a candidate', () => {
  const { world, guard, intruder } = defenseFixture({ enemyRole: 'resident' });
  guard.militaryClass = 'arqueiro';
  intruder.x = guard.x + 5;
  world.peopleSpatialIndex = createPersonSpatialIndex(world.people);
  const action = createCombatAction(world, guard, intruder, world.day);
  const before = intruder.health;

  const result = resolveCombatAction(world, guard, action, [intruder], () => {
    assert.fail('an ineligible civilian must never receive damage');
  });

  assert.equal(result.kind, 'miss');
  assert.equal(intruder.health, before);
  assert.deepEqual(action.hitTargets, []);
});

test('nearby soldiers intercept an invader on home territory without an active campaign', () => {
  const { world, guard, intruder } = defenseFixture();
  // This checks interception/contact, independently of a randomly seeded dodge.
  Object.assign(intruder, { playerControlled: true, militaryFacingX: 1, militaryFacingY: 0 });
  const before = intruder.health;

  const responses = respondToLocalThreats(world, world.day);


  assert.deepEqual(responses.map(item => [item.soldierId, item.targetId, item.action]),
    [[guard.id, intruder.id, 'engage']]);
  assert.ok(intruder.health < before);
  assert.equal(world.campaigns.length, 0);
});

test('a defender advances on a nearby incursion but stops responding after the invader leaves home territory', () => {
  const { world, guard, intruder, enemyKingdom, day } = defenseFixture({ guardClass: 'guerreiro', distance: 5 });
  const before = { x: guard.x, y: guard.y };

  const first = respondToLocalThreats(world, day);

  assert.equal(first[0]?.action, 'intercept');
  assert.ok(distance(guard, before) > 0, 'the guard moves toward the local threat');
  assert.equal(cellAt(world, guard.x, guard.y).kingdomId, guard.kingdomId);

  cellAt(world, intruder.x, intruder.y).kingdomId = enemyKingdom.id;
  const afterLeaving = { x: guard.x, y: guard.y };
  assert.deepEqual(respondToLocalThreats(world, day + 1), []);
  assert.deepEqual({ x: guard.x, y: guard.y }, afterLeaving);
});

test('a civilian who directly attacked a resident can be intercepted and learns from damage', () => {
  const { world, home, guard, intruder, day } = defenseFixture({ enemyRole: 'resident', evidenceOfAggression: true });

  const responses = respondToLocalThreats(world, day);

  assert.equal(responses[0]?.targetId, intruder.id);
  assert.ok(intruder.health < 100);
  assert.equal(intruder.lastHostileEncounter.sourcePersonId, guard.id);
  assert.equal(intruder.lastHostileEncounter.territoryId, home.id);
  assert.equal(intruder.territoryAwareness.caught, true);
  assert.ok(intruder.territoryWarnings[home.id] >= day);
});

test('territorial warning and caught memory survive return to safe ground', () => {
  const { world, enemyKingdom, intruder, site, day } = defenseFixture({ enemyRole: 'resident' });
  const foreignTile = cellAt(world, site.x + 2, site.y);
  const safeTile = cellAt(world, site.x + 3, site.y + 1);
  foreignTile.kingdomId = world.kingdoms[0].id;
  safeTile.kingdomId = enemyKingdom.id;

  markTerritoryStep(world, intruder, foreignTile);
  assert.equal(intruder.territoryAwareness.warning, true);
  assert.match(intruder.lastLesson, /território/);
  intruder.territoryWarnings[world.kingdoms[0].id] = day + 180;

  markTerritoryStep(world, intruder, safeTile);
  assert.equal(intruder.territoryAwareness.caught, true);
  assert.equal(intruder.territoryAwareness.threatOwnerId, world.kingdoms[0].id);
});


test('an active campaign does not authorize arrows against a peaceful enemy civilian', () => {
  const { world, home, enemyKingdom, guard, intruder, day, site } =
    defenseFixture({ enemyRole: 'resident', guardClass: 'arqueiro', distance: 5 });
  guard.campaignId = 700;
  guard.combatAction = null;
  world.campaigns = [{
    id: 700, attackerId: home.id, defenderId: enemyKingdom.id,
    status: 'engaged', target: { x: site.x, y: site.y }
  }];
  const healthBefore = intruder.health;

  fightTacticalRound(world, [guard], [intruder], day);

  assert.equal(intruder.health, healthBefore);
  assert.equal(intruder.lastAttackedById, undefined);
  assert.equal(guard.combatAction, null,
    'campaign participation does not override hostility eligibility');

  const action = createCombatAction(world, guard, intruder, day);
  const result = resolveCombatAction(world, guard, action, [intruder], () => {
    assert.fail('a peaceful civilian cannot receive damage through direct projectile resolution');
  });
  assert.equal(result.kind, 'miss');
  assert.deepEqual(action.hitTargets, []);
});

test('civilian aggression authorizes only the aggressor, not a nearby peaceful bystander', () => {
  const { world, guard, intruder, day } =
    defenseFixture({ enemyRole: 'resident', guardClass: 'arqueiro', distance: 5, evidenceOfAggression: true });
  const peaceful = { ...intruder, id: world.nextId++, name: 'Morador pacífico',
    x: guard.x + 2, y: guard.y, health: 100, lastAttackedById: null, lastAttackedDay: null };
  world.people.push(peaceful);
  world.peopleSpatialIndex = createPersonSpatialIndex(world.people);
  guard.combatAction = null;

  fightTacticalRound(world, [guard], [peaceful, intruder], day);

  assert.equal(guard.combatAction?.targetId, intruder.id,
    'the recorded attacker, rather than the closer bystander, is the eligible target');
  assert.equal(peaceful.health, 100);
  assert.equal(peaceful.lastAttackedById, null);
});
