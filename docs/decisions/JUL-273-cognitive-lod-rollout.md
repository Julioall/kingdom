# JUL-273 — Cognitive LOD scheduler (experimental stage 1)
31 October 2026 · `feat/jul273-cognitive-lod-scheduler`

## Why this exists
The current Kingdom performs neural forward passes inside each actor's synchronous
daily action loop. A true multi-agent tensor batch cannot be injected into
this loop without separating the collection of observations from side effects:
earlier NPC actions can change later NPCs' perceived world state.
Preserving causal order is more important than claiming batching prematurely.

## Opt-in / rollback
Existing behavior is unchanged unless the authoritative world explicitly has:
```js
world.neuralOverrides = {
  ...world.neuralOverrides,
  cognitiveSchedule: { mode: 'budgeted', budget: 128 }
};
```
Remove `cognitiveSchedule` or set `mode: 'unlimited'` to restore one forward
per eligible neural decision. Mode `neuralController: 'legacy'` remains separate.
Do not enable by default until the JUL-274 behavioral A/B acceptance.

## Behavior and guardrails
- `beginCognitiveDay(world,living)` reserves up to `budget` ambient refresh
  slots using ID-stable rotation; static 5,000-person population with 128
  reservations has a theoretical 40-day maximum **for neural refresh**, provided
  that those actors execute eligible decisions.
- High priority bypass: controlled actor, nearby actors (18 tile radius),
  ruler, general, current campaigns/combat, severe needs, injuries and directly
  visible threats. The urgent bypass can exceed the ambient budget.
- No artificial sleeping/pausing of off-camera individuals. The entire
  `updatePeople` loop, consumption, economy, movement, military commands,
  duties and current-day action utility/masking remain in force every day.
- Each actor stores its own small, versioned cache of **only neural logits**,
  invalidated for changed actor ID, role, policy version/width/seed or world epoch.
  The cache never contains another actor's memories or permissions.
- Before receiving its first budgeted neural update, an actor uses zero neural
  logits plus today's current utility and personal learning. This is not
  equivalent to executing the full neural policy, and can change behavior.
  Different trajectories are expected when comparing LOD to unlimited.
- All scheduling is based on simulated day and actor identity; no wall-clock
  time affects the choices, preserving test replay determinism.

## Measurements and limitations
The `jul273-cognitive-ab.yml` workflow profiles 50, 500 and 5,000
**synthetic decision agents** for six simulated days in both modes, reporting
inference-window timing, caches and CPU-only overhead. This does **not**
simulate 5,000 full Kingdom agents, ecologies, paths or worker traffic and is
not evidence that 100,000 NPCs can run at 60 FPS.

Use the separate `cognitiveDayMetrics(world)` for backlog and cache metrics.
No network requests, worker-side LLM calls or graphical GPU inference are
introduced.

## Still outstanding for full JUL-273
1. True bounded batched tensor execution: collect policy observations in a
   causality-safe stage, then `inferBatch` with contiguous SoA/Float32Array
   inputs and deterministic application of validated intents.
2. Track true p50/p95/p99 end-to-end inference latency, queue waiting time,
   fairness/starvation and per-role deadlines under realistic mixed workload.
3. Compare 50/500/5,000+ **full simulation agents** (not just decision
   microbench), plus combat, player-controlled NPCs, hunger and save-resume.
4. Tune emergency thresholds, refresh budget and cognitive LOD against
   behavioral quality, not speed alone. Default activation is for JUL-274
   only after A/B gates; must remain rollback-safe.

Related: JUL-269 baseline, JUL-271 shared-policy, JUL-272 private cognition,
JUL-274 quality/rollout, JUL-277/278 Worker snapshots and deltas.
