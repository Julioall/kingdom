import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../../src/simulation/engine.js';
import { updateMilitaryCommand } from '../../src/simulation/kingdoms/military.js';
import { updateTowerShifts, towerDutyOrder } from '../../src/simulation/kingdoms/tower-archers.js';
import { campaignOrderFor, updateFieldCommand } from '../../src/simulation/kingdoms/campaigns.js';
import { dispatchCommand } from '../../src/simulation/commands.js';

test('promotion releases an archer general from tower duty and keeps later shifts from assigning him again', () => {
  const world = Sim.createWorld(42);
  const general = world.people.find(p => p.role === 'soldier');
  const tower = world.structures.find(s => s.kingdomId === general.kingdomId && s.type === 'torre');
  Object.assign(general, { militaryClass: 'arqueiro', militaryMerit: 500,
    towerDutyId: tower.id, towerMounted: true, towerRecovering: true });
  tower.archerId = general.id;
  updateMilitaryCommand(world, 60);
  assert.equal(general.militaryRank, 'general');
  assert.equal(general.towerDutyId, null);
  assert.equal(general.towerMounted, false);
  assert.equal(tower.archerId, null);
  updateTowerShifts(world, 61);
  assert.equal(general.towerDutyId, null);
  assert.equal(towerDutyOrder(world, general), null);
  assert.equal(campaignOrderFor(world, general).fieldCommandPost, true);
});

test('a general issues battlefield objectives and movement orders shared by troops while occupying a rear position', () => {
  const world = Sim.createWorld(42);
  world.day = 60;
  const [attacker, defender] = world.kingdoms;
  const tower = world.structures.find(s => s.kingdomId === defender.id && s.type === 'torre');
  assert.equal(dispatchCommand(world, { type: 'capture-tower', kingdomId: attacker.id, towerId: tower.id }).ok, true);
  Sim.modules.KingdomCampaigns.prepare(world, 61);
  const campaign = world.campaigns[0], side = campaign.attacker;
  campaign.status = 'marching';
  const troops = world.people.filter(p => side.troopIds.includes(p.id));
  const general = troops.find(p => p.militaryRank === 'general');
  assert.ok(general);
  for (const p of troops) { p.x = campaign.target.x; p.y = campaign.target.y - 3; }
  const enemy = world.people.find(p => campaign.defender.troopIds.includes(p.id));
  Object.assign(enemy, { x: campaign.target.x, y: campaign.target.y + 1, attackingStructureId: tower.id });
  const command = updateFieldCommand(world, campaign, side, 62);
  assert.equal(command.issuerId, general.id);
  assert.equal(command.targetStructureId, tower.id);
  assert.equal(command.targetEnemyId, enemy.id);
  assert.equal(command.action, 'engage');
  assert.ok(troops.every(p => p.fieldCommand === command));
  const order = campaignOrderFor(world, general);
  assert.equal(order.commanding, true);
  assert.equal(order.engagementRange, null);
  assert.equal(general.towerMounted, false);
  assert.ok(Math.hypot(order.target.x - campaign.target.x, order.target.y - campaign.target.y) >= 4);
});
