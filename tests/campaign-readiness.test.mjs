import test from 'node:test';
import assert from 'node:assert/strict';
import engine from '../src/simulation/engine.js';
import { prepareKingdomCampaigns } from '../src/simulation/kingdoms/campaigns.js';

function warFixture({ observedLocation = true } = {}) {
  const world = engine.createWorld(42);
  const attacker = world.kingdoms[0];
  const defender = world.kingdoms[1];
  const relationKey = Math.min(attacker.id, defender.id) + ':' + Math.max(attacker.id, defender.id);
  world.kingdomRelations[relationKey] = {
    a: attacker.id, b: defender.id, status: 'at-war', tension: 1, borderIncidents: 1,
    startedDay: 1, resolvedDay: -1, ceasefireUntilDay: -1, warId: 90001
  };
  const location = observedLocation ? { x: defender.x, y: defender.y } : null;
  world.wars = [{
    id: 90001, a: attacker.id, b: defender.id, attackerId: attacker.id, defenderId: defender.id,
    status: 'active', startedDay: 1, cause: 'confronto observado de fronteira',
    evidence: location ? {
      location,
      attacker: { source: 'patrulha local', location, certainty: 'posição observada' },
      defender: { source: 'guarnição local', location, certainty: 'posição observada' }
    } : null
  }];
  world.campaigns = [];
  return { world, attacker, relation: world.kingdomRelations[relationKey], war: world.wars[0] };
}

test('a war without a locally observed objective cannot mobilize a campaign', () => {
  const { world, war } = warFixture({ observedLocation: false });

  prepareKingdomCampaigns(world, 1);

  assert.equal(war.campaignStatus, 'blocked');
  assert.match(war.campaignBlockReason, /local observado/i);
  assert.equal(war.campaignId, undefined);
  assert.deepEqual(world.campaigns, []);
});

test('a campaign waits for 18 days of rations without debiting stocks, then settles status quo', () => {
  const { world, attacker, relation, war } = warFixture();
  attacker.treasury.stock.food = 0;
  for (const community of world.communities) community.stores.food = 0;
  for (const person of world.people) if (person.kingdomId === attacker.id && person.role === 'soldier') {
    person.foodReserve = 0;
    person.campaignId = null;
    person.towerDutyId = null;
    person.towerRecovering = false;
  }

  const treasuryFoodBefore = attacker.treasury.stock.food;
  const communityFoodBefore = world.communities.find(item => item.id === attacker.communityId).stores.food;
  prepareKingdomCampaigns(world, 1);

  assert.equal(war.campaignStatus, 'awaiting-supplies');
  assert.equal(war.awaitingSuppliesSinceDay, 1);
  assert.equal(war.campaignId, undefined);
  assert.deepEqual(world.campaigns, []);
  assert.equal(attacker.treasury.stock.food, treasuryFoodBefore);
  assert.equal(world.communities.find(item => item.id === attacker.communityId).stores.food, communityFoodBefore);

  prepareKingdomCampaigns(world, 181);

  assert.equal(war.status, 'resolved');
  assert.equal(war.campaignStatus, 'settled-without-supplies');
  assert.equal(relation.status, 'peace');
  assert.equal(relation.lastOutcome, war.resolutionReason);
  assert.equal(world.treaties.at(-1).kind, 'armistice-status-quo');
  assert.equal(world.treaties.at(-1).winnerId, null);
  assert.deepEqual(world.campaigns, []);
});
