# JUL-178 — deterministic rules and stochastic agent evaluation

**Date:** 2026-10-28
**Scope:** food conservation and logistics replay gates; no gameplay code changed.

## Decision

Keep exact assertions for domain rules and deterministic replays. Do not use exact state/chronicle equality to judge the quality of LLM or probabilistic-policy behavior. The food audit script currently exercises the synchronous simulation engine directly; it does not start the browser `local-engine`/Ollama request loop. It creates a world from a seed and calls `engine.stepDay`. The neural controller's action selection uses a deterministic argmax and seeded world state, so repeating a seed on the same code/configuration is a valid regression check for this path. It is not evidence that the game must produce one exact trajectory when an external LLM is enabled.

## Revised replay shape

The required horizons still serve different questions: 253 days covers the existing seasonal/calendar checkpoint, 365 days checks one year, and 730 days checks continuity across two years. Running three separate matrices duplicates the first checkpoints. Run each required seed once to day 730 and collect metrics at days 253, 365, and 730. Keep seeds 1, 42, 987, and 2026, and repeat seed 42 once on the exact same SHA/configuration. This is five runs, not fifteen, while retaining the same horizon and seed coverage. Do not rerun already-passing horizons on unchanged code.

Every run should assert hard invariants at each relevant transaction/day: no negative stock; transfers debit and credit the correct owned inventories; conservation balances reconcile within the documented numeric tolerance; failed/capacity-blocked work does not silently create or erase resources; and blocked access has a recorded reason. These claims should be backed by direct tests/instrumentation, not inferred from a small number of long replays.

Long-run outcomes such as food reserve, low-reserve person-days, deaths by cause, trade throughput, field cycles, and campaign supply are measurements, not exact target traces. Report per-community values and ranges across the seeds. Hunger remains a possible game outcome; an individual death is not automatically a test failure. Diagnose whether it followed an invariant violation or an allowed consequence of insufficient accessible food/logistics. Four seeds provide regression coverage, not strong evidence about rare-event probability; do not claim statistical certainty from them.

## LLM/neural-policy evaluation

For an enabled LLM or a deliberately sampled policy, use a separate evaluation protocol: record model/provider/version, prompt hash, decoding parameters, simulation SHA/configuration, seed, accepted/rejected action, fallback, latency, and relevant costs. Compare candidate and baseline on matched scenario/seed sets when the sources of randomness can be paired. Report success/violation rates and uncertainty intervals over repeated runs; do not demand identical state hashes or one exact decision sequence. Hard domain constraints still apply on every run, regardless of the controller's stochastic output.

The current JUL-178 food matrix should therefore be described as an audit of the deterministic simulation/fallback path. Evaluating quality or variance of LLM-enabled decisions belongs to the corresponding AI/annual-slice issue, with its own cost-aware sample plan. Exact observer-on/off parity is appropriate for core gameplay state only when audit instrumentation is meant to be passive; exclude telemetry from the compared state digest, and prove that observation did not alter actions or domain state.

## Evidence and limits

- `scripts/audit-food-replays.mjs` calls `createWorld(seed)` and `stepDay` directly, compares canonical state/chronicle hashes, and includes food-ledger assertions; it does not boot the UI AI client.
- `src/controllers/individual/neural.js` selects actions by argmax and updates the seeded neural state from rewards.
- `src/ai/local-engine.js` runs external/model inference asynchronously and uses validated deterministic fallback after failure; this is a different execution mode.
- SciSpace search surfaced Blackwell, Barry, and Cohn, *Towards Reproducible LLM Evaluation: Quantifying Uncertainty in LLM Benchmark Scores* (2024), which studies uncertainty across repeats, and Ma et al., *MAESTRO: Multi-Agent Evaluation Suite for Testing, Reliability, and Observability* (2026), which reports substantial run-to-run variability in LLM multi-agent systems. Henderson et al., *Deep Reinforcement Learning that Matters* (2017), motivates repeated seeds and uncertainty reporting for stochastic learning systems.
- Consensus could not be queried: the account had exhausted its monthly 30-search quota (reset 2026-11-01). SciSpace and direct inspection of the current code were used instead.

## Consequence for acceptance

Keep conservation, inventory ownership, no-negative-stock, worker/task safety, and per-run accounting as exact gates. Keep a deterministic seed-42 repeat hash gate only for the direct simulation/fallback path. Replace separate 253/365/730 full runs with five 730-day runs that emit checkpoints at all three horizons. Do not close JUL-178 until the resulting current-SHA evidence and the specified controlled access/logistics scenarios are complete; do not attribute LLM variability to a food-ledger defect without separating the run mode.
