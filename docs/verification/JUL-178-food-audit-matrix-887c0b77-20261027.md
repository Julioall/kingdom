# JUL-178 food audit matrix

- Code SHA: `887c0b77f61d79481d4889008081ac486da45b80`
- Branch: `codex/jul178-one-day-food-units`
- Horizons: 253, 365, and 730 simulation days
- Seeds: 1, 42, 987, and 2026 at each horizon; seed 42 repeated at every horizon
- Full machine-readable runs: `JUL-178-food-audit-matrix-887c0b77-20261027.json`

## Results

All 15 replay results (12 base runs plus 3 deterministic seed-42 repeats) completed on the same code SHA. No human death was caused by starvation; observed human deaths were combat or invasion. Every replay completed both cultivated fields, had complete market-trade record coverage, and had complete, balanced campaign food ledgers. The audit checked food, feed, seed, cargo, reserves, market, treasury, structure, and campaign inventories for negative or invalid balances after every simulated day.

| Horizon | Lowest ending community food | Lowest combined community + personal reserve | Communities below 300 food | Human starvation deaths | Market ledger coverage | Campaign ledgers |
|---:|---:|---:|---:|---:|---|---|
| 253 days | 8,874 | 51 days | 7 days, Valedouro, seed 1 | 0 | Complete | Complete and balanced |
| 365 days | 9,471 | 51 days | 7 days, Valedouro, seed 1 | 0 | Complete | Complete and balanced |
| 730 days | 10,980 | 51 days | 7 days, Valedouro, seed 1 | 0 | Complete | Complete and balanced |

In the seven days when Valedouro's community stock fell below 300 in seed 1, its combined community and personal reserves remained above 51 days. Every other community stayed at or above 300. The three repeated seed-42 runs matched their original state and chronicle hashes.

The full trade history is retained only when `scripts/audit-food-replays.mjs` sets the opt-in audit flag. Normal gameplay keeps its existing cap of 120 ledger entries. Individual JSON reports preserve per-seed stocks, harvests, crop cycles, trade records, campaign side balances, death causes, state hashes, and community reserve trackers.

## Remaining JUL-178 evidence gap

Replay assertions prove that tracked inventories never became negative; trade entries and campaign rations reconcile; field harvests and deliveries are summarized; and unit tests exercise food conversion, capacity, collection, transfers, dependents, market bounds, and military supply. The replay report still does not emit a complete per-day, per-owner transaction ledger for every non-trade food transfer and consumption (including route and blocked-work reasons). JUL-178 remains In Progress until that remaining ledger criterion is either instrumented and validated or the issue's acceptance criteria are narrowed with explicit approval.
