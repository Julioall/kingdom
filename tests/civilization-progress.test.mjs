import test from 'node:test';
import assert from 'node:assert/strict';
import { CIVILIZATION_LEVELS, recordIndividualLivelihood,
  assessCivilizationProgress } from '../src/simulation/society/civilization-progress.js';
import engine from '../src/simulation/engine.js';

const adult = (id, homeId, communityId = 10) => ({
  id, alive: true, role: 'resident', homeId, communityId, kingdomId: null,
  ageDays: 400, health: 100, hydration: 85, foodReserve: 70,
  personalWallet: { stock: { gold: 0 } }
});

function recordRealWorkEvidence(world, days = 30) {
  for (let day = 1; day <= days; day++) {
    for (const person of world.people.filter(p => p.ageDays >= 240)) {
      person.visualActivity = day <= 6 ? { kind: 'harvest', day } : null;
    }
    recordIndividualLivelihood(world, day);
  }
}

test('life evidence requires sustained care and actual work, not just an initial food gift', () => {
  const person = adult(1, null);
  const world = { people: [person] };
  for (let day = 1; day <= 30; day++) recordIndividualLivelihood(world, day);
  assert.equal(person.livelihoodEvidence.healthyDays, 30);
  assert.equal(person.livelihoodEvidence.selfReliant, false);
  for (let day = 31; day <= 60; day++) {
    person.visualActivity = { kind: 'harvest', day };
    recordIndividualLivelihood(world, day);
  }
  assert.equal(person.livelihoodEvidence.days.length, 30, 'bound per-person audit memory');
  assert.equal(person.livelihoodEvidence.selfReliant, true);
  person.health = 10;
  for (let day = 61; day <= 90; day++) recordIndividualLivelihood(world, day);
  assert.equal(person.livelihoodEvidence.selfReliant, false, 'lost capacity is not a permanent status');
});

test('all civilization levels require evidence from the previous level', () => {
  const mother = adult(1, 101), father = adult(2, 101);
  const parent2 = adult(3, 102), mother2 = adult(4, 102);
  mother.partnerId = father.id; father.partnerId = mother.id;
  parent2.partnerId = mother2.id; mother2.partnerId = parent2.id;
  const world = {
    people: [mother, father, parent2, mother2],
    structures: [
      { id: 101, type: 'casa', complete: true, residentIds: [1, 2], communityId: 10 },
      { id: 102, type: 'casa', complete: true, residentIds: [3, 4], communityId: 10 }
    ],
    communities: [{ id: 10, leaderId: 1, tradeCount: 1, stores: { food: 20 }, dissolved: false }],
    kingdoms: [{ id: 20, communityId: 10 }],
  };
  assert.equal(assessCivilizationProgress(world).level, 'sobrevivencia',
    'existing castle/politics do not prove autonomous civilization');
  recordRealWorkEvidence(world);
  assert.equal(assessCivilizationProgress(world).level, 'individuo');
  const baby1 = { id: 5, alive: true, homeId: 101, communityId: 10, ageDays: 20, parents: [1, 2] };
  world.people.push(baby1);
  world.structures[0].residentIds.push(5);
  assert.equal(assessCivilizationProgress(world).level, 'familia');
  const baby2 = { id: 6, alive: true, homeId: 102, communityId: 10, ageDays: 20, parents: [3, 4] };
  world.people.push(baby2);
  world.structures[1].residentIds.push(6);
  assert.equal(assessCivilizationProgress(world).level, 'comunidade');
  assert.equal(assessCivilizationProgress(world).evidence.prebuiltKingdomsWithoutCharter, 1);
  world.kingdoms[0].civicCharter = { foundingCommunityIds: [10], acceptedDay: 365 };
  assert.equal(assessCivilizationProgress(world).level, 'reino');
  world.structures.push(
    { id: 200, type: 'centro_militar', kingdomId: 20, complete: true },
    { id: 201, type: 'torre', kingdomId: 20, complete: true }
  );
  world.people.push({ id: 7, alive: true, role: 'soldier', ageDays: 400,
    kingdomId: 20, militaryCenterId: 200 });
  assert.equal(assessCivilizationProgress(world).level, 'defesa_organizada');
  assert.deepEqual(Object.keys(assessCivilizationProgress(world).reached), CIVILIZATION_LEVELS);
});

test('world opt-in collects lifecycle evidence without rewriting the historical starting kingdoms', () => {
  const world = engine.createWorld(7, { trackCivilization: true });
  assert.equal(world.trackCivilization, true);
  const kingdoms = world.kingdoms.length;
  engine.stepDay(world, { includeSnapshot: false });
  assert.equal(world.kingdoms.length, kingdoms);
  assert.ok(world.people.some(p => p.livelihoodEvidence?.days?.length === 1));
  const defaultWorld = engine.createWorld(7);
  assert.equal(defaultWorld.trackCivilization, undefined,
    'legacy simulations keep their original deterministic state');
});
