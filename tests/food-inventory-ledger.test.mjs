import test from 'node:test';
import assert from 'node:assert/strict';
import { PLANTS } from '../src/config/ecosystem.js';
import { collectSheepFeed } from '../src/simulation/individuals/actions.js';
import { exchangeResources, transferCommunityFoodToReserve, transferFoodReserve, transferInventory, transferResource, transferStoresToInventory } from '../src/simulation/economy/inventories.js';
import { drawCampaignRation } from '../src/simulation/kingdoms/campaigns.js';
import { buyMilitaryMeal } from '../src/simulation/kingdoms/service.js';
import {
  recordFoodAuditCultivatedState, recordFoodAuditWorkObservation, registerFoodAuditCampaignSide, startFoodInventoryAudit
} from '../src/simulation/economy/food-audit-ledger.js';

function makeWorld() {
  const person = { id: 1, name: 'Alda', x: 0, y: 0, alive: true, communityId: 2, kingdomId: 3,
    foodReserve: 5, carriedFood: 0, carriedFruit: 0, carriedMeat: 0, carriedFeed: 0 };
  const community = { id: 2, name: 'Vila', x: 2, y: 3, kingdomId: 3, memberIds: [1], dissolved: false,
    stores: { food: 20, meat: 0, feed: 0, seeds: 5 } };
  const kingdom = { id: 3, name: 'Reino', communityId: 2,
    treasury: { stock: { food: 8, meat: 0, feed: 0, seeds: 0 } },
    market: { stock: { food: 10, meat: 0, feed: 2, seeds: 4 } } };
  const cropIndex = PLANTS.findIndex(plant => plant.id === 'cultivated-root');
  const plants = Array(PLANTS.length).fill(0);
  plants[cropIndex] = 7;
  const field = { id: 7, type: 'roça', name: 'Roça', x: 3, y: 3, communityId: 2, kingdomId: 3,
    complete: true, integrity: 1, cropSeedStored: 3, cropSeededBiomass: 7, cropYieldTarget: 70,
    cropHarvestedThisCycle: 0, foodDelivered: 0, cropCycleState: 'growing', fieldTileIndices: [0] };
  return { seed: 9, day: 0, width: 1, height: 1, people: [person], communities: [community], kingdoms: [kingdom],
    structures: [field], campaigns: [], loot: [], tiles: [{ i: 0, cropFieldId: 7, plants }],
    market: { food: 5, feed: 1 } };
}

test('records daily owner balances, transfers, blockers, routes and field biomass without losing access to state', () => {
  const world = makeWorld();
  const personDescriptor = Object.getOwnPropertyDescriptor(world.people[0], 'foodReserve');
  const peopleDescriptor = Object.getOwnPropertyDescriptor(world, 'people');
  const audit = startFoodInventoryAudit(world);
  audit.beginDay(1);
  world.people[0].navigationCongestion = { blockedDays: 3, key: 'field-route' };

  assert.equal(transferResource(world.communities[0].stores, world.people[0], 'food', 4,
    'carriedFood', 24, 'test-haul'), 4);
  world.communities[0].stores.food -= 2;
  assert.equal(transferResource(world.communities[0].stores, world.people[0], 'food', 30,
    'carriedFood', 4, 'blocked-haul'), 0);

  world.people[0].assignment = { action: 'forage', blockers: ['route_infeasible'] };
  world.people[0].state = 'rota bloqueada para coletar alimento';
  const newPerson = { id: 4, name: 'Bento', x: 4, y: 3, alive: true, communityId: 2, kingdomId: 3,
    foodReserve: 12, carriedFood: 0, carriedFruit: 0, carriedMeat: 0, carriedFeed: 0 };
  world.people.push(newPerson);
  newPerson.foodReserve -= 2;

  recordFoodAuditWorkObservation(world, 1);
  recordFoodAuditCultivatedState(world, 1);
  audit.endDay();
  const report = audit.finish();

  assert.equal(report.coverage.balanced, true);
  assert.equal(report.coverage.unbalancedAccountDays, 0);
  assert.equal(report.coverage.uninstrumentedPropertyCount, 0);
  const communityFoodIndex = report.accounts.find(account => account.ownerType === 'community'
    && account.ownerId === 2 && account.property === 'food').index;
  const personCargoIndex = report.accounts.find(account => account.ownerType === 'person'
    && account.ownerId === 1 && account.property === 'carriedFood').index;
  const communityFoodDay = report.accountDailyBalances.find(row => row[0] === 1 && row[1] === communityFoodIndex);
  const personCargoDay = report.accountDailyBalances.find(row => row[0] === 1 && row[1] === personCargoIndex);
  assert.equal(communityFoodDay[2], 20);
  assert.equal(communityFoodDay[4], 6);
  assert.equal(communityFoodDay[6], 14);
  assert.equal(personCargoDay[3], 4);
  assert.equal(personCargoDay[6], 4);

  const transfer = report.transactions.find(operation => operation.category === 'test-haul');
  assert.ok(transfer);
  assert.equal(transfer.source, communityFoodIndex);
  assert.equal(transfer.destination, personCargoIndex);
  assert.equal(transfer.moved, 4);
  assert.ok(Math.abs(transfer.route.straightLineDistance - Math.sqrt(13)) < 1e-6);
  assert.equal(transfer.route.blockedDays, 3);
  assert.ok(report.blockedOperations.some(operation => operation.reason === 'destination-capacity-full'));
  assert.ok(report.foodWorkObservations.some(item => item.personId === 1 && item.blockers.includes('route_infeasible')));
  assert.deepEqual(report.fieldDailyStates[0].slice(0, 7), [1, 7, 2, true, false, 1, 7]);

  const newbornFoodIndex = report.accounts.find(account => account.ownerType === 'person'
    && account.ownerId === 4 && account.property === 'foodReserve').index;
  const newbornFoodDay = report.accountDailyBalances.find(row => row[0] === 1 && row[1] === newbornFoodIndex);
  assert.equal(newbornFoodDay[2], 0);
  assert.equal(newbornFoodDay[3], 12);
  assert.equal(newbornFoodDay[4], 2);
  assert.equal(newbornFoodDay[6], 10);

  assert.equal(Object.getOwnPropertyDescriptor(world.people[0], 'foodReserve').get, undefined);
  assert.equal(Object.getOwnPropertyDescriptor(world, 'people').get, peopleDescriptor?.get);
  assert.equal(world.people[0].foodReserve, 5);
  assert.equal(world.people[1].foodReserve, 10);
  assert.equal(Object.getOwnPropertyDescriptor(world.people[0], 'foodReserve').value, personDescriptor.value);
});

test('community-to-treasury transfer accepts an audit category and records both owners', () => {
  const world = makeWorld();
  const destination = world.kingdoms[0].treasury;
  const audit = startFoodInventoryAudit(world);
  audit.beginDay(1);

  assert.equal(transferStoresToInventory(world.communities[0], destination, 'food', 4, 'test-community-to-kingdom'), 4);
  assert.equal(transferStoresToInventory(world.communities[0], destination, 'food', 0, 'zero-no-op'), 0);
  audit.endDay();
  const report = audit.finish();

  assert.equal(destination.stock.food, 12);
  const transfer = report.transactions.find(operation => operation.category === 'test-community-to-kingdom');
  assert.ok(transfer);
  assert.equal(transfer.kind, 'transfer');
  assert.equal(transfer.moved, 4);
  assert.equal(report.accounts[transfer.destination].ownerType, 'kingdom');
  assert.ok(!report.transactions.some(operation => operation.category === 'zero-no-op'));
  assert.ok(!report.blockedOperations.some(operation => operation.category === 'zero-no-op'));
  assert.ok(report.coverage.balanced);
});

test('food barter records both sides of the exchange as whole-unit costs', () => {
  const world = makeWorld();
  world.communities[0].stores.gold = 12;
  const audit = startFoodInventoryAudit(world);
  audit.beginDay(1);

  assert.equal(exchangeResources(world.communities[0].stores, { gold: 2 }, world.kingdoms[0].market.stock,
    { food: 3 }), true);
  audit.endDay();
  const report = audit.finish();
  const barter = report.transactions.find(operation => operation.category === 'barter');

  assert.ok(barter);
  assert.equal(barter.kind, 'exchange');
  assert.deepEqual(barter.firstGives, { gold: 2 });
  assert.deepEqual(barter.secondGives, { food: 3 });
  assert.equal(barter.moved, 3);
  assert.ok(report.coverage.balanced);
});

test('campaign attacker and defender supply accounts stay separate and reconcile', () => {
  const world = makeWorld();
  world.campaigns.push({ id: 9,
    attacker: { role: 'attacker', kingdomId: 3, supply: { stock: { food: 10, meat: 0, feed: 0, seeds: 0 } } },
    defender: { role: 'defender', kingdomId: 4, supply: { stock: { food: 20, meat: 0, feed: 0, seeds: 0 } } }
  });
  const audit = startFoodInventoryAudit(world);
  audit.beginDay(1);

  world.campaigns[0].attacker.supply.stock.food -= 3;
  world.campaigns[0].defender.supply.stock.food += 4;
  audit.endDay();
  const report = audit.finish();
  const sideAccounts = report.accounts.filter(account => account.ownerType === 'campaign-side' && account.resource === 'food');

  assert.equal(sideAccounts.length, 2);
  assert.deepEqual(new Set(sideAccounts.map(account => account.account)), new Set(['field-supply-attacker', 'field-supply-defender']));
  assert.ok(report.coverage.balanced);
  for (const account of sideAccounts) {
    const balance = report.accountDailyBalances.find(row => row[0] === 1 && row[1] === account.index);
    assert.equal(balance[7], 0);
    assert.equal(balance[8], true);
  }
  assert.equal(report.accountDailyBalances.find(row => row[1] === sideAccounts.find(account => account.account === 'field-supply-attacker').index)[6], 7);
  assert.equal(report.accountDailyBalances.find(row => row[1] === sideAccounts.find(account => account.account === 'field-supply-defender').index)[6], 24);
});

test('newborn food provisions register its reserve before the baby joins the world collection', () => {
  const world = makeWorld();
  const audit = startFoodInventoryAudit(world);
  audit.beginDay(1);
  const baby = { id: 4, name: 'Luz', alive: true, communityId: 2, kingdomId: 3, foodReserve: 0 };

  assert.equal(transferFoodReserve(world.people[0], baby, 3, 'birth-provisions'), 3);
  world.people.push(baby);
  audit.endDay();
  const report = audit.finish();
  const provision = report.transactions.find(operation => operation.category === 'birth-provisions');
  const babyAccount = report.accounts.find(account => account.ownerType === 'person'
    && account.ownerId === 4 && account.property === 'foodReserve');

  assert.ok(provision);
  assert.ok(babyAccount);
  assert.equal(provision.destination, babyAccount.index);
  assert.equal(report.accountDailyBalances.find(row => row[0] === 1 && row[1] === babyAccount.index)[6], 3);
  assert.equal(report.coverage.balanced, true);
  assert.equal(report.coverage.unbalancedAccountDays, 0);
});

test('campaign deployment registers a new field-supply account before funding it', () => {
  const world = makeWorld();
  const audit = startFoodInventoryAudit(world);
  audit.beginDay(1);
  const side = { campaignId: 9, kingdomId: 3, role: 'attacker',
    supply: { ownerType: 'field-supply', ownerId: 9, stock: { food: 0, meat: 0, feed: 0, seeds: 0 } } };

  registerFoodAuditCampaignSide(side);
  assert.equal(transferInventory(world.kingdoms[0].treasury, side.supply, 'food', 4, 'campaign-deployment'), 4);
  world.campaigns.push({ id: 9, attacker: side, defender: null });
  audit.endDay();
  const report = audit.finish();
  const deployment = report.transactions.find(operation => operation.category === 'campaign-deployment');
  const sideAccount = report.accounts.find(account => account.ownerType === 'campaign-side'
    && account.ownerId === 9 && account.account === 'field-supply-attacker' && account.property === 'food');

  assert.ok(deployment);
  assert.ok(sideAccount);
  assert.equal(deployment.destination, sideAccount.index);
  assert.equal(report.accountDailyBalances.find(row => row[0] === 1 && row[1] === sideAccount.index)[6], 4);
  assert.equal(report.coverage.balanced, true);
  assert.equal(report.coverage.unbalancedAccountDays, 0);
});

test('community meal links mixed community and shelter stocks to the recipient reserve', () => {
  const world = makeWorld();
  world.structures.push({ id: 8, type: 'abrigo', communityId: 2, complete: true, meatStored: 1 });
  const audit = startFoodInventoryAudit(world);
  audit.beginDay(1);

  const transfer = transferCommunityFoodToReserve(world, world.communities[0], world.people[0], 3,
    'resident-food-issue', 'resident-community-meal');
  audit.endDay();
  const report = audit.finish();
  const distribution = report.transactions.find(operation => operation.category === 'resident-community-meal'
    && operation.parentId == null);
  const recipient = report.accounts.find(account => account.ownerType === 'person'
    && account.ownerId === 1 && account.property === 'foodReserve');

  assert.equal(transfer.nutrition, 3);
  assert.equal(transfer.reserveAdded, 3);
  assert.ok(distribution);
  assert.equal(distribution.source.type, 'community-food-network');
  assert.equal(distribution.source.accounts.length, 2);
  assert.equal(distribution.destination, recipient.index);
  assert.ok(distribution.childIds.length > 0);
  assert.equal(report.coverage.balanced, true);
  assert.equal(report.coverage.unbalancedAccountDays, 0);
});

test('campaign rations debit field stock and credit the soldier in one traced parent', () => {
  const world = makeWorld();
  const person = world.people[0];
  person.role = 'soldier';
  person.campaignId = 9;
  const side = { campaignId: 9, kingdomId: 3, role: 'attacker', troopIds: [person.id],
    supply: { stock: { food: 5, meat: 0, feed: 0, seeds: 0 } },
    supplyLedger: { rationConsumptionFood: 0, personalReserveRationDays: 0 } };
  world.campaigns.push({ id: 9, status: 'marching', attacker: side,
    defender: { campaignId: 9, kingdomId: 4, role: 'defender', troopIds: [],
      supply: { stock: { food: 0, meat: 0, feed: 0, seeds: 0 } } } });
  const audit = startFoodInventoryAudit(world);
  audit.beginDay(1);

  assert.equal(drawCampaignRation(world, person, 2), 2);
  audit.endDay();
  const report = audit.finish();
  const transfer = report.transactions.find(operation => operation.category === 'campaign-ration'
    && operation.kind === 'campaign-ration-transfer' && operation.parentId == null);
  const sideAccount = report.accounts.find(account => account.ownerType === 'campaign-side'
    && account.ownerId === 9 && account.account === 'field-supply-attacker' && account.property === 'food');
  const recipient = report.accounts.find(account => account.ownerType === 'person'
    && account.ownerId === person.id && account.property === 'foodReserve');

  assert.ok(transfer);
  assert.equal(transfer.source, sideAccount.index);
  assert.equal(transfer.destination, recipient.index);
  assert.equal(person.foodReserve, 7);
  assert.equal(side.supply.stock.food, 3);
  assert.equal(report.coverage.balanced, true);
});

test('military market purchase links purchased food, gold cost and personal reserve', () => {
  const world = makeWorld();
  const person = world.people[0];
  person.role = 'soldier';
  person.militaryWallet = { stock: { gold: 10 } };
  world.kingdoms[0].market = { stock: { food: 5, meat: 0, feed: 0, seeds: 0, gold: 0 }, prices: { food: 2 } };
  const audit = startFoodInventoryAudit(world);
  audit.beginDay(1);

  assert.equal(buyMilitaryMeal(world, person, 3), 3);
  audit.endDay();
  const report = audit.finish();
  const purchase = report.transactions.find(operation => operation.category === 'military-market-meal'
    && operation.kind === 'market-meal-purchase' && operation.parentId == null);
  const marketFood = report.accounts.find(account => account.ownerType === 'kingdom'
    && account.ownerId === 3 && account.account === 'market-stock' && account.property === 'food');
  const recipient = report.accounts.find(account => account.ownerType === 'person'
    && account.ownerId === person.id && account.property === 'foodReserve');

  assert.ok(purchase);
  assert.equal(purchase.source, marketFood.index);
  assert.equal(purchase.destination, recipient.index);
  assert.deepEqual(purchase.costs, { gold: 6 });
  assert.equal(person.foodReserve, 8);
  assert.equal(world.kingdoms[0].market.stock.food, 2);
  assert.equal(report.coverage.balanced, true);
});

test('sheep browse harvest links shrub biomass to the collector feed cargo', () => {
  const world = makeWorld();
  const person = world.people[0];
  const community = world.communities[0];
  const browseIndex = PLANTS.findIndex(plant => plant.id === 'browse');
  const tiles = Array.from({ length: 9 }, (_, i) => ({ i, x: i % 3, y: Math.floor(i / 3), terrain: 'land',
    plants: Array(PLANTS.length).fill(0), detritusGPerM2: 0 }));
  const target = tiles[4];
  target.plants[browseIndex] = 30;
  world.width = 3;
  world.height = 3;
  world.tiles = tiles;
  world.day = 1;
  world.structures = [{ id: 9, type: 'curral', complete: true, communityId: community.id, x: 1, y: 1 }];
  person.x = 1;
  person.y = 1;
  person.energy = 50;
  person.skills = { care: .5 };
  const audit = startFoodInventoryAudit(world);
  audit.beginDay(1);

  const collected = collectSheepFeed(world, person, community, target);
  audit.endDay();
  const report = audit.finish();
  const harvest = report.transactions.find(operation => operation.kind === 'sheep-feed-foraging'
    && operation.parentId == null);
  const cargo = report.accounts.find(account => account.ownerType === 'person'
    && account.ownerId === person.id && account.property === 'carriedFeed');

  assert.ok(collected > 0);
  assert.ok(harvest);
  assert.deepEqual(harvest.source, { type: 'browse-plant-biomass', tileIndex: target.i,
    plantId: 'browse', communityId: community.id, biomassAmount: (30 - target.plants[browseIndex]),
    biomassUnit: 'plant-biomass', feedConversionFactor: .82 });
  assert.deepEqual(harvest.destination, { type: 'person-cargo', personId: person.id });
  const feedCredit = report.transactions.find(operation => harvest.childIds.includes(operation.id)
    && operation.destination === cargo.index);
  assert.ok(feedCredit);
  assert.equal(harvest.category, 'livestock-feed-gathering');
  assert.ok(harvest.childIds.length > 0);
  assert.ok(target.plants[browseIndex] < 30);
  assert.equal(person.carriedFeed, collected);
  assert.equal(report.coverage.balanced, true);
  assert.equal(report.coverage.unbalancedAccountDays, 0);
});
