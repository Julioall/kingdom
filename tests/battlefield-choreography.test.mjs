import test from 'node:test';
import assert from 'node:assert/strict';
import { planSquadTactics } from '../src/simulation/kingdoms/squad-tactics.js';
import { allocateBattlefieldSlots } from '../src/simulation/kingdoms/battlefield-slots.js';
import { battlefieldDebugData } from '../src/ui/battlefield-debug.js';

function army(count = 5) {
  const troops = Array.from({ length: count * 10 }, (_, i) => ({
    id: i + 1, alive: true, x: 50, y: 50, stamina: 90,
    militaryClass: i % 5 === 0 ? 'lanceiro' : i % 5 === 1
      ? 'guerreiro' : i % 5 === 2 ? 'arqueiro' : 'guerreiro',
    militaryRank: i % 10 === 0 ? 'comandante' : 'soldado'
  }));
  const units = Array.from({ length: count }, (_, i) => ({
    id: 'unit-' + i, commanderId: i * 10 + 1,
    memberIds: troops.slice(i * 10, i * 10 + 10).map(p => p.id)
  }));
  return { troops, units };
}
function fixtureWorld(size = 120) {
  return { width: size, height: size,
    tiles: Array.from({ length: size * size }, (_, i) => ({
      i, x: i % size, y: Math.floor(i / size),
      terrain: 'land', elevationLevel: 0
    })) };
}

test('battlefront visibly separates two wings and a rear reserve from the center', () => {
  const { troops, units } = army();
  const plan = planSquadTactics({ troops, units, day: 12,
    destination: { x: 55, y: 50 }, home: { x: 10, y: 50 }, mode: 'hierarchical',
    generalOrder: { action: 'advance', battlePlan: 'assemble', formationType: 'line' } });
  assert.deepEqual(plan.squads.map(s => s.role),
    ['vanguard', 'support', 'flank-left', 'flank-right', 'reserve']);
  const [center, support, left, right, reserve] = plan.squads;
  assert.equal(center.target.y, 50);
  assert.ok(left.target.y < center.target.y - 7, 'left wing clears front ranks');
  assert.ok(right.target.y > center.target.y + 7, 'right wing clears front ranks');
  assert.ok(support.target.x < center.target.x, 'support deploys behind center');
  assert.ok(reserve.target.x < support.target.x, 'reserve holds deeper than support');
  assert.equal(reserve.phase, 'holding');
});

test('rank positions choose unique land tiles without colliding with commander anchors', () => {
  const { troops, units } = army(3);
  const world = fixtureWorld();
  const plan = planSquadTactics({ troops, units, day: 2,
    destination: { x: 55, y: 50 }, home: { x: 0, y: 50 },
    observedThreats: [{ id: 200, x: 55, y: 50 }],
    mode: 'hierarchical', generalOrder: { action: 'engage', battlePlan: 'envelop' } });
  // Test the hardest case: every officer is still in an overlapped spawn tile.
  for (const soldier of troops) if (soldier.id !== 1 && soldier.id !== 11 && soldier.id !== 21) {
    soldier.x = 49; soldier.y = 50;
  }
  const allocated = allocateBattlefieldSlots(world, plan.squads, troops);
  const anchors = new Set(['50:50']);
  const slots = allocated.flatMap(group => Object.values(group.worldSlots));
  assert.ok(slots.length >= 18, 'most soldiers receive a distinct nearby rank tile');
  assert.equal(slots.length + allocated.reduce((sum, group) => sum + group.terrainBlockedSlots, 0),
    27, 'each remaining soldier is counted as blocked rather than assigned to a duplicate tile');
  const keys = slots.map(point => point.x + ':' + point.y);
  assert.equal(new Set(keys).size, keys.length);
  for (const slot of slots) {
    assert.equal(world.tiles[slot.y * world.width + slot.x].terrain, 'land');
    assert.ok(!anchors.has(slot.x + ':' + slot.y), 'followers never share a captain tile');
  }
});

test('coastline rank assignment is stable and never allocates a water cell', () => {
  const { troops, units } = army(1);
  const world = fixtureWorld(120);
  const officer = troops[0];
  officer.x = 45; officer.y = 45;
  for (const tile of world.tiles) if (tile.x >= 46 && tile.y >= 43 && tile.y <= 47)
    tile.terrain = 'water';
  const planner = () => planSquadTactics({ troops, units, day: 8,
    destination: { x: 50, y: 45 }, home: { x: 10, y: 45 }, mode: 'hierarchical' });
  const first = allocateBattlefieldSlots(world, planner().squads, troops);
  const second = allocateBattlefieldSlots(world, planner().squads, troops);
  assert.deepEqual(first.map(x => x.worldSlots), second.map(x => x.worldSlots));
  assert.ok(first[0].terrainBlockedSlots >= 0);
  for (const slot of Object.values(first[0].worldSlots))
    assert.equal(world.tiles[slot.y * world.width + slot.x].terrain, 'land');
});

test('battlefield debug data follows true soldier positions and squad targets', () => {
  const { troops, units } = army(3);
  const world = fixtureWorld();
  const result = planSquadTactics({ troops, units, day: 3,
    destination: { x: 55, y: 50 }, home: { x: 0, y: 50 }, mode: 'hierarchical' });
  allocateBattlefieldSlots(world, result.squads, troops);
  world.people = troops;
  world.campaigns = [{ id: 70, status: 'marching',
    attacker: { kingdomId: 1, squadTactics: result },
    defender: { kingdomId: 2, squadTactics: null } }];
  const data = battlefieldDebugData(world);
  assert.equal(data.length, 3);
  assert.equal(data.find(item => item.role === 'flank-left').soldiers.length, 9);
  assert.ok(data[0].soldiers.every(entry => Number.isFinite(entry.person.x)));
  assert.ok(data[0].soldiers.every(entry => entry.slot === null
    || Number.isFinite(entry.slot.x)), 'overlay only reads genuine projected positions');
  world.campaigns[0].status = 'withdrawing';
  assert.deepEqual(battlefieldDebugData(world), []);
});

test('cohesive center performs a bounded charge instead of stalling outside spear range', () => {
  const { troops, units } = army(1);
  troops.forEach((person, i) => { person.x = i === 0 ? 50 : 49; person.y = 50; });
  const target = { x: 56, y: 50 };
  const order = { action: 'engage', battlePlan: 'press-front', formationType: 'line' };
  const charging = planSquadTactics({ troops, units, day: 7, destination: target,
    home: { x: 20, y: 50 }, observedThreats: [{ id: 200, ...target }],
    generalOrder: order, mode: 'hierarchical' }).squads[0];
  assert.equal(charging.phase, 'charging');
  assert.ok(charging.target.x > troops[0].x && charging.target.x < target.x,
    'the commander advances a bounded step without abandoning the infantry');
  for (const follower of troops.slice(1)) { follower.x = 20; follower.y = 20; }
  const waiting = planSquadTactics({ troops, units, day: 8, destination: target,
    home: { x: 20, y: 50 }, observedThreats: [{ id: 200, ...target }],
    generalOrder: order, mode: 'hierarchical' }).squads[0];
  assert.notEqual(waiting.phase, 'charging',
    'no unit charge is ordered when the soldiers have been left far behind');
});

test('army uses the vanguard as a real moving anchor until the battlefield deployment', () => {
  const { troops, units } = army(5);
  for (const person of troops) { person.x = 20; person.y = 50; }
  const initial = planSquadTactics({ troops, units, day: 3,
    destination: { x: 90, y: 50 }, home: { x: 0, y: 50 },
    mode: 'hierarchical', generalOrder: { action: 'advance' } });
  const [lead, support, left, right, reserve] = initial.squads;
  assert.equal(lead.target.x, 90, 'only the leader plans the full strategic march');
  assert.ok(support.target.x < 20, 'support follows physical vanguard rather than rushing the target');
  assert.ok(reserve.target.x < support.target.x, 'reserve stays behind the support group');
  assert.ok(Math.abs(left.target.y - 50) <= 3 && Math.abs(right.target.y - 50) <= 3,
    'wings use narrow marching files before they deploy');
  troops.find(p => p.id === 1).x = 84;
  const deploying = planSquadTactics({ troops, units, day: 4,
    destination: { x: 90, y: 50 }, home: { x: 0, y: 50 },
    mode: 'hierarchical', generalOrder: { action: 'advance' } });
  assert.ok(deploying.squads[2].target.y <= 40,
    'wings only open after the center actually reaches the front');
  assert.ok(deploying.squads[3].target.y >= 60);
});

test('battle ranks hold their facing when the target shifts by a tiny angle', () => {
  const { troops, units } = army(1);
  for (const person of troops) { person.x = 49; person.y = 50; }
  const base = { troops, units, home: { x: 20, y: 50 }, day: 2,
    mode: 'hierarchical', generalOrder: { action: 'advance', formationType: 'line' } };
  const original = planSquadTactics({ ...base, destination: { x: 54, y: 50 } });
  const next = planSquadTactics({ ...base, day: 3, previous: original,
    destination: { x: 54, y: 50.6 } });
  assert.deepEqual(next.squads[0].orientation, original.squads[0].orientation,
    'small target oscillations must not continuously reshuffle all infantry slots');
});

test('flank maneuver stays committed after its captain leaves the center deployment radius', () => {
  const { troops, units } = army(3);
  for (const person of troops) { person.x = 48; person.y = 50; }
  const args = {
    units, troops, day: 3, mode: 'hierarchical',
    destination: { x: 50, y: 50 }, home: { x: 0, y: 50 },
    observedThreats: [{ id: 5000, x: 42, y: 50 }],
    generalOrder: { action: 'engage', battlePlan: 'envelop' }
  };
  const first = planSquadTactics(args);
  const wing = first.squads.find(squad => squad.role === 'flank-left');
  assert.equal(wing.phase, 'flanking');
  assert.equal(wing.formationType, 'column',
    'wing must march in files before the inward wedge strike');
  const captain = troops.find(person => person.id === wing.commanderId);
  Object.assign(captain, wing.target);
  assert.ok(Math.hypot(captain.x - args.destination.x,
    captain.y - args.destination.y) > 13);
  // Followers were able to catch the real waypoint.
  for (const id of wing.memberIds.filter(id => id !== wing.commanderId)) {
    const soldier = troops.find(p => p.id === id);
    soldier.x = captain.x - 2; soldier.y = captain.y;
  }
  const second = planSquadTactics({ ...args, day: 4, previous: first });
  const committed = second.squads.find(squad => squad.role === 'flank-left');
  assert.equal(committed.phase, 'striking',
    'the flank may not collapse into an ordinary march outside the central radius');
  assert.equal(committed.flankStage, 'strike');
  assert.equal(committed.formationType, 'wedge');
  assert.ok(Math.hypot(committed.target.x - wing.target.x,
    committed.target.y - wing.target.y) > 2);
});

test('reserve follows the vanguard while marching, then locks its rear rally point', () => {
  const { troops, units } = army(5);
  for (const person of troops) { person.x = 0; person.y = 50; }
  const args = { troops, units, day: 2, mode: 'hierarchical',
    destination: { x: 50, y: 50 }, home: { x: -30, y: 50 } };
  const road = planSquadTactics(args);
  const marchingReserve = road.squads.find(squad => squad.role === 'reserve');
  assert.equal(marchingReserve.phase, 'marching');
  assert.equal(marchingReserve.reserveHoldPoint, null);
  for (const person of troops) { person.x = 47; person.y = 50; }
  const deployed = planSquadTactics({ ...args, day: 3, previous: road });
  const reserve = deployed.squads.find(squad => squad.role === 'reserve');
  assert.equal(reserve.phase, 'holding');
  assert.deepEqual(reserve.reserveHoldPoint, reserve.target);
  const shiftingFront = planSquadTactics({ ...args, day: 4, previous: deployed,
    destination: { x: 53, y: 55 } });
  const stationary = shiftingFront.squads.find(squad => squad.role === 'reserve');
  assert.deepEqual(stationary.target, reserve.target,
    'battle contact must not drag an uncommitted reserve forward by moving its goal');
  const pressure = structuredClone(shiftingFront);
  pressure.squads.find(squad => squad.role === 'vanguard').morale = 40;
  const orderedForward = planSquadTactics({ ...args, day: 5,
    previous: pressure, destination: { x: 53, y: 55 } });
  const called = orderedForward.squads.find(squad => squad.role === 'reserve');
  assert.equal(called.mission, 'reinforce');
  assert.equal(called.reserveHoldPoint, null);
  assert.notDeepEqual(called.target, reserve.target,
    'a committed reserve must actually receive a new destination');
});

test('wing captain waits for the body of troops halfway through an outward march', () => {
  const { troops, units } = army(3);
  for (const person of troops) { person.x = 48; person.y = 50; }
  const args = { units, troops, day: 3, mode: 'hierarchical',
    destination: { x: 50, y: 50 }, home: { x: 0, y: 50 },
    observedThreats: [{ id: 5000, x: 42, y: 50 }],
    generalOrder: { action: 'engage', battlePlan: 'envelop' } };
  const first = planSquadTactics(args);
  const wing = first.squads.find(s => s.role === 'flank-left');
  const captain = troops.find(p => p.id === wing.commanderId);
  // The captain has begun the detour; the rest of the unit is still in the
  // center. This is an intermediate waypoint, not the final staging tile.
  captain.x = (captain.x + wing.target.x) / 2;
  captain.y = (captain.y + wing.target.y) / 2;
  assert.ok(Math.hypot(captain.x - wing.target.x, captain.y - wing.target.y) > 3.5);
  assert.ok(Math.hypot(captain.x - 48, captain.y - 50) > 6.5);
  const second = planSquadTactics({ ...args, day: 4, previous: first });
  const waiting = second.squads.find(s => s.role === 'flank-left');
  assert.equal(waiting.flankStage, 'swing');
  assert.equal(waiting.phase, 'reforming',
    'the captain must wait for followers before reaching the outer waypoint');
  assert.deepEqual(waiting.target, { x: captain.x, y: captain.y });
});
