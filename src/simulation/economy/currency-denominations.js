// Fixed currency hierarchy used for quoting and presentation. Ore stocks remain
// physically owned inventories; this module never creates or transfers coins.
export const COIN_VALUE_COPPER = Object.freeze({ copper: 1, silver: 10, gold: 100 });
export const METAL_TYPES = Object.freeze(['copper', 'silver', 'gold', 'iron']);
export const COIN_TYPES = Object.freeze(['copper', 'silver', 'gold']);

export function currencyValueCopper(account) {
  if (!account || typeof account !== 'object') return null;
  let value = 0;
  for (const coin of COIN_TYPES) {
    const amount = account[coin] ?? 0;
    if (!Number.isFinite(amount) || amount < 0) return null;
    value += amount * COIN_VALUE_COPPER[coin];
  }
  return Number.isFinite(value) ? value : null;
}

export function copperToCoinBreakdown(copper) {
  if (!Number.isSafeInteger(copper) || copper < 0) return null;
  let remainder = copper;
  const gold = Math.floor(remainder / COIN_VALUE_COPPER.gold);
  remainder -= gold * COIN_VALUE_COPPER.gold;
  const silver = Math.floor(remainder / COIN_VALUE_COPPER.silver);
  const coins = remainder - silver * COIN_VALUE_COPPER.silver;
  return { gold, silver, copper: coins };
}

// Prices in the existing economy are gold-equivalent and may be fractional.
// Keep them unchanged for legacy transactions. A later coin-payment layer
// must decide rounding and actual change rather than converting balances here.
export function goldValueInCopper(gold) {
  return Number.isFinite(gold) && gold >= 0 ? gold * COIN_VALUE_COPPER.gold : null;
}
