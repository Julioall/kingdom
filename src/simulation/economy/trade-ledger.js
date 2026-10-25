const TRADE_LEDGER_LIMIT = 120;

export function recordTrade(world, record, owners) {
  world.trades = (world.trades || 0) + 1;
  const entry = { id: world.trades, day: world.day + 1, ...record };
  for (const owner of new Set(owners.filter(Boolean))) {
    const ledger = owner.tradeLedger ||= { count: 0, history: [] };
    ledger.count++;
    ledger.history.push(entry);
    if (ledger.history.length > TRADE_LEDGER_LIMIT) ledger.history.shift();
  }
  return entry;
}
