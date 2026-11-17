// Read-only snapshots used to validate whether a delegated construction task
// actually progressed. Other actions never inspect these values in
// completeCommunityTask; avoid two full structure scans per unrelated actor.
//
// Keep all formulas identical to the previous per-NPC before/after snapshot.
// A build can create an assignment during execution, so we always evaluate
// when the chosen action is 'build', even if no task was assigned beforehand.
export function constructionTaskProgress(world, community, action) {
  if (action !== 'build') return null;
  const buildProgress = world.structures
    .filter(structure => structure.communityId === (community && community.id))
    .reduce((sum, structure) => sum + (structure.progress || 0), 0);
  const repairProgress = !community ? 0 : (world.structures || [])
    .filter(structure => structure.kingdomId === community.kingdomId && structure.complete
      && structure.destroyedDay == null)
    .reduce((sum, structure) => {
      const integrity = Number.isFinite(structure.integrity) ? structure.integrity : 1;
      const health = Number.isFinite(structure.maxHealth) && structure.maxHealth > 0
        ? (Number.isFinite(structure.health) ? structure.health / structure.maxHealth : 1) : 0;
      return sum + integrity + health;
    }, 0);
  return { buildProgress, repairProgress };
}
