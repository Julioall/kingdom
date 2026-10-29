import { distance } from '../core/math.js';
import { cellAt } from '../world/spatial.js';
import { moveOne } from '../individuals/movement.js';
import { isTreeAnchor } from '../ecology/plants.js';
import { fightTacticalRound } from './military.js';
import { towerVitality } from './fortifications.js';
import { isTerritorialIntruder, observeTowerIntruders, TOWER_WATCH_RADIUS } from './border-defense.js';
import { hitboxesOverlap, npcHitbox, resourceCollisionIndex, structureInteractionPoint } from '../physics/hitboxes.js';

function hasResourceBlockingEntry(world, tile) {
  if (!tile) return true;
  const body = npcHitbox({}, tile.x, tile.y);
  const resources = resourceCollisionIndex(world).byTile.get(tile.i) || [];
  return resources.some(resource => hitboxesOverlap(body, resource));
}

function eligible(person, tower) {
  return person.alive && person.role === 'soldier' && person.militaryClass === 'arqueiro'
    && person.militaryRank !== 'general'
    && person.kingdomId === tower.kingdomId && person.health >= 42 && (person.energy ?? 100) >= 24
    && (person.foodReserve ?? 100) >= 20 && (person.hydration ?? 100) >= 20;
}

function availableForTower(world, person, tower) {
  if (person.campaignId == null) return true;
  const campaign = (world.campaigns || []).find(c => c.id === person.campaignId);
  return campaign?.defender?.kingdomId === person.kingdomId
    && ['mobilizing', 'marching', 'engaged'].includes(campaign.status)
    && campaign.target && distance(campaign.target, tower) <= 18;
}

function towerEntryTile(world, tower) {
  const entry = structureInteractionPoint(tower) || { x: tower.x, y: tower.y + 1 };
  const tile = cellAt(world, entry.x, entry.y);
  if (tile?.terrain === 'land' && !isTreeAnchor(world, tile) && !hasResourceBlockingEntry(world, tile)) {
    return { x: tile.x, y: tile.y };
  }
  const candidates = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const candidate = cellAt(world, Math.round(tower.x) + dx, Math.round(tower.y) + dy);
    if (candidate?.terrain === 'land' && !isTreeAnchor(world, candidate) && !hasResourceBlockingEntry(world, candidate))
      candidates.push(candidate);
  }
  candidates.sort((a, b) => distance(a, entry) - distance(b, entry)
    || distance(a, tower) - distance(b, tower) || a.y - b.y || a.x - b.x);
  if (candidates[0]) return { x: candidates[0].x, y: candidates[0].y };
  return entry;
}

function towerTileOccupied(world, person, entryTile) {
  return world.people.some(other => other !== person && other.alive
    && Math.round(other.x) === entryTile.x && Math.round(other.y) === entryTile.y);
}

function mountOnTower(world, person, tower) {
  const entryTile = towerEntryTile(world, tower);
  if (distance(person, entryTile) > .05 || towerTileOccupied(world, person, entryTile)) {
    person.towerMounted = false;
    return false;
  }
  person.towerEntryReady = false; person.towerMounted = true;
  return true;
}

function moveOffTower(world, person, tower) {
  const entry = towerEntryTile(world, tower), x = Math.round(entry.x), y = Math.round(entry.y);
  const candidates = [[0, 1], [1, 0], [-1, 0], [1, 1], [-1, 1], [0, -1], [1, -1], [-1, -1]]
    .map(([dx, dy]) => cellAt(world, x + dx, y + dy))
    .filter(tile => tile && tile.terrain === 'land' && !world.people.some(other => other !== person && other.alive
      && Math.round(other.x) === tile.x && Math.round(other.y) === tile.y));
  if (candidates[0]) moveOne(world, person, candidates[0], false);
}

export function updateTowerShifts(world, day) {
  const towers = world.structures.filter(s => s.type === 'torre' && s.complete
    && s.destroyedDay == null && towerVitality(s).health > 0);
  const valid = new Set(towers.map(t => t.id));
  for (const p of world.people) {
    if (p.militaryRank === 'general') {
      const tower = towers.find(t => t.id === p.towerDutyId || t.archerId === p.id);
      if (tower && p.towerMounted) moveOffTower(world, p, tower);
      if (tower?.archerId === p.id) tower.archerId = null;
      p.towerDutyId = null; p.towerMounted = false; p.towerEntryReady = false; p.towerRecovering = false;
    }
    if (p.towerDutyId != null && !valid.has(p.towerDutyId)) {
      p.towerDutyId = null; p.towerMounted = false; p.towerEntryReady = false;
    }
    if (p.towerRecovering && p.stamina >= 80 && (p.energy ?? 100) >= 40) p.towerRecovering = false;
  }
  for (const tower of towers) {
    let archer = world.people.find(p => p.id === tower.archerId && p.towerDutyId === tower.id);
    if (archer && (!eligible(archer, tower) || !availableForTower(world, archer, tower)
      || archer.stamina < 16 || archer.towerRecovering)) {
      if (archer.towerMounted) moveOffTower(world, archer, tower);
      archer.towerDutyId = null; archer.towerMounted = false; archer.towerEntryReady = false;
      archer.towerRecovering = true;
      archer.state = 'descansando após o turno na torre'; archer = null;
    }
    if (!archer) {
      tower.archerId = null;
      archer = world.people.filter(p => eligible(p, tower) && p.towerDutyId == null
        && !p.towerRecovering && (p.stamina ?? 100) >= 80 && availableForTower(world, p, tower))
        .sort((a, b) => distance(a, tower) - distance(b, tower) || a.id - b.id)[0];
      if (archer) {
        archer.towerDutyId = tower.id; tower.archerId = archer.id;
        archer.towerMounted = false; archer.towerEntryReady = false;
        tower.archerShiftCount = (tower.archerShiftCount || 0) + 1; tower.archerShiftDay = day;
      }
    }
    if (archer) {
      if (archer.towerMounted && distance(archer, tower) > 1.25) {
        archer.towerMounted = false; archer.towerEntryReady = false;
      }
    }
  }
}

export function towerDutyOrder(world, person) {
  if (person.militaryRank === 'general') return null;
  if (person.towerRecovering)
    return { towerDuty: true, recovering: true, target: world.kingdoms.find(k => k.id === person.kingdomId) || person };
  const tower = world.structures.find(s => s.id === person.towerDutyId && s.destroyedDay == null && s.complete);
  return tower && eligible(person, tower) ? { towerDuty: true, target: tower } : null;
}

export function performTowerDuty(world, person, order) {
  if (order.recovering) {
    person.towerMounted = false;
    person.towerEntryReady = false;
    if (distance(person, order.target) > 3) moveOne(world, person, order.target, false);
    person.energy = Math.min(100, (person.energy ?? 100) + 3);
    person.state = 'recuperando estamina para o próximo turno';
    return true;
  }
  if (person.towerMounted) {
    person.state = 'vigiando do alto da torre (alcance 14)';
  } else if (person.towerEntryReady) {
    const entryTile = towerEntryTile(world, order.target);
    if (distance(person, entryTile) > .05) {
      person.towerEntryReady = false;
      moveOne(world, person, entryTile, false);
      person.state = 'indo para a entrada da torre';
    } else if (mountOnTower(world, person, order.target)) person.state = 'vigiando do alto da torre (alcance 14)';
    else person.state = 'aguardando vaga livre no posto da torre';
  } else {
    const entrance = towerEntryTile(world, order.target);
    if (distance(person, entrance) > .05) {
      moveOne(world, person, entrance, false);
      person.state = 'indo para a entrada da torre';
    } else {
      person.towerEntryReady = true;
      person.state = 'entrando pela porta da torre';
    }
  }
  return true;
}

export function defendTowers(world, day) {
  for (const archer of world.people) {
    if (!archer.alive || !archer.towerMounted) continue;
    const tower = world.structures.find(t => t.id === archer.towerDutyId && t.destroyedDay == null);
    if (!tower || !tower.complete || tower.archerId !== archer.id
      || towerVitality(tower).health <= 0 || distance(archer, tower) > 1.25 || !eligible(archer, tower)) {
      if (tower) tower.borderVisibleIntruderIds = [];
      archer.towerMounted = false; archer.towerEntryReady = false; archer.towerDutyId = null; continue;
    }
    // Observation generates intelligence and a horn cue once per new intrusion.
    // The tower never needs a formal campaign to repel trespassers on its land.
    observeTowerIntruders(world, tower, archer, day);
    const enemies = world.people.filter(p => p.alive && p.kingdomId !== archer.kingdomId
      && p.restingStructureId == null && (
        isTerritorialIntruder(world, archer.kingdomId, p)
          && distance(archer, p) <= TOWER_WATCH_RADIUS
        || (world.campaigns || []).some(c =>
          ['marching', 'engaged', 'contested'].includes(c.status)
          && [c.attackerId ?? c.attacker?.kingdomId, c.defenderId ?? c.defender?.kingdomId].includes(archer.kingdomId)
          && [c.attackerId ?? c.attacker?.kingdomId, c.defenderId ?? c.defender?.kingdomId].includes(p.kingdomId)
          && (!c.target || distance(p, c.target) <= 16))));
    fightTacticalRound(world, [archer], enemies, day);
  }
}
