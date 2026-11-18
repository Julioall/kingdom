// Interpret CPU samples from the REAL simulation; never mutate world state.
// Exclusive: sample's own function. Inclusive: at least one ancestor in the
// sampled stack belongs to this area. Inclusive areas MAY OVERLAP.
const AREAS = Object.freeze([
  'routeSearch', 'routeReuse', 'congestion', 'collision',
  'movement', 'activitySelection', 'taskDelegation', 'constructionPlanning'
]);

function sourceFile(frame) {
  const url = String(frame?.url || '').replaceAll('\\', '/');
  const src = url.lastIndexOf('/src/');
  return src >= 0 ? url.slice(src + 1) : url.startsWith('src/') ? url : '';
}

export function npcHotspotArea(frame) {
  const name = String(frame?.functionName || ''), path = sourceFile(frame);
  if (!path.startsWith('src/')) return null;
  if (path === 'src/simulation/individuals/navigation.js'
      || path === 'src/simulation/individuals/navigation-cache.js') {
    if (name === 'findPreferredRoute') return 'routeSearch';
    if (['rememberedRouteStep', 'rememberRouteArrival', 'commonRouteFrom',
      'rememberCommonRoute', 'localExitMask'].includes(name)) return 'routeReuse';
    if (name === 'congestionRouteStep') return 'congestion';
  }
  if (path === 'src/simulation/individuals/movement.js') {
    if (name === 'findRouteStep') return 'routeSearch';
    if (['localCongestionStep', 'persistentCongestionStep', 'respondToPassageRequest',
      'canYieldPassage', 'personOnTile'].includes(name)) return 'congestion';
    if (['canEnter', 'canStep'].includes(name)) return 'collision';
    if (['moveOne', 'reachableAreaAround', 'corralGate', 'corralWaypoint'].includes(name))
      return 'movement';
  }
  if (path === 'src/simulation/individuals/spatial-index.js'
      || path === 'src/simulation/physics/hitboxes.js'
      || path === 'src/simulation/physics/structure-source-snapshot.js')
    return 'collision';
  if (path === 'src/simulation/settlements/construction.js'
      && ['chooseBuildSite', 'workOnCommunityStructure', 'canCommunityBuild',
        'communityBuildUtility', 'overlapsSiteResources', 'nextCommunityStructure'].includes(name))
    return 'constructionPlanning';
  if (path === 'src/simulation/world/building-clearance.js'
      && name === 'hasBuildingResourceClearance') return 'constructionPlanning';
  if (path === 'src/simulation/individuals/action-state-machine.js'
      && name === 'selectNpcActivity') return 'activitySelection';
  if (['choosePeopleAction', 'chooseMilitaryAction', 'buildPeoplePolicyInputs',
    'buildPeopleActionUtilities'].includes(name)
      && (path.startsWith('src/simulation/individuals/')
        || path.startsWith('src/ai/'))) return 'activitySelection';
  if (path === 'src/simulation/society/governance.js'
      && (name.startsWith('assign') || name === 'completeCommunityTask'
        || name === 'updateCommunityGovernance')) return 'taskDelegation';
  if (path === 'src/simulation/individuals/construction-task-progress.js'
      && name === 'constructionTaskProgress') return 'taskDelegation';
  return null;
}

export function analyzeNpcCpuHotspots(profile) {
  if (!profile || !Array.isArray(profile.nodes)) throw new TypeError('Invalid CPU profile');
  const nodes = new Map(profile.nodes.map(node => [node.id, node]));
  const parents = new Map();
  for (const node of profile.nodes) for (const child of node.children || [])
    parents.set(child, node.id);
  const samples = Array.isArray(profile.samples) && profile.samples.length
    ? profile.samples : profile.nodes.flatMap(node =>
      Array.from({ length: Math.max(0, node.hitCount | 0) }, () => node.id));
  const areas = Object.fromEntries(AREAS.map(area =>
    [area, { exclusiveSamples: 0, inclusiveSamples: 0 }]));
  let categorizedSamples = 0;
  for (const id of samples) {
    const self = nodes.get(id);
    if (!self) continue;
    const direct = npcHotspotArea(self.callFrame);
    if (direct) areas[direct].exclusiveSamples++;
    const inclusive = new Set();
    let cursor = id;
    const visited = new Set();
    while (cursor != null && !visited.has(cursor)) {
      visited.add(cursor);
      const area = npcHotspotArea(nodes.get(cursor)?.callFrame);
      if (area) inclusive.add(area);
      cursor = parents.get(cursor);
    }
    if (inclusive.size) categorizedSamples++;
    for (const area of inclusive) areas[area].inclusiveSamples++;
  }
  const totalSamples = samples.length;
  const percent = count => totalSamples ? +(100 * count / totalSamples).toFixed(2) : 0;
  for (const area of AREAS) {
    areas[area].exclusiveSharePercent = percent(areas[area].exclusiveSamples);
    areas[area].inclusiveSharePercent = percent(areas[area].inclusiveSamples);
  }
  return {
    schemaVersion: 1, totalSamples, categorizedSamples, categorizedSharePercent: percent(categorizedSamples),
    areas, rankingByInclusiveSamples: AREAS.slice().sort((a, b) =>
      areas[b].inclusiveSamples - areas[a].inclusiveSamples),
    caveats: [
      'V8 CPU sampling, not exact function invocation counts or per-call milliseconds.',
      'Inclusive samples overlap across ancestor areas and must never be summed.',
      'The Worker runs comparable simulation code but Node profiling is not browser Worker timing.',
      'RAF/frame p95, Canvas commands, GPU completion and snapshot transport are separate measurements.'
    ]
  };
}
