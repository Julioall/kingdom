import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../../src/simulation/engine.js';
import { attackTower, damageTower, campaignTower, towerBattlePosition } from '../../src/simulation/kingdoms/fortifications.js';
import { collectLoot, nearestLoot } from '../../src/simulation/economy/loot.js';
import { prepareFrontierConflicts } from '../../src/simulation/kingdoms/frontier-conflicts.js';
import { prepareKingdomCampaigns, resolveKingdomCampaigns } from '../../src/simulation/kingdoms/campaigns.js';
import { buildKingdomStructure } from '../../src/simulation/kingdoms/commands.js';
import { advanceKingdomProjects } from '../../src/simulation/kingdoms/projects.js';
import { workOnCommunityStructure } from '../../src/simulation/settlements/construction.js';

function siege() {
  const world = Sim.createWorld(42);
  world.day = 99;
  prepareFrontierConflicts(world, 100);
  prepareKingdomCampaigns(world, 100);
  const campaign = world.campaigns[0], tower = campaignTower(world, campaign);
  campaign.status = 'marching'; campaign.readyDay = 100;
  const attackers = world.people.filter(p => campaign.attacker.troopIds.includes(p.id));
  const defenders = world.people.filter(p => campaign.defender.troopIds.includes(p.id));
  for (const p of attackers) { p.x = tower.x; p.y = tower.y; }
  for (const p of defenders) { p.x = 0; p.y = 0; }
  return { world, campaign, tower, attackers, defenders };
}

test('all initial towers have life and construction sites start vulnerable', () => {
  const world = Sim.createWorld(42);
  for (const tower of world.structures.filter(s => s.type === 'torre')) {
    assert.equal(tower.health, 6000);
    assert.equal(tower.maxHealth, 6000);
    assert.deepEqual(tower.entryTile, { x: tower.x, y: tower.y + 1 });
    assert.equal(world.tiles[tower.entryTile.y * world.width + tower.entryTile.x].terrain, 'land');
  }
  const result = buildKingdomStructure(world, world.kingdoms[0].id, 'torre',
    { frontierOutpost: true, requireNeutral: true, maxProjection: 42, maxDistance: 48 });
  assert.equal(result.ok, true);
  assert.equal(result.structure.health, 1000);
  assert.equal(result.structure.maxHealth, 4000);
  assert.equal(world.tiles[result.structure.entryTile.y * world.width + result.structure.entryTile.x].terrain, 'land');
});

test('attack range, class, allegiance, recovery and attack cooldown constrain siege damage', () => {
  const { world, tower, attackers, defenders } = siege();
  const archer = attackers.find(p => p.militaryClass === 'arqueiro');
  archer.x = tower.x + 8;
  assert.equal(attackTower(world, archer, tower, 100), 12);
  assert.equal(attackTower(world, archer, tower, 100), 0);
  assert.equal(attackTower(world, archer, tower, 101), 0);
  assert.equal(attackTower(world, archer, tower, 102), 12);
  archer.x = tower.x + 10;
  assert.equal(attackTower(world, archer, tower, 104), 0);
  const infantry = attackers.find(p => p.militaryClass === 'guerreiro');
  infantry.x = tower.x + 8;
  assert.equal(attackTower(world, infantry, tower, 104), 0);
  infantry.x = tower.x; infantry.health = 20;
  assert.equal(attackTower(world, infantry, tower, 104), 0);
  const cleric = attackers.find(p => p.militaryClass === 'monge');
  assert.equal(attackTower(world, cleric, tower, 104), 0);
  const friend = defenders.find(p => p.militaryClass === 'guerreiro');
  friend.x = tower.x; friend.y = tower.y;
  assert.equal(attackTower(world, friend, tower, 104), 0);
});

test('an unopposed attacker must damage a tower rather than annex it intact', () => {
  const { world, campaign, tower, defenders } = siege();
  for (const p of defenders) p.campaignId = null;
  const owner = tower.kingdomId;
  resolveKingdomCampaigns(world, 101);
  assert.ok(tower.health < tower.maxHealth);
  assert.equal(tower.kingdomId, owner);
  assert.notEqual(campaign.status, 'withdrawing');
  assert.equal(campaign.outcome, null);
  assert.ok(campaign.history.some(e => e.type === 'siege' && e.towerId === tower.id));
});

test('zero tower life destroys the objective, removes its domain and ends the siege', () => {
  const { world, campaign, tower, attackers } = siege();
  const owner = world.kingdoms.find(k => k.id === tower.kingdomId);
  const territoryBefore = owner.territoryTileCount;
  assert.equal(damageTower(world, tower, 1e9, 101, attackers[0].kingdomId), 6000);
  assert.equal(tower.health, 0);
  assert.equal(tower.complete, false);
  assert.equal(tower.integrity, 0);
  assert.equal(tower.destroyedDay, 101);
  assert.ok(!owner.towerIds.includes(tower.id));
  assert.ok(owner.territoryTileCount < territoryBefore);
  assert.equal(damageTower(world, tower, 10, 102, attackers[0].kingdomId), 0);
  resolveKingdomCampaigns(world, 102);
  assert.equal(campaign.status, 'withdrawing');
  assert.equal(campaign.outcome, 'attacker-victory');
  assert.match(campaign.outcomeReason, /torre foi destruída/);
});

test('destroyed construction sites cannot revive for free', () => {
  const world = Sim.createWorld(42), owner = world.kingdoms[0];
  const result = buildKingdomStructure(world, owner.id, 'torre',
    { frontierOutpost: true, requireNeutral: true, maxProjection: 42, maxDistance: 48 });
  const tower = result.structure;
  damageTower(world, tower, 2000, 10, world.kingdoms[1].id);
  advanceKingdomProjects(world, 11);
  const community = world.communities.find(c => c.id === tower.communityId);
  const builder = world.people.find(p => p.communityId === community.id && p.role === 'resident');
  builder.x = tower.x; builder.y = tower.y;
  community.stores.wood = 100; community.stores.stone = 100; community.stores.food = 100;
  for (let i = 0; i < 12; i++) workOnCommunityStructure(world, builder, community, community.memberIds.length);
  assert.equal(tower.health, 0);
  assert.equal(tower.complete, false);
  assert.equal(tower.progress, 0);
});

test('community builders cannot bypass the royal tower worksite and its siege restrictions', () => {
  const world = Sim.createWorld(42), owner = world.kingdoms[0];
  const result = buildKingdomStructure(world, owner.id, 'torre',
    { frontierOutpost: true, requireNeutral: true, maxProjection: 42, maxDistance: 48 });
  const tower = result.structure;
  tower.progress = tower.required - 1; tower.siegeBlocked = true;
  const community = world.communities.find(c => c.id === tower.communityId);
  const builder = world.people.find(p => p.communityId === community.id && p.role === 'resident');
  builder.x = tower.x; builder.y = tower.y;
  community.stores.wood = 100; community.stores.stone = 100; community.stores.food = 100;
  workOnCommunityStructure(world, builder, community, community.memberIds.length);
  assert.equal(tower.complete, false);
  assert.equal(tower.progress, tower.required - 1);
  assert.equal(tower.health, 1000);
});

test('defenders intercept the soldiers attacking the tower and ranged troops keep distance', () => {
  const { world, campaign, tower, attackers, defenders } = siege();
  const threat = attackers.find(p => p.militaryClass === 'guerreiro');
  threat.x = tower.x + 4; threat.y = tower.y; threat.attackingTowerId = tower.id;
  for (const p of attackers.filter(p => p.id !== threat.id)) { p.x = 0; p.y = 0; }
  const defender = defenders.find(p => p.militaryClass === 'guerreiro');
  const position = towerBattlePosition(world, defender, tower, campaign.defender, attackers);
  assert.ok(Math.hypot(position.x - threat.x, position.y - threat.y) < 2);
  const archer = attackers.find(p => p.militaryClass === 'arqueiro');
  const rangedPosition = towerBattlePosition(world, archer, tower, campaign.attacker, defenders);
  assert.ok(Math.hypot(rangedPosition.x - tower.x, rangedPosition.y - tower.y) > 5);
});

test('a destroyed castle drops its stock once and nearby people can collect within cargo capacity', () => {
  const world = Sim.createWorld(42);
  const castle = world.structures.find(s => s.type === 'castelo' && s.kingdomId === world.kingdoms[0].id);
  const treasury = world.kingdoms[0].treasury.stock;
  for (const resource of Object.keys(treasury)) treasury[resource] = 0;
  castle.stock = { food: 18, wood: 12 };

  damageTower(world, castle, 1e9, 101, world.kingdoms[1].id);
  assert.equal(castle.stock.food, 0);
  assert.equal(castle.stock.wood, 0);
  assert.equal(world.loot.length, 1);
  assert.deepEqual(world.loot[0].resources, { food: 18, wood: 12 });

  const person = world.people.find(p => p.alive && p.role === 'resident');
  Object.assign(person, { x: castle.x, y: castle.y, carriedFood: 0, carriedMeat: 0, carriedWood: 0,
    carriedStone: 0, carriedGold: 0, carriedFeed: 0, carriedFruit: 0, carriedMaterial: 0, foodReserve: 0 });
  const pile = nearestLoot(world, person);
  assert.equal(pile, world.loot[0]);
  assert.equal(collectLoot(world, person, pile), 24);
  assert.equal(person.carriedFood, 18);
  assert.equal(person.carriedWood, 6);
  assert.equal(pile.resources.wood, 6);
  assert.equal(pile.available, true);

  damageTower(world, castle, 100, 102, world.kingdoms[1].id);
  assert.equal(world.loot.length, 1);
});
