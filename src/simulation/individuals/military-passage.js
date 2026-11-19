// Stable, bounded priority when two friendly military units request the same
// occupied passage. This decides only whether an otherwise-safe passage yield
// may be attempted: terrain, hitboxes, combat and movement remain authoritative.
const PHASE_PRIORITY = Object.freeze({
  rout: 60, rally: 50, striking: 45, charging: 45,
  contact: 35, flanking: 30, marching: 25, deploying: 25,
  reforming: 20, holding: 10
});
const ROLE_PRIORITY = Object.freeze({
  vanguard: 5, 'flank-left': 4, 'flank-right': 4,
  support: 3, reserve: 1
});

function compareId(left, right) {
  // Both identifiers can be strings in imported/migrated military groups.
  // Locale-independent order is stable across Node and browsers.
  const a = String(left), b = String(right);
  return a === b ? 0 : a < b ? -1 : 1;
}

function priority(person) {
  return {
    phase: PHASE_PRIORITY[person.tacticalPhase] ?? 15,
    role: ROLE_PRIORITY[person.tacticalRole] ?? 2,
    leader: person.militaryRank === 'comandante' ? 1 : 0
  };
}

export function militaryPassageYieldDecision(blocker, requester) {
  if (blocker?.role !== 'soldier' || requester?.role !== 'soldier'
    || blocker.kingdomId == null || blocker.kingdomId !== requester.kingdomId
    || blocker.campaignId == null || blocker.campaignId !== requester.campaignId
    || blocker.militaryUnitId == null || requester.militaryUnitId == null
    || !blocker.tacticalRole || !requester.tacticalRole) return null;

  // Player orders and a reserve explicitly guarding its ground are not
  // silently displaced by another squad's route selection.
  if (blocker.playerControlled || requester.playerControlled
    || blocker.tacticalReserveHolding) return false;
  if (requester.tacticalReserveHolding) return false;
  // Defensive ranks may not be peeled out of their shield wall merely
  // because an allied column has a convenient route through them. A routed
  // ally may request emergency passage; physical safety still decides.
  if (['holding', 'contact'].includes(blocker.tacticalPhase)
      && requester.tacticalPhase !== 'rout') return false;

  // Within a unit, the captain has the right of way. A subordinate cannot
  // force the captain to abandon his real anchor to fill a personal slot.
  const sameUnit = String(blocker.militaryUnitId) === String(requester.militaryUnitId);
  if (sameUnit) {
    const blockerLeader = blocker.id === blocker.commanderId || blocker.militaryRank === 'comandante';
    const requesterLeader = requester.id === requester.commanderId || requester.militaryRank === 'comandante';
    if (blockerLeader !== requesterLeader) return requesterLeader;
    // Two peers must not recursively push one another in opposite directions.
    return compareId(requester.id, blocker.id) < 0;
  }

  const a = priority(requester), b = priority(blocker);
  if (a.phase !== b.phase) return a.phase > b.phase;
  if (a.role !== b.role) return a.role > b.role;
  if (a.leader !== b.leader) return a.leader > b.leader;

  // One winner for two opposed units. Unit identity, not update order,
  // breaks the tie; this avoids oscillation as member IDs change.
  return compareId(requester.militaryUnitId, blocker.militaryUnitId) < 0;
}
