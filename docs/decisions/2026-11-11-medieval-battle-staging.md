# Kingdom — battlefield staging and medieval warfare realism

Date: 2026-11-11
Scope: experimental PR #115, not deployed to main.

## Product priority

**War should look like a medieval battle.** Do not choose the winning
controller based primarily on CPU, entity throughput or simulation timings.
Prioritize visible organization, credible roles, tactical transitions,
repositioning and satisfying physical contacts. CPU measurements remain
diagnostics, not an optimization target.

## Command hierarchy and battlefield sequence

1. **General** receives the campaign objective and a locally observed enemy
   report. He chooses whether to assemble, press the front or envelop the
   enemy; line/column doctrine provides the starting formation.
2. **Commanders** lead the kingdom's existing military units (up to ten
   soldiers apiece) as physical formation anchors. They move toward their
   assigned tactical objective, not the exact same tile as another commander.
3. **March:** units move in compact three-file columns.
4. **Deployment:** commanders spread along the front; troops reorganize by
   their actual medieval classes. Shield infantry makes a forward wall,
   lance-bearing soldiers extend a spear line, archers fire from the rear
   and clerics remain behind both.
5. **Contact:** the line faces the observed enemy. Units maintain relative
   slots until threat reaches actual engagement range instead of dissolving
   into twenty independent chases.
6. **Envelopment:** when the general chooses envelopment and the observed
   enemy has been reached, wing commanders first move to lateral staging
   points; once there, their squads pivot into wedges and strike the flank.
   The two stages are explicit; offsetting the wing directly toward the
   enemy is **not** considered flanking.
7. **Reserve:** the rear unit holds its position until the main battle line
   is in contact or taking pressure, then reinforces the center.
8. **Morale:** group casualties, exhaustion and campaign morale may cause
   rallying or rout. A routed group retreats; the combat resolver no longer
   issues offensive attacks while a troop is routed (manual control remains
   independent).
9. **Succession:** the military unit's existing replacement commander
   becomes the anchor after the previous one dies.

Only observed threats contribute to the general's battle plan. No global
omniscient enemy map was added. Positions are approximate target geometries:
the existing terrain, elevation, hitboxes, wall/fence collision and melee/
ranged attack rules still govern the physical battle. Formation choice does
not add hidden damage or invulnerability.

## What the player can observe

- Distinct moving ranks with fighters in front, archer/cleric support behind
- Commanders leading separate bodies instead of a blob at the destination
- Two-stage wing movements, visible wedges and stationary reserves
- Infantry bracing animation while sustaining the line
- Battle-phase changes in the military inspector, including formation,
  commander, cohesion and morale
- Maneuver events recorded in the campaign chronicle

## Acceptance criteria (visual and gameplay QA)

- A three-unit army must visibly produce a center and two separate wings.
- Two flank commanders should first move sideways, then turn and enter
  the enemy side, without jumping across obstacles.
- Shield-wall and spear-line units must preserve their ranks in open terrain.
- Archers must not walk ahead of the shield line merely to satisfy a common
  waypoint; clerics remain in support positions.
- The reserve must hold when safe and advance when the front collapses or
  calls for reinforcements.
- No troop should attack while actively routed. A new commander should
  replace a dead leader without duplicating or teleporting units.
- A squad with no available path must stay constrained by existing map rules.
- Visual tests should cover open fields, bridges, river crossings,
  walls/fortifications, obstacles and retreat under pressure. Record actual
  arrival, contact, flank success, casualties, cohesion and player-facing
  combat animations.

## Automated evidence and limitations

- `tests/squad-tactics.test.mjs` exercises class ranks, wing staging, reserve
  release, morale rout, stable anchors, succession and old-mode rollback.
- `scripts/benchmark-squad-hierarchy.mjs` now reports formation and phase
  frequencies in addition to battle counts, cohesion and campaign outcomes.
- The CI/Node benchmark is not a visual acceptance test. Browser video
  inspection remains necessary to determine whether these maneuvers look
  convincing and whether clashes naturally resolve.
- This iteration does **not** yet add cavalry units, siege engines, period-
  specific weapon loadouts, a dynamic grid of shield bracing, or unique
  historical doctrines per kingdom. The goals are behavior and choreography,
  not a verified reconstruction of one medieval army.
- Keep PR #115 as draft until graphical and large-battle verification.
