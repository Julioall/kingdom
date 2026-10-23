import { clamp, distance } from '../core/math.js';
import { communityRelation } from '../society/governance.js';
import { domesticatedSheep, makeAnimal } from '../ecology/animals.js';
import { removeStoredFruit, stockSurplus, transferCommunityFood } from './inventories.js';
import { getSocialLink } from '../society/communities.js';
import { nearestPenFor } from '../individuals/actions.js';
import { cellsWithin } from '../world/spatial.js';
import { MEAT_NUTRITIONAL_VALUE } from '../../config/ecosystem.js';
import { log } from '../core/events.js';

export function findTradePartner(w, community, person) {
    if (!community) return null;
    const post = w.structures.filter(s => s.complete && s.type === 'posto de coleta' && s.communityId === community.id)
      .sort((a, b) => distance(person, a) - distance(person, b))[0];
    if (post && distance(person, post) <= 5.5 && marketHasTradeOpportunity(w, community)) {
      return { isMarket: true, station: post, market: w.market, distance: distance(person, post) };
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
      }).filter(x => x.person && x.hasExchange && x.relation.trust > .14)
      .sort((a, b) => a.distance - b.distance)[0] || null;
  }

export function marketHasTradeOpportunity(w, community) {
    const store = community.stores, market = w.market || {};
    const hasSurplus = (store.food || 0) > 45 || (store.wood || 0) > 28 || (store.stone || 0) > 24 || (store.feed || 0) > 30;
    const pen = w.structures.some(s => s.communityId === community.id && s.complete && s.type === 'curral');
    const herd = domesticatedSheep(w, community).length;
    const hasDemand = (store.gold || 0) >= 4 && ((market.food || 0) >= 8 || (market.wood || 0) >= 8
      || (market.stone || 0) >= 6 || (market.feed || 0) >= 8 || (pen && herd < 6 && (market.sheep || 0) > 0));
    return hasSurplus || hasDemand;
  }

export function performShare(w, person, community, target) {
    if (community && distance(person, community) <= 7) {
      const members = community.memberIds.map(id => w.people.find(p => p.id === id && p.alive))
        .filter(p => p && p.id !== person.id && p.foodReserve < 48)
        .sort((a, b) => a.foodReserve - b.foodReserve);
      if (members.length) {
        const units = transferCommunityFood(w, community, members[0], 4.2);
        if (units > .02) {
          person.energy = Math.max(0, person.energy - .22);
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
      if (amount > .5) {
        person.foodReserve -= amount * .5; target.foodReserve += amount * .5;
        person.energy = Math.max(0, person.energy - .22);
        const link = getSocialLink(w, person, target); link.trust = clamp(link.trust + .12, 0, 1); link.sharedFood += amount;
        person.skills.care = clamp(person.skills.care + .004, 0, 1);
        person.state = 'partilhando alimento';
        person.lastLesson = 'A partilha aumentou a chance de sobrevivência de alguém próximo.';
        return true;
      }
    }
    return false;
  }

export function performTrade(w, person, community, partner) {
    if (!community || !partner || partner.distance > 2.2) return false;
    if (partner.isMarket) {
      const store = community.stores, market = w.market;
      const pen = nearestPenFor(w, person);
      const herd = domesticatedSheep(w, community).length;
      let transaction = null;
      if (pen && herd < 6 && market.sheep > 0 && store.gold >= 38) {
        const candidates = cellsWithin(w, pen.x, pen.y, (pen.radius || 4) - .7, t => t.terrain === 'land' && t.slope < .5)
          .sort((a, b) => distance(a, pen) - distance(b, pen));
        const tile = candidates.find(t => !w.animals.some(a => a.alive && distance(a, t) < 1.2));
        if (tile) {
          const sheep = makeAnimal(w, 'sheep', tile.x, tile.y, false);
          sheep.energy = 68; sheep.habituation = .82; sheep.herdCommunityId = community.id; sheep.aiEnabled = false;
          w.animals.push(sheep); market.sheep--; store.gold -= 38; market.gold += 38;
          transaction = 'comprou uma ovelha';
        }
      }
      if (!transaction && (store.food + (store.meat || 0) * MEAT_NUTRITIONAL_VALUE) < 32 && market.food >= 10 && store.gold >= 6) {
        store.food += 12; market.food -= 12; store.gold -= 6; market.gold += 6; transaction = 'comprou alimento';
      }
      if (!transaction && store.wood < 18 && market.wood >= 8 && store.gold >= 6) {
        store.wood += 10; market.wood -= 10; store.gold -= 6; market.gold += 6; transaction = 'comprou madeira';
      }
      if (!transaction && store.stone < 12 && market.stone >= 6 && store.gold >= 7) {
        store.stone += 8; market.stone -= 8; store.gold -= 7; market.gold += 7; transaction = 'comprou pedra';
      }
      if (!transaction && pen && herd && store.feed < 18 && market.feed >= 8 && store.gold >= 4) {
        store.feed += 10; market.feed -= 10; store.gold -= 4; market.gold += 4; transaction = 'comprou ração';
      }
      const sales = [
        ['food', 'food', 10, 4, 44], ['wood', 'wood', 8, 4, 28],
        ['stone', 'stone', 6, 5, 24], ['feed', 'feed', 10, 3, 30]
      ];
      if (!transaction) for (const [stockKey, marketKey, amount, payment, reserve] of sales) {
        if ((store[stockKey] || 0) - reserve >= amount && market[marketKey] + amount <= 260 && market.gold >= payment) {
          store[stockKey] -= amount; market[marketKey] += amount; store.gold += payment; market.gold -= payment;
          if (stockKey === 'food') removeStoredFruit(w, community, amount);
          transaction = 'vendeu ' + (stockKey === 'food' ? 'alimento' : stockKey === 'wood' ? 'madeira' : stockKey === 'stone' ? 'pedra' : 'ração');
          break;
        }
      }
      if (!transaction) return false;
      market.transactions = (market.transactions || 0) + 1;
      community.tradeCount++; w.trades++;
      person.energy = Math.max(0, person.energy - .35);
      person.skills.diplomacy = clamp(person.skills.diplomacy + .008, 0, 1);
      person.state = 'negociando no posto';
      person.lastLesson = 'O ouro permitiu trocar reservas por um recurso escasso; o estoque do mercado também mudou.';
      community.history.push('No posto, o reino ' + transaction + ' no dia ' + w.day + '.');
      log(w, community.name + ' ' + transaction + ' usando ouro no posto de coleta.');
      return true;
    }
    const a = community.stores, b = partner.community.stores;
    let exchanged = false;
    const resource = stockSurplus(b, 'wood') >= 5 ? 'wood' : stockSurplus(b, 'stone') >= 5 ? 'stone' : null;
    const reverseResource = stockSurplus(a, 'wood') >= 5 ? 'wood' : stockSurplus(a, 'stone') >= 5 ? 'stone' : null;
    if (stockSurplus(a, 'food') >= 5 && resource) {
      a.food -= 5; b.food += 5; b[resource] -= 5; a[resource] += 5; exchanged = true;
      removeStoredFruit(w, community, 5);
    } else if (stockSurplus(b, 'food') >= 5 && reverseResource) {
      b.food -= 5; a.food += 5; a[reverseResource] -= 5; b[reverseResource] += 5; exchanged = true;
      removeStoredFruit(w, partner.community, 5);
    }
    if (!exchanged) return false;
    partner.relation.trust = clamp(partner.relation.trust + .13, 0, 1);
    partner.relation.tension = Math.max(0, partner.relation.tension - .18);
    partner.relation.trades++;
    partner.community.tradeCount++;
    community.tradeCount++;
    w.trades++;
    person.energy = Math.max(0, person.energy - .4);
    person.skills.diplomacy = clamp(person.skills.diplomacy + .01, 0, 1);
    person.state = 'trocando recursos';
    person.lastLesson = 'A troca converteu excedente em um recurso escasso para os dois reinos.';
    log(w, community.name + ' e ' + partner.community.name + ' trocaram alimento por ' + (resource || reverseResource || 'recursos') + '; a confiança entre os reinos aumentou.');
    return true;
  }
