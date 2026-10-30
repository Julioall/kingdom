import { COIN_VALUE_COPPER, COIN_TYPES } from './currency-denominations.js';

// Physical coin accounts, not mineable ore cargo or legacy fractional-gold balances.
// A signed transfer means positive coins go from payer to seller; negative is change.
// No coin splitting, minting, overdrafts, or floating-point payment is permitted.
function coinBalances(account) {
  if (!account || typeof account !== 'object' || Array.isArray(account)) return null;
  const balances = {};
  for (const coin of COIN_TYPES) {
    const amount = account[coin] ?? 0;
    if (!Number.isFinite(amount) || amount < 0) return null;
    if (coin === 'gold') {
      // Old accounts can still hold fractional gold. Only whole gold pieces
      // are physical coins; the fractional legacy remainder stays untouched.
      balances[coin] = Math.floor(amount);
      if (!Number.isSafeInteger(balances[coin])) return null;
    } else {
      if (!Number.isSafeInteger(amount)) return null;
      balances[coin] = amount;
    }
  }
  return balances;
}

function canApplyTransfer(account, coin, delta) {
  const current = account?.[coin] ?? 0;
  if (!Number.isFinite(current) || current < 0) return false;
  const next = current + delta;
  if (coin === 'gold')
    return Number.isFinite(next) && next >= 0 && Number.isSafeInteger(Math.floor(next));
  return Number.isSafeInteger(next) && next >= 0;
}

export function goldPriceToCopper(priceGold, quantity = 1) {
  if (!Number.isFinite(priceGold) || priceGold <= 0
      || !Number.isSafeInteger(quantity) || quantity <= 0) return null;
  const copper = priceGold * quantity * COIN_VALUE_COPPER.gold;
  // Existing quotes can be fractional *gold*, but a new coin payment has
  // one-copper granularity. Round the entire order once to the nearest copper
  // (minimum 1), never issue fractions of any physical coin.
  const rounded = Math.max(1, Math.round(copper + Number.EPSILON));
  return Number.isSafeInteger(rounded) ? rounded : null;
}

export function quoteCoinPayment(payer, seller, priceCopper) {
  if (!Number.isSafeInteger(priceCopper) || priceCopper <= 0
      || !payer || !seller || payer === seller) return null;
  const from = coinBalances(payer), to = coinBalances(seller);
  if (!from || !to) return null;
  const wealth = from.gold * 100 + from.silver * 10 + from.copper;
  if (!Number.isSafeInteger(wealth) || wealth < priceCopper) return null;

  // Solve 100g + 10s + c = price, with signed transfers bounded by the
  // actual physical pieces held on each side. An ordinary overpayment and
  // change are two opposite movements, never a conversion of gold into silver.
  const lowGold = Math.max(-to.gold,
    Math.ceil((priceCopper - 10 * from.silver - from.copper) / 100));
  const highGold = Math.min(from.gold,
    Math.floor((priceCopper + 10 * to.silver + to.copper) / 100));
  if (lowGold > highGold || highGold - lowGold > 20000) return null;
  let best = null;
  for (let gold = lowGold; gold <= highGold; gold++) {
    const remaining = priceCopper - 100 * gold;
    const lowSilver = Math.max(-to.silver, Math.ceil((remaining - from.copper) / 10));
    const highSilver = Math.min(from.silver, Math.floor((remaining + to.copper) / 10));
    if (lowSilver > highSilver) continue;
    // For this gold transfer the least-moving silver transfer is nearest
    // remaining/10, because each excess silver costs ten copper in change.
    const desired = remaining / 10;
    for (const rawSilver of [Math.floor(desired), Math.ceil(desired)]) {
      const silver = Math.max(lowSilver, Math.min(highSilver, rawSilver));
      const copper = remaining - 10 * silver;
      if (copper < -to.copper || copper > from.copper) continue;
      const moved = Math.abs(gold) + Math.abs(silver) + Math.abs(copper);
      const changed = Math.max(0, -gold) + Math.max(0, -silver) + Math.max(0, -copper);
      if (!best || moved < best.moved || (moved === best.moved && changed < best.changed)) {
        best = { moved, changed, transfers: { copper, silver, gold } };
      }
    }
  }
  if (!best) return null;
  const tender = {}, change = {};
  for (const coin of COIN_TYPES) {
    const amount = best.transfers[coin];
    tender[coin] = Math.max(0, amount);
    change[coin] = Math.max(0, -amount);
  }
  return { priceCopper, tender, change, transfers: best.transfers };
}

// Settle a wage or other money-only obligation without fabricating goods or
// converting denominations. All pieces move atomically, including real change.
export function settleCoinPayment(payer, payee, priceCopper) {
  const quote = quoteCoinPayment(payer, payee, priceCopper);
  if (!quote) return null;
  for (const coin of COIN_TYPES) {
    const transfer = quote.transfers[coin];
    if (!canApplyTransfer(payer, coin, -transfer)
        || !canApplyTransfer(payee, coin, transfer)) return null;
  }
  for (const coin of COIN_TYPES) {
    payer[coin] = (payer[coin] ?? 0) - quote.transfers[coin];
    payee[coin] = (payee[coin] ?? 0) + quote.transfers[coin];
  }
  payer.coinMode = true;
  payee.coinMode = true;
  return quote;
}

export function settleCoinTrade(payer, seller, priceCopper,
  goodsSource, goodsTarget, resource, quantity, maxTarget = Infinity, targetResource = resource) {
  if (!payer || !seller || !goodsSource || !goodsTarget || goodsSource === goodsTarget
      || !resource || !targetResource || COIN_TYPES.includes(resource) || COIN_TYPES.includes(targetResource)
      || !Number.isFinite(quantity) || quantity <= 0
      || !(maxTarget === Infinity || (Number.isFinite(maxTarget) && maxTarget >= 0))) return null;
  const quote = quoteCoinPayment(payer, seller, priceCopper);
  const available = goodsSource[resource] ?? 0;
  const held = goodsTarget[targetResource] ?? 0;
  if (!quote || !Number.isFinite(available) || available < quantity
      || !Number.isFinite(held) || held < 0 || held + quantity > maxTarget
      || !Number.isFinite(held + quantity)) return null;
  // Whole settlement is preflighted before writing even one inventory.
  for (const coin of COIN_TYPES) {
    const delta = quote.transfers[coin];
    if (!canApplyTransfer(payer, coin, -delta)
        || !canApplyTransfer(seller, coin, delta)) return null;
  }
  for (const coin of COIN_TYPES) {
    payer[coin] = (payer[coin] ?? 0) - quote.transfers[coin];
    seller[coin] = (seller[coin] ?? 0) + quote.transfers[coin];
  }
  goodsSource[resource] = available - quantity;
  goodsTarget[targetResource] = held + quantity;
  // Preserve coin-only mode once a wallet has used physical denominations.
  // Without this flag, spending the last copper/silver would silently switch
  // the next purchase back to the legacy fractional-gold path.
  payer.coinMode = true;
  seller.coinMode = true;
  return quote;
}
