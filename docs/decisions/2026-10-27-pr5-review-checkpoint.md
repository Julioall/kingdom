# PR #5 review checkpoint — 2026-10-27

## Scope and disposition

This is a readiness checkpoint for PR #5, not a complete approval of its 143-commit, 221-file diff. The review inspected the latest food-throughput slice (`src/config/ecosystem.js`, `src/simulation/individuals/actions.js`, `src/simulation/society/governance.js`, and the related conservation/calendar tests), the CI workflow, the exact PR head, and the open acceptance criteria. No code change was made during this checkpoint.

**Disposition: keep PR #5 in draft; do not merge.** The workflow and browser boot pass, but the branch is not ready for review as the completed JUL-195 phase. The remaining food, flock, market, model-evaluation, and full-diff review criteria are material.

## Branch and local-work preservation

- Branch: `test/kingdom-autonomous`.
- PR head: `211e2b32e3137009174ea4873a0d4009b7d0c263`.
- `kingdom/main` at review: `b36727648370ac52a02707b86fbcfcb5a9315d10`, matching PR base.
- Branch is 143 commits ahead and zero behind the fetched remote main.
- The pre-existing audio/UI/doc edits, reports, and assets in the main checkout were left untouched and unstaged. A detached worktree at the PR head was used for the browser smoke.

## CI and browser smoke

- GitHub Actions run [#134](https://github.com/Julioall/kingdom/actions/runs/40479627600), queried for the exact PR head, completed successfully. All steps passed: checkout, Node setup, `npm ci`, typecheck, published test suite, deterministic food replay smoke, and production build.
- `npm ci` also completed in the detached review worktree. The local environment warned that install scripts for `onnxruntime-node` and `protobufjs` were blocked; this did not block Vite boot, and the GitHub CI install step passed.
- Browser smoke at `http://127.0.0.1:4177/` in the detached head checkout reached the playable world, displayed both kingdoms and the 96-person HUD, and advanced to day 4. `src/app/session.ts` constructs the simulation Worker. This checks boot and simulation progression only; it is not an AI-model benchmark or the full gameplay matrix.
- No screenshot was attached: this checkpoint has no visual or combat code change.

## Focused food-slice review

Harvest capacity is applied before crop biomass is debited, and the conservation test checks the 24-unit transfer. Field assignments persist until the shared-stock target is reached, with tests for the 49/50/51 population capacity estimate and duplicate assignment prevention. The annual-average crop growth change does not introduce seasonal growth; the existing seasonality test asserts that invariant.

The implementation still does **not** demonstrate the product criterion that one active farm plus one flock sustainably supports 50 residents. In the current replay evidence, a completed field supplies about 22–27 units/day against an estimated 54.17 units/day for 50 adults, and sheep meat contribution is zero in the paired 365-day sample. These are acceptance gaps, not reasons to mask starvation or infer sustainability from standing crop biomass.

## Remaining gates

- JUL-178 and JUL-224 remain open; the full seed/horizon/repeat matrix and sustainable farm-plus-flock contribution are not demonstrated.
- JUL-199 and JUL-201 remain blocked on the food baseline/dependencies; sheep reproduction/meat and the seed-buying/market cycle need implementation and evidence.
- JUL-221 remains open; the browser-model comparison is exploratory and does not satisfy its controlled per-role evaluation matrix.
- JUL-177 still needs the baseline/smoke evidence aligned to its acceptance on the current integrated SHA. JUL-194's tactical holdouts, regression matrix, and full final report remain outstanding.
- This was not a line-by-line review of all 143 commits. A full PR review, final-SHA gameplay/replay gates, and applicable CI checks are still required before marking ready.

## Source and limitations

The Linear `get_agent_context` tool returned `Tool get_agent_context not found` on this run; issue descriptions, their current relations, the repository, CI evidence, and the saved decisions were used instead. Consensus's earlier quota limit remains documented in the decisions log; no new research claim was needed for this readiness check.
