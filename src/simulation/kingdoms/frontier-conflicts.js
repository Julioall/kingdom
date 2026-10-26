import { kingdomRelation } from './territories.js';
import { distance } from '../core/math.js';
import { moveOne } from '../individuals/movement.js';
import { log } from '../core/events.js';
import { consumeFoodReserve } from '../economy/inventories.js';
import { consumePersonEnergy } from '../individuals/energy.js';
import { claimConstructionWorkstation, clearConstructionWorkpointResources, constructionContactPoint, MAX_CONSTRUCTION_WORKERS } from '../settlements/construction-workstations.js';
import { PEOPLE_ACTIONS, PLANTS } from '../../config/ecosystem.js';
import { cellAt } from '../world/spatial.js';

export const INITIAL_PEACE_DAYS = 45;
export const FRONTIER_RECOVERY_DAYS = 45;
const CONSTRUCTION_OBSTACLE_NAMES = Object.freeze({ tree: 'árvore', stone: 'pedra', gold: 'minério de ouro' });
const CONSTRUCTION_THREAT_NOTICE_RADIUS = 9;
const CONSTRUCTION_THREAT_EVADE_RADIUS = 6.5;
const CONSTRUCTION_THREAT_PATH_BUFFER = 3.5;
const CONSTRUCTION_CLEAR_DAYS_TO_RESUME = 2;
const CONSTRUCTION_MAX_EVADE_PATH_ATTEMPTS = 32;

function constructionThreats(world, person, project) {
  return world.people.filter(candidate => candidate.alive && candidate.role === 'soldier'
    && candidate.kingdomId !== person.kingdomId
    && (candidate.campaignId != null || candidate.combatTargetId === person.id))
    .map(candidate => {
      const action = candidate.combatAction;
      const projectileTargetsWorker = action?.weapon === 'arqueiro' && action.targetId === person.id
        && action.phase !== 'complete' && !action.result;
      return { person: candidate,
        distance: Math.min(distance(candidate, person), distance(candidate, project)),
        targetsWorker: candidate.combatTargetId === person.id || projectileTargetsWorker,
        projectileTargetsWorker };
    })
    .filter(entry => entry.distance <= CONSTRUCTION_THREAT_NOTICE_RADIUS || entry.targetsWorker)
    .sort((a, b) => a.distance - b.distance || a.person.id - b.person.id);
}

function constructionRiskDecision(world, person, project, threats) {
  const closest = threats[0];
  const risk = closest ? Math.max(0, Math.min(1,
    (CONSTRUCTION_THREAT_NOTICE_RADIUS - closest.distance) / CONSTRUCTION_THREAT_NOTICE_RADIUS
      + (closest.targetsWorker ? .35 : 0))) : 0;
  const progressRatio = project.required > 0 ? (project.progress || 0) / project.required : 0;
  const skill = Math.max(0, Math.min(1, person.skills?.build || 0));
  const opportunity = Math.max(0, Math.min(1, .35 + (1 - progressRatio) * .4 + skill * .25));
  const threshold = Math.max(.3, Math.min(.7, .38 + opportunity * .12));
  const policy = person.constructionRiskPolicy ||= { values: {}, updates: 0 };
  const values = policy.values;
  const learnedBuild = person.brain?.actionValues?.[PEOPLE_ACTIONS.indexOf('build')] || 0;
  const learnedMigrate = person.brain?.actionValues?.[PEOPLE_ACTIONS.indexOf('migrate')] || 0;
  const scores = {
    flee: risk * 1.15 + (values.flee || 0) + learnedMigrate * .08,
    'seek-cover': risk * 1.05 + (closest?.targetsWorker ? .62 : 0) + (values['seek-cover'] || 0) + learnedMigrate * .08,
    wait: .1 + risk * .55 + (values.wait || 0),
    'retry-build': opportunity * .72 + (1 - risk) * .25 + (values['retry-build'] || 0) + learnedBuild * .08
  };
  if (!closest) scores.flee = scores['seek-cover'] = scores.wait = -1;
  else if (risk >= threshold) scores.wait = scores['retry-build'] = -1;
  else if (distance(closest.person, project) < 6) {
    scores.wait = Math.max(scores.wait, .48 + risk * .2);
    scores['retry-build'] = -1;
  }
  const action = Object.entries(scores).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  return { day: world.day + 1, projectId: project.id, action, threatId: closest?.person.id ?? null,
    distance: closest?.distance ?? null, risk: Number(risk.toFixed(3)), opportunity: Number(opportunity.toFixed(3)),
    threshold: Number(threshold.toFixed(3)), scores: Object.fromEntries(Object.entries(scores).map(([key, value]) => [key, Number(value.toFixed(3))])) };
}

function constructionCover(world, tile) {
  let cover = 0;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    if (Math.hypot(dx, dy) > 2) continue;
    const candidate = cellAt(world, tile.x + dx, tile.y + dy);
    if (!candidate) continue;
    cover += (candidate.plants || []).reduce((sum, amount, index) => {
      const plant = PLANTS[index];
      return sum + (plant ? amount * (plant.canopy || 0) / Math.max(1, plant.max || 1) : 0);
    }, 0);
  }
  return cover;
}

function projectileDistance(point, action) {
  if (!action?.origin || !action?.aim) return Infinity;
  const dx = action.aim.x - action.origin.x, dy = action.aim.y - action.origin.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1,
    ((point.x - action.origin.x) * dx + (point.y - action.origin.y) * dy) / lengthSquared)) : 0;
  return distance(point, { x: action.origin.x + t * dx, y: action.origin.y + t * dy });
}

function constructionSafeTargets(world, person, threats, seekCover = false) {
  const safeFromThreat = tile => threats.every(entry => distance(tile, entry.person) >= CONSTRUCTION_THREAT_EVADE_RADIUS
    && (!entry.projectileTargetsWorker || projectileDistance(tile, entry.person.combatAction) > .9));
  let candidates = world.tiles.filter(tile => tile.terrain === 'land' && tile.slope <= .8
    && distance(tile, person) >= 2 && distance(tile, person) <= 12
    && safeFromThreat(tile));
  if (seekCover) {
    const covered = candidates.filter(tile => constructionCover(world, tile) > .05);
    if (covered.length) candidates = covered.concat(candidates.filter(tile => !covered.includes(tile)));
  }
  candidates.sort((a, b) => (seekCover ? constructionCover(world, b) - constructionCover(world, a) : 0)
      || Math.min(...threats.map(entry => distance(b, entry.person)))
        - Math.min(...threats.map(entry => distance(a, entry.person)))
      || distance(a, person) - distance(b, person) || a.i - b.i);
  const safePathTile = tile => threats.every(entry => distance(tile, entry.person) >= CONSTRUCTION_THREAT_PATH_BUFFER
    && (!entry.projectileTargetsWorker || projectileDistance(tile, entry.person.combatAction) > .9));
  return { candidates, safePathTile };
}

function releaseConstructionSlot(project, person) {
  project.workerIds = (project.workerIds || []).filter(id => id !== person.id);
  project.constructionWorkerIds = (project.constructionWorkerIds || []).filter(id => id !== person.id);
  if (project.constructionWorkerLastSeen) delete project.constructionWorkerLastSeen[person.id];
  if (project.lastConstructionWorkerId === person.id) {
    project.lastConstructionWorkerId = null;
    project.lastConstructionWorkDay = null;
    project.lastConstructionWorkPosition = null;
  }
  if (person.constructionWorkPosition?.structureId === project.id) person.constructionWorkPosition = null;
}

function releaseConstructionWorkstation(project, person) {
  project.constructionWorkerIds = (project.constructionWorkerIds || []).filter(id => id !== person.id);
  project.workerIds = (project.workerIds || []).filter(id => id !== person.id);
  if (project.constructionWorkerLastSeen) delete project.constructionWorkerLastSeen[person.id];
  if (project.lastConstructionWorkerId === person.id) {
    project.lastConstructionWorkerId = null;
    project.lastConstructionWorkDay = null;
    project.lastConstructionWorkPosition = null;
  }
  person.constructionThreatState = null;
  person.constructionProjectId = null;
  person.constructionWorkPosition = null;
  person.constructionStallDays = 0;
}

function appendConstructionIncident(project, entry) {
  project.constructionIncidents ||= [];
  project.constructionIncidents.push(entry);
  if (project.constructionIncidents.length > 40) project.constructionIncidents.shift();
}

function recordConstructionRisk(world, person, project, decision, incident) {
  person.constructionPolicyDecision = decision;
  project.constructionRiskHistory ||= [];
  project.constructionRiskHistory.push({ ...decision });
  if (project.constructionRiskHistory.length > 40) project.constructionRiskHistory.shift();
  if (!incident) return;
  const entry = { day: decision.day, projectId: project.id, workerId: person.id,
    action: decision.action, threatId: decision.threatId, risk: decision.risk,
    opportunity: decision.opportunity, reason: incident };
  appendConstructionIncident(project, entry);
  log(world, person.name + (decision.action === 'retry-build'
    ? ' retomou a obra ' : decision.action === 'wait' ? ' aguardou a redução do risco na obra ' : ' se retirou da obra ')
    + project.id + ' (' + incident + ').', decision.day);
}

function trainConstructionRiskPolicy(world, person, project, currentThreats) {
  const pending = person.constructionRiskPending;
  if (!pending || pending.projectId !== project.id) return;
  const threat = world.people.find(candidate => candidate.id === pending.threatId && candidate.alive);
  const currentThreatDistance = threat ? distance(threat, person) : CONSTRUCTION_THREAT_NOTICE_RADIUS;
  const currentRisk = currentThreats[0]
    ? Math.max(0, (CONSTRUCTION_THREAT_NOTICE_RADIUS - currentThreats[0].distance) / CONSTRUCTION_THREAT_NOTICE_RADIUS) : 0;
  const damage = Math.max(0, pending.health - person.health);
  const reward = pending.action === 'flee' || pending.action === 'seek-cover'
    ? Math.max(-1, Math.min(1, .2 + Math.max(0, currentThreatDistance - pending.threatDistance) * .12 - damage * .025))
    : pending.action === 'wait'
      ? Math.max(-1, Math.min(1, .15 + Math.max(-.4, Math.min(.4, (pending.risk - currentRisk) * .5)) - damage * .025))
      : (project.progress || 0) > pending.progress ? .35 : -.12;
  const policy = person.constructionRiskPolicy ||= { values: {}, updates: 0 };
  const previous = policy.values[pending.action] || 0;
  policy.values[pending.action] = Math.max(-1, Math.min(1, previous + .2 * (reward - previous)));
  policy.updates++;
  project.constructionPolicyTraining ||= [];
  project.constructionPolicyTraining.push({ day: world.day, workerId: person.id, projectId: project.id,
    action: pending.action, reward: Number(reward.toFixed(3)), value: Number(policy.values[pending.action].toFixed(3)) });
  if (project.constructionPolicyTraining.length > 40) project.constructionPolicyTraining.shift();
  person.constructionRiskPending = null;
}

function rememberConstructionDecision(person, project, decision) {
  person.constructionRiskPending = { ...decision, health: person.health, progress: project.progress || 0,
    threatDistance: decision.distance ?? CONSTRUCTION_THREAT_NOTICE_RADIUS };
}

function respondToConstructionRisk(world, person, project) {
  const threats = constructionThreats(world, person, project);
  trainConstructionRiskPolicy(world, person, project, threats);
  const decision = constructionRiskDecision(world, person, project, threats);
  const previous = person.constructionThreatState;
  if (decision.action === 'flee' || decision.action === 'seek-cover') {
    const enteringRetreat = previous?.projectId !== project.id || previous.status !== 'retreating';
    person.constructionThreatState = { projectId: project.id, status: 'retreating',
      clearDays: 0, lastClearDay: null, sinceDay: enteringRetreat ? decision.day : previous.sinceDay,
      target: previous?.projectId === project.id ? previous.target : null };
    person.constructionProjectId = project.id;
    releaseConstructionSlot(project, person);
    recordConstructionRisk(world, person, project, decision, enteringRetreat ? 'ameaça local observável' : null);
    const { candidates, safePathTile } = constructionSafeTargets(world, person, threats, decision.action === 'seek-cover');
    let moved = false;
    let reachedCover = false;
    for (const target of candidates.slice(0, CONSTRUCTION_MAX_EVADE_PATH_ATTEMPTS)) {
      if (distance(person, target) <= .25 || moveOne(world, person, target, false, { allowedTile: safePathTile })) {
        person.constructionThreatState.target = { x: target.x, y: target.y };
        reachedCover = decision.action === 'seek-cover' && constructionCover(world, target) > .05;
        moved = true;
        break;
      }
    }
    const state = person.constructionThreatState;
    state.stalledDays = moved ? 0 : (state.stalledDays || 0) + 1;
    person.constructionThreatState.coverTarget = reachedCover;
    person.state = moved ? reachedCover ? 'buscando abrigo para proteger a obra' : 'retirando-se da obra ameaçada'
      : 'aguardando uma rota segura para deixar a obra';
    person.lastLesson = 'A política comparou risco local ' + decision.risk.toFixed(2) + ' com oportunidade de trabalho '
      + decision.opportunity.toFixed(2) + ' e priorizou segurança sem cancelar a obra financiada.';
    rememberConstructionDecision(person, project, decision);
    if (state.stalledDays >= 4) {
      (project.blockedWorkerUntil ||= {})[person.id] = world.day + 7;
      releaseConstructionWorkstation(project, person);
      person.state = 'rota de fuga bloqueada; outro trabalhador poderá assumir a obra';
      recordConstructionRisk(world, person, project,
        { ...decision, action: 'wait' }, 'rota segura inalcançável; vaga liberada para substituto');
    }
    return true;
  }

  if (decision.action === 'wait') {
    const enteringWait = previous?.projectId !== project.id || previous.status !== 'waiting';
    person.constructionThreatState = { projectId: project.id, status: 'waiting', sinceDay: enteringWait ? decision.day : previous.sinceDay };
    recordConstructionRisk(world, person, project, decision, enteringWait ? 'pausa preventiva protegeu a equipe durante ameaça próxima' : null);
    rememberConstructionDecision(person, project, decision);
    person.state = 'aguardando redução do risco antes de construir';
    person.lastLesson = 'A política reteve o trabalho porque a obra está no raio de cerco, protegendo a equipe sem cancelar o projeto.';
    return true;
  }

  if (!previous || previous.projectId !== project.id) {
    recordConstructionRisk(world, person, project, decision, null);
    rememberConstructionDecision(person, project, decision);
    if (decision.action === 'wait') {
      person.state = 'aguardando redução do risco antes de construir';
      person.lastLesson = 'A política comparou risco local e oportunidade da obra e escolheu aguardar antes de voltar ao ponto de trabalho.';
      return true;
    }
    return false;
  }
  if (previous.status === 'waiting') {
    person.constructionThreatState = null;
    recordConstructionRisk(world, person, project, decision, 'ameaça afastada; pausa preventiva encerrada');
    rememberConstructionDecision(person, project, decision);
    return false;
  }
  if (previous.status === 'retreating') {
    const clearDay = world.day + 1;
    previous.clearDays = previous.lastClearDay === world.day ? previous.clearDays + 1 : 1;
    previous.lastClearDay = clearDay;
    if (previous.clearDays < CONSTRUCTION_CLEAR_DAYS_TO_RESUME) {
      person.state = 'aguardando confirmação de rota segura para a obra';
      person.lastLesson = 'A política mantém a pausa por histerese até observar dois dias sem ameaça local.';
      return true;
    }
    previous.status = 'returning';
    previous.returnStallDays = 0;
  }
  if (previous.status !== 'returning') return false;
  const workstation = claimConstructionWorkstation(world, project, person);
  if (!workstation) {
    person.state = 'aguardando vaga para retomar a obra';
    return true;
  }
  if (!workstation.arrived && !moveOne(world, person, workstation.position, false)) {
    previous.returnStallDays = (previous.returnStallDays || 0) + 1;
    person.state = 'rota de retomada bloqueada; reavaliando a obra';
    if (previous.returnStallDays >= 4) {
      (project.blockedWorkerUntil ||= {})[person.id] = world.day + 7;
      releaseConstructionWorkstation(project, person);
      person.state = 'retomada bloqueada; vaga liberada para substituto';
    }
    return true;
  }
  previous.returnStallDays = 0;
  if (distance(person, workstation.position) > .1) {
    person.state = 'retornando à mesma obra após a ameaça';
    return true;
  }
  if (!project.workerIds.includes(person.id)) project.workerIds.push(person.id);
  person.constructionThreatState = null;
  recordConstructionRisk(world, person, project, decision, 'ameaça afastada; mesma obra e reserva preservadas');
  return true;
}

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
  const validProject = structure => structure?.kingdomId === person.kingdomId && structure.kingdomProject
    && !structure.complete && structure.integrity > 0 && structure.builtDay == null;
  let project = world.structures.find(structure => structure.id === person.constructionProjectId && validProject(structure));
  const previousProject = person.constructionProjectId == null ? null
    : world.structures.find(structure => structure.id === person.constructionProjectId);
  if (previousProject && previousProject !== project) {
    const reason = previousProject.complete ? 'obra concluída' : previousProject.kingdomId !== person.kingdomId
      ? 'obra capturada por outro reino' : 'obra destruída ou cancelada';
    if (person.constructionThreatState?.projectId === previousProject.id || previousProject.workerIds?.includes(person.id)) {
      appendConstructionIncident(previousProject, { day: world.day, projectId: previousProject.id,
        workerId: person.id, action: 'abandon', reason });
      log(world, person.name + ' abandonou a obra ' + previousProject.id + ': ' + reason + '.', world.day);
      releaseConstructionWorkstation(previousProject, person);
    }
  } else if (person.constructionProjectId != null && !previousProject) {
    person.constructionProjectId = null;
    person.constructionThreatState = null;
    person.constructionWorkPosition = null;
  }
  project ||= world.structures.find(validProject);
  if (!project || person.campaignId != null) return null;
  const available = p => p.alive && p.role === 'resident' && p.ageDays >= 18 * 365
    && p.kingdomId === project.kingdomId && !p.recruitmentOrder && p.campaignId == null
    && p.energy > 24 && p.foodReserve > 8 && p.hydration > 15 && p.health >= 45
    && !p.constructionRetreating && p.homeRestTargetId == null && p.restingStructureId == null && !p.restingOutdoors
    && (project.blockedWorkerUntil?.[p.id] ?? -1) < world.day;
  const recoveringWorker = person.constructionProjectId === project.id
    && person.constructionThreatState?.projectId === project.id
    && ['retreating', 'returning'].includes(person.constructionThreatState.status);
  const civilians = (project.workerIds || []).map(id => world.people.find(p => p.id === id))
    .filter(p => p && available(p)).slice(0, MAX_CONSTRUCTION_WORKERS);
  const replacements = world.people.filter(p => available(p) && p.constructionProjectId == null
    && !p.constructionThreatState && !civilians.includes(p)
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
  if (!project.workerIds.includes(person.id) && !project.escortIds.includes(person.id) && !recoveringWorker) return null;
  return { construction: true, project, target: project, withdrawing: false };
}

export function performFrontierWork(world, person, order) {
  if (order.project.complete || order.project.destroyedDay != null || order.project.integrity <= 0) return false;
  if (person.constructionRetreating) return false;
  if (person.constructionProjectId !== order.project.id) {
    person.constructionProjectId = order.project.id;
    person.constructionStallDays = 0;
  }
  if (person.role === 'resident' && respondToConstructionRisk(world, person, order.project)) return true;
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
