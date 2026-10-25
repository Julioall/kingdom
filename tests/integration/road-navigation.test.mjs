import test from 'node:test';
import assert from 'node:assert/strict';
import Sim from '../../src/simulation/engine.js';
import { moveOne } from '../../src/simulation/individuals/movement.js';
import { makePerson } from '../../src/simulation/individuals/lifecycle.js';
import { isRoadTile, recordFootstep, updateRoadWear } from '../../src/simulation/world/roads.js';

function fixture() {
  const width = Sim.width, height = Sim.height;
  return { day: 1, width, height, kingdoms: [], structures: [], people: [],
    tiles: Array.from({ length: width * height }, (_, i) => ({ i, x: i % width, y: Math.floor(i / width),
      terrain: 'land', elevationLevel: 0, heightM: 80, slope: 0, roadWear: 0, plants: new Float32Array(Sim.plants.length) })) };
}
const resident = () => ({ id: 1, x: 20, y: 10, energy: 100, travelCost: 0, communityId: null });
const person = (id, x, y, extra = {}) => ({ id, alive: true, x, y, energy: 100, health: 100,
  travelCost: 0, communityId: null, role: 'resident', ...extra });
const tile = (w, x, y) => w.tiles[y * w.width + x];
function travel(w, p, destination) {
  for (let i = 0; i < 80 && (p.x !== destination.x || p.y !== destination.y); i++) {
    assert.equal(moveOne(w, p, destination, false), true);
    w.day++;
  }
  assert.deepEqual([p.x, p.y], [destination.x, destination.y]);
}

test('established paths remain visible and consolidated streets remain fast after a year without traffic', () => {
  for (const [steps, fast] of [[24, false], [48, true]]) {
    const t = { terrain: 'land', roadWear: 0 };
    for (let n = 0; n < steps; n++) recordFootstep(t, resident(), 10);
    const w = { tiles: [t], width: 1, height: 1, people: [], structures: [] };
    for (let day = 0; day < 365; day++) updateRoadWear(w);
    assert.equal(isRoadTile(t, fast), true);
    assert.equal(t.lastRoadUseDay, 10);
  }
});

test('abandoned trails still disappear eventually and animal tracks do not maintain streets', () => {
  const t = { terrain: 'land', roadWear: 3 };
  recordFootstep(t, { speciesId: 'sheep' }, 1);
  assert.equal(t.roadWear, 3);
  const w = { tiles: [t], width: 1, height: 1, people: [], structures: [] };
  for (let day = 0; day < 4000; day++) updateRoadWear(w);
  assert.equal(t.roadWear, 0);
});

test('inhabitants choose a useful street detour and remember the successful route back', () => {
  const w = fixture(), p = resident();
  for (let x = 20; x <= 35; x++) tile(w, x, 8).roadWear = 12;
  for (const x of [20, 35]) for (let y = 8; y <= 10; y++) tile(w, x, y).roadWear = 12;
  moveOne(w, p, { x: 35, y: 10 }, false);
  assert.ok(p.y < 10, 'the faster existing street beats walking straight over open ground');
  travel(w, p, { x: 35, y: 10 });
  assert.ok(p.knownRoutes.length > 0);
  const replans = p.navigationReplans;
  travel(w, p, { x: 20, y: 10 });
  assert.ok(p.navigationCacheHits > 0, 'return journeys reuse the learned route');
  assert.equal(p.navigationReplans, replans);
});

test('a newly blocked remembered path is replanned without entering the obstacle', () => {
  const w = fixture(), p = resident(), destination = { x: 32, y: 10 };
  moveOne(w, p, destination, false);
  const nextIndex = p.navigationRoute.path[p.navigationRoute.path.indexOf(tile(w, p.x, p.y).i) + 1];
  const blocked = w.tiles[nextIndex]; blocked.terrain = 'rock';
  const replans = p.navigationReplans;
  assert.equal(moveOne(w, p, destination, false), true);
  assert.notDeepEqual([p.x, p.y], [blocked.x, blocked.y]);
  assert.ok(p.navigationReplans > replans);
  travel(w, p, destination);
});

test('cached routes obey updated movement restrictions and stop when no legal exit remains', () => {
  const w = fixture(), p = resident(), destination = { x: 32, y: 10 };
  moveOne(w, p, destination, false);
  const start = { x: p.x, y: p.y };
  assert.equal(moveOne(w, p, destination, false, { allowedTile: t => t.x === start.x && t.y === start.y }), false);
  assert.deepEqual([p.x, p.y], [start.x, start.y]);
});

test('a free NPC accepts a passage request and moves aside before the requester enters', () => {
  const w = fixture(), requester = person(1, 20, 10), blocker = person(2, 21, 10);
  w.people.push(requester, blocker);

  assert.equal(moveOne(w, requester, { x: 25, y: 10 }, false), true);

  assert.deepEqual([requester.x, requester.y], [21, 10]);
  assert.notDeepEqual([blocker.x, blocker.y], [21, 10]);
  assert.equal(requester.passageResponse.accepted, true);
  assert.equal(requester.passageResponse.personId, blocker.id);
  assert.equal(new Set(w.people.map(p => Math.round(p.x) + ':' + Math.round(p.y))).size, 2);
});

test('a busy NPC refuses passage but the requester reroutes without sharing its position', () => {
  const w = fixture(), requester = person(1, 20, 10);
  const blocker = person(2, 21, 10, { assignment: { expiresDay: 5 } });
  w.people.push(requester, blocker);

  assert.equal(moveOne(w, requester, { x: 25, y: 10 }, false), true);

  assert.deepEqual([blocker.x, blocker.y], [21, 10]);
  assert.equal(requester.passageResponse.accepted, false);
  assert.notDeepEqual([requester.x, requester.y], [blocker.x, blocker.y]);
  assert.equal(new Set(w.people.map(p => Math.round(p.x) + ':' + Math.round(p.y))).size, 2);
});

test('new NPCs spawn on a free land tile when their requested position is occupied', () => {
  const w = fixture();
  w.rngState = 42;
  w.nextId = 1;
  w.people.push(person(0, 20, 10));

  const newcomer = makePerson(w, 20, 10, false);

  assert.notDeepEqual([newcomer.x, newcomer.y], [20, 10]);
  assert.notEqual(tile(w, newcomer.x, newcomer.y).terrain, 'water');
  assert.notEqual(tile(w, newcomer.x, newcomer.y).terrain, 'rock');
});

test('allied campaign soldiers yield at a bottleneck while hostile soldiers hold their ground', () => {
  for (const hostile of [false, true]) {
    const w = fixture();
    const requester = person(1, 20, 10, { role: 'soldier', campaignId: 7, kingdomId: 1, brain: { lastAction: 'campaign' } });
    const blocker = person(2, 21, 10, { role: 'soldier', campaignId: 7, kingdomId: hostile ? 2 : 1, brain: { lastAction: 'campaign' } });
    w.people = [requester, blocker];
    for (const t of w.tiles) t.terrain = 'rock';
    for (let x = 20; x <= 25; x++) tile(w, x, 10).terrain = 'land';
    tile(w, 21, 9).terrain = 'land';
    const moved = moveOne(w, requester, { x: 25, y: 10 }, false);
    assert.equal(moved, !hostile);
    assert.equal(requester.passageResponse.accepted, !hostile);
    assert.notDeepEqual([requester.x, requester.y], [blocker.x, blocker.y]);
    if (!hostile) assert.deepEqual([blocker.x, blocker.y], [21, 9]);
  }
});

test('an inaccessible exact position can be approached on reachable ground without crossing water', () => {
  const w = fixture(), p = person(1, 20, 10), destination = { x: 30, y: 10 };
  w.people = [p];
  // The destination is land enclosed by water, so exact routing cannot reach it.
  for (let y = 8; y <= 12; y++) for (let x = 28; x <= 32; x++) tile(w, x, y).terrain = 'water';
  tile(w, 30, 10).terrain = 'land';
  for (let day = 0; day < 15 && Math.hypot(p.x - 30, p.y - 10) > 3; day++) {
    assert.equal(moveOne(w, p, destination, false, { arrivalRadius: 3 }), true);
    assert.equal(tile(w, p.x, p.y).terrain, 'land');
    w.day++;
  }
  assert.ok(Math.hypot(p.x - 30, p.y - 10) <= 3);
  assert.notDeepEqual([p.x, p.y], [30, 10]);
});
