import test from 'node:test';
import assert from 'node:assert/strict';
import { runMilitaryJourney } from '../scripts/audit-medieval-unit-journey.mjs';

for (const units of [3, 4, 5]) {
  test('medieval army of ' + units + ' squads passes physical journey safety audit', () => {
    const result = runMilitaryJourney({ seed: 42, units, days: 100 });
    assert.equal(result.soldierCount, units * 10);
    assert.equal(result.safety.illegalTerrain, 0,
      'no soldier enters a rock, water or non-walkable bridge cell');
    assert.equal(result.safety.overlaps, 0,
      'no soldiers overlap at any stage of the controlled journey');
    assert.equal(result.safety.jumps, 0,
      'no actor is teleported across the bridge');
    assert.ok(result.milestones.march != null, 'squads must receive march orders');
    assert.ok(result.milestones.bridgeEntered != null,
      'at least one squad must truly reach and enter the bridge');
    assert.ok(result.maxCrossed > 0,
      'at least one soldier must physically cross to the far bank');
    assert.ok(result.corridor.blocked >= 0 && result.corridor.releases >= 0);
  });
}

test('three-unit same-seed journey produces an identical audited replay', () => {
  const options = { seed: 2026, units: 3, days: 35 };
  const first = runMilitaryJourney(options);
  const second = runMilitaryJourney(options);
  assert.equal(first.digest, second.digest,
    'authoritative positions, milestones, health and decisions must replay');
});
