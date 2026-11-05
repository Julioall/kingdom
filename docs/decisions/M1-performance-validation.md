# M1 — Population performance validation

## Acceptance

Keep the complete simulation, individual cognition and deterministic replay. The
target is both at most 300 seconds per day for 5,000 actors and at least 20%
improvement against an equivalent baseline on the same benchmark host. A local
result cannot establish improvement against the historical GitHub runner result.
Do not enable neural batching until its complete-world benefit is measured.

## Reproducible measurements

Use `node scripts/benchmark-m1.mjs POPULATION SEED DAYS OUTPUT.json SCHEDULE` in each
checkout. Write output outside the repository. The harness records host, Node,
commit, elapsed step time, process CPU, post-step memory, surviving actors and an
authoritative snapshot digest for every day. Snapshot hashing is outside timed
steps. `SCHEDULE` defaults to `unlimited`; `budgeted` explicitly uses budget 128.
The historical budgeted measurement must be reproduced with equivalent flags
and host before comparing against its reported 377 seconds. Reports include a
digest of the tracked source diff to distinguish local candidate revisions.

Compare baseline and candidate sequentially using populations 500, 1,000 and
5,000 and seeds 1, 42 and 2026. Repeat with reversed execution order to assess
warmup and host noise. Require matching per-day digests for changes that preserve
semantics. Record failures rather than averaging them away. Include prolonged
campaign, economy, combat and survival scenarios before accepting M1.

Name the outputs `baseline-POPULATION-SEED.json` and
`candidate-POPULATION-SEED.json` in one external directory. Run
`node scripts/compare-m1-results.mjs DIRECTORY` after the matrix completes.
Missing files, mismatched environment/configuration and divergent snapshots
reject the comparison. The reported timing gate applies only to that matrix;
it does not establish prolonged functional stability or completion of M1.

Memory samples are not peak memory. This harness measures neither GPU nor browser
latency. Worker transport integrity and resynchronization require their own tests.
Commit metadata alone does not identify uncommitted candidate changes; preserve
the candidate diff alongside output until a candidate commit exists.

## Rejected social-grid experiment

`updateSocialLinks` builds a temporary grid for living actors and evaluates
neighboring cells, keeping the original array order of pairs and the exact final
distance predicate. Positions are stable during these interactions. The grid is
rebuilt on each call; invalid coordinates retain the original all-pairs path.
Membership, trust, food and conversation effects execute in their original order.
Dense populations can still require quadratic work; a speedup is not guaranteed.

The initial same-host 5,000-person seed-1 pair preserved the snapshot digest but
regressed from 161,394 ms to 214,256 ms (32.75% slower). The grid implementation
was removed before integration. Smaller population results were mixed. These
measurements reject this candidate; they do not establish the M1 performance goal.

## Current measured candidates

The current simulation changes reorder read-only local-defense filters ahead of
the recent-victim scan, use the existing per-update people-ID index in trade,
reuse mineral field names, and compare structure geometry before rebuilding its
text signature. A private geometry copy includes polygon points; the original
signature function remains authoritative whenever geometry changes. No revision
counter substitutes for live geometry checks.

The geometry comparison uses direct field access. An isolated 30-building,
10,000-query experiment with reversed execution order preserved signatures and
measured 38–52 ms versus 83–96 ms baseline. This is not complete-world evidence.
The budget-128 matrix in isolated baseline/candidate checkouts must establish
whole-world timing and per-seed parity before accepting the changes.

M1 remains open until paired performance, three-seed reproducibility, prolonged
functional validation, tests, typecheck, build and integration into dev are proven.

## Local full-world matrix — 5 November 2026

Same-host sequential baseline/candidate, Node v24.22.1, Windows 10.0.26200,
Intel Core i7-12700, approximately 16 GB RAM. Baseline is `6022a32`; the isolated
candidate source diff SHA-256 is
`97d01ef10241813668f4b8578cd0db2b5a6eccb293487d61a58d2a475e345101`.
The candidate contains the four simulation changes described above; Worker delta
packing does not participate in the timed complete-world step.

All nine scenarios (500/1,000/5,000 actors × seeds 1/42/2026) preserved the
authoritative snapshot digest after one day. Budgeted neural schedule is 128.

| 5,000-actor seed | Baseline seconds | Candidate seconds | Reduction |
| --- | ---: | ---: | ---: |
| 1 | 156.465 | 99.975 | 36.10% |
| 42 | 163.191 | 97.407 | 40.31% |
| 2026 | 152.140 | 116.413 | 23.48% |

All 5,000 actors survived each scenario. The strict local timing gate passed.
This is one pair per seed; reversed-order reference-runner measurements and
30-day behavioral comparisons remain pending. These results do not establish
browser FPS, peak memory, multi-day performance at 5,000 actors, or complete M1
acceptance. Raw logs and JSON remain outside production files.

## Prolonged behavior and verification

Thirty days × seeds 1/42/2026 × legacy/shared-unlimited/shared-budgeted were run
twice per scenario in both baseline and candidate. All 270 paired daily snapshot
digests and all nine behavioral summaries matched. Within-mode replays passed.
These ordinary-population scenarios observed trades and births and no deaths;
they do not establish thirty-day performance at 5,000 actors or force a war.
The complete 666-test suite, typecheck, asset checks and production build passed
locally; PR CI also passed for the simulation commit `a1926f5`.

The Worker field-delta encoder now stops allocating once its monotonic payload
byte count reaches the full-snapshot fallback threshold. Existing field-delta
and atomicity tests passed. A dense 12,544-tile isolated fallback measurement
was 161–184 ms versus 184–193 ms baseline over 15 calls. This change reduces
wasted packing; it does not implement origin-level tile dirty tracking or avoid
the complete snapshot scan. That part of M1.2 remains open.

Physical and economic update frequencies were retained because reducing them
would require separate causal and behavioral evidence. No new default cognitive
LOD or batched inference mode is enabled by this candidate. Existing individual
cognition and scheduler tests remain part of the required complete suite.
