import test from 'node:test';
import assert from 'node:assert/strict';
import engine from '../src/simulation/engine.js';
import { makePerson, updateDependent } from '../src/simulation/individuals/lifecycle.js';
import { observeFamilyWork, familyKnowledgeReport } from '../src/simulation/society/family-learning.js';
import { HUMAN_ADOLESCENT_AGE_DAYS } from '../src/simulation/individuals/human-age.js';

function family() {
  const mentor = {
    id: 1, alive: true, x: 3, y: 3, foodReserve: 90, health: 100,
    skills: { forage: .9, gather: .8, build: .6 },
    visualActivity: { kind: 'harvest', day: 12 }
  };
  const child = {
    id: 2, alive: true, x: 4, y: 3, ageDays: 50,
    parents: [1], guardianId: 1,
    skills: { forage: .12, gather: .08, build: .05 }
  };
  return { mentor, child, world: { day: 11 } };
}

test('a child learns a parent's demonstrated work, without copying their skills or neural state', () => {
  const { world, mentor, child } = family();
  const originalSkill = child.skills.forage;
  assert.equal(observeFamilyWork(world, child, mentor), true);
  assert.ok(child.skills.forage > originalSkill && child.skills.forage < mentor.skills.forage);
  assert.equal(child.skills.gather, .08, 'only demonstrated skills can be learned');
  assert.deepEqual(familyKnowledgeReport(child), [{
    skill: 'forage', mentorId: mentor.id, observations: 1,
    lastObservedDay: 12, currentSkill: child.skills.forage
  }]);
  assert.equal(observeFamilyWork(world, child, mentor), false, 'no duplicate lesson the same day');
  assert.equal(child.cognitiveState, undefined, 'no fabricated memories or copied cognitive weights');
});

test('learning requires family link, recent observed work, proximity, health and childhood', () => {
  const { world, mentor, child } = family();
  child.parents = []; child.guardianId = null;
  assert.equal(observeFamilyWork(world, child, mentor), false, 'strangers cannot teach as parents');
  child.parents = [mentor.id];
  child.x = 100;
  assert.equal(observeFamilyWork(world, child, mentor), false, 'knowledge cannot cross the map');
  child.x = 4;
  mentor.visualActivity.day = 10;
  assert.equal(observeFamilyWork(world, child, mentor), false, 'work was not seen today');
  mentor.visualActivity.day = 12;
  mentor.foodReserve = 2;
  assert.equal(observeFamilyWork(world, child, mentor), false, 'starving caregivers cannot teach');
  mentor.foodReserve = 80;
  child.ageDays = HUMAN_ADOLESCENT_AGE_DAYS;
  assert.equal(observeFamilyWork(world, child, mentor), false, 'adult autonomy uses normal learning');
});

test('actual dependent care transfers skills to the next generation and preserves source', () => {
  const world = engine.createWorld(13);
  const parent = world.people.find(p => p.alive && p.role === 'resident');
  assert.ok(parent);
  parent.foodReserve = 90;
  parent.health = 100;
  parent.visualActivity = { kind: 'harvest', day: world.day + 1 };
  parent.skills.forage = .92;
  const child = makePerson(world, parent.x + 1, parent.y, true);
  Object.assign(child, { ageDays: 100, parents: [parent.id], guardianId: parent.id,
    kingdomId: parent.kingdomId, communityId: parent.communityId, homeId: parent.homeId,
    foodReserve: 2, hydration: 90 });
  child.skills.forage = .1;
  world.people.push(child);
  const previous = child.skills.forage;
  updateDependent(world, child);
  assert.ok(child.skills.forage > previous, 'real caregiving and observed work produce learning');
  assert.equal(child.familyLearning.forage.fromPersonId, parent.id);
  assert.equal(child.familyLearning.forage.observations, 1);
  child.ageDays = HUMAN_ADOLESCENT_AGE_DAYS;
  assert.ok(child.skills.forage > previous, 'learned skill survives independence');
});
