import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectNpcCongestion } from '../scripts/support/npc-congestion-diagnostics.mjs';

const person = (id, x, y, details = {}) => ({
  id, x, y, alive: true, role: 'resident',
  brain: {lastAction: 'build'}, ...details
});
test('diagnoses blocked TODAY vs stale and occupied next-grid-cell separately', () => {
  const blocked = person(1, 1, 1, {
    navigationCongestion: {blockedDays: 2, lastBlockedDay: 3,
      startIndex: 21, nextSearchDay: 7},
    navigationRoute: {cursor: 0, completed: false, path: [21, 22, 23]}
  });
  const occupant = person(2, 2, 1);
  const stale = person(3, 4, 4, {
    role: 'soldier', brain: {lastAction: 'campaign'},
    navigationCongestion: {blockedDays: 6, lastBlockedDay: 2,
      startIndex: 79, nextSearchDay: 3},
    navigationRoute: {cursor: 0, completed: false, path: [84, 85]}
  });
  const uncertain = person(4, 9, 3, {
    navigationCongestion: {blockedDays: 1, lastBlockedDay: 3,
      startIndex: 69, nextSearchDay: 5}
  });
  const world = {day: 4, width: 20, people: [blocked, occupant, stale, uncertain]};
  const copy = structuredClone(world);
  const s = inspectNpcCongestion(world);
  assert.equal(s.peopleAlive, 4);
  assert.equal(s.withCongestionRecord, 3);
  assert.equal(s.blockedThisDay, 2);
  assert.equal(s.staleCongestionRecords, 1);
  assert.equal(s.sameStartTile, 2);
  assert.equal(s.movedSinceBlockedStart, 1);
  assert.equal(s.nextRouteTileOccupied, 1);
  assert.equal(s.nextRouteTileUnoccupied, 1);
  assert.equal(s.nextRouteTileUnavailable, 1);
  assert.equal(s.retryScheduledAfterToday, 2);
  assert.deepEqual(s.byBlockedDays, {one: 1, two: 1, threeToFive: 0, sixPlus: 1});
  assert.deepEqual(s.byRole, {resident: 2, soldier: 1});
  assert.deepEqual(world, copy, 'read-only diagnostics must never change AI or navigation');
});
test('no congestion is a valid zero-result report', () => {
  const s = inspectNpcCongestion({width: 100, day: 1, people: [
    person(1, 1, 1), person(2, 1, 1, {alive: false})
  ]});
  assert.equal(s.peopleAlive, 1);
  assert.equal(s.withCongestionRecord, 0);
  assert.equal(s.nextRouteTileUnavailable, 0);
  assert.equal(s.maxBlockedDays, 0);
});
