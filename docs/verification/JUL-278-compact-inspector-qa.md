# JUL-278 — Compact actor transport (opt-in QA only)

**Date:** 2026-11-10.  
**Baseline:** `dev` already includes PR #108 (Worker `inspect-person`/`inspect-animal`) and PR #109 (visual inspector adapter with epoch/revision selection guards).  
**Candidate:** PR #111, **opt-in developer QA**. The default worker protocol remains unchanged.

## Purpose and transport contract

The authoritative simulation `world.people` / `world.animals` must never lose neural state. Only the **presentation snapshot/delta base** is projected. Worker request `initialize` or `reset` can negotiate `transport:'tile-delta-compact'`, in which:
- all existing tile field deltas, epoch, baseRevision, resync and reset safeguards still apply;
- `snapshot.base.people/animals` preserve actor count, ID, x/y, alive, health, movement, animation, resource/status and other non-cognitive fields;
- per-actor `perception`, `navigationRoute`, `knownRoutes`, `sensoryMemory`, `personalMemory`, `cognitiveState`, `lastDecision`, `militaryBrain` are omitted;
- `brain` retains only `mode,lastAction,decisions,updates,inputSize,hiddenSize,actionCount` needed for presentation such as sheep feed/movement and miner sprite activity;
- the full authoritative values remain available **on demand** from `inspect-person` / `inspect-animal`, with `kind,actorId,day,epoch,revision` and a detached actor copy;
- malformed/late inspector responses are rejected by the PR #109 `createActorInspectorDetails` adapter. The UI temporarily shows “Consultando os detalhes…” until the full detail is loaded.

**Launch on developer Vite only:** `?seed=42&paused=1&inspectorQA=1&compactActors=1`. The `compactActors` flag is ignored in production builds, even if present in the URL. The parameter does not alter physics, AI decisions, food, market, territory or stored saves.

## Tests

- `tests/compact-actor-transport.test.mjs`: three seeds and two days per seed, full world vs compact. Assert equal tiles, IDs, positions and brain lastAction; full selected actor cognition after each advance; resync/reset transport renegotiation. Verify no mutation of authoritative people.
- `scripts/benchmark-jul278-compact-actors.mjs`: three seeds and days 0,1,7. Compare entire snapshot-base JSON bytes and Node structuredClone timing (not actual Chrome Worker transfer or FPS).
- `scripts/qa-jul278-compact-inspector.mjs`: opens actual Vite game in headless Chromium, queries **person and animal** via actual selection UI and real Worker; compares all displayed inspector text and titles against the traditional snapshot mode after details arrive, records browser JS errors and protocol metadata.
- GitHub Actions `jul278-compact-actors.yml`: all of the above, artifacts retained.

## Rollout gates before changing production defaults

1. Browser QA of the map renderer with 50/500/5000 living actors, including combat, dead actors, trades, selection, minimap, new births, soldier actions, training dummies and sheep.
2. Explicit tests for inspector switching while an old Worker response is in flight, reset, and missing/dead actors on **compact** mode.
3. StructuredClone / real Worker transfer bytes, worker CPU and p95 response times, heap/GC and FPS p95 on a local hardware-accelerated browser.
4. Fallback/resync behavior when compact vs normal transport is renegotiated, plus replay determinism.
5. Ensure non-actor UI subsystems never read removed cognition keys. PR #111 only changes the game under an explicit DEV opt-in.

The previous generic entity delta (PR #101) and row-delta experiment (PR #107) are **not** enabled. The HFSM/neural states proposal JUL-292 is deferred.
