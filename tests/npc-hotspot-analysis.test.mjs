import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeNpcCpuHotspots, npcHotspotArea }
  from '../src/simulation/observability/npc-hotspot-analysis.js';

const frame = (functionName, path) => ({functionName, url: 'file:///repo/' + path});

test('qualifies real route, congestion, collision, decision and delegation symbols', () => {
  const cases = [
    ['findPreferredRoute', 'src/simulation/individuals/navigation.js', 'routeSearch'],
    ['findRouteStep', 'src/simulation/individuals/movement.js', 'routeSearch'],
    ['rememberedRouteStep', 'src/simulation/individuals/navigation.js', 'routeReuse'],
    ['commonRouteFrom', 'src/simulation/individuals/navigation-cache.js', 'routeReuse'],
    ['localCongestionStep', 'src/simulation/individuals/movement.js', 'congestion'],
    ['respondToPassageRequest', 'src/simulation/individuals/movement.js', 'congestion'],
    ['hitboxesOverlap', 'src/simulation/physics/hitboxes.js', 'collision'],
    ['canStep', 'src/simulation/individuals/movement.js', 'collision'],
    ['moveOne', 'src/simulation/individuals/movement.js', 'movement'],
    ['selectNpcActivity', 'src/simulation/individuals/action-state-machine.js', 'activitySelection'],
    ['choosePeopleAction', 'src/simulation/individuals/actions.js', 'activitySelection'],
    ['completeCommunityTask', 'src/simulation/society/governance.js', 'taskDelegation'],
    ['constructionTaskProgress', 'src/simulation/individuals/construction-task-progress.js', 'taskDelegation'],
    ['chooseBuildSite', 'src/simulation/settlements/construction.js', 'constructionPlanning'],
    ['hasBuildingResourceClearance', 'src/simulation/world/building-clearance.js', 'constructionPlanning']
  ];
  for (const [name, path, expected] of cases)
    assert.equal(npcHotspotArea(frame(name, path)), expected, name);
  assert.equal(npcHotspotArea(frame('findPreferredRoute', 'src/ui/game.js')), null);
  assert.equal(npcHotspotArea({ functionName: 'anything', url: '' }), null);
});

test('exclusive CPU samples are disjoint; inclusive ancestor areas can overlap', () => {
  const path = 'src/simulation/individuals/movement.js';
  const profile = {
    nodes: [
      { id: 1, callFrame: frame('(root)', 'src/simulation/engine.js'), children: [2, 6] },
      { id: 2, callFrame: frame('moveOne', path), children: [3] },
      { id: 3, callFrame: frame('findRouteStep', path), children: [4] },
      { id: 4, callFrame: frame('canStep', path), children: [5] },
      { id: 5, callFrame: frame('hitboxesOverlap', 'src/simulation/physics/hitboxes.js') },
      { id: 6, callFrame: frame('completeCommunityTask', 'src/simulation/society/governance.js') }
    ],
    samples: [2, 3, 4, 5, 6, 5, 2]
  };
  const report = analyzeNpcCpuHotspots(profile);
  assert.equal(report.totalSamples, 7);
  assert.equal(report.areas.movement.exclusiveSamples, 2);
  assert.equal(report.areas.movement.inclusiveSamples, 6);
  assert.equal(report.areas.routeSearch.exclusiveSamples, 1);
  assert.equal(report.areas.routeSearch.inclusiveSamples, 4);
  assert.equal(report.areas.collision.exclusiveSamples, 3);
  assert.equal(report.areas.collision.inclusiveSamples, 3);
  assert.equal(report.areas.taskDelegation.exclusiveSamples, 1);
  assert.equal(report.categorizedSamples, 7);
  assert.equal(report.areas.movement.inclusiveSharePercent, 85.71);
});

test('native/unknown samples are excluded from attributed coverage, but remain in denominator', () => {
  const report = analyzeNpcCpuHotspots({
    nodes: [
      { id: 1, callFrame: { functionName: '(root)', url: '' }, children: [2] },
      { id: 2, callFrame: frame('selectNpcActivity', 'src/simulation/individuals/action-state-machine.js') }
    ],
    samples: [1, 1, 2, 1]
  });
  assert.equal(report.totalSamples, 4);
  assert.equal(report.categorizedSamples, 1);
  assert.equal(report.categorizedSharePercent, 25);
  assert.equal(report.areas.activitySelection.inclusiveSharePercent, 25);
  assert.throws(() => analyzeNpcCpuHotspots(undefined), TypeError);
});

test('V8 profiles without explicit samples use hitCounts', () => {
  const report = analyzeNpcCpuHotspots({nodes: [{
    id: 9, hitCount: 5, callFrame: frame('selectNpcActivity',
      'src/simulation/individuals/action-state-machine.js')
  }]});
  assert.equal(report.totalSamples, 5);
  assert.equal(report.areas.activitySelection.exclusiveSamples, 5);
  assert.equal(report.areas.activitySelection.inclusiveSamples, 5);
});
