import { initializeTowerHealth, TOWER_HEALTH } from './fortifications.js';
import { log } from '../core/events.js';
import { enlistSoldier } from './service.js';
import { recruitKingdomSoldier, buildKingdomStructure } from './commands.js';
import { assignHome, INITIAL_MILITARY_ROSTER } from './initialization.js';

export function advanceKingdomProjects(world, day) {
  // The king funds specialist training from the same treasury and adult population as manual recruitment.
  if (day >= 24 && day % 12 === 0) for (const kingdom of world.kingdoms) {
    for (const { school, militaryClass, count: target } of INITIAL_MILITARY_ROSTER) {
      if (!world.structures.some(s => s.kingdomId === kingdom.id && s.type === school && s.complete)) {
        if (!world.structures.some(s => s.kingdomId === kingdom.id && s.type === school && s.kingdomProject && !s.complete))
          buildKingdomStructure(world, kingdom.id, school);
        continue;
      }
      const count = world.people.filter(p => p.alive && p.kingdomId === kingdom.id
        && (p.role === 'soldier' && p.militaryClass === militaryClass || p.recruitmentOrder?.militaryClass === militaryClass)).length;
      if (count < target) recruitKingdomSoldier(world, kingdom.id, { militaryClass, startedDay: day });
    }
  }

  for (const structure of world.structures) {
    if (!structure.kingdomProject || structure.complete || structure.builtDay != null) continue;
    structure.siegeBlocked = world.people.some(p => p.alive && p.role === 'soldier' && p.kingdomId !== structure.kingdomId && p.campaignId != null && Math.hypot(p.x - structure.x, p.y - structure.y) < 6);
    if (structure.siegeBlocked) continue;
    const worker = world.people.find(p => p.id === structure.lastConstructionWorkerId && p.alive && p.role === 'resident');
    const workPosition = structure.lastConstructionWorkPosition;
    const workerAtWorkPosition = worker && (workPosition
      ? Math.hypot(worker.x - workPosition.x, worker.y - workPosition.y) <= .1
      : Math.hypot(worker.x - structure.x, worker.y - structure.y) <= 2);
    if (structure.lastConstructionWorkDay !== day || structure.lastProgressDay === day || !worker
      || !workerAtWorkPosition) continue;
    initializeTowerHealth(structure);
    structure.progress = Math.min(structure.required, (structure.progress || 0) + 1);
    structure.lastProgressDay = day;
    if (structure.maxHealth) structure.health = Math.min(structure.maxHealth, structure.health + structure.maxHealth * (1 - TOWER_HEALTH.constructionFraction) / structure.required);
    if (structure.progress < structure.required) continue;
    structure.complete = true;
    structure.builtDay = day;
    structure.constructionStatus = 'obra concluída';
    structure.completedWorkerIds = (structure.workerIds || []).slice();
    const assignedIds = new Set([...(structure.workerIds || []), ...(structure.escortIds || []),
      ...world.people.filter(p => p.constructionProjectId === structure.id).map(p => p.id)]);
    for (const id of assignedIds) {
      const person = world.people.find(p => p.id === id && p.alive);
      if (!person) continue;
      if (person.state === 'escoltando trabalhadores da torre') person.state = 'escolta concluída; retomando serviço';
      else if (person.state === 'construindo ' + structure.type || person.constructionProjectId === structure.id)
        person.state = 'obra concluída; retomando atividades';
      person.constructionProjectId = null; person.constructionStallDays = 0;
      person.constructionWorkPosition = null;
      person.constructionThreatState = null;
      person.constructionRiskPending = null;
    }
    structure.workerIds = []; structure.escortIds = [];
    structure.constructionWorkerIds = []; structure.constructionWorkerLastSeen = {};
    const kingdom = world.kingdoms.find(item => item.id === structure.kingdomId);
    log(world, 'O reino ' + (kingdom && kingdom.name || 'desconhecido') + ' concluiu '
      + (structure.frontierOutpost ? 'um posto de fronteira' : structure.type === 'casa' ? 'uma casa' : structure.type === 'torre' ? 'uma torre' : structure.type === 'monasterio' ? 'um monastério' : structure.type === 'arquearia' ? 'uma arquearia' : 'um centro militar')
      + ' no dia ' + day + '.');
  }

  for (const person of world.people) {
    if (!person.alive || person.kingdomId == null || person.homeId != null) continue;
    const kingdom = world.kingdoms.find(k => k.id === person.kingdomId);
    if (kingdom) assignHome(world, kingdom, person);
  }

  for (const structure of world.structures) {
    if (!structure.frontierOutpost || !structure.complete) continue;
    const assigned = world.people.find(person => person.id === structure.garrisonSoldierId
      && person.alive && person.role === 'soldier' && person.kingdomId === structure.kingdomId);
    if (assigned) continue;
    structure.garrisonSoldierId = null;
    const alreadyPosted = new Set(world.structures.filter(item => item.frontierOutpost && item.complete
      && item.kingdomId === structure.kingdomId && item.id !== structure.id && item.garrisonSoldierId != null)
      .map(item => item.garrisonSoldierId));
    const guard = world.people.filter(person => person.alive && person.role === 'soldier'
      && person.kingdomId === structure.kingdomId && !alreadyPosted.has(person.id))
      .sort((a, b) => Math.hypot(a.x - structure.x, a.y - structure.y)
        - Math.hypot(b.x - structure.x, b.y - structure.y) || a.id - b.id)[0];
    if (!guard) continue;
    structure.garrisonSoldierId = guard.id;
    guard.militaryDutyPostId = structure.id;
    guard.patrolRoute = null;
    guard.patrolCenterId = null;
    guard.patrolWaypointIndex = 0;
    const kingdom = world.kingdoms.find(item => item.id === structure.kingdomId);
    log(world, (kingdom && kingdom.name || 'O reino') + ' designou ' + guard.name
      + ' para patrulhar o novo posto de fronteira.');
  }

  for (const person of world.people) {
    const order = person.recruitmentOrder;
    if (!person.alive || !order || day < order.readyDay) continue;
    const center = world.structures.find(structure => structure.id === order.militaryCenterId
      && structure.complete && structure.type === 'centro_militar');
    if (!center || (center.soldierIds || []).includes(person.id)) {
      delete person.recruitmentOrder;
      continue;
    }
    enlistSoldier(world, person, center, day, order.militaryClass);
    const kingdom = world.kingdoms.find(item => item.id === order.kingdomId);
    const recruitment = kingdom && (kingdom.militaryRecruitments || []).find(item => item.personId === person.id && item.status === 'training');
    if (recruitment) {
      recruitment.status = 'trained';
      recruitment.completedDay = day;
    }
    log(world, person.name + ' concluiu ' + KINGDOM_TRAINING_LABEL + ' e entrou na guarnição de '
      + (kingdom && kingdom.name || 'seu reino') + ' no dia ' + day + '.');
  }
}

const KINGDOM_TRAINING_LABEL = 'o treinamento militar';
