import test from 'node:test';
import assert from 'node:assert/strict';
import { assessKingdomPopulationGrowth } from '../src/simulation/kingdoms/demography.js';
import engine from '../src/simulation/engine.js';
import { reproducePeople } from '../src/simulation/individuals/lifecycle.js';
import { getSocialLink } from '../src/simulation/society/communities.js';
import { HUMAN_ADULT_AGE_DAYS, HUMAN_MAX_AGE_DAYS } from '../src/simulation/individuals/human-age.js';

test('king does not create births without food or civilian caretakers', () => {
  const world = {
    kingdoms: [{ id: 1, communityId: 10 }],
    communities: [{ id: 10, stores: { food: 0 } }],
    people: [
      { id: 1, alive: true, kingdomId: 1, communityId: 10, role: 'resident', ageDays: 400, foodReserve: 1, health: 100, hydration: 100 },
      { id: 2, alive: true, kingdomId: 1, communityId: 10, role: 'soldier', ageDays: 430, foodReserve: 100, health: 100, hydration: 100 }
    ]
  };
  let decision = assessKingdomPopulationGrowth(world, 1);
  assert.equal(decision.foodReady, false);
  assert.equal(decision.maySupportChild, false);
  world.people[0].foodReserve = 80;
  decision = assessKingdomPopulationGrowth(world, 1);
  assert.equal(decision.foodReady, true);
  assert.equal(decision.careSlots, 2);
  assert.equal(decision.maySupportChild, true);
  for (let i = 0; i < 2; i++) world.people.push({
    id: i + 3, alive: true, kingdomId: 1, communityId: 10,
    role: 'resident', ageDays: 0, foodReserve: 0
  });
  decision = assessKingdomPopulationGrowth(world, 1);
  assert.equal(decision.children, 2);
  assert.equal(decision.careSlots, 0);
  assert.equal(decision.maySupportChild, false);
});

test('natural aging is not conditional on war, hunger, population deficits or royal quotas', () => {
  const w = engine.createWorld(42);
  const newborn = w.people.find(p => p.role === 'resident');
  newborn.ageDays = HUMAN_MAX_AGE_DAYS - 1;
  newborn.health = 100;
  newborn.hydration = 100;
  newborn.foodReserve = 80;
  w.day = 0;
  engine.stepDay(w, { includeSnapshot: false });
  assert.equal(newborn.alive, false);
  assert.equal(newborn.deathCause, 'age');
  assert.equal(newborn.ageDays, HUMAN_MAX_AGE_DAYS);
});

test('resources, not deaths or a population target, permit real couples to have children', () => {
  const w = engine.createWorld(42, { initialPopulation: 200, initialMilitaryShare: .8 });
  w.day = 29;
  for (const p of w.people) p.birthCooldown = 999;
  const k = w.kingdoms[0];
  const residents = w.people.filter(p => p.alive && p.kingdomId === k.id && p.role === 'resident');
  const m = residents.find(p => p.sex === 'M');
  const f = residents.find(p => p.sex === 'F');
  assert.ok(m && f);
  Object.assign(m, { ageDays: HUMAN_ADULT_AGE_DAYS + 35, foodReserve: 80, energy: 90, hydration: 90, health: 95, birthCooldown: 0 });
  Object.assign(f, { ageDays: HUMAN_ADULT_AGE_DAYS + 35, foodReserve: 80, energy: 90, hydration: 90, health: 95, birthCooldown: 0 });
  m.x = f.x = k.x;
  m.y = f.y = k.y;
  getSocialLink(w, m, f).trust = .9;
  const house = w.structures.find(s => s.id === k.homeIds[0]);
  house.complete = true;
  house.capacity = (house.residentIds || []).length + 3;
  const community = w.communities.find(g => g.id === k.communityId);
  community.stores.food = 0;
  for (const p of residents) if (p !== m && p !== f) p.foodReserve = 0;
  reproducePeople(w);
  assert.equal(w.births, 0, 'king pauses births while other caretakers are starving');
  for (const p of residents) if (p !== m && p !== f) p.foodReserve = 85;
  reproducePeople(w);
  assert.equal(w.births, 1, 'parenthood resumes only after real personal food capacity exists');
  const baby = w.people.find(p => p.parents?.includes(m.id) && p.parents?.includes(f.id));
  assert.ok(baby && baby.homeId === house.id);
  assert.equal(baby.foodReserve, 12, 'baby food comes from parents, not a population bonus');
});
