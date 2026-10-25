import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../../src/simulation/engine.js';
import { distance } from '../../src/simulation/core/math.js';
import { cellAt } from '../../src/simulation/world/spatial.js';
import { canEnterForeignTerritory, resolveBorderIncursions } from '../../src/simulation/kingdoms/territories.js';
import { campaignOrderFor, performCampaignOrder, recordCampaignPersonalRation } from '../../src/simulation/kingdoms/campaigns.js';
import { createFormation, formationSlot } from '../../src/simulation/kingdoms/formations.js';
import { changePersonHealth, killPerson } from '../../src/simulation/individuals/lifecycle.js';
import { DAILY_FOOD_NEED, FOOD_RESERVE_PER_UNIT } from '../../src/config/ecosystem.js';
import { isTreeAnchor } from '../../src/simulation/ecology/plants.js';
import { updatePeople } from '../../src/simulation/individuals/actions.js';

function nextRandomRoll(state) {
  state = (state + 0x6D2B79F5) >>> 0;
  let value = state;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return { state, value: ((value ^ (value >>> 14)) >>> 0) / 4294967296 };
}

function stateForTwoLowRolls() {
  for (let state = 0; state < 100_000; state++) {
    const first = nextRandomRoll(state);
    const second = nextRandomRoll(first.state);
    if (first.value < .02 && second.value < .02) return state;
  }
  throw new Error('could not find deterministic low random rolls');
}

function createWarWorld({ defenders = true } = {}) {
  const world = Sim.createWorld(42);
  const attacker = world.kingdoms[0], defender = world.kingdoms[1];
  if (!defenders) {
    for (const person of world.people.filter(item => item.kingdomId === defender.id && item.role === 'soldier')) {
      person.role = 'resident';
      person.militaryClass = null;
      person.militaryCenterId = null;
      person.militaryDutyCenterId = null;
    }
  }
  const key = Math.min(attacker.id, defender.id) + ':' + Math.max(attacker.id, defender.id);
  world.kingdomRelations[key] = { a: Math.min(attacker.id, defender.id), b: Math.max(attacker.id, defender.id),
    status: 'at-war', tension: .82, borderIncidents: 1, lastIncidentDay: 0, startedDay: 0 };
  world.wars.push({ id: 9001, a: attacker.id, b: defender.id, attackerId: attacker.id, defenderId: defender.id,
    startedDay: 0, status: 'active', cause: 'confronto de fronteira após uma incursão descoberta', evidence: {
      location: { x: defender.x, y: defender.y }, incidentDay: 0,
      source: 'incursão descoberta por uma patrulha territorial',
      attacker: { source: 'relato do morador', location: { x: defender.x, y: defender.y }, certainty: 'última posição conhecida' },
      defender: { source: 'guarda local', soldiers: 2, posts: 1, location: { x: defender.x, y: defender.y }, certainty: 'observação direta' }
    } });
  return { world, attacker, defender, key };
}

function alignCampaignAtFront(world, campaign) {
  for (const side of [campaign.attacker, campaign.defender]) {
    for (const id of side.troopIds) {
      const person = world.people.find(item => item.id === id && item.alive);
      const order = campaignOrderFor(world, person);
      const position = side.formation?.worldSlots?.[person.id] || order?.target;
      if (position) { person.x = position.x; person.y = position.y; }
    }
  }
}

function makeGeneralRequests({ duplicateCampaign = false } = {}) {
  const { world } = createWarWorld();
  world.simulationEpoch = 7;
  Sim.modules.KingdomStrategy.setStrategicAiEnabled(world, true);
  Sim.modules.KingdomCampaigns.prepare(world, 1);
  if (duplicateCampaign) {
    const source = world.campaigns[0];
    const clone = structuredClone(source);
    clone.id = world.nextId + 100;
    clone.warId = clone.id;
    for (const side of [clone.attacker, clone.defender]) {
      side.campaignId = clone.id;
      side.lastGeneralRequestDay = null;
      side.nextGeneralReviewDay = null;
      side.supply.ownerId = clone.id;
      side.troopIds = side.troopIds.map(id => {
        const person = structuredClone(world.people.find(item => item.id === id));
        person.id = world.nextId++;
        person.campaignId = clone.id;
        world.people.push(person);
        return person.id;
      });
    }
    world.campaigns.push(clone);
    Sim.modules.KingdomCampaigns.prepare(world, 2);
  }
  const requests = [];
  while (true) {
    const request = Sim.modules.KingdomCampaigns.pullGeneralAiRequest(world);
    if (!request) break;
    requests.push(request);
  }
  return { world, requests };
}

test('a border report provisions a campaign from finite treasury stock and gives soldiers a known objective', () => {
  const { world, attacker } = createWarWorld();
  const treasuryFood = attacker.treasury.stock.food;
  Sim.modules.KingdomCampaigns.prepare(world, 1);

  const campaign = world.campaigns[0];
  assert.ok(campaign);
  assert.equal(campaign.status, 'mobilizing');
  assert.match(campaign.cause, /incursão descoberta/);
  assert.equal(campaign.target.x, world.kingdoms[1].x);
  assert.ok(attacker.treasury.stock.food < treasuryFood, 'mobilization debits provisions from the treasury');
  assert.ok(campaign.attacker.supply.stock.food > 0);
  assert.ok(campaign.attacker.supply.stock.wood > 0);
  assert.ok(campaign.attacker.supply.stock.gold > 0);
  assert.deepEqual(campaign.attacker.supplyLedger.deployment, {
    food: campaign.attacker.supply.stock.food,
    wood: campaign.attacker.supply.stock.wood,
    gold: campaign.attacker.supply.stock.gold
  });

  const soldier = world.people.find(person => person.id === campaign.attacker.troopIds[0]);
  const beforeFood = campaign.attacker.supply.stock.food;
  assert.equal(Sim.modules.KingdomCampaigns.drawRation(world, soldier), .78);
  assert.ok(Math.abs(campaign.attacker.supply.stock.food - beforeFood - (-DAILY_FOOD_NEED / FOOD_RESERVE_PER_UNIT)) < .001);
  assert.ok(Math.abs(campaign.attacker.supplyLedger.rationConsumptionFood - (DAILY_FOOD_NEED / FOOD_RESERVE_PER_UNIT)) < .001);
  assert.equal(recordCampaignPersonalRation(world, soldier, .31), .31);
  assert.equal(campaign.attacker.supplyLedger.personalReserveRationPoints, .31);
  assert.equal(recordCampaignPersonalRation(world, soldier, Number.NaN), 0);

  Sim.modules.KingdomCampaigns.prepare(world, 3);
  const order = Sim.modules.KingdomCampaigns.orderFor(world, soldier);
  assert.equal(campaign.status, 'marching');
  const slot = campaign.attacker.formation.slotAssignments[soldier.id];
  const dx = campaign.target.x - campaign.attacker.home.x, dy = campaign.target.y - campaign.attacker.home.y;
  const length = Math.hypot(dx, dy) || 1;
  const forward = { x: dx / length, y: dy / length }, lateral = { x: -forward.y, y: forward.x };
  const destination = { x: campaign.target.x - forward.x * 4, y: campaign.target.y - forward.y * 4 };
  const ideal = {
    x: destination.x - forward.x * slot.depth * campaign.attacker.formation.spacing
      + lateral.x * slot.lateral * campaign.attacker.formation.spacing,
    y: destination.y - forward.y * slot.depth * campaign.attacker.formation.spacing
      + lateral.y * slot.lateral * campaign.attacker.formation.spacing
  };
  assert.ok(distance(order.target, campaign.target) <= 11, 'the assigned position stays on the actual front');
  assert.equal(cellAt(world, order.target.x, order.target.y).terrain, 'land');
  assert.deepEqual(order.target, campaign.attacker.formation.worldSlots[soldier.id] || ideal);
  assert.ok(world.kingdoms[0].militaryIntel.some(item => item.location.x === campaign.target.x));
});

test('campaign troops use their formation slots while marching toward the objective', () => {
  const { world } = createWarWorld();
  Sim.modules.KingdomCampaigns.prepare(world, 1);
  const campaign = world.campaigns[0];
  campaign.status = 'marching';
  const side = campaign.attacker;
  const soldier = world.people.find(person => side.troopIds.includes(person.id) && person.militaryRank !== 'general');
  side.formation = createFormation({ campaignId: campaign.id, kingdomId: side.kingdomId, role: side.role,
    memberIds: side.troopIds, origin: side.home, destination: campaign.target, day: 1 });

  const order = campaignOrderFor(world, soldier);
  const dx = campaign.target.x - side.home.x, dy = campaign.target.y - side.home.y;
  const distanceToTarget = Math.hypot(dx, dy) || 1;
  const orientation = { x: dx / distanceToTarget, y: dy / distanceToTarget };
  const destination = { x: campaign.target.x - orientation.x * 4, y: campaign.target.y - orientation.y * 4 };

  assert.deepEqual(order.target, formationSlot({ ...side.formation, orientation }, soldier.id, destination));
});

test('campaign formations give each military role a distinct rank and a non-overlapping slot', () => {
  const { world } = createWarWorld();
  Sim.modules.KingdomCampaigns.prepare(world, 1);
  const campaign = world.campaigns[0], side = campaign.attacker;
  const positions = side.troopIds.map(id => {
    const slot = side.formation.slotAssignments[id], forward = side.formation.orientation;
    const lateral = { x: -forward.y, y: forward.x };
    return {
      x: campaign.target.x - forward.x * slot.depth * side.formation.spacing
        + lateral.x * slot.lateral * side.formation.spacing,
      y: campaign.target.y - forward.y * slot.depth * side.formation.spacing
        + lateral.y * slot.lateral * side.formation.spacing
    };
  });
  const occupiedSlots = positions.map(position => Math.round(position.x) + ':' + Math.round(position.y));

  assert.equal(new Set(occupiedSlots).size, occupiedSlots.length);
  const meanDepth = militaryClass => {
    const members = side.troopIds.map(id => world.people.find(person => person.id === id))
      .filter(person => person.militaryClass === militaryClass);
    return members.reduce((sum, person) => sum + distance(positions[side.troopIds.indexOf(person.id)], campaign.target), 0)
      / members.length;
  };
  assert.ok(meanDepth('guerreiro') < meanDepth('lanceiro'));
  assert.ok(meanDepth('lanceiro') < meanDepth('arqueiro'));
  assert.ok(meanDepth('arqueiro') < meanDepth('monge'));
});

test('campaign formations open into a line on an open front and close into a column in a narrow passage', () => {
  const { world } = createWarWorld();
  Sim.modules.KingdomCampaigns.prepare(world, 1);
  const campaign = world.campaigns[0];
  campaign.status = 'marching';
  campaign.readyDay = 0;
  const target = cellAt(world, campaign.target.x, campaign.target.y);
  target.terrain = 'land';
  target.elevationLevel = 0;
  const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]]
    .map(([dx, dy]) => cellAt(world, target.x + dx, target.y + dy));
  for (const neighbor of neighbors) { neighbor.terrain = 'land'; neighbor.elevationLevel = 0; }
  for (const side of [campaign.attacker, campaign.defender]) for (const id of side.troopIds) {
    const person = world.people.find(item => item.id === id);
    person.x = campaign.target.x;
    person.y = campaign.target.y;
  }

  Sim.modules.KingdomCampaigns.prepare(world, 2);
  assert.ok([campaign.attacker.formation, campaign.defender.formation]
    .every(formation => formation.type === 'line'));

  for (const neighbor of neighbors) neighbor.terrain = 'water';
  Sim.modules.KingdomCampaigns.prepare(world, 3);
  assert.ok([campaign.attacker.formation, campaign.defender.formation]
    .every(formation => formation.type === 'column'));
  assert.ok(campaign.history.filter(event => event.type === 'formation')
    .some(event => event.formationType === 'line'));
  assert.ok(campaign.history.filter(event => event.type === 'formation')
    .some(event => event.formationType === 'column'));
});

test('a fallen formation leader is replaced and the living slots reorganize with the casualty recorded', () => {
  const { world } = createWarWorld();
  Sim.modules.KingdomCampaigns.prepare(world, 1);
  const campaign = world.campaigns[0];
  const side = campaign.attacker;
  const fallenId = side.formation.leaderId;
  const fallen = world.people.find(person => person.id === fallenId);
  fallen.alive = false;

  Sim.modules.KingdomCampaigns.prepare(world, 2);

  assert.equal(side.formation.memberIds.includes(fallenId), false);
  assert.equal(side.formation.memberIds.length, side.troopIds.length - 1);
  assert.equal(side.formation.leaderId, side.formation.memberIds[0]);
  assert.ok(campaign.history.some(event => event.type === 'formation'
    && event.kingdomId === side.kingdomId && event.text.includes('assumiu a liderança')));
  assert.ok(campaign.history.some(event => event.type === 'formation'
    && event.kingdomId === side.kingdomId && event.text.includes('reorganizou as posições')));
});

test('the general receives a role-specific request with an isolated report and versioned campaign order', () => {
  const { world, requests } = makeGeneralRequests();
  assert.equal(requests.length, 2, 'each side has its own general report');
  const request = requests.find(item => item.kingdomId === world.campaigns[0].attackerId);
  assert.ok(request);
  assert.equal(request.role, 'general');
  assert.equal(request.campaignId, world.campaigns[0].id);
  assert.match(request.requestId, /^general:\d+:\d+:\d+$/);
  assert.equal(request.orderVersion, 0);
  assert.deepEqual(request.allowedActions, ['advance', 'hold_position', 'withdraw']);
  assert.equal(request.observedFacts.kingdom.id, request.kingdomId);
  assert.equal(request.observedFacts.campaign.id, request.campaignId);
  assert.equal(request.observedFacts.side.role, 'attacker');
  assert.equal(request.observedFacts.side.troopCount, world.campaigns[0].attacker.troopIds.length);
  assert.equal(request.observedFacts.opponent.role, 'defender');

  const soldier = world.people.find(person => person.id === world.campaigns[0].attacker.troopIds[0]);
  const start = { x: soldier.x, y: soldier.y };
  assert.equal(Sim.modules.KingdomCampaigns.applyGeneralAiDecision(world, request,
    { action: 'hold_position', confidence: .83, reason: 'Aguarde com suprimentos disponíveis.' },
    { provider: 'ollama', model: 'smollm2:135m' }), true);
  assert.equal(world.campaigns[0].attacker.aiOrder.model, 'smollm2:135m');
  assert.equal(world.campaigns[0].attacker.orderVersion, 1);
  const order = Sim.modules.KingdomCampaigns.orderFor(world, soldier);
  assert.equal(order.holding, true);
  Sim.modules.KingdomCampaigns.orderFor(world, soldier);
  performCampaignOrder(world, soldier, order);
  assert.deepEqual({ x: soldier.x, y: soldier.y }, start, 'hold position prevents campaign movement');
  assert.match(soldier.state, /mantendo posição/);
  assert.equal(Sim.modules.KingdomCampaigns.applyGeneralAiDecision(world, request,
    { action: 'hold_position', confidence: .83, reason: 'duplicada' }), false, 'the same request cannot apply twice');
});

test('two campaigns keep their general queue entries and decisions isolated', () => {
  const { world, requests } = makeGeneralRequests({ duplicateCampaign: true });
  assert.equal(world.campaigns.length, 2);
  assert.equal(requests.length, 4);
  const first = requests.find(request => request.campaignId === world.campaigns[0].id && request.kingdomId === world.campaigns[0].attackerId);
  const otherCampaign = requests.find(request => request.campaignId === world.campaigns[1].id && request.kingdomId === world.campaigns[1].attackerId);
  assert.ok(first && otherCampaign);
  assert.notEqual(first.requestId, otherCampaign.requestId);
  assert.notEqual(first.observedFacts.campaign.id, otherCampaign.observedFacts.campaign.id);
  assert.equal(Sim.modules.KingdomCampaigns.applyGeneralAiDecision(world, first,
    { action: 'hold_position', confidence: .7, reason: 'Aguardar.' }), true);
  assert.ok(world.campaignGeneralAi.pendingBySide[world.campaigns[1].id + ':' + otherCampaign.kingdomId],
    'applying one campaign order does not consume another campaign request');
  assert.equal(world.campaigns[1].attacker.aiOrder, null);
});

test('a general cannot issue unlisted orders, and withdrawal resolves only through a legal campaign decision', () => {
  {
    const { world, requests } = makeGeneralRequests();
    const request = requests[0];
    const warCount = world.wars.length;
    assert.equal(Sim.modules.KingdomCampaigns.applyGeneralAiDecision(world, request,
      { action: 'declare_war', confidence: 1, reason: 'ataque sem autorização' }), false);
    assert.equal(world.wars.length, warCount);
    assert.equal(world.campaigns[0].status, 'mobilizing');
  }
  {
    const { world, requests } = makeGeneralRequests();
    const request = requests.find(item => item.kingdomId === world.campaigns[0].attackerId);
    const relation = world.kingdomRelations[world.campaigns[0].attackerId + ':' + world.campaigns[0].defenderId]
      || Object.values(world.kingdomRelations).find(item => item.status === 'at-war');
    assert.equal(Sim.modules.KingdomCampaigns.applyGeneralAiDecision(world, request,
      { action: 'withdraw', confidence: .91, reason: 'As provisões não sustentam a marcha.' }), true);
    assert.equal(world.campaigns[0].status, 'withdrawing');
    assert.equal(world.campaigns[0].outcome, 'defender-victory');
    assert.equal(relation.status, 'peace');
    assert.ok(world.treaties.some(item => item.campaignId === world.campaigns[0].id && item.kind === 'armistice-status-quo'));
  }
});

test('a failed general request records deterministic fallback and disabling clears experimental orders', () => {
  const { world, requests } = makeGeneralRequests();
  const request = requests[0];
  assert.equal(Sim.modules.KingdomCampaigns.failGeneralAiRequest(world, request, {
    reason: 'Ollama indisponível.', provider: 'ollama', model: 'smollm2:135m'
  }), true);
  assert.ok(world.campaigns[0].history.some(event => event.type === 'general-fallback'
    && /Ollama indisponível/.test(event.text)));
  assert.equal(world.campaigns[0].attacker.aiOrder, null);
  assert.equal(Object.keys(world.campaignGeneralAi.pendingBySide).length, 1,
    'the other side keeps its independent pending request');

  const otherRequest = requests[1];
  assert.equal(Sim.modules.KingdomCampaigns.applyGeneralAiDecision(world, otherRequest,
    { action: 'hold_position', confidence: .8, reason: 'Esperar.' }), true);
  Sim.modules.KingdomStrategy.setStrategicAiEnabled(world, false);
  Sim.modules.KingdomCampaigns.setGeneralAiEnabled(world, false);
  assert.equal(world.campaigns[0].defender.aiOrder, null);
  assert.equal(world.campaignGeneralAi.requests.length, 0);
  assert.equal(Object.keys(world.campaignGeneralAi.pendingBySide).length, 0);
});

test('a war without a locally observed incident cannot create a campaign', () => {
  const world = Sim.createWorld(42);
  const [a, b] = world.kingdoms;
  const key = Math.min(a.id, b.id) + ':' + Math.max(a.id, b.id);
  world.kingdomRelations[key] = { a: Math.min(a.id, b.id), b: Math.max(a.id, b.id), status: 'at-war', tension: 0 };
  world.wars.push({ id: 9002, a: a.id, b: b.id, attackerId: a.id, defenderId: b.id, cause: 'unknown', status: 'active' });

  Sim.modules.KingdomCampaigns.prepare(world, 1);

  assert.equal(world.campaigns.length, 0);
  assert.equal(world.wars[0].campaignStatus, 'blocked');
  assert.match(world.wars[0].campaignBlockReason, /local observado/i);
});

test('a war with no available attackers waits for soldiers instead of creating an empty campaign', () => {
  const { world, attacker } = createWarWorld();
  const war = world.wars.find(item => item.id === 9001);
  const attackers = world.people.filter(person => person.kingdomId === attacker.id && person.alive);
  for (const person of attackers) {
    person.role = 'resident';
    person.campaignId = null;
  }

  Sim.modules.KingdomCampaigns.prepare(world, 1);

  assert.equal(world.campaigns.length, 0);
  assert.equal(war.campaignStatus, 'awaiting-force');
  assert.match(war.campaignBlockReason, /não tem soldados disponíveis/);
  assert.ok(world.events.some(event => event.text.includes('adiou a campanha')));

  attackers[0].role = 'soldier';
  Sim.modules.KingdomCampaigns.prepare(world, 2);
  assert.equal(world.campaigns.length, 1);
  assert.equal(world.campaigns[0].attacker.troopIds.length, 1);
  assert.equal(war.campaignStatus, 'mobilizing');
  assert.equal(war.campaignBlockReason, undefined);
});

test('a war waits for an 18-day ration budget before mobilizing and spends nothing while blocked', () => {
  const { world, attacker } = createWarWorld();
  const war = world.wars.find(item => item.id === 9001);
  const soldiers = world.people.filter(person => person.alive && person.kingdomId === attacker.id && person.role === 'soldier');
  const community = world.communities.find(item => item.id === attacker.communityId);
  const woodBefore = attacker.treasury.stock.wood, goldBefore = attacker.treasury.stock.gold;
  attacker.treasury.stock.food = 0;
  community.stores.food = 0;
  for (const person of soldiers) person.foodReserve = 0;

  Sim.modules.KingdomCampaigns.prepare(world, 1);

  assert.equal(world.campaigns.length, 0);
  assert.equal(war.campaignStatus, 'awaiting-supplies');
  assert.equal(war.awaitingSuppliesSinceDay, 1);
  assert.ok(soldiers.every(person => person.campaignId == null), 'soldiers remain at their posts');
  assert.equal(attacker.treasury.stock.wood, woodBefore);
  assert.equal(attacker.treasury.stock.gold, goldBefore);
  assert.equal(attacker.treasury.stock.food, 0);
  assert.ok(world.events.some(event => event.text.includes('adiou a campanha')));

  attacker.treasury.stock.food = soldiers.length * DAILY_FOOD_NEED * 18 / FOOD_RESERVE_PER_UNIT;
  Sim.modules.KingdomCampaigns.prepare(world, 2);

  assert.equal(world.campaigns.length, 1);
  assert.equal(war.campaignStatus, 'mobilizing');
  assert.equal(war.awaitingSuppliesSinceDay, undefined);
  assert.equal(war.campaignBlockReason, undefined);
});

test('a war waiting for provisions ends in status quo after 180 days', () => {
  const { world, attacker, key } = createWarWorld();
  const war = world.wars.find(item => item.id === 9001);
  const community = world.communities.find(item => item.id === attacker.communityId);
  attacker.treasury.stock.food = 0;
  community.stores.food = 0;
  for (const person of world.people.filter(item => item.alive && item.kingdomId === attacker.id && item.role === 'soldier')) {
    person.foodReserve = 0;
  }

  Sim.modules.KingdomCampaigns.prepare(world, 1);
  Sim.modules.KingdomCampaigns.prepare(world, 180);
  assert.equal(war.status, 'active', 'the supply wait remains open through day 180');
  Sim.modules.KingdomCampaigns.prepare(world, 181);

  assert.equal(world.campaigns.length, 0);
  assert.equal(war.status, 'resolved');
  assert.equal(war.campaignStatus, 'settled-without-supplies');
  assert.match(war.resolutionReason, /ração suficiente/);
  assert.equal(world.kingdomRelations[key].status, 'peace');
  assert.equal(world.treaties.at(-1).kind, 'armistice-status-quo');
});

test('a war without a mobilizable force settles as a status quo armistice after 180 days', () => {
  const { world, attacker, key } = createWarWorld();
  const war = world.wars.find(item => item.id === 9001);
  for (const person of world.people.filter(item => item.kingdomId === attacker.id && item.alive)) {
    person.role = 'resident';
    person.campaignId = null;
  }

  Sim.modules.KingdomCampaigns.prepare(world, 1);
  assert.equal(war.campaignStatus, 'awaiting-force');
  assert.equal(war.awaitingForceSinceDay, 1);
  Sim.modules.KingdomCampaigns.prepare(world, 180);
  assert.equal(war.status, 'active', 'the force request remains open until the full wait period elapses');
  assert.equal(world.treaties.length, 0);

  Sim.modules.KingdomCampaigns.prepare(world, 181);

  assert.equal(world.campaigns.length, 0, 'no empty campaign should be created');
  assert.equal(war.status, 'resolved');
  assert.equal(war.campaignStatus, 'settled-without-force');
  assert.equal(war.resolvedDay, 181);
  assert.equal(world.kingdomRelations[key].status, 'peace');
  assert.equal(world.kingdomRelations[key].ceasefireUntilDay, 211);
  assert.equal(world.treaties.length, 1);
  assert.equal(world.treaties[0].kind, 'armistice-status-quo');
  assert.equal(world.treaties[0].campaignId, null);
  assert.equal(attacker.militaryIntel.find(item => item.kind === 'force-requested').status, 'expired');

  Sim.modules.KingdomCampaigns.prepare(world, 182);
  assert.equal(world.treaties.length, 1, 'later updates must not record the same armistice twice');
});

test('a later war does not reopen an older war already settled without force', () => {
  const { world, attacker, key } = createWarWorld();
  const previousWar = world.wars.find(item => item.id === 9001);
  for (const person of world.people.filter(item => item.kingdomId === attacker.id && item.alive)) {
    person.role = 'resident';
    person.campaignId = null;
  }

  Sim.modules.KingdomCampaigns.prepare(world, 1);
  Sim.modules.KingdomCampaigns.prepare(world, 181);
  assert.equal(previousWar.campaignStatus, 'settled-without-force');

  world.kingdomRelations[key].status = 'at-war';
  const laterWar = structuredClone(previousWar);
  Object.assign(laterWar, { id: 9003, startedDay: 182, status: 'active' });
  delete laterWar.campaignId;
  delete laterWar.resolvedDay;
  delete laterWar.winnerId;
  delete laterWar.resolutionReason;
  delete laterWar.awaitingForceSinceDay;
  laterWar.campaignStatus = null;
  world.wars.push(laterWar);

  Sim.modules.KingdomCampaigns.prepare(world, 182);

  assert.equal(previousWar.status, 'resolved');
  assert.equal(previousWar.resolvedDay, 181);
  assert.equal(previousWar.campaignStatus, 'settled-without-force');
  assert.equal(laterWar.campaignStatus, 'awaiting-force');
  assert.equal(laterWar.awaitingForceSinceDay, 182);
  assert.equal(world.treaties.length, 1);
});

test('a pending force request autonomously trains a soldier and pays campaign resupply from the treasury', () => {
  const { world, attacker, defender } = createWarWorld();
  const committed = world.people.filter(person => person.alive && person.kingdomId === attacker.id && person.role === 'soldier');
  for (const person of committed) person.campaignId = 9000;
  const target = { x: Math.round(committed[0].x), y: Math.round(committed[0].y) };
  const war = world.wars.find(item => item.id === 9001);
  war.evidence.location = target;
  war.evidence.attacker.location = target;
  war.evidence.defender.location = target;

  for (const kingdom of [attacker, defender]) {
    kingdom.treasury.stock.food = 200;
    kingdom.treasury.stock.wood = 100;
    kingdom.treasury.stock.gold = 100;
    world.communities.find(item => item.id === kingdom.communityId).stores.food = 500;
  }

  Sim.modules.KingdomCampaigns.prepare(world, 1);
  assert.equal(war.campaignStatus, 'awaiting-force');
  assert.equal(attacker.militaryIntel.at(-1).kind, 'force-requested');
  Sim.modules.KingdomStrategy.update(world);

  const recruitment = attacker.militaryRecruitments.at(-1);
  const trainee = world.people.find(person => person.id === recruitment.personId);
  assert.equal(trainee.recruitmentOrder.readyDay, 7);
  assert.deepEqual(recruitment.cost, { food: 10, wood: 8, gold: 3 });
  assert.ok(world.events.some(event => event.day === 1 && event.text.includes('iniciou o treinamento')
    && event.text.includes('aguardava efetivo')));

  Sim.tick(world, 15);

  const campaign = world.campaigns.find(item => item.warId === war.id);
  assert.ok(campaign, 'the trained soldier should clear the awaiting-force block');
  assert.equal(war.campaignStatus, campaign.status);
  assert.ok(['mobilizing', 'marching'].includes(campaign.status));
  assert.equal(trainee.role, 'soldier');
  assert.ok(campaign.attacker.troopIds.includes(trainee.id));
  assert.equal(recruitment.status, 'mobilized');
  assert.equal(recruitment.campaignId, campaign.id);
  assert.equal(recruitment.mobilizedDay, campaign.startedDay);
  assert.equal(attacker.militaryIntel.find(item => item.warId === war.id && item.kind === 'force-requested').status, 'mobilized');
  assert.equal(campaign.attacker.supplyLedger.deployment.food, 18 / FOOD_RESERVE_PER_UNIT);
  assert.ok(campaign.attacker.supplyLedger.resupply.food > 0,
    'seven days of campaign rations should trigger a treasury-funded top-up while the soldier is on home territory');
  assert.ok(campaign.history.some(event => event.type === 'resupply'));
  const recordedFood = campaign.attacker.supplyLedger.deployment.food + campaign.attacker.supplyLedger.resupply.food;
  const accountedFood = campaign.attacker.supplyLedger.rationConsumptionFood + campaign.attacker.supply.stock.food;
  assert.ok(Math.abs(recordedFood - accountedFood) < 1e-9);
});

test('campaign resupply can use community surplus while preserving two days of civilian food', () => {
  const { world, attacker } = createWarWorld();
  const community = world.communities.find(item => item.id === attacker.communityId);
  const members = world.people.filter(person => person.alive && attacker.memberIds.includes(person.id));
  const dependents = members.filter(person => person.ageDays < 12 * 365).length;
  const protectedFood = (members.length - dependents) * DAILY_FOOD_NEED + dependents * .42;
  attacker.treasury.stock.food = 0;
  community.stores.food = protectedFood * 2 + 5;

  Sim.modules.KingdomCampaigns.prepare(world, 1);

  const campaign = world.campaigns.find(item => item.warId === 9001);
  assert.ok(campaign, 'the observed war mobilizes its available attackers');
  assert.equal(campaign.attacker.supplyLedger.deployment.food, 0,
    'the test starts with no military food in the treasury');
  assert.ok(Math.abs(campaign.attacker.supplyLedger.resupplySources.food.community - 5) < 1e-9);
  assert.ok(Math.abs(campaign.attacker.supplyLedger.resupply.food - 5) < 1e-9);
  assert.ok(Math.abs(community.stores.food - protectedFood * 2) < 1e-9,
    'field resupply leaves two full days of civilian food demand in the community');
  const resupply = campaign.history.find(event => event.type === 'resupply');
  assert.equal(resupply.sources.communityFood, 5);
  assert.equal(resupply.sources.treasuryFood, 0);
  assert.equal(resupply.sources.civilianReserveDays, 2);

  campaign.attacker.supply.stock.food = 0;
  campaign.attacker.lastResupplyDay = 1;
  Sim.modules.KingdomCampaigns.prepare(world, 8);
  assert.ok(Math.abs(community.stores.food - protectedFood * 2) < 1e-9,
    'campaigns cannot draw below the protected two-day civil reserve');
  assert.ok(Math.abs(campaign.attacker.supplyLedger.resupplySources.food.community - 5) < 1e-9);
});

test('mobilization days do not count as a failed campaign route', () => {
  const { world } = createWarWorld();
  Sim.modules.KingdomCampaigns.prepare(world, 1);
  const campaign = world.campaigns[0];

  Sim.modules.KingdomCampaigns.resolve(world, 1);
  Sim.modules.KingdomCampaigns.resolve(world, 2);

  assert.equal(campaign.status, 'mobilizing');
  assert.equal(campaign.attacker.stallDays, 0);
  assert.equal(campaign.defender.stallDays, 0);
});

test('field supply coverage includes rations carried by each soldier', () => {
  const { world } = createWarWorld();
  Sim.modules.KingdomCampaigns.prepare(world, 1);
  const campaign = world.campaigns[0];
  campaign.status = 'marching';
  campaign.attacker.supply.stock.food = 0;
  const attackers = campaign.attacker.troopIds.map(id => world.people.find(person => person.id === id));
  attackers[0].foodReserve = 42;
  attackers[1].foodReserve = 31;

  Sim.modules.KingdomCampaigns.resolve(world, 4);

  assert.equal(campaign.attacker.supplyShortageDays, 0);

  attackers[1].foodReserve = .1;
  Sim.modules.KingdomCampaigns.resolve(world, 5);

  assert.equal(campaign.attacker.supplyShortageDays, 1,
    'one soldier’s low personal reserve cannot be covered by another soldier’s surplus');
});

test('a starving soldier follows the withdrawal route instead of foraging indefinitely', () => {
  const { world } = createWarWorld();
  Sim.modules.KingdomCampaigns.prepare(world, 1);
  const campaign = world.campaigns[0];
  campaign.status = 'withdrawing';
  const soldier = world.people.find(person => person.id === campaign.attacker.troopIds[0]);
  soldier.x = campaign.target.x;
  soldier.y = campaign.target.y;
  soldier.foodReserve = 2;
  soldier.energy = 50;
  soldier.hydration = 50;
  const before = distance(soldier, campaign.attacker.home);

  Sim.tick(world, 1);

  assert.ok(distance(soldier, campaign.attacker.home) < before);
});

test('a withdrawing soldier with no full field ration leaves before their personal reserve is exhausted', () => {
  const { world } = createWarWorld();
  Sim.modules.KingdomCampaigns.prepare(world, 1);
  const campaign = world.campaigns[0];
  campaign.status = 'withdrawing';
  campaign.attacker.supply.stock.food = 0;
  const soldier = world.people.find(person => person.id === campaign.attacker.troopIds[0]);
  soldier.x = campaign.target.x;
  soldier.y = campaign.target.y;
  soldier.foodReserve = 1.5;

  Sim.modules.KingdomCampaigns.prepare(world, 2);

  assert.equal(soldier.role, 'soldier', 'evacuation preserves military service');
  assert.equal(soldier.campaignId, null);
  assert.ok(!campaign.attacker.troopIds.includes(soldier.id));
  assert.ok(campaign.history.some(event => event.type === 'desertion' && event.personId === soldier.id
    && event.reason === 'withdrawal-out-of-rations'));
});

test('a returned soldier can use the post ration while the campaign remains tracked', () => {
  const { world } = createWarWorld();
  Sim.modules.KingdomCampaigns.prepare(world, 1);
  const campaign = world.campaigns[0];
  campaign.status = 'withdrawing';
  const soldier = world.people.find(person => person.id === campaign.attacker.troopIds[0]);
  const otherSoldier = world.people.find(person => campaign.attacker.troopIds.includes(person.id) && person.id !== soldier.id);
  assert.ok(otherSoldier, 'the test needs another soldier to keep the campaign open');
  soldier.x = campaign.attacker.home.x;
  soldier.y = campaign.attacker.home.y;
  soldier.foodReserve = 2;
  soldier.energy = 50;
  soldier.hydration = 50;
  otherSoldier.x = campaign.target.x;
  otherSoldier.y = campaign.target.y;
  const order = Sim.modules.KingdomCampaigns.orderFor(world, soldier);
  assert.equal(order, null, 'soldiers at home no longer receive a withdrawal movement order');
  assert.equal(campaign.status, 'withdrawing');
  assert.deepEqual([soldier.x, soldier.y], [campaign.attacker.home.x, campaign.attacker.home.y]);
  assert.equal(soldier.campaignId, campaign.id, 'the returned soldier remains tracked until the full force returns');
  assert.equal(Sim.modules.KingdomCampaigns.drawRation(world, soldier), .78,
    'a soldier at the post retains access to finite field rations');
});

test('campaign recovery sends tired soldiers into their own house and restores energy before duty resumes', () => {
  for (const status of ['marching', 'withdrawing']) {
    const { world } = createWarWorld();
    Sim.modules.KingdomCampaigns.prepare(world, 1);
    const campaign = world.campaigns[0];
    campaign.status = status;
    const person = world.people.find(p => campaign.attacker.troopIds.includes(p.id) && p.militaryClass === 'guerreiro');
    const center = world.structures.find(s => s.id === person.militaryCenterId);
    const house = world.structures.find(s => s.id === person.homeId);
    assert.ok(house, 'the soldier has an assigned home');
    house.x = center.x + 6; house.y = center.y;
    const nearbyHouse = { ...house, id: world.nextId++, x: center.x + 1, residentIds: [] };
    world.structures = [center, house, nearbyHouse];
    world.people = [person];
    campaign.attacker.home = { x: center.x, y: center.y };
    for (const tile of world.tiles) {
      tile.terrain = 'land'; tile.elevationLevel = 0;
      tile.plants = tile.plants.map(() => 0);
    }
    person.x = center.x; person.y = center.y;
    person.energy = 40; person.health = 100; person.injury = 0;
    person.foodReserve = 90; person.hydration = 90;
    updatePeople(world);
    assert.equal(person.brain.lastAction, 'rest', status);
    assert.equal(person.militaryRestTargetId, house.id, 'assigned home wins over a closer empty house');
    assert.equal(person.restingStructureId, null, 'walking home remains visible');
    assert.ok(person.energy < 40, 'walking home does not restore energy');
    for (let day = 0; day < 12 && person.restingStructureId == null; day++) {
      world.day++;
      updatePeople(world);
    }
    assert.equal(person.restingStructureId, house.id, status);
    assert.equal(person.state, 'descansando dentro da casa');
    if (status === 'withdrawing') {
      assert.equal(campaignOrderFor(world, person), null, 'resting at home cannot restart the return to barracks');
      Sim.modules.KingdomCampaigns.resolve(world, world.day + 1);
      assert.equal(campaign.status, 'complete', 'a returned soldier resting in a house counts as returned');
    }
    const energyAtEntry = person.energy;
    for (let day = 0; day < 30 && person.energy < 74; day++) {
      world.day++;
      updatePeople(world);
      assert.equal(person.restingStructureId, house.id, 'the soldier remains inside while recovering');
    }
    assert.ok(person.energy > energyAtEntry && person.energy >= 74, 'rest restores energy past the duty threshold');
    world.day++;
    updatePeople(world);
    assert.equal(person.restingStructureId, null);
    assert.notEqual(person.brain.lastAction, 'rest');
    if (status === 'marching') assert.equal(person.brain.lastAction, 'campaign', 'recovery resumes the existing campaign');
  }
});

test('a soldier blocked on the withdrawal route is released after four failed moves', () => {
  const { world } = createWarWorld();
  Sim.modules.KingdomCampaigns.prepare(world, 1);
  const campaign = world.campaigns[0];
  campaign.status = 'withdrawing';
  const stuck = world.people.find(person => person.id === campaign.attacker.troopIds[0]);
  const returned = world.people.find(person => campaign.attacker.troopIds.includes(person.id) && person.id !== stuck.id);
  assert.ok(returned, 'the attacking force needs a second soldier to return ahead of the blocked one');
  const start = world.tiles.find(tile => tile.terrain === 'land'
    && distance(tile, campaign.attacker.home) > 10
    && distance(tile, campaign.defender.home) > 10);
  assert.ok(start, 'the test needs a distant land tile for the stranded soldier');
  const homeTiles = [campaign.attacker.home, campaign.defender.home]
    .map(home => cellAt(world, home.x, home.y));
  stuck.x = start.x;
  stuck.y = start.y;
  for (const person of world.people.filter(item => item.alive && item.campaignId === campaign.id && item.id !== stuck.id)) {
    const side = person.kingdomId === campaign.attackerId ? campaign.attacker : campaign.defender;
    person.x = side.home.x;
    person.y = side.home.y;
  }
  for (const tile of world.tiles) {
    if (tile.i === start.i || homeTiles.some(home => home && home.i === tile.i)) continue;
    tile.terrain = 'rock';
  }

  for (let day = 1; day <= 4; day++) {
    for (const side of [campaign.attacker, campaign.defender]) for (const id of side.troopIds.slice()) {
      const person = world.people.find(item => item.id === id && item.alive);
      if (person) performCampaignOrder(world, person, Sim.modules.KingdomCampaigns.orderFor(world, person));
    }
    Sim.modules.KingdomCampaigns.resolve(world, day);
    if (day === 1) {
      assert.equal(Sim.modules.KingdomCampaigns.orderFor(world, returned), null,
        'a soldier at home no longer receives a withdrawal movement order');
      assert.equal(returned.campaignId, campaign.id, 'the returned soldier remains tracked until the full force returns');
      assert.equal(Sim.modules.KingdomCampaigns.drawRation(world, returned), .78,
        'a soldier waiting at the post should retain access to finite field rations');
    }
    if (day < 4) assert.equal(campaign.status, 'withdrawing');
  }

  assert.equal(campaign.status, 'complete');
  assert.equal(stuck.campaignId, null);
  assert.equal(stuck.role, 'soldier', 'a blocked return route does not disband the standing army');
  assert.ok(campaign.history.some(event => event.type === 'desertion' && event.personId === stuck.id
    && event.reason === 'return-route-stalled'));
});

test('repeated reported resource disputes can cause a war with the losing kingdom objective on record', () => {
  const world = Sim.createWorld(42);
  const [a, b] = world.kingdoms;
  const key = Math.min(a.id, b.id) + ':' + Math.max(a.id, b.id);
  world.kingdomRelations[key] = { a: Math.min(a.id, b.id), b: Math.max(a.id, b.id),
    status: 'peace', tension: .84, resourceDisputes: 3 };
  a.militaryIntel = [1, 2].map(day => ({ day, reportDay: day + 2, kind: 'resource-dispute', opponentId: b.id,
    cause: 'confronto por alimento', source: 'relato de moradores', resourceKind: 'berry', outcome: 'lost',
    location: { x: 50, y: 50 } }));
  b.militaryIntel = [{ day: 3, reportDay: 5, kind: 'resource-dispute', opponentId: a.id,
    cause: 'confronto por alimento', source: 'relato de moradores', resourceKind: 'berry', outcome: 'held',
    location: { x: 50, y: 50 } }];

  Sim.modules.KingdomCampaigns.prepare(world, 46);

  assert.equal(world.wars.length, 1);
  assert.equal(world.wars[0].attackerId, a.id);
  assert.match(world.wars[0].cause, /retaliou após perder repetidas disputas/);
  assert.deepEqual(world.wars[0].evidence.location, { x: 50, y: 50 });
  assert.equal(world.campaigns[0].target.x, 50);
});

test('a peace settlement cannot reuse old dispute reports, but fresh losses can break the ceasefire', () => {
  const world = Sim.createWorld(42);
  const [a, b] = world.kingdoms;
  const key = Math.min(a.id, b.id) + ':' + Math.max(a.id, b.id);
  world.kingdomRelations[key] = { a: Math.min(a.id, b.id), b: Math.max(a.id, b.id),
    status: 'peace', tension: .9, resourceDisputes: 3, resolvedDay: 5, ceasefireUntilDay: 30 };
  const report = (kingdom, day, opponentId, outcome) => ({ day, reportDay: day + 1, kind: 'resource-dispute',
    opponentId, cause: 'confronto por alimento', source: 'relato de moradores', resourceKind: 'berry', outcome,
    location: { x: 50, y: 50 } });
  a.militaryIntel = [report(a, 1, b.id, 'lost'), report(a, 2, b.id, 'lost')];
  b.militaryIntel = [report(b, 3, a.id, 'held')];

  Sim.modules.KingdomCampaigns.prepare(world, 46);
  assert.equal(world.wars.length, 0, 'reports already covered by the treaty cannot restart the same war');

  a.militaryIntel.push(report(a, 6, b.id, 'lost'), report(a, 7, b.id, 'lost'));
  b.militaryIntel.push(report(b, 8, a.id, 'held'));
  world.kingdomRelations[key].resourceDisputes = 6;
  Sim.modules.KingdomCampaigns.prepare(world, 47);

  assert.equal(world.wars.length, 1);
  assert.equal(world.wars[0].startedDay, 47);
  assert.match(world.wars[0].cause, /retaliou após perder repetidas disputas/);
});

test('an expelled resident avoids foreign territory unless survival is critical', () => {
  const world = Sim.createWorld(42);
  const [home, host] = world.kingdoms;
  const person = world.people.find(item => item.kingdomId === home.id && item.alive);
  const foreignTile = world.tiles.find(tile => tile.kingdomId === host.id);
  world.day = 20;
  person.territoryWarnings = { [host.id]: 110 };

  assert.equal(canEnterForeignTerritory(world, person, foreignTile), false);
  person.foodReserve = 8;
  assert.equal(canEnterForeignTerritory(world, person, foreignTile), true);
  person.foodReserve = 40;
  world.day = 111;
  assert.equal(canEnterForeignTerritory(world, person, foreignTile), true);
});

test('an unopposed force can occupy the reported area and end the war through an armistice', () => {
  const { world, attacker, defender, key } = createWarWorld({ defenders: false });
  Sim.modules.KingdomCampaigns.prepare(world, 1);
  const campaign = world.campaigns[0];
  campaign.status = 'marching';
  campaign.readyDay = 0;
  for (const id of campaign.attacker.troopIds) {
    const soldier = world.people.find(person => person.id === id);
    soldier.x = campaign.target.x;
    soldier.y = campaign.target.y;
  }
  Sim.modules.KingdomCampaigns.prepare(world, 1);
  alignCampaignAtFront(world, campaign);

  Sim.modules.KingdomCampaigns.resolve(world, 1);

  assert.equal(world.kingdomRelations[key].status, 'peace');
  assert.equal(campaign.status, 'withdrawing');
  assert.equal(campaign.outcome, 'attacker-victory');
  assert.equal(world.territoryClaims.length, 1);
  assert.equal(cellAt(world, campaign.target.x, campaign.target.y).kingdomId, attacker.id);
  assert.equal(world.treaties[0].kind, 'armistice-with-territory-change');
  assert.ok(world.events.some(event => event.text.includes('A nova fronteira permanece no mapa')));
  assert.notEqual(attacker.id, defender.id);
});

test('an attacker does not claim a border while living defenders are still marching to reinforce it', () => {
  const { world, key } = createWarWorld();
  Sim.modules.KingdomCampaigns.prepare(world, 1);
  const campaign = world.campaigns[0];
  campaign.status = 'marching';
  campaign.readyDay = 0;
  campaign.undefendedDays = 0;
  for (const id of campaign.attacker.troopIds) {
    const person = world.people.find(item => item.id === id);
    person.x = campaign.target.x;
    person.y = campaign.target.y;
    person.foodReserve = 100;
  }
  for (const [index, id] of campaign.defender.troopIds.entries()) {
    const person = world.people.find(item => item.id === id);
    person.x = campaign.target.x + 18 + index;
    person.y = campaign.target.y;
    person.foodReserve = 100;
  }

  Sim.modules.KingdomCampaigns.resolve(world, 1);

  assert.equal(campaign.battleCount, 0);
  assert.equal(campaign.status, 'marching');
  assert.equal(world.kingdomRelations[key].status, 'at-war');
});

test('an observed frontline battle costs equipment, affects cohesion, and records its losses', () => {
  const { world, key } = createWarWorld();
  Sim.modules.KingdomCampaigns.prepare(world, 1);
  const campaign = world.campaigns[0];
  campaign.status = 'marching';
  campaign.readyDay = 0;
  for (const side of [campaign.attacker, campaign.defender]) for (const id of side.troopIds) {
    const soldier = world.people.find(person => person.id === id);
    soldier.x = campaign.target.x;
    soldier.y = campaign.target.y;
    soldier.foodReserve = 100;
  }
  Sim.modules.KingdomCampaigns.prepare(world, 1);
  alignCampaignAtFront(world, campaign);
  const equipmentBefore = campaign.attacker.supply.stock.wood + campaign.defender.supply.stock.wood;

  Sim.modules.KingdomCampaigns.resolve(world, 1);
  alignCampaignAtFront(world, campaign);

  Sim.modules.KingdomCampaigns.resolve(world, 2);

  assert.equal(campaign.battleCount, 1);
  const battle = campaign.history.find(event => event.type === 'battle');
  assert.ok(battle);
  assert.ok(battle.equipmentCosts.wood > 0);
  assert.ok(battle.equipmentCosts.gold > 0);
  const losingSide = [campaign.attacker, campaign.defender].find(side => side.kingdomId === battle.loserId);
  assert.deepEqual(losingSide.supplyLedger.battleEquipmentLoss, battle.equipmentCosts);
  assert.match(battle.text, /equipamento consumido/);
  assert.equal(battle.formations.length, 2);
  assert.ok(battle.formations.every(formation => ['line', 'column'].includes(formation.type)));
  assert.ok(battle.formations.every(formation => Number.isFinite(formation.cohesion)
    && formation.cohesion >= 0 && formation.cohesion <= 1));
  assert.ok(battle.formations.some(formation => formation.state === 'retreating'));
  assert.ok(campaign.attacker.morale < 82 || campaign.defender.morale < 82);
  assert.ok(campaign.attacker.supply.stock.wood + campaign.defender.supply.stock.wood < equipmentBefore);
  assert.ok(world.events.some(event => event.text.includes('venceu o confronto de campanha')));
  assert.ok(['at-war', 'peace'].includes(world.kingdomRelations[key].status));
});

test('frontline battles do not resolve while both forces are still away from the objective', () => {
  const { world } = createWarWorld();
  Sim.modules.KingdomCampaigns.prepare(world, 1);
  const campaign = world.campaigns[0];
  campaign.status = 'marching';
  campaign.readyDay = 0;
  for (const side of [campaign.attacker, campaign.defender]) for (const id of side.troopIds) {
    const soldier = world.people.find(person => person.id === id);
    soldier.x = side.home.x;
    soldier.y = side.home.y;
    soldier.foodReserve = 100;
  }

  Sim.modules.KingdomCampaigns.resolve(world, 1);

  assert.equal(campaign.battleCount, 0);
  assert.equal(campaign.status, 'marching');
});

test('deployed melee troops close the staging gap and attack without losing battle readiness', () => {
  for (const militaryClass of ['guerreiro', 'lanceiro']) {
    const { world } = createWarWorld();
    Sim.modules.KingdomCampaigns.prepare(world, 1);
    const campaign = world.campaigns[0];
    campaign.readyDay = 0;
    campaign.status = 'marching';
    // An open battlefield isolates movement from the generated island terrain.
    world.structures = [];
    for (const tile of world.tiles) {
      tile.terrain = 'land'; tile.elevationLevel = 0;
      tile.plants = tile.plants.map(() => 0);
    }
    const troops = [campaign.attacker, campaign.defender].map(side => {
      const person = world.people.find(person => person.id === side.troopIds[0]);
      side.troopIds = [person.id];
      side.mobilizedTroopCount = 1;
      person.militaryClass = militaryClass;
      person.health = 100; person.foodReserve = 100; person.energy = 100;
      return person;
    });
    world.people = troops;
    Sim.modules.KingdomCampaigns.prepare(world, 2);
    alignCampaignAtFront(world, campaign);
    assert.ok(distance(...troops) >= 7.9, 'staging lines begin outside melee range');
    for (let day = 3; day <= 12; day++) {
      world.day = day - 1;
      Sim.modules.KingdomCampaigns.prepare(world, day);
      for (const person of troops) performCampaignOrder(world, person, campaignOrderFor(world, person));
      Sim.modules.KingdomCampaigns.resolve(world, day);
      if (troops.every(person => person.lastMilitaryAttackDay >= 3)) break;
    }
    assert.ok(troops.every(person => person.lastMilitaryAttackDay >= 3), militaryClass + ' must reach and attack the opposing line');
    assert.ok(campaign.battleCount > 0);
    assert.ok(troops.some(person => person.health < 100), 'melee attacks apply actual damage');
  }
});

test('full campaign formations fit unique positions onto the generated island front', () => {
  const world = Sim.createWorld(42);
  world.day = 99;
  Sim.modules.KingdomCampaigns.prepare(world, 100);
  assert.ok(world.campaigns.length);
  for (const campaign of world.campaigns) for (const side of [campaign.attacker, campaign.defender]) {
    const positions = side.troopIds.map(id => side.formation.worldSlots[id]);
    assert.ok(positions.every(Boolean), 'every soldier receives a position');
    const occupied = new Set();
    for (const position of positions) {
      const tile = cellAt(world, position.x, position.y);
      assert.equal(tile.terrain, 'land');
      assert.equal(isTreeAnchor(world, tile), false);
      assert.ok(distance(position, campaign.target) <= 11);
      assert.equal(occupied.has(tile.i), false, 'assigned positions never overlap on the grid');
      occupied.add(tile.i);
    }
  }
});

test('nearby frontline soldiers fight while the rest of both armies is still arriving', () => {
  const { world } = createWarWorld();
  Sim.modules.KingdomCampaigns.prepare(world, 1);
  const campaign = world.campaigns[0];
  world.structures = [];
  campaign.status = 'marching'; campaign.readyDay = 0;
  const fronts = [];
  for (const side of [campaign.attacker, campaign.defender]) {
    const troops = side.troopIds.map(id => world.people.find(p => p.id === id));
    for (const person of troops) { person.x = 5; person.y = 5; person.foodReserve = 100; }
    const front = troops.find(p => p.militaryClass === 'guerreiro');
    front.x = campaign.target.x + (side.role === 'attacker' ? -1 : 0);
    front.y = campaign.target.y;
    side.formation.deployed = false;
    fronts.push(front);
  }
  const order = campaignOrderFor(world, fronts[0]);
  assert.deepEqual(order.target, { x: fronts[1].x, y: fronts[1].y });
  Sim.modules.KingdomCampaigns.resolve(world, 3);
  assert.equal(campaign.battleCount, 1);
  assert.ok(fronts.every(person => person.lastMilitaryAttackDay === 3));
  assert.ok([campaign.attacker, campaign.defender].every(side => !side.formation.deployed),
    'local fighting does not require pretending that the full armies have arrived');
});

test('a spearman already in attack range holds the support line instead of pushing into occupied melee tiles', () => {
  const { world } = createWarWorld();
  Sim.modules.KingdomCampaigns.prepare(world, 1);
  const campaign = world.campaigns[0];
  world.structures = [];
  campaign.status = 'marching'; campaign.readyDay = 0;
  for (const person of world.people) if (person.role === 'soldier') { person.x = 5; person.y = 5; }
  const spear = world.people.find(p => campaign.attacker.troopIds.includes(p.id) && p.militaryClass === 'lanceiro');
  const enemy = world.people.find(p => campaign.defender.troopIds.includes(p.id) && p.militaryClass === 'guerreiro');
  spear.x = campaign.target.x - 3; spear.y = campaign.target.y;
  enemy.x = campaign.target.x; enemy.y = campaign.target.y;
  const start = { x: spear.x, y: spear.y };
  assert.equal(performCampaignOrder(world, spear, campaignOrderFor(world, spear)), true);
  assert.deepEqual({ x: spear.x, y: spear.y }, start);
  assert.equal(spear.state, 'sustentando a linha de combate');
  Sim.modules.KingdomCampaigns.resolve(world, 3);
  assert.equal(spear.lastMilitaryAttackDay, 3);
});

test('unpaid fortification maintenance degrades and eventually removes territorial coverage', () => {
  const world = Sim.createWorld(42);
  const kingdom = world.kingdoms[0];
  const tower = world.structures.find(item => item.id === kingdom.towerIds[0]);
  const fortifications = world.structures.filter(item => item.complete && item.kingdomId === kingdom.id
    && ['castelo', 'torre', 'centro_militar'].includes(item.type));
  const expectedDeferredCost = fortifications.reduce((total, structure) => {
    const cost = structure.frontierOutpost ? { wood: .2, stone: .1 }
      : structure.type === 'castelo' ? { wood: .8, stone: .4 }
        : structure.type === 'centro_militar' ? { wood: .6, stone: .3 } : { wood: .4, stone: .2 };
    total.wood += cost.wood;
    total.stone += cost.stone;
    return total;
  }, { wood: 0, stone: 0 });
  for (const resource of ['wood', 'stone']) expectedDeferredCost[resource] = Number(expectedDeferredCost[resource].toFixed(2));
  kingdom.treasury.stock.wood = 0;
  kingdom.treasury.stock.stone = 0;

  for (let day = 30; day <= 300; day += 30) {
    Sim.modules.KingdomCampaigns.maintainFortifications(world, day);
    if (day === 30) assert.ok(world.events.some(event => event.day === 30 && event.text.includes('fechou a manutenção')));
  }

  const firstMaintenance = kingdom.fortificationMaintenance.history[0];
  assert.equal(firstMaintenance.day, 30);
  assert.equal(firstMaintenance.deferredStructures, fortifications.length);
  assert.deepEqual(firstMaintenance.deferredCost, expectedDeferredCost);
  assert.ok(firstMaintenance.integrityLost > 0);
  assert.equal(tower.complete, false);
  assert.equal(tower.integrity, 0);
  assert.ok(world.events.some(event => event.text.includes('falta prolongada') && event.text.includes('torre')));
  assert.equal(kingdom.towerIds.includes(tower.id), false);
});

test('paid fortification maintenance records exact treasury costs without reporting integrity loss', () => {
  const world = Sim.createWorld(42);
  const kingdom = world.kingdoms[0];
  const fortifications = world.structures.filter(item => item.complete && item.kingdomId === kingdom.id
    && ['castelo', 'torre', 'centro_militar'].includes(item.type));
  for (const resource of ['wood', 'stone']) kingdom.treasury.stock[resource] = 100;
  for (const structure of fortifications) structure.integrity = .8;

  Sim.modules.KingdomCampaigns.maintainFortifications(world, 30);

  const ledger = kingdom.fortificationMaintenance.history[0];
  assert.equal(ledger.day, 30);
  assert.equal(ledger.fortificationCount, fortifications.length);
  assert.equal(ledger.paidStructures, fortifications.length);
  assert.equal(ledger.deferredStructures, 0);
  assert.deepEqual(ledger.paidCost, { wood: 3, stone: 1.5 });
  assert.deepEqual(ledger.deferredCost, { wood: 0, stone: 0 });
  assert.equal(ledger.integrityLost, 0);
  assert.ok(Math.abs(kingdom.treasury.stock.wood - 97) < 1e-9);
  assert.ok(Math.abs(kingdom.treasury.stock.stone - 98.5) < 1e-9);
  assert.ok(world.events.some(event => event.day === 30 && event.text.includes('3 madeira e 1,5 pedra')));
});

test('fortification maintenance ledger keeps only its latest 24 monthly records', () => {
  const world = Sim.createWorld(42);
  const kingdom = world.kingdoms[0];

  for (let day = 30; day <= 780; day += 30) Sim.modules.KingdomCampaigns.maintainFortifications(world, day);

  assert.equal(kingdom.fortificationMaintenance.history.length, 24);
  assert.equal(kingdom.fortificationMaintenance.history[0].day, 90);
  assert.equal(kingdom.fortificationMaintenance.history.at(-1).day, 780);
});

test('a lethal border incursion kills the resident and records an invasion death', () => {
  const world = Sim.createWorld(42);
  world.day = 46;
  const [home, host] = world.kingdoms;
  const person = world.people.find(item => item.alive && item.kingdomId === home.id && item.role === 'resident');
  const relationKey = Math.min(home.id, host.id) + ':' + Math.max(home.id, host.id);
  world.kingdomRelations[relationKey] = {
    a: Math.min(home.id, host.id), b: Math.max(home.id, host.id), status: 'at-war',
    tension: 1, borderIncidents: 0, lastIncidentDay: 0, startedDay: 0
  };
  person.x = host.x;
  person.y = host.y;
  const guard = world.people.find(item => item.alive && item.kingdomId === host.id && item.id !== person.id);
  assert.ok(guard, 'host kingdom needs an available defender for lethal force');
  guard.role = 'soldier';
  guard.x = person.x;
  guard.y = person.y;
  person.territoryExposure = { ownerId: host.id, lastCheckDay: -1 };
  world.rngState = stateForTwoLowRolls();

  const incidents = resolveBorderIncursions(world, (target, cause) => killPerson(world, target, cause));

  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].killed, true);
  assert.equal(person.alive, false);
  assert.equal(person.deathCause, 'invasion');
  assert.equal(world.deaths, 1);
  assert.equal(world.deathsByCause.invasion, 1);
  assert.ok(!home.memberIds.includes(person.id));
});

test('human death events retain the observed vital conditions alongside the primary label', () => {
  const world = Sim.createWorld(42);
  const person = world.people.find(item => item.alive && item.role === 'resident');
  Object.assign(person, { ageDays: 20 * 365, health: 0, foodReserve: 0, hydration: 7.68, injury: 5.88, carriedFood: .4 });

  killPerson(world, person, 'injury');

  assert.deepEqual(person.deathDetails, {
    day: 1, cause: 'injury', ageDays: 20 * 365, health: 0,
    foodReserve: 0, hydration: 7.68, injury: 5.88, carriedFood: .4,
    recentHealth: { days: 30, losses: {}, recovery: {} }
  });
  assert.match(world.events[0].text, /morreu por ferimentos/);
  assert.match(world.events[0].text, /Valores observados no óbito: reserva alimentar 0\.0\/100; água 7\.7%; saúde 0\.0%; ferimentos 5\.9/);
});

test('recent health records distinguish applied losses, recovery and their source', () => {
  const world = Sim.createWorld(42);
  const person = world.people.find(item => item.alive && item.role === 'resident');
  person.health = 2;

  assert.equal(changePersonHealth(world, person, -5, 'starvation'), -2, 'record only health actually lost at zero');
  assert.equal(changePersonHealth(world, person, -1, 'dehydration'), 0, 'damage cannot pass below zero');
  assert.equal(changePersonHealth(world, person, 1, 'recovery'), 1);
  assert.equal(changePersonHealth(world, person, -.25, 'starvation'), -.25);
  world.day = 10;
  assert.equal(changePersonHealth(world, person, -.5, 'dehydration'), -.5);

  killPerson(world, person, 'injury');

  assert.deepEqual(person.deathDetails.recentHealth, {
    days: 30,
    losses: { dehydration: .5, starvation: 2.25 },
    recovery: { recovery: 1 }
  });
  assert.match(world.events[0].text, /perdas de saúde nos últimos 30 dias: desidratação 0\.50, falta de alimento 2\.25/);
  assert.match(world.events[0].text, /recuperação de saúde no período: recuperação geral 1\.00/);
});

test('health history expires entries older than the 30-day death window', () => {
  const world = Sim.createWorld(42);
  const person = world.people.find(item => item.alive && item.role === 'resident');

  changePersonHealth(world, person, -2, 'starvation');
  world.day = 30;
  changePersonHealth(world, person, -1, 'battle');
  killPerson(world, person, 'combat');

  assert.deepEqual(person.deathDetails.recentHealth, { days: 30, losses: { battle: 1 }, recovery: {} });
});

test('a border watch post expels a resident without lethal force when no soldier is nearby', () => {
  const world = Sim.createWorld(42);
  world.day = 46;
  const [home, host] = world.kingdoms;
  const person = world.people.find(item => item.alive && item.kingdomId === home.id && item.role === 'resident');
  const relationKey = Math.min(home.id, host.id) + ':' + Math.max(home.id, host.id);
  world.kingdomRelations[relationKey] = {
    a: Math.min(home.id, host.id), b: Math.max(home.id, host.id), status: 'at-war',
    tension: 1, borderIncidents: 0, lastIncidentDay: 0, startedDay: 0
  };
  for (const guard of world.people.filter(item => item.alive && item.kingdomId === host.id && item.role === 'soldier')) {
    guard.role = 'resident';
  }
  for (const structure of world.structures.filter(item => item.kingdomId === host.id
    && ['torre', 'centro_militar'].includes(item.type))) structure.complete = false;
  person.x = 0;
  person.y = 0;
  world.structures.push({ id: world.nextId++, type: 'torre', complete: true, kingdomId: host.id,
    x: person.x, y: person.y });
  person.territoryExposure = { ownerId: host.id, enteredDay: world.day - 2, lastCheckDay: -1 };
  world.rngState = stateForTwoLowRolls();

  const incidents = resolveBorderIncursions(world, (target, cause) => killPerson(world, target, cause));

  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].killed, false);
  assert.equal(person.alive, true);
  assert.equal(person.deathCause, undefined);
  assert.equal(world.deathsByCause.invasion || 0, 0);
  assert.equal(person.territoryExposure, null);
  assert.equal(person.territoryAwareness.caught, true);
});

test('an intruder is not detected where no soldier or watch post can observe them, even during war', () => {
  const world = Sim.createWorld(42);
  world.day = 46;
  const [home, host] = world.kingdoms;
  const person = world.people.find(item => item.alive && item.kingdomId === home.id && item.role === 'resident');
  const relationKey = Math.min(home.id, host.id) + ':' + Math.max(home.id, host.id);
  world.kingdomRelations[relationKey] = {
    a: Math.min(home.id, host.id), b: Math.max(home.id, host.id), status: 'at-war',
    tension: 1, borderIncidents: 0, lastIncidentDay: 0, startedDay: 0
  };
  for (const guard of world.people.filter(item => item.alive && item.kingdomId === host.id && item.role === 'soldier')) {
    guard.role = 'resident';
  }
  for (const structure of world.structures.filter(item => item.kingdomId === host.id
    && ['torre', 'centro_militar'].includes(item.type))) structure.complete = false;
  person.x = 0;
  person.y = 0;
  person.territoryExposure = { ownerId: host.id, enteredDay: world.day - 2, lastCheckDay: -1 };
  world.rngState = stateForTwoLowRolls();

  const incidents = resolveBorderIncursions(world, (target, cause) => killPerson(world, target, cause));

  assert.deepEqual(incidents, []);
  assert.equal(person.alive, true);
  assert.equal(person.territoryExposure.ownerId, host.id);
  assert.equal(world.borderIncidents, 0);
});
