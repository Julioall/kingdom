import test from 'node:test';
import assert from 'node:assert/strict';
import { HEIGHT, PLANTS, WIDTH } from '../../src/config/ecosystem.js';
import { moveOne } from '../../src/simulation/individuals/movement.js';
import { invalidateNavigation } from '../../src/simulation/individuals/navigation-cache.js';

function fixture() {
  const width = WIDTH, height = HEIGHT;
  return { day: 1, seed: 42, width, height, kingdoms: [], structures: [], people: [],
    tiles: Array.from({ length: width * height }, (_, i) => ({ i, x: i % width, y: Math.floor(i / width),
      terrain: 'land', elevationLevel: 0, heightM: 80, slope: 0, roadWear: 0, plants: new Float32Array(PLANTS.length) })) };
}
const tile = (w, x, y) => w.tiles[y * w.width + x];
const person = (id, x, y, extra = {}) => ({ id, alive: true, x, y, energy: 100, health: 100,
  hydration: 80, foodReserve: 80, travelCost: 0, role: 'resident', communityId: null, ...extra });
function corridor(w) {
  for (const t of w.tiles) t.terrain = t.y === 8 ? 'land' : 'rock';
}

test('a busy occupant causes a bounded local detour without a second full route search', () => {
  const w = fixture(), p = person(1, 4, 8), blocker = person(2, 5, 8, { assignment: { expiresDay: 10 } });
  w.people = [p, blocker];
  assert.equal(moveOne(w, p, { x: 18, y: 8 }, false), true);
  assert.equal(p.navigationReplans, 1);
  assert.equal(p.navigationLocalDetours, 1);
  assert.deepEqual([blocker.x, blocker.y], [5, 8]);
  assert.notDeepEqual([p.x, p.y], [5, 8]);
  for (let step = 0; step < 20 && p.x !== 18; step++) {
    w.day++;
    assert.equal(moveOne(w, p, { x: 18, y: 8 }, false), true);
  }
  assert.deepEqual([p.x, p.y], [18, 8]);
  assert.equal(p.navigationReplans, 1);
});

test('a crowded one-cell passage waits cheaply and resumes when its occupant leaves', () => {
  const w = fixture(); corridor(w);
  const p = person(1, 4, 8), blocker = person(2, 5, 8, { assignment: { expiresDay: 20 } });
  w.people = [p, blocker];
  for (let i = 0; i < 3; i++) {
    assert.equal(moveOne(w, p, { x: 18, y: 8 }, false), false);
    assert.deepEqual([p.x, p.y], [4, 8]);
    w.day++;
  }
  assert.equal(p.navigationReplans, 1);
  assert.equal(p.navigationCongestionWaits, 3);
  assert.equal(p.navigationFailure, undefined, 'occupancy must not mark the terrain inaccessible');
  blocker.alive = false;
  assert.equal(moveOne(w, p, { x: 18, y: 8 }, false), true);
  assert.deepEqual([p.x, p.y], [5, 8]);
  assert.equal(p.navigationReplans, 1);
});

test('persistent congestion can take a larger detour after the local waiting interval', () => {
  const w = fixture(), p = person(1, 4, 8);
  w.people = [p, ...Array.from({ length: 9 }, (_, i) => person(i + 2, 5, i + 4, { assignment: { expiresDay: 30 } }))];
  const destination = { x: 18, y: 8 };
  for (let i = 0; i < 3; i++) {
    assert.equal(moveOne(w, p, destination, false), false);
    assert.equal(p.navigationReplans, 1);
    w.day++;
  }
  assert.equal(moveOne(w, p, destination, false), true);
  assert.equal(p.navigationCongestionReplans, 1);
  assert.equal(p.navigationReplans, 2);
  for (let i = 0; i < 30 && (p.x !== 18 || p.y !== 8); i++) {
    w.day++;
    assert.equal(moveOne(w, p, destination, false), true);
    assert.ok(!w.people.some(other => other !== p && other.x === p.x && other.y === p.y));
  }
  assert.deepEqual([p.x, p.y], [18, 8]);
});

test('a failed persistent-congestion search is retried only after its cooldown', () => {
  const w = fixture(); corridor(w);
  const p = person(1, 4, 8), blocker = person(2, 5, 8, { assignment: { expiresDay: 30 } });
  w.people = [p, blocker];
  for (let i = 0; i < 8; i++) {
    assert.equal(moveOne(w, p, { x: 18, y: 8 }, false), false);
    w.day++;
  }
  assert.equal(p.navigationReplans, 2);
  assert.equal(p.navigationCongestionReplans, 1);
  assert.equal(p.navigationFailure, undefined);
  blocker.alive = false;
  assert.equal(moveOne(w, p, { x: 18, y: 8 }, false), true);
  assert.equal(p.navigationReplans, 2);
});

test('unreachable terrain is searched once, then retried after its short cooldown', () => {
  const w = fixture(); corridor(w);
  tile(w, 10, 8).terrain = 'rock';
  const p = person(1, 4, 8); w.people = [p];
  const destination = { x: 18, y: 8 };
  assert.equal(moveOne(w, p, destination, false), false);
  assert.equal(p.navigationReplans, 1);
  w.day++;
  assert.equal(moveOne(w, p, destination, false), false);
  assert.equal(p.navigationReplans, 1);
  assert.equal(p.navigationFailureCacheHits, 1);
  w.day = p.navigationFailure.retryDay;
  assert.equal(moveOne(w, p, destination, false), false);
  assert.equal(p.navigationReplans, 2);
});

test('a remote map change invalidates failed routes immediately', () => {
  const w = fixture(); corridor(w);
  tile(w, 10, 8).terrain = 'rock';
  const p = person(1, 4, 8); w.people = [p];
  assert.equal(moveOne(w, p, { x: 18, y: 8 }, false), false);
  tile(w, 10, 8).terrain = 'land';
  invalidateNavigation(w);
  assert.equal(moveOne(w, p, { x: 18, y: 8 }, false), true);
  assert.equal(p.navigationReplans, 2);
});

test('a common destination reuses a corridor from a neighboring start with an independent path', () => {
  const w = fixture(), a = person(1, 4, 8), b = person(2, 4, 9);
  const destination = { x: 18, y: 8 };
  moveOne(w, a, destination, false);
  assert.equal(a.navigationReplans, 1);
  assert.equal(moveOne(w, b, destination, false), true);
  assert.equal(b.navigationSharedCacheHits, 1);
  assert.equal(b.navigationReplans || 0, 0);
  const index = a.navigationRoute.path[3];
  b.navigationRoute.path[3] = -1;
  assert.equal(a.navigationRoute.path[3], index, 'one follower must not mutate the leader route');
});

test('a common route is validated again after an unannounced obstacle appears', () => {
  const w = fixture(), a = person(1, 4, 8), b = person(2, 4, 9);
  const destination = { x: 18, y: 8 };
  moveOne(w, a, destination, false);
  tile(w, 10, 8).terrain = 'rock';
  assert.equal(moveOne(w, b, destination, false), true);
  assert.equal(b.navigationSharedCacheHits || 0, 0);
  assert.equal(b.navigationReplans, 1);
  assert.ok(!b.navigationRoute.path.includes(tile(w, 10, 8).i));
});

test('shared routing and failed-route memories respect changing territorial permissions', () => {
  const w = fixture(); corridor(w);
  for (let x = 10; x < w.width; x++) tile(w, x, 8).kingdomId = 2;
  w.kingdoms = [{ id: 1 }, { id: 2 }];
  const a = person(1, 4, 8), b = person(2, 4, 8, { kingdomId: 1, territoryWarnings: { 2: 20 } });
  const destination = { x: 18, y: 8 };
  assert.equal(moveOne(w, a, destination, false), true);
  assert.equal(moveOne(w, b, destination, false), false);
  assert.equal(b.navigationSharedCacheHits || 0, 0);
  const replans = b.navigationReplans;
  b.role = 'soldier'; b.campaignId = 7;
  assert.equal(moveOne(w, b, destination, false), true);
  assert.equal(b.navigationSharedCacheHits, 1);
  assert.equal(b.navigationReplans, replans);
});

test('custom movement predicates bypass shared routes and failure cooldowns', () => {
  const w = fixture(), p = person(1, 4, 8);
  const destination = { x: 18, y: 8 };
  const options = { allowedTile: t => t.x === 4 && t.y === 8 };
  assert.equal(moveOne(w, p, destination, false, options), false);
  options.allowedTile = () => true;
  assert.equal(moveOne(w, p, destination, false, options), true);
  assert.equal(p.navigationReplans, 2);
  assert.equal(p.navigationFailure, undefined);
});

test('common corridors do not mix road preferences or approach radii', () => {
  for (const options of [{ preferRoads: true }, { arrivalRadius: 3 }]) {
    const w = fixture(), a = person(1, 4, 8), b = person(2, 4, 9);
    const destination = { x: 18, y: 8 };
    moveOne(w, a, destination, false);
    assert.equal(moveOne(w, b, destination, false, options), true);
    assert.equal(b.navigationSharedCacheHits || 0, 0);
    assert.equal(b.navigationReplans, 1);
  }
});

test('common corridors expire so new journeys can account for changed road costs', () => {
  const w = fixture(), a = person(1, 4, 8), b = person(2, 4, 9);
  const destination = { x: 18, y: 8 };
  moveOne(w, a, destination, false);
  w.day += 14;
  assert.equal(moveOne(w, b, destination, false), true);
  assert.equal(b.navigationSharedCacheHits || 0, 0);
  assert.equal(b.navigationReplans, 1);
});

test('a changed corral gate invalidates an otherwise cached inaccessible route', () => {
  const w = fixture(); corridor(w);
  const pen = { id: 1, type: 'curral', complete: true, x: 12, y: 6, radius: 2 };
  w.structures.push(pen);
  // The corral's southern fence crosses the only corridor between endpoints.
  const p = person(1, 4, 8), destination = { x: 18, y: 8 };
  assert.equal(moveOne(w, p, destination, false), false);
  pen.complete = false;
  assert.equal(moveOne(w, p, destination, false), true);
  assert.equal(p.navigationReplans, 2);
});
