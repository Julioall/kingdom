import Sim from '../src/simulation/engine.js';
import { applyFrontierLayout } from './frontier-layout.mjs';
import { observeKingdomStrategy, planKingdomStrategy } from '../src/simulation/kingdoms/strategy.js';

const seed = Math.max(1, Math.floor(Number(process.env.ECONOMY_SEED || 2026)));
const days = Math.max(1, Math.floor(Number(process.env.ECONOMY_DAYS || 730)));
const layout = process.env.ECONOMY_LAYOUT || 'frontier';
const traceDaily = process.env.ECONOMY_DAILY === '1';
const resources = ['food', 'wood', 'stone', 'gold', 'feed'];
const communityResources = ['food', 'meat', 'wood', 'stone', 'gold', 'feed', 'sheep'];
const tradeResources = ['food', 'meat', 'wood', 'stone', 'gold', 'feed', 'sheep'];
const round = value => Number((value || 0).toFixed(2));

function resourceBalances(account, keys) {
  return Object.fromEntries(keys.map(resource => [resource,
    account && Number.isFinite(account[resource]) ? account[resource] : 0]));
}

function kingdomAccountBalances(world, kingdom) {
  const community = world.communities.find(item => item.id === kingdom.communityId && !item.dissolved);
  return {
    community: resourceBalances(community && community.stores, communityResources),
    market: resourceBalances(kingdom.market && kingdom.market.stock, resources)
  };
}

function roundedBalances(balances, keys) {
  return Object.fromEntries(keys.map(resource => [resource, round(balances[resource])]));
}

function balanceDelta(before, after, keys) {
  return Object.fromEntries(keys.map(resource => [resource, round(after[resource] - before[resource])]));
}

function cloneCommunityFlows(flows = {}) {
  return Object.fromEntries(Object.entries(flows).map(([category, amounts]) => [category, { ...amounts }]));
}

function communityFlowDelta(previous = {}, current = {}) {
  const categories = new Set([...Object.keys(previous), ...Object.keys(current)]);
  return Object.fromEntries([...categories].map(category => {
    const previousAmounts = previous[category] || {};
    const currentAmounts = current[category] || {};
    const flowResources = new Set([...Object.keys(previousAmounts), ...Object.keys(currentAmounts)]);
    return [category, Object.fromEntries([...flowResources].map(resource => [resource,
      (currentAmounts[resource] || 0) - (previousAmounts[resource] || 0)]))];
  }));
}

function addCommunityFlows(target, delta) {
  for (const [category, amounts] of Object.entries(delta)) {
    target[category] ||= {};
    for (const [resource, amount] of Object.entries(amounts)) {
      target[category][resource] = (target[category][resource] || 0) + amount;
    }
  }
}

function roundedCommunityFlows(flows = {}) {
  return Object.fromEntries(Object.entries(flows).map(([category, amounts]) => [category,
    Object.fromEntries(Object.entries(amounts).map(([resource, amount]) => [resource, round(amount)])
      .filter(([, amount]) => amount !== 0))]).filter(([, amounts]) => Object.keys(amounts).length));
}

const world = Sim.createWorld(seed);
const layoutPlacements = layout === 'frontier' ? applyFrontierLayout(world) : [];
if (layout !== 'frontier' && layout !== 'default') {
  throw new Error(`ECONOMY_LAYOUT inválido: ${layout}`);
}

const previousStocks = new Map(world.kingdoms.map(kingdom => [kingdom.id, { ...kingdom.treasury.stock }]));
const openingStocks = Object.fromEntries(world.kingdoms.map(kingdom => [kingdom.name, { ...kingdom.treasury.stock }]));
const openingAccountStocks = new Map(world.kingdoms.map(kingdom => [kingdom.id, kingdomAccountBalances(world, kingdom)]));
const previousAccountStocks = new Map(world.kingdoms.map(kingdom => [kingdom.id, kingdomAccountBalances(world, kingdom)]));
const months = [], dailyRows = [];
const emptyTaxTotals = () => Object.fromEntries(resources.map(resource => [resource, 0]));
const emptyTradeBalances = () => Object.fromEntries(tradeResources.map(resource => [resource, 0]));
const emptyTradeTotals = () => ({
  marketTransactions: 0,
  communityBarters: 0,
  communityDelta: emptyTradeBalances(),
  marketDelta: emptyTradeBalances(),
  kingdomMarketDelta: emptyTradeBalances(),
  assetsCreated: {}
});
const communityFlowTotals = new Map();
const previousCommunityFlowTotals = new Map();
const kingdomCommunityFlowTotals = new Map(world.kingdoms.map(kingdom => [kingdom.id, {}]));
const treasuryFlowTotals = new Map();
const previousTreasuryFlowTotals = new Map();
const kingdomReadiness = new Map(world.kingdoms.map(kingdom => [kingdom.id, {
  constructionReadyDays: 0, activeProjectDaysWhenFoodPriorityWins: 0, lowSharedFoodDays: 0,
  constructionPlans: {}
}]));
function installCommunityFlowRecorder(community) {
  if (!community || community.economyFlowRecorder) return;
  Object.defineProperty(community, 'economyFlowRecorder', {
    configurable: true,
    enumerable: false,
    value(category, delta) {
      let totals = communityFlowTotals.get(community.id);
      if (!totals) { totals = {}; communityFlowTotals.set(community.id, totals); }
      totals[category] ||= {};
      for (const [resource, amount] of Object.entries(delta || {})) {
        totals[category][resource] = (totals[category][resource] || 0) + amount;
      }
    }
  });
}
function installTreasuryFlowRecorder(kingdom) {
  const treasury = kingdom && kingdom.treasury;
  if (!treasury || treasury.inventoryFlowRecorder) return;
  Object.defineProperty(treasury, 'inventoryFlowRecorder', {
    configurable: true,
    enumerable: false,
    value(category, delta) {
      let totals = treasuryFlowTotals.get(kingdom.id);
      if (!totals) { totals = {}; treasuryFlowTotals.set(kingdom.id, totals); }
      totals[category] ||= {};
      for (const [resource, amount] of Object.entries(delta || {})) {
        totals[category][resource] = (totals[category][resource] || 0) + amount;
      }
    }
  });
}
for (const community of world.communities) installCommunityFlowRecorder(community);
for (const kingdom of world.kingdoms) installTreasuryFlowRecorder(kingdom);
const monthlyTransfers = new Map(world.kingdoms.map(kingdom => [kingdom.id, {
  food: 0, feed: 0, emergencyFood: 0, routineFood: 0, feedTransfers: 0, count: 0,
  taxCollected: emptyTaxTotals(), taxCycles: 0, protectedTaxCycles: 0,
  trades: emptyTradeTotals(), communityFlows: {}, treasuryFlows: {}
}]));
const kingdomTaxTotals = new Map(world.kingdoms.map(kingdom => [kingdom.id, emptyTaxTotals()]));
const kingdomReserveTotals = new Map(world.kingdoms.map(kingdom => [kingdom.id, { food: 0, feed: 0, emergencyFood: 0, routineFood: 0, count: 0 }]));

for (let day = 0; day < days; day++) {
  const before = new Map(world.kingdoms.map(kingdom => {
    const community = world.communities.find(item => item.id === kingdom.communityId);
    return [kingdom.id, {
      treasuryFood: kingdom.treasury.stock.food,
      communityFood: community && community.stores.food || 0,
      communityMeat: community && community.stores.meat || 0,
      reserveTransfers: new Set(kingdom.reserveTransfers || []),
      taxRecords: new Set(kingdom.taxLedger && kingdom.taxLedger.history || []),
      tradeRecords: new Set(community && community.tradeLedger && community.tradeLedger.history || [])
    }];
  }));
  const previousEvents = traceDaily ? new Set(world.events) : null;
  for (const community of world.communities) installCommunityFlowRecorder(community);
  for (const kingdom of world.kingdoms) installTreasuryFlowRecorder(kingdom);
  Sim.stepDay(world);
  for (const kingdom of world.kingdoms) {
    const old = before.get(kingdom.id);
    const deliveries = (kingdom.reserveTransfers || []).filter(record => !old.reserveTransfers.has(record));
    const totals = monthlyTransfers.get(kingdom.id);
    for (const delivery of deliveries) {
      totals.food += delivery.food || 0;
      totals.feed += delivery.feed || 0;
      const reserveTotals = kingdomReserveTotals.get(kingdom.id);
      reserveTotals.food += delivery.food || 0;
      reserveTotals.feed += delivery.feed || 0;
      if (delivery.foodReason === 'emergency-community-below-one-day') totals.emergencyFood += delivery.food || 0;
      if (delivery.foodReason === 'emergency-community-below-one-day') reserveTotals.emergencyFood += delivery.food || 0;
      if (delivery.foodReason === 'restore-two-day-community-buffer') {
        totals.routineFood += delivery.food || 0;
        reserveTotals.routineFood += delivery.food || 0;
      }
      if (delivery.feed > .01) totals.feedTransfers++;
      totals.count++;
      reserveTotals.count++;
    }
    const taxRecords = (kingdom.taxLedger && kingdom.taxLedger.history || []).filter(record => !old.taxRecords.has(record));
    for (const record of taxRecords) {
      totals.taxCycles++;
      if (record.status === 'protected-reserve') totals.protectedTaxCycles++;
      for (const [resource, amount] of Object.entries(record.tax || {})) {
        if (resource in totals.taxCollected) {
          totals.taxCollected[resource] += amount || 0;
          kingdomTaxTotals.get(kingdom.id)[resource] += amount || 0;
        }
      }
    }
    const community = world.communities.find(item => item.id === kingdom.communityId);
    const previousFlows = previousCommunityFlowTotals.get(kingdom.communityId) || {};
    const currentFlows = communityFlowTotals.get(kingdom.communityId) || {};
    const flowDelta = communityFlowDelta(previousFlows, currentFlows);
    addCommunityFlows(totals.communityFlows, flowDelta);
    addCommunityFlows(kingdomCommunityFlowTotals.get(kingdom.id), flowDelta);
    previousCommunityFlowTotals.set(kingdom.communityId, cloneCommunityFlows(currentFlows));
    const previousTreasuryFlows = previousTreasuryFlowTotals.get(kingdom.id) || {};
    const currentTreasuryFlows = treasuryFlowTotals.get(kingdom.id) || {};
    addCommunityFlows(totals.treasuryFlows, communityFlowDelta(previousTreasuryFlows, currentTreasuryFlows));
    previousTreasuryFlowTotals.set(kingdom.id, cloneCommunityFlows(currentTreasuryFlows));
    const report = observeKingdomStrategy(world, kingdom.id);
    if (report) {
      const readiness = kingdomReadiness.get(kingdom.id);
      const plan = report.community.buildPlan;
      if (report.community.foodPerResident < 8) readiness.lowSharedFoodDays++;
      if (report.community.constructionReady) {
        readiness.constructionReadyDays++;
        const type = plan && plan.type || 'unknown';
        readiness.constructionPlans[type] = (readiness.constructionPlans[type] || 0) + 1;
        if (plan && plan.type === 'ongoing' && planKingdomStrategy(report).action !== 'build') {
          readiness.activeProjectDaysWhenFoodPriorityWins++;
        }
      }
    }
    const tradeRecords = (community && community.tradeLedger && community.tradeLedger.history || [])
      .filter(record => !old.tradeRecords.has(record));
    for (const record of tradeRecords) {
      const tradeTotals = totals.trades;
      if (record.kind === 'market') tradeTotals.marketTransactions++;
      else if (record.kind === 'community-barter') tradeTotals.communityBarters++;
      const participant = (record.participants || []).find(item => item.communityId === (community && community.id));
      for (const [resource, amount] of Object.entries(participant && participant.delta || {})) {
        if (resource in tradeTotals.communityDelta) tradeTotals.communityDelta[resource] += amount || 0;
      }
      for (const [resource, amount] of Object.entries(record.market && record.market.delta || {})) {
        if (resource in tradeTotals.marketDelta) tradeTotals.marketDelta[resource] += amount || 0;
        if (record.market && record.market.ownerId === kingdom.id && resource in tradeTotals.kingdomMarketDelta) {
          tradeTotals.kingdomMarketDelta[resource] += amount || 0;
        }
      }
      for (const asset of record.assetsCreated || []) {
        if (asset.type === 'animal') tradeTotals.assetsCreated[asset.speciesId] =
          (tradeTotals.assetsCreated[asset.speciesId] || 0) + (asset.count || 1);
      }
    }
  }
  if (traceDaily) for (const kingdom of world.kingdoms) {
    const community = world.communities.find(item => item.id === kingdom.communityId);
    const old = before.get(kingdom.id);
    dailyRows.push({
      day: world.day,
      kingdom: kingdom.name,
      treasuryFoodBefore: round(old.treasuryFood),
      treasuryFoodAfter: round(kingdom.treasury.stock.food),
      treasuryFoodDelta: round(kingdom.treasury.stock.food - old.treasuryFood),
      treasuryFoodBeforeExact: old.treasuryFood,
      treasuryFoodAfterExact: kingdom.treasury.stock.food,
      treasuryFoodDeltaExact: kingdom.treasury.stock.food - old.treasuryFood,
      communityFoodBefore: round(old.communityFood),
      communityFoodAfter: round(community && community.stores.food),
      communityMeatBefore: round(old.communityMeat),
      communityMeatAfter: round(community && community.stores.meat),
      reserveTransfers: (kingdom.reserveTransfers || []).filter(record => !old.reserveTransfers.has(record)),
      taxRecords: (kingdom.taxLedger && kingdom.taxLedger.history || []).filter(record => !old.taxRecords.has(record)),
      tradeRecords: (community && community.tradeLedger && community.tradeLedger.history || [])
        .filter(record => !old.tradeRecords.has(record)),
      newEvents: world.events.filter(event => !previousEvents.has(event) && event.text.includes(kingdom.name))
        .map(event => ({ day: event.day, text: event.text }))
    });
  }
  if (world.day % 30 !== 0 && world.day !== days) continue;

  const kingdoms = world.kingdoms.map(kingdom => {
    const stock = kingdom.treasury.stock;
    const previous = previousStocks.get(kingdom.id);
    const ledger = (kingdom.fortificationMaintenance && kingdom.fortificationMaintenance.history || []).at(-1);
    const netChange = Object.fromEntries(resources.map(resource => [resource, round(stock[resource] - previous[resource])]));
    const paidMaintenance = ledger && ledger.day === world.day ? ledger.paidCost : { wood: 0, stone: 0 };
    const outsideMaintenanceNet = {
      wood: round(netChange.wood + paidMaintenance.wood),
      stone: round(netChange.stone + paidMaintenance.stone)
    };
    for (const resource of resources) previous[resource] = stock[resource];

    const community = world.communities.find(item => item.id === kingdom.communityId);
    const accounts = kingdomAccountBalances(world, kingdom);
    const previousAccounts = previousAccountStocks.get(kingdom.id);
    const communityNetChange = balanceDelta(previousAccounts.community, accounts.community, communityResources);
    const marketNetChange = balanceDelta(previousAccounts.market, accounts.market, resources);
    const members = world.people.filter(person => person.alive && person.kingdomId === kingdom.id);
    const completeFortifications = world.structures.filter(structure => structure.complete
      && structure.kingdomId === kingdom.id
      && ['castelo', 'torre', 'centro_militar'].includes(structure.type)).length;
    const outposts = world.structures.filter(structure => structure.complete
      && structure.kingdomId === kingdom.id && structure.frontierOutpost).length;
    previousAccountStocks.set(kingdom.id, accounts);

    return {
      name: kingdom.name,
      population: members.length,
      communityFood: round(community && community.stores.food),
      communityStores: roundedBalances(accounts.community, communityResources),
      communityNetChange,
      marketStock: roundedBalances(accounts.market, resources),
      marketNetChange,
      treasury: Object.fromEntries(resources.map(resource => [resource, round(stock[resource])])),
      netChange,
      paidMaintenance: { wood: round(paidMaintenance.wood), stone: round(paidMaintenance.stone) },
      deferredMaintenance: ledger && ledger.day === world.day
        ? { wood: ledger.deferredCost.wood, stone: ledger.deferredCost.stone, structures: ledger.deferredStructures }
        : { wood: 0, stone: 0, structures: 0 },
      maintenanceIntegrityLost: ledger && ledger.day === world.day ? ledger.integrityLost : 0,
      netChangeOutsideMaintenance: outsideMaintenanceNet,
      reserveTransfers: {
        food: round(monthlyTransfers.get(kingdom.id).food),
        feed: round(monthlyTransfers.get(kingdom.id).feed),
        emergencyFood: round(monthlyTransfers.get(kingdom.id).emergencyFood),
        routineFood: round(monthlyTransfers.get(kingdom.id).routineFood),
        feedTransfers: monthlyTransfers.get(kingdom.id).feedTransfers,
        count: monthlyTransfers.get(kingdom.id).count
      },
      taxCollected: Object.fromEntries(resources.map(resource => [resource, round(monthlyTransfers.get(kingdom.id).taxCollected[resource])])),
      taxCycles: monthlyTransfers.get(kingdom.id).taxCycles,
      protectedTaxCycles: monthlyTransfers.get(kingdom.id).protectedTaxCycles,
      communityFlows: roundedCommunityFlows(monthlyTransfers.get(kingdom.id).communityFlows),
      treasuryFlows: roundedCommunityFlows(monthlyTransfers.get(kingdom.id).treasuryFlows),
      tradeLedger: {
        marketTransactions: monthlyTransfers.get(kingdom.id).trades.marketTransactions,
        communityBarters: monthlyTransfers.get(kingdom.id).trades.communityBarters,
        communityDelta: Object.fromEntries(tradeResources.map(resource => [resource,
          round(monthlyTransfers.get(kingdom.id).trades.communityDelta[resource])])),
        marketDelta: Object.fromEntries(tradeResources.map(resource => [resource,
          round(monthlyTransfers.get(kingdom.id).trades.marketDelta[resource])])),
        kingdomMarketDelta: Object.fromEntries(tradeResources.map(resource => [resource,
          round(monthlyTransfers.get(kingdom.id).trades.kingdomMarketDelta[resource])])),
        assetsCreated: { ...monthlyTransfers.get(kingdom.id).trades.assetsCreated }
      },
      completeFortifications,
      outposts,
      frontierStatus: kingdom.frontierExpansion && kingdom.frontierExpansion.status,
      frontierReason: kingdom.frontierExpansion && kingdom.frontierExpansion.reason
    };
  });
  months.push({ day: world.day, periodDays: world.day % 30 || 30, kingdoms });
  for (const kingdom of world.kingdoms) monthlyTransfers.set(kingdom.id, {
    food: 0, feed: 0, emergencyFood: 0, routineFood: 0, feedTransfers: 0, count: 0,
    taxCollected: emptyTaxTotals(), taxCycles: 0, protectedTaxCycles: 0,
    trades: emptyTradeTotals(), communityFlows: {}, treasuryFlows: {}
  });
}

if (traceDaily) for (const row of dailyRows) console.log(JSON.stringify({ type: 'day', ...row }));
for (const month of months) for (const kingdom of month.kingdoms) {
  console.log(JSON.stringify({
    type: 'month', day: month.day, periodDays: month.periodDays, kingdom: kingdom.name, treasury: kingdom.treasury,
    population: kingdom.population, communityStores: kingdom.communityStores,
    communityNetChange: kingdom.communityNetChange,
    marketStock: kingdom.marketStock, marketNetChange: kingdom.marketNetChange,
    netChange: kingdom.netChange, paidMaintenance: kingdom.paidMaintenance,
    reserveTransfers: kingdom.reserveTransfers,
    taxCollected: kingdom.taxCollected,
    taxCycles: kingdom.taxCycles,
    protectedTaxCycles: kingdom.protectedTaxCycles,
    communityFlows: kingdom.communityFlows,
    treasuryFlows: kingdom.treasuryFlows,
    tradeLedger: kingdom.tradeLedger,
    deferredMaintenance: kingdom.deferredMaintenance,
    maintenanceIntegrityLost: kingdom.maintenanceIntegrityLost,
    fortifications: kingdom.completeFortifications, outposts: kingdom.outposts,
    frontierStatus: kingdom.frontierStatus, frontierReason: kingdom.frontierReason
  }));
}

const totals = world.kingdoms.map(kingdom => {
  const rows = months.map(month => month.kingdoms.find(item => item.name === kingdom.name));
  const sum = (field, resource) => round(rows.reduce((total, row) => total + (row[field][resource] || 0), 0));
  const stock = rows.at(-1) && rows.at(-1).treasury;
  const openingAccounts = openingAccountStocks.get(kingdom.id);
  const closingAccounts = kingdomAccountBalances(world, kingdom);
  const accountBalances = {
    community: {
      opening: roundedBalances(openingAccounts.community, communityResources),
      closing: roundedBalances(closingAccounts.community, communityResources),
      netChange: balanceDelta(openingAccounts.community, closingAccounts.community, communityResources)
    },
    market: {
      opening: roundedBalances(openingAccounts.market, resources),
      closing: roundedBalances(closingAccounts.market, resources),
      netChange: balanceDelta(openingAccounts.market, closingAccounts.market, resources)
    }
  };
  const communityStructures = world.structures.filter(item => item.communityId === kingdom.communityId);
  const reserveTransfers = {
    ...kingdomReserveTotals.get(kingdom.id)
  };
  const taxCollected = Object.fromEntries(resources.map(resource => [resource,
    round(kingdomTaxTotals.get(kingdom.id)[resource] || 0)]));
  const tradeLedger = {
    marketTransactions: rows.reduce((total, row) => total + row.tradeLedger.marketTransactions, 0),
    communityBarters: rows.reduce((total, row) => total + row.tradeLedger.communityBarters, 0),
    communityDelta: Object.fromEntries(tradeResources.map(resource => [resource,
      round(rows.reduce((total, row) => total + (row.tradeLedger.communityDelta[resource] || 0), 0))])),
    marketDelta: Object.fromEntries(tradeResources.map(resource => [resource,
      round(rows.reduce((total, row) => total + (row.tradeLedger.marketDelta[resource] || 0), 0))])),
    kingdomMarketDelta: Object.fromEntries(tradeResources.map(resource => [resource,
      round(rows.reduce((total, row) => total + (row.tradeLedger.kingdomMarketDelta[resource] || 0), 0))])),
    assetsCreated: Object.fromEntries([...new Set(rows.flatMap(row => Object.keys(row.tradeLedger.assetsCreated || {})))].map(speciesId => [speciesId,
      rows.reduce((total, row) => total + ((row.tradeLedger.assetsCreated || {})[speciesId] || 0), 0)]))
  };
  const communityFlowTotalsForKingdom = kingdomCommunityFlowTotals.get(kingdom.id) || {};
  const communityFlows = roundedCommunityFlows(communityFlowTotalsForKingdom);
  const treasuryFlowTotalsForKingdom = treasuryFlowTotals.get(kingdom.id) || {};
  const treasuryFlows = roundedCommunityFlows(treasuryFlowTotalsForKingdom);
  const treasuryFlowNetExact = Object.fromEntries(resources.map(resource => [resource,
    Object.values(treasuryFlowTotalsForKingdom).reduce((total, amounts) => total + (amounts[resource] || 0), 0)]));
  const paidMaintenance = { wood: sum('paidMaintenance', 'wood'), stone: sum('paidMaintenance', 'stone') };
  const treasuryReconciliation = Object.fromEntries(resources.map(resource => {
    const opening = openingStocks[kingdom.name][resource] || 0;
    const taxInExact = kingdomTaxTotals.get(kingdom.id)[resource] || 0;
    const reserveOut = resource === 'food' ? reserveTransfers.food : resource === 'feed' ? reserveTransfers.feed : 0;
    const maintenanceOut = resource === 'wood' ? paidMaintenance.wood : resource === 'stone' ? paidMaintenance.stone : 0;
    const closing = kingdom.treasury.stock[resource] || 0;
    return [resource, {
      opening: round(opening), taxIn: round(taxInExact), inventoryFlowNet: round(treasuryFlowNetExact[resource]),
      reserveOut: round(reserveOut), maintenanceOut: round(maintenanceOut),
      closing: round(closing),
      unexplainedNet: round(opening + taxInExact + treasuryFlowNetExact[resource] - closing)
    }];
  }));
  const communityReconciliation = Object.fromEntries(communityResources.map(resource => {
    const opening = openingAccounts.community[resource] || 0;
    const tradeNet = tradeLedger.communityDelta[resource] || 0;
    const reserveIn = resource === 'food' ? reserveTransfers.food : resource === 'feed' ? reserveTransfers.feed : 0;
    const taxOutExact = kingdomTaxTotals.get(kingdom.id)[resource] || 0;
    const closing = closingAccounts.community[resource] || 0;
    const operationNetExact = Object.values(communityFlowTotalsForKingdom)
      .reduce((sum, amounts) => sum + (amounts[resource] || 0), 0);
    const otherNetExact = closing - opening - tradeNet - reserveIn + taxOutExact;
    return [resource, {
      opening: round(opening), tradeNet: round(tradeNet), reserveIn: round(reserveIn), taxOut: round(taxOutExact),
      closing: round(closing), operationNet: round(operationNetExact), otherNet: round(otherNetExact),
      unattributedNet: round(otherNetExact - operationNetExact)
    }];
  }));
  const marketReconciliation = Object.fromEntries(resources.map(resource => {
    const opening = openingAccounts.market[resource] || 0;
    const tradeNet = tradeLedger.kingdomMarketDelta[resource] || 0;
    const closing = closingAccounts.market[resource] || 0;
    return [resource, { opening: round(opening), tradeNet: round(tradeNet), closing: round(closing),
      unexplainedNet: round(opening + tradeNet - closing) }];
  }));
  return {
    name: kingdom.name,
    population: rows.at(-1) && rows.at(-1).population,
    opening: openingStocks[kingdom.name],
    closing: stock,
    communityStructures: communityStructures.map(item => ({
      type: item.type, complete: !!item.complete, createdDay: item.createdDay, builtDay: item.builtDay ?? null,
      progress: item.progress ?? null, required: item.required ?? null
    })),
    growthReadiness: kingdomReadiness.get(kingdom.id),
    strategy: kingdom.strategy ? {
      goal: kingdom.strategy.goal, action: kingdom.strategy.action,
      sinceDay: kingdom.strategy.sinceDay, evaluatedDay: kingdom.strategy.evaluatedDay,
      lastOutcome: kingdom.strategy.lastOutcome || null,
      history: (kingdom.strategy.history || []).slice(-4)
    } : null,
    accountBalances,
    reserveTransfers,
    taxCollected,
    tradeLedger,
    communityFlows,
    treasuryFlows,
    taxCycles: rows.reduce((total, row) => total + row.taxCycles, 0),
    protectedTaxCycles: rows.reduce((total, row) => total + row.protectedTaxCycles, 0),
    communityReconciliation,
    marketReconciliation,
    paidMaintenance,
    treasuryReconciliation,
    deferredMaintenance: { wood: sum('deferredMaintenance', 'wood'), stone: sum('deferredMaintenance', 'stone') },
    maintenanceIntegrityLost: round(rows.reduce((total, row) => total + row.maintenanceIntegrityLost, 0)),
    monthsWithDeferrals: rows.filter(row => row.deferredMaintenance.structures > 0).length,
    establishedOutposts: Math.max(0, ...rows.map(row => row.outposts))
  };
});
console.log(JSON.stringify({ type: 'summary', seed, days: world.day, layout, layoutPlacements,
  deathsByCause: { ...world.deathsByCause },
  plantFoodHarvested: round(world.harvests.plantFoodBiomass || 0),
  humanFoodRegrowth: round(world.ecologyFlows.humanFoodRegrowth || 0),
  humanFoodNaturalLoss: round(world.ecologyFlows.humanFoodNaturalLoss || 0),
  humanFoodSettlementLoss: round(world.ecologyFlows.humanFoodSettlementLoss || 0),
  humanFoodEcologicalLoss: round(world.ecologyFlows.humanFoodEcologicalLoss || 0), totals }));
