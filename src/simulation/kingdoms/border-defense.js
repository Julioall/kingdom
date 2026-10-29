import { distance } from '../core/math.js';
import { log } from '../core/events.js';
import { cellAt } from '../world/spatial.js';

// Only a visible trespass inside the defender's currently controlled tiles
// grants territorial authority to attack a civilian. Nationality alone does not.
export function isTerritorialIntruder(world, defenderKingdomId, person) {
  return defenderKingdomId != null && person?.alive !== false
    && person?.kingdomId != null && person.kingdomId !== defenderKingdomId
    && person.restingStructureId == null
    && Number.isFinite(person.x) && Number.isFinite(person.y)
    && cellAt(world, person.x, person.y)?.kingdomId === defenderKingdomId;
}

export const TOWER_WATCH_RADIUS = 14;
const MAX_HORN_CALLS = 3;

// Each occupied watchtower remembers which people it currently sees. A person
// staying in range does not trigger a new alarm every simulated day. Exiting
// the guarded area and entering again is a new observable incursion.
export function observeTowerIntruders(world, tower, archer, day) {
  if (!tower || !archer?.alive || !archer.towerMounted
    || tower.archerId !== archer.id || tower.destroyedDay != null
    || !tower.complete || tower.health === 0 || tower.integrity === 0
    || archer.towerDutyId !== tower.id || archer.kingdomId !== tower.kingdomId) {
    if (tower) tower.borderVisibleIntruderIds = [];
    return [];
  }

  const visible = (world.people || []).filter(person =>
    isTerritorialIntruder(world, tower.kingdomId, person)
    && distance(archer, person) <= TOWER_WATCH_RADIUS)
    .sort((a, b) => a.id - b.id);
  const previous = new Set(tower.borderVisibleIntruderIds || []);
  tower.borderVisibleIntruderIds = visible.map(person => person.id);
  if (!visible.some(person => !previous.has(person.id))) return [];

  const kingdom = (world.kingdoms || []).find(item => item.id === tower.kingdomId);
  if (!kingdom) return [];
  const reports = [];
  const opponentIds = [...new Set(visible.map(person => person.kingdomId))].sort((a, b) => a - b);
  for (const opponentId of opponentIds) {
    const group = visible.filter(person => person.kingdomId === opponentId);
    if (!group.some(person => !previous.has(person.id))) continue;
    tower.borderAlarmSequence = (tower.borderAlarmSequence || 0) + 1;
    const report = {
      id: `tower:${tower.id}:${tower.borderAlarmSequence}`,
      day, kind: 'tower-intrusion', source: 'arqueiro de vigia na torre',
      towerId: tower.id, observerId: archer.id, opponentId,
      location: { x: Math.round(group[0].x), y: Math.round(group[0].y) },
      intruderCount: group.length,
      soldiersObserved: group.filter(person => person.role === 'soldier').length,
      civiliansObserved: group.filter(person => person.role !== 'soldier').length,
      intruderIds: group.map(person => person.id),
      alarmCount: Math.min(MAX_HORN_CALLS, group.length),
      severity: group.length > 1 ? 'group-incursion' : 'intruder',
      confidence: 'observação direta'
    };
    kingdom.militaryIntel = [...(kingdom.militaryIntel || []), report].slice(-48);
    kingdom.frontierAlert = report; // The general receives intelligence, never an automatic mobilization order.
    reports.push(report);
    log(world, kingdom.name + ': alarme da torre! '
      + group.length + (group.length === 1 ? ' intruso' : ' intrusos')
      + ' avistados (' + report.soldiersObserved + ' militares, '
      + report.civiliansObserved + ' civis). General informado; defesa local acionada.', day);
  }
  return reports;
}
