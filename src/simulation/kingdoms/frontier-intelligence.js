import { distance } from '../core/math.js';
import { log } from '../core/events.js';

export const SERVICE_GRADES = [
  ['soldado', 0], ['cabo', 5], ['sargento', 15], ['tenente', 35],
  ['capitão', 70], ['major', 120], ['coronel', 200]
];

function increaseBorderTension(world, a, b, amount) {
  const low = Math.min(a, b), high = Math.max(a, b);
  const relation = (world.kingdomRelations ||= {})[low + ':' + high] ||= {
    a: low, b: high, status: 'peace', tension: 0, borderIncidents: 0, lastIncidentDay: -1, resolvedDay: -1
  };
  relation.tension = Math.min(1, (relation.tension || 0) + amount);
}

export function updateServiceGrades(world, troops, day) {
  for (const person of troops) {
    const earned = SERVICE_GRADES.filter(([, points]) => (person.militaryMerit || 0) >= points).length;
    const previous = person.militaryLevel || 1;
    person.militaryLevel = Math.max(previous, earned);
    person.militaryGrade = SERVICE_GRADES[Math.min(SERVICE_GRADES.length, person.militaryLevel) - 1][0];
    if (person.militaryLevel > previous) {
      person.lastPromotion = { day, level: person.militaryLevel, grade: person.militaryGrade };
      person.prestige = (person.prestige || 0) + person.militaryLevel - previous;
      log(world, person.name + ' foi promovido a ' + person.militaryGrade + ' por mérito em combate e apoio à tropa.', day);
    }
  }
}

export function reportTerritoryLoss(world, kingdomId, opponentId, tiles, location, day) {
  const kingdom = world.kingdoms.find(k => k.id === kingdomId);
  if (!kingdom || tiles <= 0) return;
  const commanders = world.people.filter(p => p.alive && p.kingdomId === kingdomId && p.militaryRank === 'comandante')
    .sort((a, b) => distance(a, location) - distance(b, location) || a.id - b.id);
  const commander = commanders[0];
  const responsible = new Set([commander?.id, commander?.generalId,
    ...(commander ? [] : kingdom.militaryCommand?.generalIds || [])].filter(id => id != null));
  const penalty = Math.min(12, 1 + tiles / 20);
  for (const person of world.people.filter(p => p.alive && responsible.has(p.id))) {
    person.prestige = Math.max(-100, (person.prestige || 0) - penalty);
    person.commandPrestige = (person.commandPrestige || 0) - penalty;
    person.lastCommandFailure = { day, tiles, opponentId, penalty, location: { ...location } };
  }
  const report = { day, kind: 'territory-lost', opponentId, tiles, location: { ...location },
    source: 'registro territorial da fronteira', responsibleIds: [...responsible] };
  kingdom.militaryIntel = [...(kingdom.militaryIntel || []), report].slice(-48);
  kingdom.frontierLosses = [...(kingdom.frontierLosses || []), report].slice(-24);
  kingdom.lostTerritoryTiles = (kingdom.lostTerritoryTiles || 0) + tiles;
  increaseBorderTension(world, kingdomId, opponentId, .1);
  log(world, kingdom.name + ': o rei foi avisado da perda de ' + tiles + ' células de território em '
    + location.x + ',' + location.y + '. O comando responsável perdeu prestígio.', day);
}

export function observeMilitaryFrontiers(world, day) {
  for (const kingdom of world.kingdoms) {
    const watchers = world.people.filter(p => p.alive && p.role === 'soldier' && p.kingdomId === kingdom.id
      && p.restingStructureId == null && p.militaryRestTargetId == null);
    const owned = world.tiles.filter(t => t.kingdomId === kingdom.id);
    const sightings = world.people.filter(p => p.alive && p.role === 'soldier' && p.kingdomId != null
      && p.kingdomId !== kingdom.id && p.restingStructureId == null
      && watchers.some(w => distance(w, p) <= 8) && owned.some(t => distance(t, p) <= 5));
    for (const opponentId of new Set(sightings.map(p => p.kingdomId))) {
      const enemies = sightings.filter(p => p.kingdomId === opponentId);
      const previous = kingdom.lastFrontierAlerts?.[opponentId];
      if (previous != null && day - previous < 10) continue;
      const location = { x: Math.round(enemies[0].x), y: Math.round(enemies[0].y) };
      const report = { day, kind: 'enemy-approach', opponentId, soldiersObserved: enemies.length,
        location, source: 'patrulha de fronteira', observerId: watchers.find(w => distance(w, enemies[0]) <= 8).id };
      kingdom.militaryIntel = [...(kingdom.militaryIntel || []), report].slice(-48);
      (kingdom.lastFrontierAlerts ||= {})[opponentId] = day;
      kingdom.frontierAlert = report;
      increaseBorderTension(world, kingdom.id, opponentId, .03);
      log(world, kingdom.name + ': patrulha avisou o rei de ' + enemies.length + ' militares inimigos próximos da fronteira em '
        + location.x + ',' + location.y + '.', day);
    }
    const known = (kingdom.knownEnemyInstallations || []).filter(item => day - item.day <= 60);
    for (const structure of world.structures.filter(s => s.kingdomId != null && s.kingdomId !== kingdom.id
      && s.complete && s.destroyedDay == null && ['torre', 'centro_militar', 'arquearia', 'monasterio', 'mercado', 'castelo'].includes(s.type))) {
      const watcher = watchers.find(w => distance(w, structure) <= 10);
      if (!watcher) continue;
      const entry = { id: structure.id, type: structure.type, opponentId: structure.kingdomId,
        day, x: structure.x, y: structure.y, observerId: watcher.id };
      const index = known.findIndex(item => item.id === structure.id);
      if (index < 0) known.push(entry); else known[index] = entry;
    }
    kingdom.knownEnemyInstallations = known.slice(-32);
  }
}
