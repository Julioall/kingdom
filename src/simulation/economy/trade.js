import { clamp, distance } from '../core/math.js';
import { communityRelation } from '../society/governance.js';
import { domesticatedSheep, makeAnimal } from '../ecology/animals.js';
import { consumeStoreInventory, exchangeResources, removeStoredFruit, stockSurplus, transferCommunityFood, transferFoodReserve } from './inventories.js';
import { getSocialLink } from '../society/communities.js';
import { nearestPenFor } from '../individuals/actions.js';
import { cellAt, cellsWithin } from '../world/spatial.js';
import { FOOD_RESERVE_PER_UNIT, MEAT_NUTRITIONAL_VALUE } from '../../config/ecosystem.js';
import { log } from '../core/events.js';
import { moveOne } from '../individuals/movement.js';
import { recordTrade } from './trade-ledger.js';
import { consumePersonEnergy } from '../individuals/energy.js';
import { recordSocialBeliefEvidence, recordSocialFact, rememberSocialFact } from '../society/social-evidence.js';

const RESOURCE_LABELS = Object.freeze({
  food: ['unidade de alimento', 'unidades de alimento'],
  wood: ['unidade de madeira', 'unidades de madeira'],
  stone: ['unidade de pedra', 'unidades de pedra'],
  gold: ['unidade de ouro', 'unidades de ouro'],
  feed: ['unidade de ração', 'unidades de ração']
});
const TRADE_RESOURCES = Object.freeze(['food', 'meat', 'wood', 'stone', 'gold', 'feed', 'sheep']);

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

export function findTradePartner(w, community, person) {
    if (!community) return null;
    const kingdom = (w.kingdoms || []).find(item => item.communityId === community.id);
    const post = w.structures.filter(s => s.complete && s.communityId === community.id
        && (s.type === 'posto de coleta' || (kingdom && s.type === 'mercado' && s.kingdomId === kingdom.id)))
      .sort((a, b) => distance(person, a) - distance(person, b))[0];
    if (post && distance(person, post) <= 16 && marketHasTradeOpportunity(w, community)) {
      return { isMarket: true, station: post, market: kingdom && kingdom.market || w.market, distance: distance(person, post) };
    }
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
    const marketOwner = kingdom && kingdom.market || w.market || {};
    const market = marketOwner.stock || marketOwner;
    const store = community.stores;
    const needsMarketFood = (store.food || 0) + (store.meat || 0) * MEAT_NUTRITIONAL_VALUE < 32;
    const canBarterFood = needsMarketFood && (market.food || 0) >= 12
      && ((store.gold || 0) >= 6
        || ((store.wood || 0) >= 26 && (market.wood || 0) + 8 <= 260)
        || ((store.stone || 0) >= 18 && (market.stone || 0) + 6 <= 260));
    const hasSurplus = (store.food || 0) > 45 || (store.wood || 0) > 28 || (store.stone || 0) > 24 || (store.feed || 0) > 30
      || canBarterFood;
    const pen = w.structures.some(s => s.communityId === community.id && s.complete && s.type === 'curral');
    const herd = domesticatedSheep(w, community).length;
    const hasDemand = (store.gold || 0) >= 4 && ((market.food || 0) >= 8 || (market.wood || 0) >= 8
      || (market.stone || 0) >= 6 || (market.feed || 0) >= 8 || (pen && herd < 6 && (market.sheep || 0) > 0));
    return hasSurplus || hasDemand;
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
  rememberSocialFact(w, recipient.id, fact.eventId, { source: 'direct' });
  recordSocialBeliefEvidence(w, recipient.id, {
    topic: 'food_aid_reliability', aboutId: giver.id, eventId: fact.eventId, polarity: 1
  });
  return fact;
}

export function performShare(w, person, community, target) {
    if (community && distance(person, community) <= 7) {
      const members = community.memberIds.map(id => w.people.find(p => p.id === id && p.alive))
        .filter(p => p && p.id !== person.id && p.foodReserve < 48)
        .sort((a, b) => a.foodReserve - b.foodReserve);
      if (members.length) {
        const units = transferCommunityFood(w, community, members[0], 4.2);
        if (units > .02) {
          recordFoodAidExperience(w, person, members[0], units * FOOD_RESERVE_PER_UNIT, 'community');
          consumePersonEnergy(person, .22);
          const link = getSocialLink(w, person, members[0]); link.trust = clamp(link.trust + .08, 0, 1); link.sharedFood += units;
          person.skills.care = clamp(person.skills.care + .004, 0, 1);
          person.state = 'partilhando alimento';
          person.lastLesson = 'Compartilhar a reserva reduziu a fome de um membro.';
          return true;
        }
      }
    }
    if (target && person.foodReserve > 82 && distance(person, target) <= 1.6 && target.foodReserve < 40) {
      const amount = Math.min(5, (person.foodReserve - 70) / 2, (76 - target.foodReserve));
      const moved = amount > .5 ? transferFoodReserve(person, target, amount * .5, 'voluntary-sharing') : 0;
      if (moved > .01) {
        recordFoodAidExperience(w, person, target, moved, 'voluntary');
        consumePersonEnergy(person, .22);
        const link = getSocialLink(w, person, target); link.trust = clamp(link.trust + .12, 0, 1); link.sharedFood += moved;
        person.skills.care = clamp(person.skills.care + .004, 0, 1);
        person.state = 'partilhando alimento';
        person.lastLesson = 'A partilha aumentou a chance de sobrevivência de alguém próximo.';
        return true;
      }
    }
    return false;
  }

export function performTrade(w, person, community, partner) {
    if (!community || !partner) return false;
    if (!partner.isMarket && partner.community && communitiesHaveClosedBorder(w, community, partner.community)) return false;
    if (partner.distance > 2.2) {
      const target = partner.isMarket ? partner.station : partner.person;
      const tile = target && cellAt(w, target.x, target.y);
      if (!tile || !moveOne(w, person, tile, false)) return false;
      person.state = partner.isMarket ? 'indo negociar no mercado' : 'indo encontrar parceiro de troca';
      person.lastLesson = partner.isMarket
        ? 'O mercado foi identificado; aproximar-se do posto consome tempo antes que a troca possa acontecer.'
        : 'O parceiro aceitou trocar; aproximar-se consome tempo antes que os estoques mudem.';
      return true;
    }
    if (partner.isMarket) {
      const store = community.stores;
      const storeBefore = { ...store };
      const tradeStoreBefore = tradeBalances(store);
      const animalsBefore = w.animals.length;
      const marketOwner = partner.market || w.market;
      const market = marketOwner && marketOwner.stock || marketOwner;
      if (!market) return false;
      const marketBefore = tradeBalances(market);
      const pen = nearestPenFor(w, person);
      const herd = domesticatedSheep(w, community).length;
      let transaction = null;
      if (pen && herd < 6 && market.sheep > 0 && store.gold >= 38) {
        const candidates = cellsWithin(w, pen.x, pen.y, (pen.radius || 4) - .7, t => t.terrain === 'land' && t.slope < .5)
          .sort((a, b) => distance(a, pen) - distance(b, pen));
        const tile = candidates.find(t => !w.animals.some(a => a.alive && distance(a, t) < 1.2));
        if (tile && exchangeResources(store, { gold: 38 }, market, { sheep: 1 })) {
          // The structured trade ledger already includes this store debit as
          // part of the market exchange; do not count it a second time as use.
          consumeStoreInventory(community, { sheep: 1 }, null);
          const sheep = makeAnimal(w, 'sheep', tile.x, tile.y, false);
          sheep.energy = 68; sheep.habituation = .82; sheep.herdCommunityId = community.id; sheep.aiEnabled = false;
          w.animals.push(sheep);
          transaction = 'comprou uma ovelha';
        }
      }
      if (!transaction && (store.food + (store.meat || 0) * MEAT_NUTRITIONAL_VALUE) < 32
          && market.food >= 10 && store.gold >= 6 && exchangeResources(store, { gold: 6 }, market, { food: 12 })) {
        transaction = 'comprou alimento';
      }
      if (!transaction && store.wood < 18 && market.wood >= 8 && store.gold >= 6
          && exchangeResources(store, { gold: 6 }, market, { wood: 10 })) {
        transaction = 'comprou madeira';
      }
      if (!transaction && store.stone < 12 && market.stone >= 6 && store.gold >= 7
          && exchangeResources(store, { gold: 7 }, market, { stone: 8 })) {
        transaction = 'comprou pedra';
      }
      if (!transaction && pen && herd && store.feed < 18 && market.feed >= 8 && store.gold >= 4
          && exchangeResources(store, { gold: 4 }, market, { feed: 10 })) {
        transaction = 'comprou ração';
      }
      if (!transaction && (store.food + (store.meat || 0) * MEAT_NUTRITIONAL_VALUE) < 32 && market.food >= 12) {
        if ((store.wood || 0) >= 26 && (market.wood || 0) + 8 <= 260
            && exchangeResources(store, { wood: 8 }, market, { food: 12 })) {
          transaction = 'trocou madeira por alimento';
        } else if ((store.stone || 0) >= 18 && (market.stone || 0) + 6 <= 260
            && exchangeResources(store, { stone: 6 }, market, { food: 12 })) {
          transaction = 'trocou pedra por alimento';
        }
      }
      const sales = [
        ['food', 'food', 10, 4, 44], ['wood', 'wood', 8, 4, 28],
        ['stone', 'stone', 6, 5, 24], ['feed', 'feed', 10, 3, 30]
      ];
      if (!transaction) for (const [stockKey, marketKey, amount, payment, reserve] of sales) {
        if ((store[stockKey] || 0) - reserve >= amount && (market[marketKey] || 0) + amount <= 260
            && exchangeResources(store, { [stockKey]: amount }, market, { gold: payment })) {
          if (stockKey === 'food') removeStoredFruit(w, community, amount);
          transaction = 'vendeu ' + (stockKey === 'food' ? 'alimento' : stockKey === 'wood' ? 'madeira' : stockKey === 'stone' ? 'pedra' : 'ração');
          break;
        }
      }
      if (!transaction) return false;
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
        participants: [{ communityId: community.id, delta: tradeDelta(tradeStoreBefore, tradeBalances(store)) }],
        market: {
          ownerType: marketOwner.ownerType || 'market',
          ownerId: marketOwner.ownerId ?? null,
          delta: tradeDelta(marketBefore, tradeBalances(market))
        },
        assetsCreated: createdAnimals.map(animal => ({ type: 'animal', id: animal.id, speciesId: animal.speciesId, count: 1 }))
      }, [community, marketOwner]);
      const effects = [storeChanges, animalChange].filter(Boolean).join('; ');
      const message = community.name + ' ' + transaction + ': ' + effects + ' no mercado.';
      community.history.push('No posto, ' + message + ' Dia ' + day + '.');
      log(w, message, day);
      return true;
    }
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
    if (!exchanged) return false;
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
        { communityId: community.id, delta: tradeDelta(tradeStoreBefore, tradeBalances(a)) },
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
