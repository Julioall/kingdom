# JUL-270 — SharedPolicy, individual state & Worker delta contracts
_Status: accepted as **proposed types**, not runtime implementation • 31 Oct 2026_

## Evidence from existing code

- `src/controllers/individual/neural.js` allocates a full `inputWeights`/`outputWeights` pair per person/animal, with learning in `updateBrain`.
- `src/config/ecosystem.js`: 18 input features, 9 hidden neurons (50 for rulers) and 17 legacy human actions. These are **legacy compatibility facts**, not the final shared-model dimension.
- `src/simulation/individuals/actions.js` uses `choosePeopleAction` for some actors; military commands and strategic decisions also travel through rule-based paths. The shared policy must not silently replace tactical or episodic LLM channels.
- The active Worker protocol in `src/simulation/protocol.ts` provides full `WorldSnapshot` and `player-update`. `WorldDeltaV1` in the new contract is **design-only**, not sent until JUL-277/278 explicitly negotiate a protocol version.

## Architecture decision

**One shared human policy model, role-conditioned**, owned by the authoritative simulation. Civilians, workers, soldiers, generals and kings see the same model parameters, but their observations include a cognitive role, permitted capabilities and actor-specific context.

```text
Simulation Worker (authoritative)
  -> Perception gate (no omniscient actor state)
  -> ActorObservation + AgentCognitiveState
  -> SharedPolicy.inferBatch (one global immutable versioned weight bank)
  -> per-actor preference/experience adjustment + permitted action mask
  -> DecisionIntent (intent only)
  -> validator: role, resources, occupancy, rules, world revision
  -> execute/reject + per-actor reward and episodic memory
```

**Important distinctions:**
- Shared weights do not share memories. No actor may read another NPC's private beliefs just because a single neural model processes both.
- Logical roles `civilian`, `worker`, `military`, `general`, `king` are **not** direct copies of current `person.role`. The role resolver must map existing soldier ranks/general and ruler states without changing gameplay (JUL-271).
- King's strategic context and general's formation planning may have longer decision horizons and a different cadence, but not additional per-agent dense matrices.
- Ordinary NPC learning updates `AgentCognitiveState` (preferences, capped episodes, beliefs, action bias, latent state); only a controlled, explicitly versioned training process can update global weights.
- Existing local LLM/SLM strategic workflow (JUL-221) is independent and episodic; it must not become an LLM call per NPC/day/frame.
- Animals can have species-level shared policies as a separate follow-up. Do not force human/animal action spaces into the same dense human network in this phase.

## Roles and action validation

The proposed `ActorObservation` has fixed-order float features for authorised perception, role, personality, memory summary and context, plus one byte per legal action. **Intent != command**: the domain validator must still check inventory, ownership, stamina, permissions, command authority, enemy visibility, and world epoch/revision. Never infer permissions from a self-reported role alone.

The current 17 actions form a *legacy compatibility inventory*; additional military/king commands must be registered with stable indices and explicitly masked. No actor becomes automatically able to execute every action simply because one model knows them.

## Personal state budget

Persistence object contains identity, personality, preferences, bounded episodes and beliefs, goals, action bias, latent state and learning baseline. The binary hot path should use SoA or compact typed arrays rather than 100,000 JavaScript objects per tick, with explicit cold-storage memory paging and budgets measured against actual hardware. No invented fixed byte budget: decide limits during JUL-272 with heap/RSS benchmarks and truncation tests.

## Model sizing and rollout

Initial experiments: 64/128/256 hidden units; evaluate 256-512-256 (~1,024 hidden neurons, **not 1,024 parameters**) only if there is useful quality improvement. Changing weight sharing reduces model memory multiplicatively but does **not** reduce inference FLOPs per decision. Use batch scheduling, cognitive LOD and safety budgets (JUL-273) with latency and fairness gates.

Mode `neuralController=legacy|shared` remains a test flag until JUL-274 migration is validated. No automatic conversion of unknown user save formats. Seeded test fixtures, determinism when required, and independent per-actor memory tests are acceptance criteria.

## Worker delta protocol (future)

```text
initialize/reset/recovery -> versioned full snapshot { epoch, revision, ... }
advance/dispatch          -> delta { epoch, baseRevision, revision, ... }
apply if epoch matches and baseRevision == localRevision
otherwise                 -> request full snapshot; do not apply partial delta
```

`WorldDeltaV1` contains sparse entity patches/removals, dirty tile columns and view-only events/stats. Sender will use explicit field allowlists, bounded messages, transfer ownership of typed buffers when valid, and priority channels for combat. It must not serialize the raw simulation world, private NPC memory, or global neural weights to the UI.

The receiver must be idempotent on duplicate revision, detect missing/out-of-order revisions, handle reset and entity birth/death, and backpressure/coalesce without dropping user commands or causal events. Initial full snapshot remains supported for recovery. Do not change the **active** `SIMULATION_PROTOCOL_VERSION` in this task.

## Acceptance gates and links

1. This document and `src/ai/policy/contracts.ts` are additive; they change no existing runtime behavior.
2. Typecheck, published tests, replay and build pass in GitHub Actions.
3. JUL-271: role mapping, policy implementation and action masks.
4. JUL-272: bounded identity/memory, reward learning and persist/migrate.
5. JUL-273/274: batch/LOD, A/B and rollback.
6. JUL-277/278: staged implementation of Worker full+delta/resync.
7. JUL-283: manual GPU/browser QA; existing human validation need not block a technically safe dev merge.

Links: [Linear JUL-270](https://linear.app/julio-alves/issue/JUL-270) • [project](https://linear.app/julio-alves/project/kingdom-refatoracao-de-performance-e-ia-neural-compartilhada-be6ee36b56e1) • [repo](https://github.com/Julioall/kingdom).
