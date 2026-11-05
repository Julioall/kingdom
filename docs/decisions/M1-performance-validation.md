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
