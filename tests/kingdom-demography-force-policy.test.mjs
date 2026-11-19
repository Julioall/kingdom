import { HUMAN_ADULT_AGE_DAYS, HUMAN_ADOLESCENT_AGE_DAYS, HUMAN_MAX_AGE_DAYS } from '../src/simulation/individuals/human-age.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import engine from '../src/simulation/engine.js';
import { reproducePeople } from '../src/simulation/individuals/lifecycle.js';
import { getSocialLink } from '../src/simulation/society/communities.js';
import { planKingdomForceBalance, updateKingdomForceBalance } from '../src/simulation/kingdoms/population-policy.js';
import { dischargeSoldier } from '../src/simulation/kingdoms/service.js';
import { observeKingdomStrategy } from '../src/simulation/kingdoms/strategy.js';
import { npcControlState, NPC_CONTROL } from '../src/simulation/individuals/action-state-machine.js';

function readyCouples(world, countPerKingdom) {
  world.day = 29;
  for (const person of world.people) person.birthCooldown = 1000;
  for (const kingdom of world.kingdoms) {
    const members = world.people.filter(p => p.alive && p.kingdomId === kingdom.id && p.role === 'resident');
    const men = members.filter(p => p.sex === 'M').slice(0, countPerKingdom);
    const women = members.filter(p => p.sex === 'F').slice(0, countPerKingdom);
    assert.equal(men.length, countPerKingdom);
    assert.equal(women.length, countPerKingdom);
    const home = world.structures.find(s => s.id === kingdom.homeIds[0]);
    assert.ok(home);
    home.capacity = (home.residentIds || []).length + 2 * countPerKingdom + 2;
    for (let i = 0; i < countPerKingdom; i++) {
      const p = men[i], q = women[i];
      for (const person of [p, q]) {
        Object.assign(person, { ageDays: HUMAN_ADULT_AGE_DAYS + 60, energy: 95, hydration: 95,
          health: 100, foodReserve: 90, birthCooldown: 0 });
      }
      p.x = kingdom.x + i * 2; p.y = kingdom.y + 2;
      q.x = p.x + 1; q.y = p.y;
      getSocialLink(world, p, q).trust = .9;
    }
  }
}

test('births are no longer globally limited to one couple across both kingdoms', () => {
  const world = engine.createWorld(42);
  readyCouples(world, 1);
  reproducePeople(world);
  assert.equal(world.births, 2);
  assert.deepEqual(world.kingdoms.map(kingdom => world.people.filter(p => p.birthKingdomId === kingdom.id
    && p.ageDays === 0).length), [1, 1]);
  reproducePeople(world);
  assert.equal(world.births, 2, 'parents cannot reproduce again on the same day');
});

test('500-person military world can host several paid, housed births per kingdom', () => {
  const world = engine.createWorld(42, { initialPopulation: 500, initialMilitaryShare: .8 });
  readyCouples(world, 2);
  const previousTreasuries = world.kingdoms.map(k => structuredClone(k.treasury.stock));
  reproducePeople(world);
  assert.equal(world.births, 4);
  for (let i = 0; i < 2; i++) {
    const kingdom = world.kingdoms[i];
    const children = world.people.filter(p => p.ageDays === 0 && p.birthKingdomId === kingdom.id);
    assert.equal(children.length, 2);
    assert.ok(children.every(p => p.homeId != null && p.foodReserve === 12));
    assert.deepEqual(kingdom.treasury.stock, previousTreasuries[i], 'births do not mint or debit treasury food');
  }
});

test('adolescents grow into normal citizens; old residents die from age and release housing', () => {
  const world = engine.createWorld(42);
  const people = world.people.filter(p => p.alive && p.role === 'resident');
  const child = people[0], adolescent = people[1], elder = people[2];
  Object.assign(child, { ageDays: HUMAN_ADULT_AGE_DAYS - 1, health: 100, hydration: 100, foodReserve: 80, energy: 100 });
  Object.assign(adolescent, { ageDays: HUMAN_ADOLESCENT_AGE_DAYS - 1, health: 100, hydration: 100, foodReserve: 80, energy: 100 });
  Object.assign(elder, { ageDays: HUMAN_MAX_AGE_DAYS - 1, health: 100, hydration: 100, foodReserve: 80, energy: 100 });
  const occupiedHome = world.structures.find(s => s.id === elder.homeId);
  engine.stepDay(world, { includeSnapshot: false });
  assert.equal(child.ageDays, HUMAN_ADULT_AGE_DAYS);
  assert.equal(npcControlState(child), NPC_CONTROL.AUTONOMOUS);
  assert.equal(adolescent.ageDays, HUMAN_ADOLESCENT_AGE_DAYS);
  assert.equal(elder.alive, false);
  assert.equal(elder.deathCause, 'age');
  if (occupiedHome) assert.ok(!occupiedHome.residentIds.includes(elder.id));
});

function report({ adults = 100, soldiers = 70, civilianAdults = 30, foodDays = 120, war = false, recruited = false } = {}) {
  return {
    community: { foodBufferDays: foodDays },
    military: { adultPopulation: adults, soldiers, civilianAdults, recruitment: { available: recruited },
      activeCampaign: war ? { id: 1 } : null, pendingForceRequests: [], recentTerritoryLosses: [] }
  };
}

test('royal policy demobilizes in peace, protects campaigns and recruits only with civilian surplus', () => {
  assert.equal(planKingdomForceBalance(report()).action, 'demobilize');
  assert.equal(planKingdomForceBalance(report({ war: true })).action, 'hold');
  assert.equal(planKingdomForceBalance(report({ soldiers: 8, civilianAdults: 92, recruited: true })).action, 'recruit');
  assert.equal(planKingdomForceBalance(report({ soldiers: 8, civilianAdults: 92, recruited: true, foodDays: 2 })).action, 'hold');
});

test('king demobilizes living off-duty soldiers without losing citizens or funds', () => {
  const world = engine.createWorld(42, { initialPopulation: 500, initialMilitaryShare: .8 });
  const kingdom = world.kingdoms[0];
  world.day = 29;
  const beforeSoldiers = world.people.filter(p => p.alive && p.kingdomId === kingdom.id && p.role === 'soldier').length;
  const beforePop = world.people.filter(p => p.alive && p.kingdomId === kingdom.id).length;
  const funds = structuredClone(kingdom.treasury.stock);
  const policy = updateKingdomForceBalance(world, kingdom, observeKingdomStrategy(world, kingdom.id));
  assert.equal(policy?.action, 'demobilize');
  assert.ok(policy.changed > 0 && policy.changed <= 12);
  assert.equal(world.people.filter(p => p.alive && p.kingdomId === kingdom.id && p.role === 'soldier').length,
    beforeSoldiers - policy.changed);
  assert.equal(world.people.filter(p => p.alive && p.kingdomId === kingdom.id).length, beforePop);
  assert.deepEqual(kingdom.treasury.stock, funds);
  assert.equal(updateKingdomForceBalance(world, kingdom, observeKingdomStrategy(world, kingdom.id)), null,
    'do not make a second force decision on the same day');
  const soldiers = new Set(world.people.filter(p => p.alive && p.role === 'soldier' && p.kingdomId === kingdom.id).map(p => p.id));
  assert.ok(kingdom.militaryCommand.units.every(u => u.memberIds.every(id => soldiers.has(id))));
  for (const centerId of kingdom.militaryCenterIds) {
    const center = world.structures.find(s => s.id === centerId);
    assert.ok((center.soldierIds || []).every(id => soldiers.has(id)));
  }
});

test('manual, campaign and tower soldiers cannot be discharged', () => {
  const world = engine.createWorld(42);
  const soldier = world.people.find(p => p.alive && p.role === 'soldier');
  soldier.campaignId = 123;
  assert.equal(dischargeSoldier(world, soldier), false);
  soldier.campaignId = null;
  soldier.towerDutyId = 789;
  assert.equal(dischargeSoldier(world, soldier), false);
  soldier.towerDutyId = null;
  soldier.playerControlled = true;
  assert.equal(dischargeSoldier(world, soldier), false);
});
