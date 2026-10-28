import test from 'node:test';
import assert from 'node:assert/strict';
import { PLANTS } from '../src/config/ecosystem.js';
import { exchangeResources, transferFoodReserve, transferInventory, transferResource, transferStoresToInventory } from '../src/simulation/economy/inventories.js';
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
