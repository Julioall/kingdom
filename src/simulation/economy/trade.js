import { clamp, distance } from '../core/math.js';
import { communityRelation } from '../society/governance.js';
import { domesticatedSheep, makeAnimal } from '../ecology/animals.js';
import { communityFoodStock, consumeStoreInventory, exchangeResources, removeStoredFruit, stockSurplus, transferCommunityFood, transferFoodReserve, transferResource } from './inventories.js';
import { getSocialLink } from '../society/communities.js';
import { availableCommunityPen, reconcileCommunityHerdPens } from '../ecology/herd.js';
import { nearestPenFor } from '../individuals/actions.js';
import { cellAt, cellsWithin } from '../world/spatial.js';
import { FOOD_DAYS_PER_UNIT, MEAT_NUTRITIONAL_VALUE } from '../../config/ecosystem.js';
import { log } from '../core/events.js';
import { moveOne } from '../individuals/movement.js';
import { recordTrade } from './trade-ledger.js';
import { goldPriceToCopper, quoteCoinPayment, settleCoinTrade } from './coin-payments.js';
import { consumePersonEnergy } from '../individuals/energy.js';
import { shareFoodAidKnowledge } from '../society/plan-execution.js';
import {
  SOCIAL_ACTIVE_INTENTION_PER_PERSON_LIMIT, SOCIAL_OPEN_COMMITMENT_PER_PERSON_LIMIT,
  acceptSocialCommitment, advanceSocialIntention,
  cancelSocialCommitment, defineSocialIntention, fulfillSocialCommitment, getSocialCommitment,
  proposeSocialCommitment, recordSocialBeliefEvidence, recordSocialFact, rejectSocialCommitment,
  pruneSocialEvidence, rememberSocialFact, updateDirectedSocialRelationship
} from '../society/social-evidence.js';

const RESOURCE_LABELS = Object.freeze({
  food: ['unidade de alimento', 'unidades de alimento'],
  wood: ['unidade de madeira', 'unidades de madeira'],
  stone: ['unidade de pedra', 'unidades de pedra'],
  gold: ['unidade de ouro', 'unidades de ouro'],
  copper: ['moeda de cobre', 'moedas de cobre'],
  silver: ['moeda de prata', 'moedas de prata'],
  iron: ['unidade de ferro', 'unidades de ferro'],
  feed: ['unidade de ração', 'unidades de ração']
});
const TRADE_RESOURCES = Object.freeze(['food', 'meat', 'wood', 'stone', 'gold', 'silver', 'copper', 'iron', 'feed', 'sheep']);
const MARKET_PURCHASES = Object.freeze({
  food: Object.freeze({ amount: 12, gold: 6, reserve: 32 }),
  wood: Object.freeze({ amount: 10, gold: 6, reserve: 18 }),
  stone: Object.freeze({ amount: 8, gold: 7, reserve: 12 }),
  feed: Object.freeze({ amount: 10, gold: 4, reserve: 18 }),
  sheep: Object.freeze({ amount: 1, gold: 38 })
});
const MARKET_SALES = Object.freeze([
  Object.freeze({ resource: 'food', amount: 10, gold: 4, reserve: 44, capacity: 260 }),
  Object.freeze({ resource: 'wood', amount: 8, gold: 4, reserve: 28, capacity: 260 }),
  Object.freeze({ resource: 'stone', amount: 6, gold: 5, reserve: 24, capacity: 260 }),
  Object.freeze({ resource: 'feed', amount: 10, gold: 3, reserve: 30, capacity: 260 }),
  Object.freeze({ resource: 'iron', amount: 4, reserve: 10, capacity: 260, dynamicPrice: true })
]);

function accountAmount(account, resource) {
  const amount = account?.[resource] ?? 0;
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function canSpend(account, resource, amount) {
  const available = accountAmount(account, resource);
  return available !== null && available >= amount;
}

function canReceiveUpTo(account, resource, amount, capacity) {
  const available = accountAmount(account, resource);
  return available !== null && available + amount <= capacity;
}

function countTradeDiagnostic(world, field, reason = null) {
  const diagnostics = world?.tradeDiagnostics;
  if (!diagnostics) return;
  if (reason) {
    const counts = diagnostics[field] ||= {};
    counts[reason] = (counts[reason] || 0) + 1;
  } else diagnostics[field] = (Number(diagnostics[field]) || 0) + 1;
}

function formatTradeAmount(amount) {
  return Number(amount.toFixed(2)).toString().replace('.', ',');
}

function describeStoreChanges(before, after) {
  const given = [], received = [];
  for (const resource of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const change = (after[resource] || 0) - (before[resource] || 0);
    if (Math.abs(change) <= .001) continue;
    const labels = RESOURCE_LABELS[resource] || ['unidade de ' + resource, 'unidades de ' + resource];
    const amount = Math.abs(change);
    const units = Math.abs(amount - 1) < .001 ? labels[0] : labels[1];
    (change < 0 ? given : received).push(formatTradeAmount(amount) + ' ' + units);
  }
  return [given.length ? 'entregou ' + given.join(' e ') : null,
    received.length ? 'recebeu ' + received.join(' e ') : null].filter(Boolean).join(' e ');
}

function tradeBalances(account) {
  return Object.fromEntries(TRADE_RESOURCES.filter(resource => Number.isFinite(account && account[resource]))
    .map(resource => [resource, account[resource]]));
}

function tradeDelta(before, after) {
  const changes = {};
  for (const resource of TRADE_RESOURCES) {
    const change = (after[resource] || 0) - (before[resource] || 0);
    if (Math.abs(change) > .001) changes[resource] = change;
  }
  return changes;
}

function communitiesHaveClosedBorder(w, first, second) {
  const firstKingdom = (w.kingdoms || []).find(item => item.communityId === first.id);
  const secondKingdom = (w.kingdoms || []).find(item => item.communityId === second.id);
  if (!firstKingdom || !secondKingdom || firstKingdom.id === secondKingdom.id) return false;
  const low = Math.min(firstKingdom.id, secondKingdom.id);
  const high = Math.max(firstKingdom.id, secondKingdom.id);
  return w.kingdomRelations && w.kingdomRelations[low + ':' + high]?.borderClosed === true;
}


// A resident's physical cargo is a different owner from the shared community stock.
// Never convert crop history or a community reserve into personal saleable property.
const PERSONAL_SALE_FLOOR = 12;
const PERSONAL_MARKET_LOT = 4;

// Opt in only when physically owned smaller denominations are present (or when
// the account explicitly enables coin mode). Historical fractional gold stays
// on the legacy path and never gets silently turned into integer coins.
function hasCoinFunds(account) {
  return account?.coinMode === true || (Number.isSafeInteger(account?.copper) && account.copper > 0)
    || (Number.isSafeInteger(account?.silver) && account.silver > 0);
}

function coinPurchaseOffer(payer, market, resource, amount, goldPrice) {
  if (!hasCoinFunds(payer) || !Number.isSafeInteger(amount) || amount <= 0
      || !canSpend(market, resource, amount)) return null;
  const priceCopper = goldPriceToCopper(goldPrice);
  if (!priceCopper || !canReceiveUpTo(payer, resource, amount, Infinity)) return null;
  const quote = quoteCoinPayment(payer, market, priceCopper);
  return quote ? { resource, amount, priceCopper, quote } : null;
}

function coinMarketNeeds(store, pen, herd) {
  return [
    { resource: 'food', label: 'alimento', needed: (store.food || 0) + (store.meat || 0) * MEAT_NUTRITIONAL_VALUE < MARKET_PURCHASES.food.reserve },
    { resource: 'wood', label: 'madeira', needed: (store.wood || 0) < MARKET_PURCHASES.wood.reserve },
    { resource: 'stone', label: 'pedra', needed: (store.stone || 0) < MARKET_PURCHASES.stone.reserve },
    { resource: 'feed', label: 'ração', needed: !!pen && herd > 0 && (store.feed || 0) < MARKET_PURCHASES.feed.reserve }
  ];
}

function marketSaleGold(sale, marketOwner) {
  if (!sale.dynamicPrice) return sale.gold;
  const price = marketOwner?.prices?.[sale.resource];
  return Number.isFinite(price) && price > 0 ? sale.amount * price / 2 : null;
}

function personalMarketOffer(world, community, person, marketOwner) {
  const market = marketOwner?.stock || marketOwner;
  if (!person?.alive || person.role === 'soldier' || person.communityId !== community?.id
      || !(world.people || []).includes(person) || !(world.communities || []).includes(community)
      || community.dissolved || !market || !marketOwner?.prices) return null;
  const kingdom = (world.kingdoms || []).find(item => item.communityId === community.id);
  if (kingdom && (kingdom.market !== marketOwner || marketOwner.ownerId !== kingdom.id)) return null;
  if (kingdom && person.kingdomId != null && person.kingdomId !== kingdom.id) return null;
  if (!kingdom && person.kingdomId != null) return null;
  // Mined gold is physical cargo, not money owned by the resident. A legacy
  // save without a personal wallet has zero spendable funds until a real sale.
  // Do not migrate carriedGold into the wallet or borrow shared inventories.
  const wallet = person.personalWallet == null ? { gold: 0 } : person.personalWallet?.stock;
  if (!wallet || typeof wallet !== 'object' || Array.isArray(wallet)
      || wallet === person || wallet === market || wallet === community.stores) return null;
  const foodPrice = marketOwner.prices.food;
  const foodAmount = accountAmount(market, 'food');
  const goldHeld = accountAmount(wallet, 'gold');
  const reserve = accountAmount(person, 'foodReserve');
  const coinMode = hasCoinFunds(wallet);
  if (coinMode && reserve !== null && reserve < 60 && foodAmount !== null && Number.isFinite(foodPrice)) {
    const maxUnits = Math.min(PERSONAL_MARKET_LOT, Math.floor(foodAmount),
      Math.floor((100 - reserve) / FOOD_DAYS_PER_UNIT));
    for (let units = maxUnits; units >= 1; units--) {
      const priceCopper = goldPriceToCopper(foodPrice, units);
      if (priceCopper && quoteCoinPayment(wallet, market, priceCopper))
        return { action: 'buy-food-coins', amount: units, priceCopper };
    }
  }
  if (!coinMode && Number.isFinite(foodPrice) && foodPrice > 0 && foodAmount !== null
      && goldHeld !== null && reserve !== null && reserve < 60) {
    const units = Math.min(PERSONAL_MARKET_LOT, foodAmount,
      Math.max(0, (100 - reserve) / FOOD_DAYS_PER_UNIT), goldHeld / foodPrice);
    if (units > .01 && canReceiveUpTo(market, 'gold', units * foodPrice, Infinity)) {
      return { action: 'buy-food', amount: units, gold: units * foodPrice };
    }
  }
  for (const resource of ['wood', 'stone', 'iron']) {
    const carried = accountAmount(person, 'carried' + resource[0].toUpperCase() + resource.slice(1));
    const marketAmount = accountAmount(market, resource);
    const price = marketOwner.prices[resource];
    if (carried === null || marketAmount === null || !Number.isFinite(price) || price <= 0) continue;
    const amount = Math.min(PERSONAL_MARKET_LOT,
      carried - (resource === 'iron' ? 4 : PERSONAL_SALE_FLOOR),
      Math.max(0, 260 - marketAmount));
    const gold = amount * price / 2;
    if (coinMode) {
      const priceCopper = goldPriceToCopper(gold);
      if (amount > .01 && priceCopper && quoteCoinPayment(market, wallet, priceCopper))
        return { action: 'sell-coins-' + resource, resource, amount, priceCopper };
    } else if (amount > .01 && canSpend(market, 'gold', gold)
        && canReceiveUpTo(wallet, 'gold', gold, Infinity)) {
      return { action: 'sell-' + resource, resource, amount, gold };
    }
  }
  return null;
}

function executePersonalMarketTrade(world, person, community, marketOwner) {
  const offer = personalMarketOffer(world, community, person, marketOwner);
  if (!offer) return false;
  const market = marketOwner.stock || marketOwner;
  // Only create a zeroed account after a valid trade is preflighted.
  // Older saves keep their mined cargo untouched.
  person.personalWallet ||= { stock: { gold: 0 } };
  const wallet = person.personalWallet.stock;
  const before = tradeBalances(market);
  let movedResource = 0, movedGold = 0, coinReceipt = null;
  if (offer.action === 'buy-food-coins') {
    coinReceipt = settleCoinTrade(wallet, market, offer.priceCopper,
      market, person, 'food', offer.amount, 100, 'foodReserve');
    if (!coinReceipt) return false;
    movedResource = offer.amount;
  } else if (offer.action === 'buy-food') {
    // Both transfers are preflighted; no partial payment or partial ration is allowed.
    movedGold = transferResource(wallet, market, 'gold', offer.gold);
    movedResource = transferResource(market, person, 'food', offer.amount,
      'foodReserve', 100);
  } else if (offer.action.startsWith('sell-coins-')) {
    const cargoField = 'carried' + offer.resource[0].toUpperCase() + offer.resource.slice(1);
    coinReceipt = settleCoinTrade(market, wallet, offer.priceCopper,
      person, market, cargoField, offer.amount, 260, offer.resource);
    if (!coinReceipt) return false;
    movedResource = offer.amount;
  } else {
    const cargoField = 'carried' + offer.resource[0].toUpperCase() + offer.resource.slice(1);
    movedResource = transferResource(person, market, cargoField, offer.amount, offer.resource, 260);
    movedGold = transferResource(market, wallet, 'gold', offer.gold);
  }
  if (Math.abs(movedResource - offer.amount) > 1e-8
      || (!coinReceipt && Math.abs(movedGold - offer.gold) > 1e-8)) {
    throw new Error('Conservative personal market preflight did not match settlement');
  }
  marketOwner.transactions = (marketOwner.transactions || 0) + 1;
  community.tradeCount = (community.tradeCount || 0) + 1;
  countTradeDiagnostic(world, 'marketCompleted');
  consumePersonEnergy(person, .35);
  if (person.skills) person.skills.diplomacy = clamp((person.skills.diplomacy || 0) + .008, 0, 1);
  person.state = offer.action.startsWith('buy-food') ? 'comprando alimento para si'
    : 'vendendo carga pessoal';
  person.lastLesson = 'A troca transferiu somente moedas e recursos existentes, com troco conservado.';
  recordTrade(world, {
    kind: 'market', scope: 'personal', action: offer.action,
    pricing: {
      resource: offer.action.startsWith('buy-food') ? 'food' : offer.resource,
      quantity: movedResource, goldPerUnit: coinReceipt
        ? coinReceipt.priceCopper / 100 / offer.amount : offer.gold / offer.amount,
      goldTransferred: movedGold,
      ...(coinReceipt ? { priceCopper: coinReceipt.priceCopper,
        tender: coinReceipt.tender, change: coinReceipt.change } : {})
    },
    balancesAfter: {
      person: {
        walletGold: wallet.gold || 0,
        walletSilver: wallet.silver || 0,
        walletCopper: wallet.copper || 0,
        carriedGold: person.carriedGold || 0,
        foodReserveDays: person.foodReserve || 0,
        carriedWood: person.carriedWood || 0,
        carriedStone: person.carriedStone || 0
      },
      market: tradeBalances(market)
    },
    participants: [{
      personId: person.id, communityId: community.id,
      delta: offer.action === 'buy-food-coins'
        ? { walletGold: -coinReceipt.transfers.gold,
          walletSilver: -coinReceipt.transfers.silver,
          walletCopper: -coinReceipt.transfers.copper,
          foodReserveDays: movedResource * FOOD_DAYS_PER_UNIT }
        : offer.action === 'buy-food'
          ? { walletGold: -movedGold, foodReserveDays: movedResource * FOOD_DAYS_PER_UNIT }
        : { ['carried' + offer.resource[0].toUpperCase() + offer.resource.slice(1)]: -movedResource,
          walletGold: coinReceipt ? coinReceipt.transfers.gold : movedGold,
          ...(coinReceipt ? { walletSilver: coinReceipt.transfers.silver,
            walletCopper: coinReceipt.transfers.copper } : {}) }
    }],
    market: {
      ownerType: marketOwner.ownerType || 'market', ownerId: marketOwner.ownerId ?? null,
      delta: tradeDelta(before, tradeBalances(market))
    }, assetsCreated: []
  }, [person, community, marketOwner]);
  return true;
}

function operationalTradeStation(station, community, kingdom) {
    return !!station && station.complete && station.communityId === community.id
      && station.destroyedDay == null
      && (station.integrity == null || station.integrity > 0)
      && (station.health == null || station.health > 0)
      && (station.type === 'posto de coleta'
        || (kingdom && station.type === 'mercado' && station.kingdomId === kingdom.id));
}

export function findTradePartner(w, community, person) {
    if (!community) return null;
    const kingdom = (w.kingdoms || []).find(item => item.communityId === community.id);
    const post = w.structures.filter(s => operationalTradeStation(s, community, kingdom))
      .sort((a, b) => distance(person, a) - distance(person, b))[0];
    countTradeDiagnostic(w, 'marketOpportunityChecks');
    if (!post) countTradeDiagnostic(w, 'marketOpportunityBlocked', 'no-market-station');
    else if (distance(person, post) > 16) countTradeDiagnostic(w, 'marketOpportunityBlocked', 'station-out-of-range');
    else if (marketHasTradeOpportunity(w, community)
        || personalMarketOffer(w, community, person, kingdom ? kingdom.market : w.market)) {
      countTradeDiagnostic(w, 'marketOpportunities');
      return { isMarket: true, station: post, market: kingdom ? kingdom.market : w.market, distance: distance(person, post) };
    } else countTradeDiagnostic(w, 'marketOpportunityBlocked', 'no-exchange-offer');
    const visibleMembers = (person.perception && person.perception.people || []).filter(s => s.visible)
      .map(s => w.people.find(p => p.id === s.id && p.alive)).filter(Boolean);
    return w.communities.filter(c => !c.dissolved && c.id !== community.id && visibleMembers.some(p => p.communityId === c.id))
      .map(c => {
        const other = visibleMembers.filter(p => p.communityId === c.id).sort((a, b) => distance(person, a) - distance(person, b))[0];
        const relation = communityRelation(w, community, c);
        const hasExchange = ((community.stores.food || 0) > 22 && ((c.stores.wood || 0) > 12 || (c.stores.stone || 0) > 10))
          || ((c.stores.food || 0) > 22 && ((community.stores.wood || 0) > 12 || (community.stores.stone || 0) > 10));
        return { community: c, person: other, relation, hasExchange, distance: other ? distance(person, other) : Infinity };
      }).filter(x => x.person && x.hasExchange && x.relation.trust > .14
        && !communitiesHaveClosedBorder(w, community, x.community))
      .sort((a, b) => a.distance - b.distance)[0] || null;
  }

export function marketHasTradeOpportunity(w, community) {
    if (!community || !community.stores) return false;
    const kingdom = (w.kingdoms || []).find(item => item.communityId === community.id);
    const marketOwner = kingdom ? kingdom.market : w.market;
    if (!marketOwner) return false;
    const market = marketOwner.stock || marketOwner;
    const store = community.stores;
    const food = accountAmount(store, 'food'), meat = accountAmount(store, 'meat');
    const edibleFood = food === null || meat === null ? Infinity : food + meat * MEAT_NUTRITIONAL_VALUE;
    const needsMarketFood = edibleFood < MARKET_PURCHASES.food.reserve;
    const canBuyFood = needsMarketFood
      && canSpend(store, 'gold', MARKET_PURCHASES.food.gold)
      && canSpend(market, 'food', MARKET_PURCHASES.food.amount);
    const canBuyWood = accountAmount(store, 'wood') !== null
      && accountAmount(store, 'wood') < MARKET_PURCHASES.wood.reserve
      && canSpend(store, 'gold', MARKET_PURCHASES.wood.gold)
      && canSpend(market, 'wood', MARKET_PURCHASES.wood.amount);
    const canBuyStone = accountAmount(store, 'stone') !== null
      && accountAmount(store, 'stone') < MARKET_PURCHASES.stone.reserve
      && canSpend(store, 'gold', MARKET_PURCHASES.stone.gold)
      && canSpend(market, 'stone', MARKET_PURCHASES.stone.amount);
    const pen = availableCommunityPen(w, community.id);
    const herd = domesticatedSheep(w, community).length;
    const canBuyFeed = !!pen && herd > 0
      && accountAmount(store, 'feed') !== null
      && accountAmount(store, 'feed') < MARKET_PURCHASES.feed.reserve
      && canSpend(store, 'gold', MARKET_PURCHASES.feed.gold)
      && canSpend(market, 'feed', MARKET_PURCHASES.feed.amount);
    const canBuySheep = !!pen
      && canSpend(store, 'gold', MARKET_PURCHASES.sheep.gold)
      && canSpend(market, 'sheep', MARKET_PURCHASES.sheep.amount);
    const canBarterFood = needsMarketFood && canSpend(market, 'food', MARKET_PURCHASES.food.amount)
      && ((canSpend(store, 'wood', 26) && canReceiveUpTo(market, 'wood', 8, 260))
        || (canSpend(store, 'stone', 18) && canReceiveUpTo(market, 'stone', 6, 260)));
    const canCoinBuy = hasCoinFunds(store) && coinMarketNeeds(store, pen, herd)
      .some(choice => choice.needed && coinPurchaseOffer(store, market,
        choice.resource, MARKET_PURCHASES[choice.resource].amount,
        MARKET_PURCHASES[choice.resource].gold));
    const canSell = MARKET_SALES.some(sale => {
      const payment = marketSaleGold(sale, marketOwner);
      if (payment === null || payment <= 0 || accountAmount(store, sale.resource) === null
          || accountAmount(store, sale.resource) < sale.reserve + sale.amount
          || !canReceiveUpTo(market, sale.resource, sale.amount, sale.capacity)) return false;
      if (hasCoinFunds(store)) {
        const priceCopper = goldPriceToCopper(payment);
        return !!priceCopper && !!quoteCoinPayment(market, store, priceCopper);
      }
      return canSpend(market, 'gold', payment);
    });
    return canBuyFood || canBuyWood || canBuyStone || canBuyFeed || canBuySheep || canBarterFood || canSell || canCoinBuy;
  }

function recordFoodAidExperience(w, giver, recipient, amount, method) {
  const nextFact = w.socialEvidence?.nextFactNumber || 1;
  const fact = recordSocialFact(w, {
    idempotencyKey: 'food-aid:' + w.day + ':' + giver.id + ':' + recipient.id + ':' + nextFact,
    type: 'food_aid_transferred',
    participantIds: [giver.id, recipient.id],
    witnessIds: [giver.id, recipient.id],
    targetId: recipient.id,
    location: { x: recipient.x, y: recipient.y },
    outcome: { resource: 'food', amount, method }
  });
  rememberSocialFact(w, giver.id, fact.eventId, { source: 'direct' });
  rememberSocialFact(w, recipient.id, fact.eventId, { source: 'direct', deferPrune: true });
  updateDirectedSocialRelationship(w, recipient.id, giver.id, {
    eventId: fact.eventId, trustDelta: method === 'community' ? .08 : .12
  });
  recordSocialBeliefEvidence(w, recipient.id, {
    topic: 'food_aid_reliability', aboutId: giver.id, eventId: fact.eventId, polarity: 1
  });
  return fact;
}

export function performShare(w, person, community, target) {
  const sighting = target && (person.perception?.people || []).find(item => item.visible && item.id === target.id);
  const recipient = sighting && sighting.visibleSignals?.foodDistress === true
    ? (w.people || []).find(item => item.id === target.id && item.alive) : null;
  if (!recipient || recipient !== target) return false;
  if (community && community.id === person.communityId && recipient.communityId === community.id
      && community.memberIds.includes(person.id) && community.memberIds.includes(recipient.id)
      && distance(person, community) <= 7 && distance(person, recipient) <= 7 && recipient.foodReserve < 48) {
    const units = transferCommunityFood(w, community, recipient, 4.2);
    if (units > .02) {
      recordFoodAidExperience(w, person, recipient, units * FOOD_DAYS_PER_UNIT, 'community');
      consumePersonEnergy(person, .22);
      const link = getSocialLink(w, person, recipient); link.trust = clamp(link.trust + .08, 0, 1); link.sharedFood += units;
      person.skills.care = clamp(person.skills.care + .004, 0, 1);
      person.state = 'partilhando alimento';
      person.lastLesson = 'Compartilhar a reserva reduziu a fome de um membro visível.';
      return true;
    }
  }
  if (person.foodReserve > 82 && distance(person, recipient) <= 1.6 && recipient.foodReserve < 40) {
    const amount = Math.min(5, (person.foodReserve - 70) / 2, (76 - recipient.foodReserve));
    const moved = amount > .5 ? transferFoodReserve(person, recipient, amount * .5, 'voluntary-sharing') : 0;
    if (moved > .01) {
      recordFoodAidExperience(w, person, recipient, moved, 'voluntary');
      consumePersonEnergy(person, .22);
      const link = getSocialLink(w, person, recipient); link.trust = clamp(link.trust + .12, 0, 1); link.sharedFood += moved;
      person.skills.care = clamp(person.skills.care + .004, 0, 1);
      person.state = 'partilhando alimento';
      person.lastLesson = 'A partilha aumentou a chance de sobrevivência de alguém próximo.';
      return true;
    }
  }
  return false;
}

export function ensureFoodAidPlan(w, requester, helper, options = {}) {
  if (!requester?.alive || requester.role === 'soldier' || !helper?.alive || requester.id === helper.id) return null;
  requester.socialIntentions ||= [];
  const existingAidPlan = requester.socialIntentions.find(item => item.type === 'seek_food_aid'
    && ['active', 'suspended'].includes(item.status));
  if (existingAidPlan && String(existingAidPlan.targetId) !== String(helper.id)) return null;
  if (!existingAidPlan && requester.socialIntentions.filter(item => ['active', 'suspended'].includes(item.status)).length
      >= SOCIAL_ACTIVE_INTENTION_PER_PERSON_LIMIT) return null;
  const parties = [String(requester.id), String(helper.id)];
  const openEntry = (w.socialEvidence?.commitments || []).find(item => {
    const record = item.record;
    return record?.object === 'food' && record.proposedBy === String(requester.id)
      && ['proposed', 'accepted'].includes(record.status) && record.dueDay >= w.day
      && record.parties.length === 2 && parties.every(id => record.parties.includes(id));
  });
  let commitment = openEntry?.record || null;
  if (!commitment) {
    const openCount = (w.socialEvidence?.commitments || []).filter(item => {
      const record = item.record;
      return !['fulfilled', 'breached', 'rejected', 'cancelled', 'expired'].includes(record?.status)
        && record?.parties?.includes(String(requester.id));
    }).length;
    if (openCount >= SOCIAL_OPEN_COMMITMENT_PER_PERSON_LIMIT) return null;
    commitment = proposeSocialCommitment(w, {
      idempotencyKey: 'food-aid-commitment:' + w.seed + ':' + (w.simulationEpoch ?? 0) + ':'
        + requester.id + ':' + helper.id + ':' + w.day,
      proposedBy: requester.id,
      parties,
      object: 'food',
      quantity: 2.5,
      // Allow walking to a visible helper, detours and the request itself.
      dueDay: w.day + Math.max(3, Math.ceil(distance(requester, helper)) * 2 + 1),
      evidenceEventIds: options.evidenceEventId ? [options.evidenceEventId] : []
    });
  }
  let intention = existingAidPlan?.commitmentId === commitment.commitmentId
    && String(existingAidPlan.targetId) === String(helper.id) ? existingAidPlan : null;
  if (!existingAidPlan && requester.socialIntentions.filter(item => ['active', 'suspended'].includes(item.status)).length
      < SOCIAL_ACTIVE_INTENTION_PER_PERSON_LIMIT) {
    intention = defineSocialIntention(w, requester.id, {
      type: 'seek_food_aid', priority: .7, targetId: helper.id, commitmentId: commitment.commitmentId,
      dueDay: commitment.dueDay,
      evidenceIds: options.evidenceEventIds || (options.evidenceEventId ? [options.evidenceEventId] : []),
      steps: [
        { action: 'approach_helper', targetId: helper.id },
        { action: 'request_food', targetId: helper.id },
        { action: 'receive_food', targetId: helper.id }
      ],
      endsWhen: 'aid_delivered_or_deadline'
    });
  }
  return { commitment, intention };
}

export function resolveFoodAidRequest(w, requester, helper, participantsToday = new Set()) {
  if (!requester?.alive || !helper?.alive || requester.id === helper.id) return { requested: false, reason: 'invalid-participants' };
  if (requester.role === 'soldier') return { requested: false, reason: 'military-duty' };
  if (requester.foodReserve >= 40) return { requested: false, reason: 'requester-not-hungry' };
  if (participantsToday.has(requester.id) || participantsToday.has(helper.id)) return { requested: false, reason: 'participant-busy' };
  const sighting = (requester.perception?.people || []).find(item => item.id === helper.id && item.visible
    && item.visibleSignals?.foodSurplus === true);
  if (!sighting || distance(requester, helper) > 1.6) return { requested: false, reason: 'helper-not-visible-or-near' };
  const emergency = person => Number.isFinite(person.hydration) && person.hydration <= 9
    || Number.isFinite(person.foodReserve) && person.foodReserve <= 8
    || Number.isFinite(person.health) && person.health <= 18
    || Number.isFinite(person.energy) && person.energy <= 8;
  if (emergency(requester) || emergency(helper)) return { requested: false, reason: 'physical-emergency' };

  const requestKey = 'food-aid-request:' + w.day + ':' + requester.id + ':' + helper.id;
  const priorRequest = (w.socialEvidence?.facts || []).find(fact => fact.type === 'food_aid_requested'
    && fact.participantIds.includes(String(requester.id)) && fact.participantIds.includes(String(helper.id))
    && fact.day === w.day);
  if (priorRequest) return { requested: false, reason: 'already-requested', fact: priorRequest };
  const request = recordSocialFact(w, {
    idempotencyKey: requestKey, type: 'food_aid_requested', participantIds: [requester.id, helper.id],
    witnessIds: [requester.id, helper.id], targetId: helper.id,
    location: { x: (requester.x + helper.x) / 2, y: (requester.y + helper.y) / 2 },
    outcome: { resource: 'food', result: 'request_made' }
  });
  rememberSocialFact(w, requester.id, request.eventId, { source: 'direct' });
  rememberSocialFact(w, helper.id, request.eventId, { source: 'direct' });
  participantsToday.add(requester.id);
  participantsToday.add(helper.id);

  const plan = ensureFoodAidPlan(w, requester, helper, { evidenceEventId: request.eventId });
  const commitment = plan?.commitment || null;
  let intention = plan?.intention || null;

  const community = (w.communities || []).find(item => !item.dissolved && item.id === helper.communityId
    && requester.communityId === item.id && item.memberIds.includes(requester.id) && item.memberIds.includes(helper.id));
  const canUseCommunityFood = !!(community && distance(helper, community) <= 7 && distance(requester, community) <= 7
    && communityFoodStock(community) > 1);
  const canUsePersonalFood = helper.foodReserve > 82 && requester.foodReserve < 40;
  if (commitment?.status === 'proposed') {
    if (canUseCommunityFood || canUsePersonalFood) acceptSocialCommitment(w, helper.id, commitment.commitmentId);
    else rejectSocialCommitment(w, helper.id, commitment.commitmentId);
  }
  let method = null;
  let moved = 0;
  if ((canUseCommunityFood || canUsePersonalFood)
      && (!commitment || getSocialCommitment(w, commitment.commitmentId)?.status === 'accepted') && canUseCommunityFood) {
    const before = requester.foodReserve;
    const units = transferCommunityFood(w, community, requester, 4.2);
    moved = requester.foodReserve - before;
    if (units > .02 && moved > .01) method = 'community';
  }
  if (!method && canUsePersonalFood
      && (!commitment || getSocialCommitment(w, commitment.commitmentId)?.status === 'accepted')) {
    const amount = Math.min(5, (helper.foodReserve - 70) / 2, 76 - requester.foodReserve);
    const transferred = amount > .5 ? transferFoodReserve(helper, requester, amount * .5, 'requested-help') : 0;
    if (transferred > .01) { method = 'voluntary'; moved = transferred; }
  }
  if (!method && commitment && getSocialCommitment(w, commitment.commitmentId)?.status === 'accepted') {
    cancelSocialCommitment(w, helper.id, commitment.commitmentId);
  }
  if (method) {
    recordFoodAidExperience(w, helper, requester, moved, method);
    consumePersonEnergy(helper, .22);
  }
  const response = recordSocialFact(w, {
    idempotencyKey: 'food-aid-response:' + w.day + ':' + requester.id + ':' + helper.id,
    type: 'food_aid_request_resolved', participantIds: [requester.id, helper.id], witnessIds: [requester.id, helper.id],
    targetId: requester.id, location: { x: requester.x, y: requester.y },
    outcome: method ? { resource: 'food', result: 'accepted', amount: moved, method, commitmentId: commitment?.commitmentId ?? null }
      : { resource: 'food', result: 'refused', reason: 'no-transferable-surplus', commitmentId: commitment?.commitmentId ?? null }
  });
  // Keep this response until the active plan can attach it as evidence. When
  // memory is at capacity, pruning here would remove the very event the plan
  // is about to validate and record as progress.
  rememberSocialFact(w, requester.id, response.eventId, { source: 'direct', deferPrune: true });
  rememberSocialFact(w, helper.id, response.eventId, { source: 'direct' });
  if (!method) {
    updateDirectedSocialRelationship(w, requester.id, helper.id, { eventId: response.eventId, trustDelta: -.03 });
    recordSocialBeliefEvidence(w, requester.id, { topic: 'food_aid_reliability', aboutId: helper.id, eventId: response.eventId, polarity: -1 });
  }
  if (method && commitment && getSocialCommitment(w, commitment.commitmentId)?.status === 'accepted') {
    fulfillSocialCommitment(w, commitment.commitmentId, response.eventId);
  }
  if (intention) {
    const resolvedCommitment = commitment ? getSocialCommitment(w, commitment.commitmentId) : null;
    if (method && resolvedCommitment?.status === 'fulfilled') {
      intention = advanceSocialIntention(w, requester.id, intention.intentionId, {
        progress: intention.steps.length, status: 'completed', blockers: [], terminationReason: 'aid_delivered',
        evidenceIds: [response.eventId]
      });
    } else if (method) {
      intention = advanceSocialIntention(w, requester.id, intention.intentionId, {
        progress: Math.min(2, intention.steps.length), status: 'active', blockers: [], evidenceIds: [response.eventId]
      });
    } else if (resolvedCommitment?.status === 'rejected' || resolvedCommitment?.status === 'cancelled') {
      intention = advanceSocialIntention(w, requester.id, intention.intentionId, {
        progress: Math.min(2, intention.steps.length), status: 'abandoned', blockers: ['aid_refused'],
        terminationReason: 'aid_refused', evidenceIds: [response.eventId]
      });
    } else {
      intention = advanceSocialIntention(w, requester.id, intention.intentionId, {
        progress: Math.min(2, intention.steps.length), status: 'suspended',
        blockers: ['aid_temporarily_unavailable'], evidenceIds: [response.eventId]
      });
    }
  }
  requester.state = method ? 'pedido de alimento aceito' : 'pedido de alimento recusado';
  requester.lastLesson = method
    ? 'O pedido foi aceito e a transferência real aumentou sua reserva alimentar.'
    : 'O pedido foi recusado; não houve débito nem crédito de alimento.';
  // A request is also a real, reserved face-to-face encounter, not just an economic operation.
  const report = shareFoodAidKnowledge(w, helper, requester) || shareFoodAidKnowledge(w, requester, helper);
  pruneSocialEvidence(w);
  return { requested: true, accepted: !!method, amount: moved, method, request, response,
    commitment: commitment ? getSocialCommitment(w, commitment.commitmentId) : null, intention, report };
}

export function performTrade(w, person, community, partner) {
    if (!community || !partner) return false;
    if (partner.isMarket) {
      const kingdom = (w.kingdoms || []).find(item => item.communityId === community.id);
      const currentMarket = kingdom ? kingdom.market : w.market;
      if (!(w.communities || []).includes(community) || community.dissolved
          || !(w.people || []).includes(person) || !person?.alive
          || person.communityId !== community.id
          || (kingdom && person.kingdomId != null && person.kingdomId !== kingdom.id)
          || !(w.structures || []).includes(partner.station)
          || !operationalTradeStation(partner.station, community, kingdom)
          || !currentMarket || partner.market !== currentMarket) {
        countTradeDiagnostic(w, 'marketBlocked', 'stale-station-or-market');
        return false;
      }
    }
    if (!partner.isMarket) {
      // Cached barter offers are not authority to trade with a departed, dead or
      // reassigned witness, a dissolved community, or a superseded relation.
      const other = partner.community;
      const counterparty = partner.person;
      const key = other && Math.min(community.id, other.id) + ':' + Math.max(community.id, other.id);
      const liveRelation = key && w.communityRelations?.[key];
      if (!(w.communities || []).includes(community) || community.dissolved
          || !(w.communities || []).includes(other) || other.dissolved || other.id === community.id
          || !(w.people || []).includes(person) || !person.alive || person.communityId !== community.id
          || !(w.people || []).includes(counterparty) || !counterparty?.alive || counterparty.communityId !== other.id
          || !liveRelation || liveRelation !== partner.relation || !(liveRelation.trust > .14)) {
        countTradeDiagnostic(w, 'communityBarterBlocked', 'stale-partner-or-community');
        return false;
      }
    }
    if (!partner.isMarket && partner.community && communitiesHaveClosedBorder(w, community, partner.community)) {
      countTradeDiagnostic(w, 'communityBarterBlocked', 'closed-border');
      return false;
    }
    if (distance(person, partner.isMarket ? partner.station : partner.person) > 2.2) {
      const target = partner.isMarket ? partner.station : partner.person;
      const tile = target && cellAt(w, target.x, target.y);
      if (!tile || !moveOne(w, person, tile, false)) {
        if (partner.isMarket) countTradeDiagnostic(w, 'marketBlocked', 'route-blocked');
        else countTradeDiagnostic(w, 'communityBarterBlocked', 'route-blocked');
        return false;
      }
      if (partner.isMarket) countTradeDiagnostic(w, 'marketApproaches');
      person.state = partner.isMarket ? 'indo negociar no mercado' : 'indo encontrar parceiro de troca';
      person.lastLesson = partner.isMarket
        ? 'O mercado foi identificado; aproximar-se do posto consome tempo antes que a troca possa acontecer.'
        : 'O parceiro aceitou trocar; aproximar-se consome tempo antes que os estoques mudem.';
      return true;
    }
    if (partner.isMarket) {
      countTradeDiagnostic(w, 'marketAttempts');
      if (executePersonalMarketTrade(w, person, community, partner.market)) return true;
      const store = community.stores;
      const storeBefore = { ...store };
      const tradeStoreBefore = tradeBalances(store);
      const animalsBefore = w.animals.length;
      const marketOwner = partner.market;
      const market = marketOwner && marketOwner.stock || marketOwner;
      if (!market) {
        countTradeDiagnostic(w, 'marketBlocked', 'market-account-missing');
        return false;
      }
      const marketBefore = tradeBalances(market);
      const pen = nearestPenFor(w, person);
      const availablePen = availableCommunityPen(w, community.id, person);
      const herd = domesticatedSheep(w, community).length;
      let transaction = null, coinReceipt = null;
      if (hasCoinFunds(store)) {
        for (const choice of coinMarketNeeds(store, availablePen || pen, herd)) {
          if (!choice.needed) continue;
          const order = MARKET_PURCHASES[choice.resource];
          const offer = coinPurchaseOffer(store, market, choice.resource, order.amount, order.gold);
          if (!offer) continue;
          coinReceipt = settleCoinTrade(store, market, offer.priceCopper,
            market, store, choice.resource, order.amount);
          if (!coinReceipt) continue;
          transaction = 'comprou ' + choice.label + ' com moedas';
          break;
        }
      }
      if (!transaction && availablePen && canSpend(market, 'sheep', MARKET_PURCHASES.sheep.amount)
          && canSpend(store, 'gold', MARKET_PURCHASES.sheep.gold)) {
        const candidates = cellsWithin(w, availablePen.x, availablePen.y, (availablePen.radius || 4) - .7, t => t.terrain === 'land' && t.slope < .5)
          .sort((a, b) => distance(a, availablePen) - distance(b, availablePen));
        const tile = candidates.find(t => !w.animals.some(a => a.alive && distance(a, t) < 1.2));
        if (tile && exchangeResources(store, { gold: MARKET_PURCHASES.sheep.gold }, market,
          { sheep: MARKET_PURCHASES.sheep.amount })) {
          // The structured trade ledger already includes this store debit as
          // part of the market exchange; do not count it a second time as use.
          consumeStoreInventory(community, { sheep: 1 }, null);
          const sheep = makeAnimal(w, 'sheep', tile.x, tile.y, false);
          sheep.energy = 68; sheep.habituation = .82; sheep.herdCommunityId = community.id; sheep.herdPenId = availablePen.id; sheep.aiEnabled = false;
          w.animals.push(sheep);
          reconcileCommunityHerdPens(w, community.id);
          transaction = 'comprou uma ovelha';
        }
      }
      if (!transaction && !hasCoinFunds(store) && (store.food + (store.meat || 0) * MEAT_NUTRITIONAL_VALUE) < MARKET_PURCHASES.food.reserve
          && canSpend(market, 'food', MARKET_PURCHASES.food.amount)
          && canSpend(store, 'gold', MARKET_PURCHASES.food.gold)
          && exchangeResources(store, { gold: MARKET_PURCHASES.food.gold }, market,
            { food: MARKET_PURCHASES.food.amount })) {
        transaction = 'comprou alimento';
      }
      if (!transaction && !hasCoinFunds(store) && store.wood < MARKET_PURCHASES.wood.reserve
          && canSpend(market, 'wood', MARKET_PURCHASES.wood.amount)
          && canSpend(store, 'gold', MARKET_PURCHASES.wood.gold)
          && exchangeResources(store, { gold: MARKET_PURCHASES.wood.gold }, market,
            { wood: MARKET_PURCHASES.wood.amount })) {
        transaction = 'comprou madeira';
      }
      if (!transaction && !hasCoinFunds(store) && store.stone < MARKET_PURCHASES.stone.reserve
          && canSpend(market, 'stone', MARKET_PURCHASES.stone.amount)
          && canSpend(store, 'gold', MARKET_PURCHASES.stone.gold)
          && exchangeResources(store, { gold: MARKET_PURCHASES.stone.gold }, market,
            { stone: MARKET_PURCHASES.stone.amount })) {
        transaction = 'comprou pedra';
      }
      if (!transaction && !hasCoinFunds(store) && pen && herd && store.feed < MARKET_PURCHASES.feed.reserve
          && canSpend(market, 'feed', MARKET_PURCHASES.feed.amount)
          && canSpend(store, 'gold', MARKET_PURCHASES.feed.gold)
          && exchangeResources(store, { gold: MARKET_PURCHASES.feed.gold }, market,
            { feed: MARKET_PURCHASES.feed.amount })) {
        transaction = 'comprou ração';
      }
      if (!transaction && (store.food + (store.meat || 0) * MEAT_NUTRITIONAL_VALUE) < MARKET_PURCHASES.food.reserve
          && canSpend(market, 'food', MARKET_PURCHASES.food.amount)) {
        if ((store.wood || 0) >= 26 && (market.wood || 0) + 8 <= 260
            && exchangeResources(store, { wood: 8 }, market, { food: 12 })) {
          transaction = 'trocou madeira por alimento';
        } else if ((store.stone || 0) >= 18 && (market.stone || 0) + 6 <= 260
            && exchangeResources(store, { stone: 6 }, market, { food: 12 })) {
          transaction = 'trocou pedra por alimento';
        }
      }
      if (!transaction) for (const sale of MARKET_SALES) {
        const { resource, amount, reserve, capacity } = sale;
        const gold = marketSaleGold(sale, marketOwner);
        if (gold === null || !canSpend(store, resource, reserve + amount)
            || !canReceiveUpTo(market, resource, amount, capacity)) continue;
        if (hasCoinFunds(store)) {
          const priceCopper = goldPriceToCopper(gold);
          if (!priceCopper || !quoteCoinPayment(market, store, priceCopper)) continue;
          coinReceipt = settleCoinTrade(market, store, priceCopper,
            store, market, resource, amount, capacity);
          if (!coinReceipt) continue;
        } else if (!canSpend(market, 'gold', gold)
            || !exchangeResources(store, { [resource]: amount }, market, { gold })) continue;
        if (resource === 'food') removeStoredFruit(w, community, amount);
        transaction = 'vendeu ' + (resource === 'food' ? 'alimento' : resource === 'wood' ? 'madeira' : resource === 'stone' ? 'pedra' : resource === 'iron' ? 'ferro' : 'ração');
        break;
      }
      if (!transaction) {
        countTradeDiagnostic(w, 'marketBlocked', 'no-executable-exchange');
        return false;
      }
      countTradeDiagnostic(w, 'marketCompleted');
      marketOwner.transactions = (marketOwner.transactions || 0) + 1;
      community.tradeCount++;
      consumePersonEnergy(person, .35);
      person.skills.diplomacy = clamp(person.skills.diplomacy + .008, 0, 1);
      person.state = 'negociando no posto';
      person.lastLesson = 'O ouro permitiu trocar reservas por um recurso escasso; o estoque do mercado também mudou.';
      const storeChanges = describeStoreChanges(storeBefore, store);
      const createdAnimals = w.animals.slice(animalsBefore);
      const newAnimals = createdAnimals.length;
      const animalChange = newAnimals > 0 ? 'adicionou ' + formatTradeAmount(newAnimals) + ' ' + (newAnimals === 1 ? 'ovelha' : 'ovelhas') + ' ao rebanho' : '';
      const day = w.day + 1;
      recordTrade(w, {
        kind: 'market',
        action: transaction,
        participants: [{ personId: person.id, communityId: community.id,
          delta: tradeDelta(tradeStoreBefore, tradeBalances(store)) }],
        market: {
          ownerType: marketOwner.ownerType || 'market',
          ownerId: marketOwner.ownerId ?? null,
          delta: tradeDelta(marketBefore, tradeBalances(market))
        },
        assetsCreated: createdAnimals.map(animal => ({ type: 'animal', id: animal.id, speciesId: animal.speciesId, count: 1 })),
        ...(coinReceipt ? { coinPayment: { priceCopper: coinReceipt.priceCopper,
          tender: coinReceipt.tender, change: coinReceipt.change } } : {})
      }, [community, marketOwner]);
      const effects = [storeChanges, animalChange].filter(Boolean).join('; ');
      const message = community.name + ' ' + transaction + ': ' + effects + ' no mercado.';
      community.history.push('No posto, ' + message + ' Dia ' + day + '.');
      log(w, message, day);
      return true;
    }
    countTradeDiagnostic(w, 'communityBarterAttempts');
    const a = community.stores, b = partner.community.stores;
    const communityStoreBefore = { ...a };
    const partnerStoreBefore = { ...b };
    const tradeStoreBefore = tradeBalances(a);
    const partnerTradeBefore = tradeBalances(b);
    let exchanged = false;
    const resource = stockSurplus(b, 'wood') >= 5 ? 'wood' : stockSurplus(b, 'stone') >= 5 ? 'stone' : null;
    const reverseResource = stockSurplus(a, 'wood') >= 5 ? 'wood' : stockSurplus(a, 'stone') >= 5 ? 'stone' : null;
    if (stockSurplus(a, 'food') >= 5 && resource) {
      exchanged = exchangeResources(a, { food: 5 }, b, { [resource]: 5 });
      if (exchanged) removeStoredFruit(w, community, 5);
    } else if (stockSurplus(b, 'food') >= 5 && reverseResource) {
      exchanged = exchangeResources(b, { food: 5 }, a, { [reverseResource]: 5 });
      if (exchanged) removeStoredFruit(w, partner.community, 5);
    }
    if (!exchanged) {
      countTradeDiagnostic(w, 'communityBarterBlocked', 'no-complementary-surplus');
      return false;
    }
    countTradeDiagnostic(w, 'communityBarterCompleted');
    partner.relation.trust = clamp(partner.relation.trust + .13, 0, 1);
    partner.relation.tension = Math.max(0, partner.relation.tension - .18);
    partner.relation.trades++;
    partner.community.tradeCount++;
    community.tradeCount++;
    consumePersonEnergy(person, .4);
    person.skills.diplomacy = clamp(person.skills.diplomacy + .01, 0, 1);
    person.state = 'trocando recursos';
    person.lastLesson = 'A troca converteu excedente em um recurso escasso para os dois reinos.';
    const day = w.day + 1;
    recordTrade(w, {
      kind: 'community-barter',
      action: 'barter',
      participants: [
        { personId: person.id, communityId: community.id, delta: tradeDelta(tradeStoreBefore, tradeBalances(a)) },
        { communityId: partner.community.id, delta: tradeDelta(partnerTradeBefore, tradeBalances(b)) }
      ],
      market: null,
      assetsCreated: []
    }, [community, partner.community]);
    const effects = describeStoreChanges(communityStoreBefore, a);
    log(w, community.name + ' trocou com ' + partner.community.name + ': ' + community.name + ' ' + effects
      + '; a confiança entre os reinos aumentou.', day);
    return true;
  }
