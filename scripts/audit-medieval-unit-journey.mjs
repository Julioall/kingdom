// Auditable, deterministic, engine-level march across a real one-cell bridge.
// Uses real Kingdom movement, squad tactics, collisions and combat actions,
// without pretending to test economy, recruitment or a complete war campaign.
import Sim from '../src/simulation/engine.js';
import { planSquadTactics, squadSlot, squadFollowerTarget } from '../src/simulation/kingdoms/squad-tactics.js';
import { moveOne } from '../src/simulation/individuals/movement.js';
import { createPersonSpatialIndex } from '../src/simulation/individuals/spatial-index.js';
import { cellAt } from '../src/simulation/world/spatial.js';
import { hitboxesOverlap, npcHitbox } from '../src/simulation/physics/hitboxes.js';
import { fightTacticalRound } from '../src/simulation/kingdoms/military.js';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BRIDGE = { minX: 36, maxX: 45, y: 40 };
const DESTINATION = { x: 65, y: 40 };
const CLASSES = ['guerreiro', 'lanceiro', 'guerreiro', 'lanceiro',
  'arqueiro', 'monge', 'arqueiro', 'guerreiro', 'lanceiro', 'guerreiro'];

function inBridge(person) {
  return person.y === BRIDGE.y && person.x >= BRIDGE.minX && person.x <= BRIDGE.maxX;
}

function makeFixture(seed, unitCount) {
  if (!Number.isInteger(unitCount) || unitCount < 3 || unitCount > 5)
    throw Error('The battlefield audit supports 3, 4 or 5 units.');
  const world = Sim.createWorld(seed, { tacticalCombat: 'hierarchical' });
  const [kingdom, opponent] = world.kingdoms;
  const template = world.people.find(p => p.alive && p.role === 'soldier');
  if (!template || !kingdom || !opponent)
    throw Error('The Kingdom seed did not produce a soldier and two kingdoms.');
  for (const tile of world.tiles) {
    tile.terrain = 'rock';
    tile.kingdomId = kingdom.id;
    tile.slope = 0; tile.elevationLevel = 0;
    tile.rampSide = null; tile.rampLevel = 0;
    tile.stoneDeposit = 0; tile.goldOre = 0;
    tile.plants?.fill(0);
  }
  function land(x, y) {
    const tile = cellAt(world, x, y);
    if (!tile) throw Error('Fixture coordinates exceed the generated map');
    tile.terrain = 'land'; tile.kingdomId = kingdom.id;
  }
  for (let x = 12; x <= 35; x++)
    for (let y = 27; y <= 53; y++) land(x, y);
  for (let x = BRIDGE.minX; x <= BRIDGE.maxX; x++) land(x, BRIDGE.y);
  for (let x = 46; x <= 83; x++)
    for (let y = 24; y <= 56; y++) land(x, y);

  const units = [], allies = [];
  let nextId = 98000;
  for (let index = 0; index < unitCount; index++) {
    const commanderId = ++nextId, ids = [];
    const centerY = 32 + 4 * index;
    for (let slot = 0; slot < 10; slot++) {
      const person = structuredClone(template);
      person.id = slot === 0 ? commanderId : ++nextId;
      person.name = 'Soldado ' + person.id;
      person.x = 27 - Math.floor(slot / 3);
      person.y = centerY + slot % 3 - 1;
      if (slot === 0) person.y = centerY;
      person.alive = true; person.role = 'soldier';
      person.kingdomId = kingdom.id; person.communityId = kingdom.communityId;
      person.campaignId = 999; person.militaryUnitId = 'unit-' + index;
      person.commanderId = commanderId; person.generalId = null;
      person.militaryRank = slot === 0 ? 'comandante' : 'soldado';
      person.militaryClass = CLASSES[slot];
      person.playerControlled = false; person.towerMounted = false;
      person.restingStructureId = null; person.militaryRestTargetId = null;
      person.tacticalRecovering = false; person.magicCast = null;
      person.health = 100; person.energy = 100; person.stamina = 160;
      person.hydration = 100; person.foodReserve = 100;
      person.lastMilitaryAttackDay = -100;
      person.navigationRoute = null; person.navigationCongestion = null;
      person.passageRequest = null; person.passageYieldHoldDay = null;
      person.tacticalRole = null; person.tacticalPhase = null;
      person.hitbox = null;
      allies.push(person); ids.push(person.id);
    }
    units.push({ id: 'unit-' + index, commanderId, memberIds: ids });
  }
  const enemy = structuredClone(template);
  enemy.id = ++nextId; enemy.name = 'Sentinela defensora';
  enemy.x = 69; enemy.y = 40;
  enemy.kingdomId = opponent.id; enemy.communityId = opponent.communityId;
  enemy.campaignId = null; enemy.militaryUnitId = null;
  enemy.militaryClass = 'guerreiro'; enemy.militaryRank = 'soldado';
  enemy.role = 'soldier'; enemy.alive = true; enemy.playerControlled = false;
  enemy.towerMounted = false; enemy.restingStructureId = null;
  enemy.militaryRestTargetId = null; enemy.magicCast = null;
  enemy.health = 250; enemy.energy = 100; enemy.stamina = 160;
  enemy.lastMilitaryAttackDay = -100; enemy.hitbox = null;
  world.people = [...allies, enemy];
  world.peopleById = new Map(world.people.map(person => [person.id, person]));
  world.peopleSpatialIndex = createPersonSpatialIndex(world.people);
  world.animals = []; world.structures = []; world.day = 0;
  world.tacticalCombat = { mode: 'hierarchical' };
  world.navigationRevision = (world.navigationRevision || 0) + 1;
  const key = Math.min(kingdom.id, opponent.id) + ':' + Math.max(kingdom.id, opponent.id);
  world.kingdomRelations[key] = { a: Math.min(kingdom.id, opponent.id),
    b: Math.max(kingdom.id, opponent.id), status: 'at-war', tension: 1,
    startedDay: 0, borderIncidents: 1 };
  return { world, units, allies, enemy };
}

function physicalErrors(world, alive) {
  let overlaps = 0, badTerrain = 0;
  const people = alive.filter(p => p.alive);
  for (const person of people) {
    if (cellAt(world, person.x, person.y)?.terrain !== 'land') badTerrain++;
  }
  for (let a = 0; a < people.length; a++) for (let b = a + 1; b < people.length; b++) {
    if (hitboxesOverlap(npcHitbox(people[a]), npcHitbox(people[b]))) overlaps++;
  }
  return { overlaps, badTerrain };
}

function firstTime(value, day) { return value == null ? day : value; }

export function runMilitaryJourney({ seed = 42, units: unitCount = 3, days = 150 } = {}) {
  const { world, units, allies, enemy } = makeFixture(seed, unitCount);
  const peopleById = world.peopleById;
  const phases = [], formations = [], history = [];
  const milestones = { march: null, bridgeEntered: null, rearGuardCleared: null,
    reformed: null, battleFormation: null, contact: null };
  const safety = { overlaps: 0, illegalTerrain: 0, jumps: 0, blockedDays: 0 };
  let previous = null, maxCrossed = 0, maxEngaged = 0;
  for (let day = 1; day <= days; day++) {
    world.day = day;
    const lead = peopleById.get(units[0].commanderId);
    const observeEnemy = lead.x >= 49;
    const tactics = planSquadTactics({
      troops: allies, units, day, previous,
      destination: DESTINATION, home: { x: 15, y: 40 },
      mode: 'hierarchical', sideMorale: 95,
      generalOrder: {
        action: observeEnemy ? 'engage' : 'advance',
        battlePlan: observeEnemy ? 'envelop' : 'assemble',
        formationType: lead.x < 46 ? 'column' : 'line'
      },
      observedThreats: observeEnemy ? [enemy] : [],
      openFront: true,
      isNarrowPassage: commander => inBridge(commander),
      projectTarget: value => value
    });
    previous = tactics;
    if (tactics.squads.some(s => s.phase === 'marching'))
      milestones.march = firstTime(milestones.march, day);
    for (const squad of tactics.squads) {
      phases.push(squad.phase); formations.push(squad.formationType);
      const commander = peopleById.get(squad.commanderId);
      for (const id of squad.memberIds) {
        const p = peopleById.get(id);
        p.tacticalRole = squad.role;
        p.tacticalPhase = squad.phase;
        p.tacticalReserveHolding = squad.role === 'reserve' && squad.mission === 'reserve';
        p.tacticalFormation = squad.formationType;
        const target = id === squad.commanderId ? squad.target
          : squadFollowerTarget(p, commander, squadSlot(squad, id, commander)).target;
        if (!target) continue;
        const before = { x: p.x, y: p.y };
        moveOne(world, p, target, false, { arrivalRadius: 1.1 });
        const step = Math.hypot(p.x - before.x, p.y - before.y);
        if (step > Math.SQRT2 + .0001) safety.jumps++;
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y))
          throw Error('Nonfinite military coordinates on day ' + day);
      }
    }
    const check = physicalErrors(world, world.people);
    safety.overlaps += check.overlaps; safety.illegalTerrain += check.badTerrain;
    const inside = allies.filter(inBridge).length;
    const crossed = allies.filter(p => p.x >= 46).length;
    maxCrossed = Math.max(maxCrossed, crossed);
    if (inside) milestones.bridgeEntered = firstTime(milestones.bridgeEntered, day);
    if (crossed === allies.length) milestones.rearGuardCleared =
      firstTime(milestones.rearGuardCleared, day);
    const front = tactics.squads[0];
    if (crossed > 0 && tactics.squads.some(s => s.phase === 'reforming'))
      milestones.reformed = firstTime(milestones.reformed, day);
    if (front.formationType === 'shield_wall' || front.formationType === 'spear_line')
      milestones.battleFormation = firstTime(milestones.battleFormation, day);
    const close = allies.filter(p => p.alive && Math.hypot(p.x - enemy.x, p.y - enemy.y) <= 3.2);
    maxEngaged = Math.max(maxEngaged, close.length);
    if (close.length && !enemy.alive) milestones.contact = firstTime(milestones.contact, day);
    else if (close.length) {
      const actionsBefore = world.combatSequence || 0;
      fightTacticalRound(world, close, [enemy], day);
      if ((world.combatSequence || 0) > actionsBefore)
        milestones.contact = firstTime(milestones.contact, day);
    }
    safety.blockedDays += allies.filter(p => p.militaryCorridorWait?.day === day).length;
    if (day % 5 === 0 || day === 1 || day === days) {
      history.push({ day, crossed, inside, enemyHealth: enemy.health,
        roles: tactics.squads.map(s => s.role),
        phases: tactics.squads.map(s => s.phase),
        formations: tactics.squads.map(s => s.formationType),
        rankIntegrity: tactics.squads.map(s => s.rankIntegrity),
        claims: Object.values(world.militaryCorridorTraffic?.corridors || {})
          .map(c => ({ unit: c.ownerUnitId || null, empty: !!c.empty })),
        safety: check });
    }
  }
  const digest = createHash('sha256').update(JSON.stringify({
    milestones, safety, history,
    positions: allies.map(p => [p.id, p.x, p.y, p.health]),
    enemy: [enemy.x, enemy.y, enemy.health, enemy.alive]
  })).digest('hex');
  return { seed, units: unitCount, days, soldierCount: allies.length,
    milestones, safety, maxCrossed, maxEngaged, digest,
    phaseCounts: Object.fromEntries([...new Set(phases)].sort().map(p =>
      [p, phases.filter(q => p === q).length])),
    formationCounts: Object.fromEntries([...new Set(formations)].sort().map(p =>
      [p, formations.filter(q => p === q).length])),
    corridor: { blocked: world.militaryCorridorTraffic?.blocked || 0,
      releases: world.militaryCorridorTraffic?.releases || 0,
      recoveries: world.militaryCorridorTraffic?.recoveries || 0 },
    lastPositions: allies.map(p => ({ id:p.id, unit:p.militaryUnitId, x:p.x, y:p.y })),
    history };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
  const counts = (args.units || '3,5').split(',').map(Number);
  const seed = Number(args.seed || 42);
  const days = Number(args.days || 150);
  const results = counts.map(units => runMilitaryJourney({ seed, units, days }));
  const summary = results.map(({ history, lastPositions, ...rest }) => rest);
  console.log('MILITARY-JOURNEY', JSON.stringify(summary));
  if (args.output) {
    const output = resolve(args.output);
    mkdirSync(dirname(output), { recursive:true });
    writeFileSync(output, JSON.stringify({ schema:1, results }, null, 2));
    console.log('MILITARY-JOURNEY-REPORT', output);
  }
}
