import { COIN_TYPES, COIN_VALUE_COPPER, currencyValueCopper } from './currency-denominations.js';

// Recoin existing royal value during new-world setup. This is a change of
// denomination, not income. Historical saves retain their existing balances.
export function seedRoyalChangeReserve(kingdom) {
  const stock = kingdom?.treasury?.stock;
  if (!stock || !Number.isSafeInteger(stock.gold) || stock.gold < 5
      || (stock.silver ?? 0) !== 0 || (stock.copper ?? 0) !== 0) return false;
  const before = currencyValueCopper(stock);
  if (!Number.isSafeInteger(before)) return false;
  stock.gold -= 5;
  stock.silver = 20; // equivalent of 2 gold pieces
  stock.copper = 300; // equivalent of 3 gold pieces
  if (currencyValueCopper(stock) !== before) throw new Error('Royal change reserve lost value');
  return true;
}

export function exchangeAtRoyalCastle(world, kingdomId, castleId, fromCoin, toCoin, quantity) {
  if (!world || !Number.isSafeInteger(kingdomId) || !Number.isSafeInteger(castleId)
      || !COIN_TYPES.includes(fromCoin) || !COIN_TYPES.includes(toCoin)
      || fromCoin === toCoin || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100)
    return { ok: false, reason: 'Quantidade e denominações devem ser moedas inteiras válidas.' };
  const kingdom = world.kingdoms?.find(item => item.id === kingdomId);
  const castle = world.structures?.find(item => item.id === castleId && item.type === 'castelo'
    && item.kingdomId === kingdomId && item.complete && item.destroyedDay == null
    && item.health !== 0 && item.integrity !== 0);
  const settlement = world.settlements?.find(item => item.kingdomId === kingdomId && item.castleId === castleId);
  const treasury = kingdom?.treasury?.stock;
  const market = kingdom?.market?.stock;
  if (!kingdom || !castle || !settlement || !treasury || !market || treasury === market)
    return { ok: false, reason: 'É necessário um castelo operacional e o mercado do mesmo reino.' };
  const goldBefore = currencyValueCopper(treasury), marketBefore = currencyValueCopper(market);
  if (![treasury, market].every(account => COIN_TYPES.every(coin =>
      Number.isSafeInteger(account[coin] ?? 0) && (account[coin] ?? 0) >= 0))
      || !Number.isSafeInteger(goldBefore) || !Number.isSafeInteger(marketBefore))
    return { ok: false, reason: 'Há saldos antigos ou inválidos: câmbio físico exige moedas inteiras.' };
  const changeCopper = quantity * COIN_VALUE_COPPER[fromCoin];
  const received = changeCopper / COIN_VALUE_COPPER[toCoin];
  if (!Number.isSafeInteger(received) || received < 1)
    return { ok: false, reason: 'A troca exige múltiplos inteiros da moeda de destino.' };
  if ((market[fromCoin] ?? 0) < quantity || (treasury[toCoin] ?? 0) < received)
    return { ok: false, reason: 'O mercador ou o tesouro real não possuem moedas suficientes para o troco.' };
  const newMarketSource = market[fromCoin] - quantity;
  const newMarketTarget = (market[toCoin] ?? 0) + received;
  const newTreasurySource = (treasury[fromCoin] ?? 0) + quantity;
  const newTreasuryTarget = treasury[toCoin] - received;
  if (![newMarketSource,newMarketTarget,newTreasurySource,newTreasuryTarget]
      .every(x => Number.isSafeInteger(x) && x >= 0))
    return { ok: false, reason: 'A operação produziria um saldo inválido.' };
  market[fromCoin] = newMarketSource;
  market[toCoin] = newMarketTarget;
  treasury[fromCoin] = newTreasurySource;
  treasury[toCoin] = newTreasuryTarget;
  if (currencyValueCopper(treasury) !== goldBefore + changeCopper
      - received * COIN_VALUE_COPPER[toCoin]
      || currencyValueCopper(market) !== marketBefore)
    throw new Error('Castle exchange broke the monetary conservation invariant');
  const record = { day: world.day, kingdomId, castleId, fromCoin, toCoin, quantity,
    received, valueCopper: changeCopper, marketBalanceCopper: marketBefore,
    treasuryBalanceCopper: goldBefore };
  kingdom.coinExchangeLedger ||= { count: 0, history: [] };
  kingdom.coinExchangeLedger.count++;
  kingdom.coinExchangeLedger.history.push(record);
  if (kingdom.coinExchangeLedger.history.length > 40) kingdom.coinExchangeLedger.history.shift();
  return { ok: true, ...record };
}
