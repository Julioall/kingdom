import test from 'node:test';
import assert from 'node:assert/strict';
import engine from '../src/simulation/engine.js';
import { drawCampaignRation, prepareKingdomCampaigns } from '../src/simulation/kingdoms/campaigns.js';
import { drawGarrisonRation } from '../src/simulation/kingdoms/service.js';
import { FOOD_RESERVE_PER_UNIT } from '../src/config/ecosystem.js';

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

test('a soldier who returned leaves the withdrawing campaign and can draw a finite garrison ration', () => {
  const { world, attacker } = warFixture();
  prepareKingdomCampaigns(world, 1);
  const campaign = world.campaigns[0];
  assert.ok(campaign, 'the seed mobilizes a campaign');
  campaign.status = 'withdrawing';
  for (const side of [campaign.attacker, campaign.defender]) {
    side.supply.stock.food = 0;
    for (const id of side.troopIds) {
      const troop = world.people.find(person => person.id === id);
      Object.assign(troop, { x: side.home.x + 20, y: side.home.y, foodReserve: 80, campaignReturnedHome: false });
    }
  }
  const returned = world.people.find(person => person.id === 87);
  const home = world.structures.find(structure => structure.id === returned.homeId);
  const center = world.structures.find(structure => structure.id === returned.militaryCenterId);
  assert.ok(campaign.attacker.troopIds.includes(returned.id) && home && center);
  assert.ok(center.soldierIds.includes(returned.id));
  Object.assign(returned, { x: home.x + 1, y: home.y, foodReserve: 0,
    campaignReturnedHome: true, restingStructureId: home.id });
  attacker.treasury.stock.food = 2;
  const remainingId = campaign.attacker.troopIds.find(id => id !== returned.id);
  const remaining = world.people.find(person => person.id === remainingId);
  const loyalty = returned.loyalty;

  prepareKingdomCampaigns(world, 2);

  assert.equal(returned.campaignId, null, 'a returned soldier does not wait for every other troop');
  assert.equal(returned.role, 'soldier');
  assert.equal(returned.militaryReturningHome, false);
  assert.equal(returned.loyalty, loyalty);
  assert.ok(center.soldierIds.includes(returned.id), 'returning does not dismiss the soldier');
  assert.ok(!campaign.attacker.troopIds.includes(returned.id));
  assert.equal(remaining.campaignId, campaign.id, 'the troop still in the field remains assigned');
  assert.equal(campaign.status, 'withdrawing');
  const received = drawGarrisonRation(world, returned, center, FOOD_RESERVE_PER_UNIT);
  assert.equal(received, FOOD_RESERVE_PER_UNIT);
  assert.equal(attacker.treasury.stock.food, 1);
  campaign.attacker.supply.stock.food = 5;
  assert.equal(drawCampaignRation(world, returned), 0, 'the released soldier cannot debit field rations');
  assert.equal(campaign.attacker.supply.stock.food, 5);
  Object.assign(remaining, { x: center.x, y: center.y, foodReserve: 0 });
  assert.equal(drawGarrisonRation(world, remaining, center, FOOD_RESERVE_PER_UNIT), 0,
    'a soldier still assigned to the campaign cannot use garrison stock');
  assert.equal(attacker.treasury.stock.food, 1);
});

test('reaching the muster point releases a returning soldier even before a return flag is set', () => {
  const { world } = warFixture();
  prepareKingdomCampaigns(world, 1);
  const campaign = world.campaigns[0];
  campaign.status = 'withdrawing';
  const side = campaign.attacker;
  const returned = world.people.find(person => person.id === 87);
  Object.assign(returned, { x: side.home.x, y: side.home.y, campaignReturnedHome: false });

  prepareKingdomCampaigns(world, 2);

  assert.equal(returned.campaignId, null);
  assert.equal(returned.role, 'soldier');
  assert.ok(!side.troopIds.includes(returned.id));
});
