import { kingdomRelation } from './territories.js';
import { distance } from '../core/math.js';
import { moveOne } from '../individuals/movement.js';
import { log } from '../core/events.js';
import { consumeFoodReserve } from '../economy/inventories.js';
import { consumePersonEnergy } from '../individuals/energy.js';
import { claimConstructionWorkstation, clearConstructionWorkpointResources, constructionContactPoint, MAX_CONSTRUCTION_WORKERS } from '../settlements/construction-workstations.js';

export const INITIAL_PEACE_DAYS = 45;
export const FRONTIER_RECOVERY_DAYS = 45;
const CONSTRUCTION_OBSTACLE_NAMES = Object.freeze({ tree: 'árvore', stone: 'pedra', gold: 'minério de ouro' });

export function updateTowerTension(world, day) {
  const towers = world.structures.filter(s => s.type === 'torre' && s.complete && s.integrity > 0
    && s.destroyedDay == null && s.health !== 0);
  for (let a = 0; a < world.kingdoms.length; a++) for (let b = a + 1; b < world.kingdoms.length; b++) {
    const first = world.kingdoms[a], second = world.kingdoms[b];
    const relation = kingdomRelation(world, first.id, second.id);
    if (relation.towerTensionUpdatedDay === day) continue;
    relation.towerTensionUpdatedDay = day;
    const pairs = [];
    for (const own of towers.filter(t => t.kingdomId === first.id))
      for (const enemy of towers.filter(t => t.kingdomId === second.id)) {
        const span = (own.territoryRadius || 13) * Math.min(1, own.integrity)
          + (enemy.territoryRadius || 13) * Math.min(1, enemy.integrity);
        const separation = distance(own, enemy);
        if (separation > span + 8) continue;
        const overlap = Math.max(0, span - separation);
        const pressure = .001 + .003 * (1 - separation / (span + 8)) + (overlap > 0 ? .006 + overlap / span * .008 : 0);
        pairs.push({ firstTowerId: own.id, secondTowerId: enemy.id, distance: separation, overlap, pressure });
      }
    const gain = Math.min(.04, pairs.reduce((sum, p) => sum + p.pressure, 0));
    relation.towerPressure = { pairs, overlappingPairs: pairs.filter(p => p.overlap > 0).length, dailyGain: gain };
    relation.tension = Math.max(0, Math.min(1, (relation.tension || 0) + (pairs.length ? gain : -.001)));
  }
}

export function orderInstallationAttack(world, kingdomId, towerId, options = {}) {
  const day = options.day ?? world.day;
  const king = world.kingdoms.find(k => k.id === kingdomId);
  const tower = world.structures.find(s => s.id === towerId && ['torre', 'centro_militar', 'arquearia', 'monasterio', 'mercado', 'castelo'].includes(s.type) && s.complete
    && s.integrity > 0 && s.destroyedDay == null && s.health !== 0);
  if (!king || !tower || tower.kingdomId == null || tower.kingdomId === kingdomId) return { ok: false, reason: 'Escolha uma instalação estratégica inimiga intacta.' };
  const capturing = tower.type === 'torre' && options.capture !== false;
  if (day <= INITIAL_PEACE_DAYS) return { ok: false, reason: 'Os reinos mantêm a paz inicial até o dia 45.' };
  const relation = kingdomRelation(world, kingdomId, tower.kingdomId);
  if (day <= (relation.ceasefireUntilDay ?? -1)) return { ok: false, reason: 'O armistício ainda está em vigor.' };
  if (relation.status === 'at-war' || (world.campaigns || []).some(c => c.status !== 'complete'
    && [c.attackerId, c.defenderId].includes(kingdomId))) return { ok: false, reason: 'O reino já está envolvido em uma campanha.' };
  if (world.people.filter(p => p.alive && p.role === 'soldier' && p.kingdomId === kingdomId
    && p.campaignId == null && p.towerDutyId == null && p.health >= 42).length < 2)
    return { ok: false, reason: 'São necessários ao menos dois soldados disponíveis para a captura.' };
  const id = world.nextId++, location = { x: tower.x, y: tower.y };
  const cause = capturing ? 'ordem do rei para capturar uma torre inimiga' : 'ordem do rei para atacar ' + tower.type + ' inimigo';
  const evidence = { location, incidentDay: day, structureId: tower.id, objectiveType: tower.type, mission: capturing ? 'capture-tower' : 'destroy-installation',
    attacker: { source: 'ordem real e reconhecimento da torre', location }, defender: { source: 'vigias da torre ameaçada', location } };
  relation.status = 'at-war'; relation.warId = id; relation.startedDay = day; relation.warCause = cause;
  relation.nextTowerRaidDay = day + FRONTIER_RECOVERY_DAYS;
  const war = { id, a: relation.a, b: relation.b, attackerId: kingdomId, defenderId: tower.kingdomId,
    startedDay: day, status: 'active', cause, evidence, forceMobilization: options.source !== 'tower-tension' };
  (world.wars ||= []).push(war);
  king.lastTowerCaptureOrder = { day, towerId, warId: id, source: options.source || 'royal-command' };
  log(world, king.name + ': o rei ordenou ' + (capturing ? 'capturar' : 'atacar') + ' ' + tower.type + ' ' + tower.id
    + '. A campanha será organizada com tropas e suprimentos finitos.', day);
  return { ok: true, war, tower, pending: true };
}

export function orderTowerCapture(world, kingdomId, towerId, options = {}) {
  if (!world.structures.some(s => s.id === towerId && s.type === 'torre')) return { ok: false, reason: 'Escolha uma torre inimiga intacta.' };
  return orderInstallationAttack(world, kingdomId, towerId, { ...options, capture: true });
}

export function frontierWorkOrder(world, person) {
  const project = world.structures.find(s => s.kingdomId === person.kingdomId && s.kingdomProject
    && !s.complete && s.integrity > 0 && s.builtDay == null);
  if (!project || person.campaignId != null) return null;
  const available = p => p.alive && p.role === 'resident' && p.ageDays >= 18 * 365
    && p.kingdomId === project.kingdomId && !p.recruitmentOrder && p.campaignId == null
    && p.energy > 24 && p.foodReserve > 8 && p.hydration > 15 && p.health >= 45
    && !p.constructionRetreating && p.homeRestTargetId == null && p.restingStructureId == null && !p.restingOutdoors
    && (project.blockedWorkerUntil?.[p.id] ?? -1) < world.day;
  const civilians = (project.workerIds || []).map(id => world.people.find(p => p.id === id))
    .filter(p => p && available(p)).slice(0, MAX_CONSTRUCTION_WORKERS);
  const replacements = world.people.filter(p => available(p) && !civilians.includes(p)
    && p.energy >= 35 && p.hydration >= 30
    && p.foodReserve >= Math.min(45, 16 + distance(p, project) * .78))
    .sort((a, b) => distance(a, project) - (a.skills?.build || 0) * 5
      - distance(b, project) + (b.skills?.build || 0) * 5 || a.id - b.id);
  civilians.push(...replacements.slice(0, Math.max(0, MAX_CONSTRUCTION_WORKERS - civilians.length)));
  project.workerIds = civilians.map(p => p.id);
  project.constructionWorkerIds = project.workerIds.slice();
  project.constructionWorkerLastSeen ||= {};
  for (const id of project.constructionWorkerIds) project.constructionWorkerLastSeen[id] = world.day;
  project.constructionWorkersPrunedDay = world.day;
  const troops = world.people.filter(p => p.alive && p.role === 'soldier' && p.kingdomId === person.kingdomId
    && p.campaignId == null && p.militaryRank !== 'general' && p.towerDutyId == null && !p.towerMounted
    && p.militaryRestTargetId == null && p.restingStructureId == null
    && p.health >= 60 && p.energy >= 55 && p.foodReserve >= 26 && p.hydration >= 30);
  const escort = project.type === 'torre' && civilians.length ? troops.sort((a, b) =>
    Number((project.escortIds || []).includes(b.id)) - Number((project.escortIds || []).includes(a.id))
      || distance(a, project) - distance(b, project) || a.id - b.id).slice(0, 2) : [];
  project.escortIds = escort.map(p => p.id);
  project.constructionStatus = !civilians.length ? 'aguardando trabalhadores aptos'
    : project.siegeBlocked ? 'obra interrompida por ataque'
      : civilians.some(p => distance(p, project) <= 3) ? 'equipe trabalhando na obra' : 'trabalhadores a caminho';
  if (!project.workerIds.includes(person.id) && !project.escortIds.includes(person.id)) return null;
  return { construction: true, project, target: project, withdrawing: false };
}

export function performFrontierWork(world, person, order) {
  if (order.project.complete || order.project.destroyedDay != null || order.project.integrity <= 0) return false;
  if (person.constructionRetreating) return false;
  if (person.constructionProjectId !== order.project.id) {
    person.constructionProjectId = order.project.id;
    person.constructionStallDays = 0;
  }
  const workstation = person.role === 'resident'
    ? claimConstructionWorkstation(world, order.project, person) : null;
  if (person.role === 'resident' && !workstation) {
    person.state = 'aguardando ponto de trabalho na obra';
    return false;
  }
  if (person.role === 'resident') {
    const cleared = clearConstructionWorkpointResources(world, person, workstation.position);
    if (cleared.cleared) {
      person.state = 'limpando ' + cleared.kinds.map(kind => CONSTRUCTION_OBSTACLE_NAMES[kind] || 'recurso').join(' e ')
        + ' do ponto de construção';
      person.constructionStallDays = 0;
      return true;
    }
  }
  let moved = false;
  if (person.role === 'resident' && !workstation.arrived) {
    moved = moveOne(world, person, { x: workstation.position.x, y: workstation.position.y }, false);
  } else if (person.role === 'soldier' && distance(person, order.project) > 3) {
    moved = moveOne(world, person, order.project, false, { arrivalRadius: 3 });
  }
  if (person.role === 'resident') {
    person.constructionStallDays = moved || workstation.arrived ? 0 : (person.constructionStallDays || 0) + 1;
    if (person.constructionStallDays >= 4) {
      (order.project.blockedWorkerUntil ||= {})[person.id] = world.day + 7;
      order.project.workerIds = (order.project.workerIds || []).filter(id => id !== person.id);
      person.constructionStallDays = 0;
      person.state = 'rota da obra bloqueada; equipe será substituída';
      return false;
    }
  }
  const working = person.role === 'resident' && workstation.arrived;
  person.state = person.role === 'soldier' ? 'escoltando trabalhadores da torre' : working ? 'construindo ' + order.project.type : 'indo para a obra do rei';
  person.brain.lastAction = person.role === 'soldier' ? 'guard' : 'build';
  if (working && person.energy > 8 && !order.project.siegeBlocked) {
    const day = world.day + 1;
    order.project.lastConstructionWorkDay = day;
    order.project.lastConstructionWorkerId = person.id;
    order.project.lastConstructionWorkPosition = { x: workstation.position.x, y: workstation.position.y };
    if (!order.project.progress) order.project.constructionStartedDay = day;
    person.visualActivity = { kind: 'build', ...constructionContactPoint(order.project), day };
    consumePersonEnergy(person, 1.2);
    consumeFoodReserve(person, .2, 'royal-construction-effort');
  }
  return true;
}

// Construction is an explicit casus belli; established towers remain strategic objectives after a truce.
export function prepareFrontierConflicts(world, day) {
  updateTowerTension(world, day);
  if (day <= INITIAL_PEACE_DAYS) return;
  const urgency = kingdom => (kingdom.frontierLosses || []).filter(r => day - r.day <= 60).reduce((sum, r) => sum + r.tiles, 0)
    + (kingdom.knownEnemyInstallations || []).filter(r => day - r.day <= 60).length * 5;
  const attackers = world.kingdoms.slice().sort((a, b) => urgency(b) - urgency(a)
    || (Math.floor(day / FRONTIER_RECOVERY_DAYS) + a.id) % world.kingdoms.length - (Math.floor(day / FRONTIER_RECOVERY_DAYS) + b.id) % world.kingdoms.length);
  for (const attacker of attackers) {
    const defender = world.kingdoms.find(k => k.id !== attacker.id);
    if (!defender) continue;
    const relation = kingdomRelation(world, attacker.id, defender.id);
    if (relation.status === 'at-war' || day <= (relation.ceasefireUntilDay ?? -1)) continue;
    if (day < (relation.nextTowerRaidDay ?? 0)) continue;
    if (world.campaigns.some(c => c.status !== 'complete' && [c.attackerId, c.defenderId].includes(attacker.id))) continue;
    const known = (attacker.knownEnemyInstallations || []).filter(item => item.opponentId === defender.id && day - item.day <= 60);
    if (relation.tension >= .35 && known.length) {
      const target = known.slice().sort((a, b) => Number(b.type === 'torre') - Number(a.type === 'torre')
        || distance(a, attacker) - distance(b, attacker)).find(item => world.structures.some(s => s.id === item.id && s.destroyedDay == null && s.kingdomId === defender.id));
      if (target && orderInstallationAttack(world, attacker.id, target.id, { day, source: 'border-recon' }).ok) break;
    }
    if (relation.tension >= .4 && relation.towerPressure?.pairs.length) {
      const pair = relation.towerPressure.pairs.slice().sort((a, b) => b.pressure - a.pressure)[0];
      const targetId = world.structures.find(s => s.id === pair.firstTowerId)?.kingdomId === defender.id
        ? pair.firstTowerId : pair.secondTowerId;
      if (orderTowerCapture(world, attacker.id, targetId, { day, source: 'tower-tension' }).ok) break;
    }
    const towers = world.structures.filter(s => ['torre', 'castelo', 'casa', 'curral', 'vila', 'mercado'].includes(s.type) && s.kingdomId === defender.id
      && s.integrity > 0 && s.destroyedDay == null && (s.complete || s.kingdomProject && s.builtDay == null && s.progress > 0));
    const project = towers.find(s => s.type === 'torre' && !s.complete);
    if (!project && day < (relation.nextTowerRaidDay ?? 100)) continue;
    const target = project || towers.sort((a, b) => Number(b.type === 'torre') - Number(a.type === 'torre') || distance(a, attacker) - distance(b, attacker))[0];
    if (!target) continue;
    if (!world.people.some(p => p.alive && p.role === 'soldier' && p.kingdomId === attacker.id)) continue;
    const location = { x: target.x, y: target.y };
    const cause = project ? 'incursão para impedir a construção de uma torre' : 'ataque a uma construção estratégica da fronteira';
    const evidence = { location, incidentDay: day, structureId: target.id, objectiveType: target.type,
      attacker: { source: 'reconhecimento militar da torre', location },
      defender: { source: 'vigias e escolta da torre', location } };
    const id = world.nextId++;
    relation.status = 'at-war'; relation.warId = id; relation.startedDay = day; relation.warCause = cause;
    relation.nextTowerRaidDay = day + FRONTIER_RECOVERY_DAYS;
    world.wars.push({ id, a: relation.a, b: relation.b, attackerId: attacker.id, defenderId: defender.id,
      startedDay: day, status: 'active', cause, evidence });
    break;
  }
}
