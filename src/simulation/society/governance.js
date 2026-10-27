import { clamp, distance, hash01 } from '../core/math.js';
import { communityFoodStock, spendStoreInventory } from '../economy/inventories.js';
import { domesticatedSheep } from '../ecology/animals.js';
import { availableCommunityPen } from '../ecology/herd.js';
import { canCommunityBuild, canRepairKingdomStructure, communityBuildingNeed, communityStructures, nextCommunityStructure } from '../settlements/construction.js';
import { bestPeopleFoodCell } from '../individuals/actions.js';
import { plantBiomass } from '../ecology/plants.js';
import { localNameFeature } from './communities.js';
import { log } from '../core/events.js';
import { updateKingdomStrategies } from '../kingdoms/strategy.js';
import { DAILY_FOOD_NEED, FOOD_RESERVE_PER_UNIT } from '../../config/ecosystem.js';

const COMMUNITY_WORK_ACTION_LABELS = Object.freeze({
  forage: 'buscar alimento', gather: 'reunir materiais', build: 'construir', rest: 'descansar',
  drink: 'buscar água', hunt: 'caçar', deliver: 'entregar recursos', explore: 'explorar',
  collect_feed: 'recolher ração', socialize: 'socializar', trade: 'negociar', migrate: 'migrar'
});

export function communityRelation(w, a, b) {
    const key = Math.min(a.id, b.id) + ':' + Math.max(a.id, b.id);
    return w.communityRelations[key] || (w.communityRelations[key] = { a: Math.min(a.id, b.id), b: Math.max(a.id, b.id), trust: .12, tension: 0, trades: 0, conflicts: 0 });
  }

export function ensureCommunityGovernanceState(community) {
    community.properties = community.properties || [];
    community.assignments = community.assignments || [];
    community.satisfaction = Number.isFinite(community.satisfaction) ? community.satisfaction : .5;
    community.lastGovernanceDay = Number.isFinite(community.lastGovernanceDay) ? community.lastGovernanceDay : -999;
    community.lastPropertyDay = Number.isFinite(community.lastPropertyDay) ? community.lastPropertyDay : -999;
    community.leadershipChallenge = community.leadershipChallenge || null;
  }

export function selectCommunityLeader(w, community, members) {
    if (!members.length) return null;
    const current = members.find(person => person.id === community.leaderId);
    if (current) return current;
    const eligible = members.filter(person => person.ageDays >= 12 * 365);
    const leader = (eligible.length ? eligible : members).slice().sort((a, b) => (b.prestige || 0) + b.skills.diplomacy * 1.4 + b.sociability * .25
      - ((a.prestige || 0) + a.skills.diplomacy * 1.4 + a.sociability * .25) || a.id - b.id)[0];
    community.leaderId = leader.id;
    if (!community.leaderChosenDay) community.leaderChosenDay = w.day;
    return leader;
  }

export function communitySatisfaction(w, community) {
    const members = community.memberIds.map(id => w.people.find(person => person.id === id && person.alive)).filter(Boolean);
    if (!members.length) return 0;
    const meanFood = members.reduce((sum, person) => sum + person.foodReserve, 0) / members.length;
    const meanHealth = members.reduce((sum, person) => sum + person.health, 0) / members.length;
    const meanSocialNeed = members.reduce((sum, person) => sum + person.socialNeed, 0) / members.length;
    const foodSecurity = clamp(clamp(meanFood / 68, 0, 1) * .55
      + clamp(communityFoodStock(community) / Math.max(1, members.length * 5), 0, 1) * .45, 0, 1);
    const shelter = w.structures.some(structure => structure.complete && structure.type === 'abrigo' && structure.communityId === community.id) ? 1 : .4;
    const social = clamp(1 - meanSocialNeed / 100 * .68 + (community.cohesion || 0) * .32, 0, 1);
    return clamp(foodSecurity * .43 + social * .21 + meanHealth / 100 * .2 + shelter * .08 + (community.cohesion || 0) * .08, 0, 1);
  }

export function taskForCommunity(w, community, members) {
    const size = members.length, foodPerMember = communityFoodStock(community) / Math.max(1, size);
    const herd = domesticatedSheep(w, community);
    const hasPen = w.structures.some(structure => structure.complete && structure.type === 'curral' && structure.communityId === community.id);
    const peopleNeedFood = members.some(person => person.foodReserve < 42);
    const farmPlan = nextCommunityStructure(w, community, size, communityStructures(w, community));
    const structures = communityStructures(w, community);
    const activeFarm = structures.some(structure => structure.type === 'roça' && !structure.complete);
    const farmInvestmentReady = (activeFarm || (farmPlan && farmPlan.type === 'roça' && canCommunityBuild(w, community, size)))
      && members.some(person => person.role !== 'soldier' && person.ageDays >= 12 * 365
        && person.hydration > 18 && person.energy > 27 && person.health > 28 && person.foodReserve > 16);
    // Protect the people before investing labor in livestock or buildings. A common
    // reserve is a buffer; one safe worker may establish the first crop field while
    // the remaining residents continue collecting food for immediate needs.
    if ((foodPerMember < 8 || peopleNeedFood) && !farmInvestmentReady) return {
      action: 'forage', title: 'buscar alimento para o reino', skill: 'forage', priority: 'urgent'
    };
    if (farmInvestmentReady) return { action: 'build', title: 'construir uma roça e semear raízes', skill: 'build', goal: 'invest-in-cultivated-food' };
    if (hasPen && herd.length && (community.stores.feed || 0) < Math.max(8, herd.length * 5)) return { action: 'collect_feed', title: 'repor brotos para o rebanho', skill: 'care' };
    const observedWildSheep = !!availableCommunityPen(w, community.id) && members.some(person => (person.perception && person.perception.animals || []).some(sighting => {
      const sheep = w.animals.find(animal => animal.id === sighting.id && animal.alive);
      return sighting.speciesId === 'sheep' && sighting.visible && sighting.distance <= 5.5 && sheep && sheep.herdCommunityId === null && !sheep.beingLedBy;
    }));
    if (observedWildSheep) return { action: 'capture_sheep', title: 'capturar e conduzir uma ovelha ao curral', skill: 'care' };
    if (canCommunityBuild(w, community, size)) return { action: 'build', title: 'construir uma estrutura comunitária', skill: 'build' };
    if (size >= 3 && communityBuildingNeed(w, community, size) > .08) return { action: 'gather', title: 'reunir materiais para a construção', skill: 'gather' };
    return null;
  }

function auditForageWorkers(w, leader, workers) {
  const audit = {
    adultWorkers: 0,
    activeAssignments: 0,
    availableAdults: 0,
    belowSurvivalLimits: 0,
    belowHydration: 0,
    belowEnergy: 0,
    belowStandardEnergy14: 0,
    belowHealth: 0,
    belowFoodReserve: 0,
    noFoodPerceivedWithinFive: 0,
    energy8To14WithFoodPerceived: 0,
    eligibleWorkers: 0
  };
  for (const person of workers) {
    if (!person.alive || person.id === leader.id || person.ageDays < 12 * 365) continue;
    audit.adultWorkers++;
    if (person.assignment && person.assignment.expiresDay >= w.day) {
      audit.activeAssignments++;
      continue;
    }
    audit.availableAdults++;
    const lowHydration = person.hydration < 24;
    const lowHealth = person.health < 28;
    const lowFoodReserve = person.foodReserve < 14;
    const lowEnergyUnderStandardCutoff = person.energy < 14;
    if (lowHydration) audit.belowHydration++;
    if (lowHealth) audit.belowHealth++;
    if (lowFoodReserve) audit.belowFoodReserve++;
    if (lowEnergyUnderStandardCutoff) audit.belowStandardEnergy14++;
    if (lowEnergyUnderStandardCutoff) audit.belowEnergy++;
    if (lowHydration || lowHealth || lowFoodReserve) {
      audit.belowSurvivalLimits++;
      continue;
    }
    const foodTarget = bestPeopleFoodCell(w, person, 5);
    if (!foodTarget) {
      audit.noFoodPerceivedWithinFive++;
    }
    if (lowEnergyUnderStandardCutoff) {
      audit.belowSurvivalLimits++;
      if (foodTarget && person.energy > 8) {
        audit.energy8To14WithFoodPerceived++;
      }
      continue;
    }
    if (!foodTarget) continue;
    audit.eligibleWorkers++;
  }
  return audit;
}

export function assignCommunityTasks(w, community, leader, members, desiredOverride = null, useCommunityFallback = true) {
    const desired = desiredOverride || (useCommunityFallback ? taskForCommunity(w, community, members) : null);
    if (!desired || members.length < 2) return;
    const workers = community.isKingdomGroup ? members.filter(person => person.role !== 'soldier') : members;
    const fields = desired.action === 'forage' ? w.structures.filter(s => s.communityId === community.id
      && s.type === 'roça' && s.complete && s.destroyedDay == null && s.integrity !== 0) : [];
    const cropInvestment = desired.action === 'build' && desired.goal === 'invest-in-cultivated-food';
    const foodWorkers = workers.filter(person => person.id !== leader.id && person.ageDays >= 12 * 365);
    const harvestPerWorker = foodWorkers.length ? foodWorkers.reduce((sum, person) => sum + 1.8 + person.skills.forage * 3.2, 0) / foodWorkers.length : 1.8;
    const foodCapacity = Math.min(foodWorkers.length, Math.max(1, Math.ceil(members.length * DAILY_FOOD_NEED
      / (harvestPerWorker * FOOD_RESERVE_PER_UNIT))));
    const capacity = desired.action === 'forage' && desired.priority === 'urgent' ? foodCapacity
      : cropInvestment || desired.goal === 'repair-damaged-structures' ? 1 : desired.priority === 'urgent'
      ? Math.min(5, Math.max(1, Math.ceil(workers.length / 3)))
      : Math.min(3, Math.max(1, Math.ceil(workers.length / 5)));
    const active = workers.filter(person => person.assignment && person.assignment.expiresDay >= w.day
      && !(desired.priority === 'urgent' && person.assignment.source === 'community-project'));
    let open = Math.max(0, capacity - active.length);
    const initialOpen = open;
    while (open > 0) {
      const hasPen = w.structures.some(structure => structure.complete && structure.type === 'curral' && structure.communityId === community.id);
      const eligible = person => {
        if (person.ageDays < 12 * 365) return false;
        // Do not assign already depleted people to work that could be done by a
        // healthier member. If everyone is depleted, their own survival policy wins.
        if (person.hydration < 24 || person.energy < 14 || person.health < 28 || person.foodReserve < 14) return false;
        if (desired.action === 'forage') {
          return person.energy > 8 && (!!bestPeopleFoodCell(w, person, 5) || fields.length > 0);
        }
        if (desired.action === 'build') return person.energy > 27 && person.hydration > 18 && person.foodReserve > 16
          // Governance runs after today's actions. Movement toward a site sets a
          // two-day cooldown, which ticks down before each next individual action.
          && person.buildCooldown <= 2 && (desired.goal === 'repair-damaged-structures'
            ? canRepairKingdomStructure(w, community) : canCommunityBuild(w, community, workers.length));
        if (desired.action === 'trade') {
          const kingdom = w.kingdoms.find(item => item.id === community.kingdomId);
          const station = kingdom && w.structures.find(item => item.type === 'mercado' && item.kingdomId === kingdom.id);
          return !!station && distance(person, station) <= 16;
        }
        if (desired.action === 'collect_feed') return hasPen && person.energy > 12 && (person.perception && person.perception.resources || []).some(item => item.visible && (item.biomass.browse || 0) > 1);
        if (desired.action === 'capture_sheep') return !!availableCommunityPen(w, community.id, person)
          && !person.leadingSheepId && person.energy > 18
          && (person.perception && person.perception.animals || []).some(sighting => sighting.speciesId === 'sheep' && sighting.visible && sighting.distance <= 5.5
            && w.animals.some(animal => animal.id === sighting.id && animal.alive && animal.herdCommunityId === null && !animal.beingLedBy));
        if (desired.action === 'gather') return person.energy > 12 && (person.perception && person.perception.resources || []).some(item => item.visible
          && (item.stone > 0 || item.goldOre > 0 || (item.biomass.broadleaf || 0) + (item.biomass.conifer || 0) > 260));
        return true;
      };
      const availableWorkers = workers.filter(person => person.id !== leader.id
        && !(person.assignment && person.assignment.expiresDay >= w.day));
      const sortByFit = (a, b) => (b.skills[desired.skill] || 0) + b.energy * .003
        - (a.skills[desired.skill] || 0) - a.energy * .003 || a.id - b.id;
      const candidate = availableWorkers.filter(person => eligible(person)).sort(sortByFit)[0];
      if (!candidate) break;
      candidate.assignment = { action: desired.action, title: desired.title, skill: desired.skill, assignedBy: leader.id,
        assignedDay: w.day, expiresDay: w.day + (desired.expiresAfterDays || (desired.priority === 'urgent' ? 7 : 21)), communityId: community.id,
        source: desired.source || 'community-governance', goal: desired.goal || null,
        priority: desired.priority || 'normal', pauseReason: null, lastPausedDay: null };
      if (fields.length) candidate.assignment.foodFieldId = fields.slice()
        .sort((a, b) => distance(candidate, a) - distance(candidate, b) || a.id - b.id)[0].id;
      community.assignments.push({ personId: candidate.id, action: desired.action, goal: desired.goal || null, assignedDay: w.day, status: 'delegada' });
      if (community.assignments.length > 16) community.assignments.shift();
      community.history.push(leader.name + ' delegou a ' + candidate.name + ' a tarefa: ' + desired.title + '.');
      open--;
    }
    if (desired.source === 'kingdom-strategy' && initialOpen > 0 && open === initialOpen) {
      const kingdom = w.kingdoms.find(item => item.id === community.kingdomId);
      const workforce = desired.action === 'forage' ? auditForageWorkers(w, leader, workers) : null;
      const reason = workforce
        ? 'nenhum trabalhador apto para coleta: ' + workforce.eligibleWorkers + ' elegíveis entre '
          + workforce.adultWorkers + ' adultos; ' + workforce.activeAssignments + ' com atribuição ativa; '
          + workforce.belowSurvivalLimits + ' abaixo dos limites pessoais da ordem; '
          + workforce.noFoodPerceivedWithinFive + ' sem alimento percebido em até 5 células'
          + (workforce.energy8To14WithFoodPerceived
            ? '; ' + workforce.energy8To14WithFoodPerceived + ' com 8 < energia < 14 e alimento percebido, mas abaixo do limite 14' : '')
        : desired.action === 'gather'
        ? 'nenhum trabalhador elegível observou madeira ou pedra disponível para coleta'
        : desired.action === 'build'
          ? 'nenhum trabalhador elegível estava disponível para construir'
          : 'nenhum trabalhador elegível observou o recurso necessário nas proximidades';
      if (kingdom && kingdom.strategy) {
        kingdom.strategy.lastOutcome = { status: 'blocked', day: w.day, goal: desired.goal, reason,
          ...(workforce ? { workforce } : {}) };
        log(w, kingdom.name + ' não conseguiu delegar ' + desired.title + ': ' + reason + '.');
      }
    }
  }

function recordProjectWorkStatus(w, project, status, reason, details = {}) {
  project.workStatus = {
    status,
    day: w.day,
    reason,
    progress: Number.isFinite(project.progress) ? project.progress : 0,
    required: Number.isFinite(project.required) ? project.required : 0,
    lastProgressDay: Number.isFinite(project.lastProgressDay) ? project.lastProgressDay : null,
    ...details
  };
}

function assignSafeOngoingBuilder(w, community, leader, members) {
  const project = w.structures.find(structure => structure.communityId === community.id && !structure.complete && !structure.kingdomProject
    && structure.destroyedDay == null && structure.integrity !== 0);
  const projectAssignments = members.filter(person => person.assignment && person.assignment.source === 'community-project'
    && person.assignment.communityId === community.id);
  if (!project) {
    for (const person of projectAssignments) {
      const record = (community.assignments || []).slice().reverse().find(item => item.personId === person.id && item.status === 'delegada');
      if (record) record.status = 'cancelada';
      person.assignment = null;
    }
    return false;
  }

  const activeBuilder = projectAssignments.find(person => person.assignment.structureId === project.id
    && person.assignment.expiresDay >= w.day && person.foodReserve >= 24
    && person.hydration >= 22 && person.energy > 27 && person.health >= 28
    && !person.constructionRetreating && person.homeRestTargetId == null && !person.restingOutdoors);
  if (activeBuilder) {
    activeBuilder.assignment.expiresDay = w.day + 15;
    const workerDistance = distance(activeBuilder, project);
    const workerAction = activeBuilder.brain && activeBuilder.brain.lastAction || null;
    const pauseReason = activeBuilder.assignment.pauseReason || null;
    const status = pauseReason ? 'worker-paused' : workerDistance > 14 ? 'worker-out-of-range'
      : workerDistance > 3.5 ? 'worker-approaching'
        : workerAction === 'build' || String(activeBuilder.state || '').startsWith('construindo') ? 'worker-working'
          : 'worker-following-local-policy';
    const reason = pauseReason ? 'A atribuição está pausada por ' + pauseReason + '.'
      : workerDistance > 14 ? 'A pessoa designada está a ' + workerDistance.toFixed(1) + ' células, fora do raio de trabalho de 14.'
        : workerDistance > 3.5 ? 'A pessoa designada ainda está se deslocando para o canteiro (' + workerDistance.toFixed(1) + ' células).'
          : status === 'worker-working' ? 'A pessoa designada avançou no canteiro recentemente.'
            : 'A atribuição foi mantida, mas a decisão local observada foi '
              + (COMMUNITY_WORK_ACTION_LABELS[workerAction] || activeBuilder.state || workerAction || 'indefinida') + '.';
    recordProjectWorkStatus(w, project, status, reason, {
      workerId: activeBuilder.id,
      workerAction,
      workerState: activeBuilder.state || null,
      distance: Number(workerDistance.toFixed(1))
    });
    return true;
  }
  for (const person of projectAssignments) {
    const record = (community.assignments || []).slice().reverse().find(item => item.personId === person.id && item.status === 'delegada');
    if (record) record.status = 'pausada por necessidade';
    person.assignment = null;
  }

  const workers = members.filter(person => person.role !== 'soldier' && person.id !== leader.id);
  const adultWorkers = workers.filter(person => person.ageDays >= 12 * 365);
  const availableWorkers = adultWorkers.filter(person => !(person.assignment && person.assignment.expiresDay >= w.day));
  const nearbyWorkers = availableWorkers.filter(person => distance(person, project) <= 14);
  // Keep one worker on an existing project while the rest of the community
  // gathers food. Requiring a full food reserve here deadlocks the first
  // shelter and farm precisely when the kingdom needs cultivated food most.
  const safeWorkers = nearbyWorkers.filter(person => person.foodReserve >= 24 && person.hydration >= 22
    && person.energy > 27 && person.health >= 28 && !person.constructionRetreating
    && person.homeRestTargetId == null && !person.restingOutdoors && person.buildCooldown <= 2);
  const candidate = safeWorkers
    .sort((a, b) => distance(a, project) - distance(b, project)
      || b.foodReserve - a.foodReserve || a.id - b.id)[0];
  if (!candidate || !canCommunityBuild(w, community, members.length)) {
    const reason = !adultWorkers.length ? 'Não há adulto residente disponível para trabalhar na obra.'
      : !availableWorkers.length ? 'Todos os adultos residentes estão ocupados com outras tarefas.'
        : !nearbyWorkers.length ? 'Não há adultos residentes livres em até 14 células do canteiro.'
          : !safeWorkers.length ? 'Os trabalhadores próximos não atendem aos limites de reserva, hidratação, energia, saúde e intervalo da obra.'
            : 'A comunidade ainda não autorizou o início ou a continuação da obra.';
    recordProjectWorkStatus(w, project, 'blocked', reason, {
      availableNearby: nearbyWorkers.length,
      safeNearby: safeWorkers.length
    });
    return false;
  }

  candidate.assignment = {
    action: 'build', title: 'concluir uma obra comunitária já financiada', skill: 'build',
    assignedBy: leader.id, assignedDay: w.day, expiresDay: w.day + 15,
    communityId: community.id, source: 'community-project', goal: 'complete-funded-project',
    priority: 'normal', structureId: project.id, pauseReason: null, lastPausedDay: null
  };
  community.assignments.push({ personId: candidate.id, action: 'build', goal: 'complete-funded-project',
    assignedDay: w.day, status: 'delegada' });
  if (community.assignments.length > 16) community.assignments.shift();
  recordProjectWorkStatus(w, project, 'delegated',
    'A liderança designou um trabalhador seguro e próximo; a decisão individual continua ativa.', {
      workerId: candidate.id,
      workerAction: candidate.brain && candidate.brain.lastAction || null,
      workerState: candidate.state || null,
      distance: Number(distance(candidate, project).toFixed(1))
    });
  community.history.push(leader.name + ' reservou um trabalhador com boas reservas para avançar uma obra comunitária já financiada, mantendo a prioridade alimentar do reino.');
  return true;
}

export function acquireCommunityProperty(w, community) {
    if (community.isKingdomGroup) return null;
    ensureCommunityGovernanceState(community);
    const livingMembers = community.memberIds.map(id => w.people.find(person => person.id === id && person.alive)).filter(Boolean);
    const members = livingMembers.length;
    const meanPersonalFood = members ? livingMembers.reduce((sum, person) => sum + person.foodReserve, 0) / members : 0;
    if (members < 6 || community.satisfaction < .48 || w.day - community.lastPropertyDay < 90
        || (community.stores.gold || 0) < 3 || (community.stores.wood || 0) < 20 || (community.stores.stone || 0) < 8
        || meanPersonalFood < 45) return null;
    const properties = community.properties || [];
    let best = null, bestScore = -Infinity;
    for (const tile of w.tiles) {
      const centerDistance = distance(tile, community);
      if (tile.terrain !== 'land' || tile.slope > .45 || centerDistance < 8 || centerDistance > 22) continue;
      const overlapsCommunity = w.communities.some(other => !other.dissolved && other.id !== community.id
        && (other.properties || []).some(property => distance(tile, property) < (property.radius || 5) + 2));
      if (overlapsCommunity || properties.some(property => distance(tile, property) < (property.radius || 5) + 5)) continue;
      const biomass = plantBiomass(tile, ['grass', 'berry', 'browse', 'broadleaf', 'conifer']);
      const waterAccess = Math.max(0, 8 - tile.waterDist);
      const score = Math.log1p(biomass) * .22 + waterAccess * .12 - tile.slope * .8 - centerDistance * .025
        + hash01(w.seed + community.id * 73, tile.x, tile.y) * .04;
      if (score > bestScore) { best = tile; bestScore = score; }
    }
    if (!best) return null;
    if (!spendStoreInventory(community, { gold: 3, wood: 20, stone: 8 }, 'property-investment')) return null;
    const property = { id: w.nextId++, communityId: community.id, x: best.x, y: best.y, radius: 5, acquiredDay: w.day,
      feature: localNameFeature(w, best.x, best.y) };
    community.properties.push(property); community.lastPropertyDay = w.day;
    const message = community.name + ' adquiriu uma nova propriedade perto de ' + property.feature + ' por 3 ouro, 20 madeira e 8 pedra.';
    community.history.push(message); log(w, message);
    return property;
  }

export function updateCommunityGovernance(w, kingdomPlanner) {
    updateKingdomStrategies(w, kingdomPlanner);
    for (const community of w.communities) {
      if (community.dissolved) continue;
      ensureCommunityGovernanceState(community);
      const members = community.memberIds.map(id => w.people.find(person => person.id === id && person.alive)).filter(Boolean);
      if (!members.length) continue;
      for (const member of members) if (member.assignment && member.assignment.expiresDay < w.day) {
        const expired = (community.assignments || []).slice().reverse().find(item => item.personId === member.id && item.status === 'delegada');
        if (expired) expired.status = 'expirada';
        member.assignment = null;
      }
      if (community.isKingdomGroup) {
        const kingdom = w.kingdoms.find(item => item.id === community.kingdomId);
        const leader = kingdom && members.find(person => person.id === kingdom.rulerId) || selectCommunityLeader(w, community, members);
        community.leaderId = leader.id;
        community.satisfaction = communitySatisfaction(w, community);
        if (w.day - community.lastGovernanceDay >= 8) {
          assignCommunityTasks(w, community, leader, members, kingdom && kingdom.strategy && kingdom.strategy.order, false);
          community.lastGovernanceDay = w.day;
        }
        assignSafeOngoingBuilder(w, community, leader, members);
        continue;
      }
      const leader = selectCommunityLeader(w, community, members);
      community.satisfaction = communitySatisfaction(w, community);
      const challengers = members.filter(person => person.id !== leader.id && person.ageDays >= 12 * 365 && (person.prestige || 0) > (leader.prestige || 0))
        .sort((a, b) => (b.prestige || 0) - (a.prestige || 0) || a.id - b.id);
      const candidate = challengers[0];
      if (candidate) {
        const relations = members.filter(person => person.id !== candidate.id).map(person => w.socialLinks[candidate.id + ':' + person.id] || w.socialLinks[person.id + ':' + candidate.id]).filter(Boolean);
        const support = relations.length ? relations.filter(link => link.trust >= .25).length / (members.length - 1) : 0;
        if (support >= .34) {
          if (community.leadershipChallenge && community.leadershipChallenge.candidateId === candidate.id) community.leadershipChallenge.days++;
          else community.leadershipChallenge = { candidateId: candidate.id, days: 1 };
          if (community.leadershipChallenge.days >= 7) {
            const previous = leader;
            community.leaderId = candidate.id; community.leadershipChallenge = null;
            const message = candidate.name + ' assumiu a liderança de ' + community.name + ' após superar o prestígio de ' + previous.name + ' e obter apoio dos membros.';
            community.history.push(message); log(w, message);
          }
        } else community.leadershipChallenge = null;
      } else community.leadershipChallenge = null;
      if (w.day - community.lastGovernanceDay >= 8) {
        assignCommunityTasks(w, community, members.find(person => person.id === community.leaderId) || leader, members);
        community.lastGovernanceDay = w.day;
      }
      if (w.day % 30 === 0) acquireCommunityProperty(w, community);
    }
  }

export function completeCommunityTask(w, person, action, beforeState, afterState) {
    const task = person.assignment;
    if (!task || task.expiresDay < w.day || task.communityId !== person.communityId) return false;
    let succeeded = false;
    if (task.action === 'forage' && task.source === 'kingdom-strategy' && action === 'deliver') {
      task.action = 'deliver'; task.supplyPhase = 'communal-delivery';
    }
    if (task.action === 'forage' && action === 'forage') {
      if (afterState.carriedFood > beforeState.carriedFood + .02) {
        if (task.source === 'kingdom-strategy') task.supplyPhase = 'communal-collection';
        else { task.action = 'deliver'; task.supplyPhase = 'communal-delivery'; }
        return false;
      }
      succeeded = afterState.food > beforeState.food + .02;
    }
    else if (task.action === 'collect_feed' && action === 'collect_feed') {
      if (afterState.carriedFeed > beforeState.carriedFeed + .02) { task.action = 'deliver'; return false; }
    } else if (task.action === 'gather' && (action === 'gather' || action === 'collect_log')) {
      if (afterState.carriedWood > beforeState.carriedWood + .02 || afterState.carriedStone > beforeState.carriedStone + .02 || afterState.carriedGold > beforeState.carriedGold + .02) {
        task.action = 'deliver'; return false;
      }
    } else if (task.action === 'capture_sheep' && action === 'capture_sheep' && person.leadingSheepId) { task.action = 'lead_sheep'; return false; }
    else if (task.action === 'build' && action === 'build') succeeded = task.goal === 'repair-damaged-structures'
      ? afterState.repairProgress > beforeState.repairProgress + .01
      : afterState.buildProgress > beforeState.buildProgress;
    else if (task.action === 'trade' && action === 'trade') succeeded = afterState.tradeCount > beforeState.tradeCount;
    else if (task.action === 'raid' && action === 'raid' && person.lastRaidSuccess) { task.action = 'deliver'; person.lastRaidSuccess = false; return false; }
    else if (task.action === 'deliver' && action === 'deliver') succeeded = afterState.food > beforeState.food + .02 || afterState.feed > beforeState.feed + .02
      || afterState.wood > beforeState.wood + .02 || afterState.stone > beforeState.stone + .02 || afterState.gold > beforeState.gold + .02;
    else if (task.action === 'lead_sheep' && action === 'lead_sheep') succeeded = beforeState.leadingSheepId && !person.leadingSheepId;
    if (!succeeded) return false;
    const community = w.communities.find(group => group.id === person.communityId && !group.dissolved);
    if (community && task.source === 'kingdom-strategy' && task.foodFieldId != null
        && ['forage', 'deliver'].includes(task.action) && communityFoodStock(community) < community.memberIds.length * 2) {
      task.action = 'forage'; task.supplyPhase = 'communal-collection';
      return false;
    }
    const leader = community && w.people.find(member => member.id === community.leaderId && member.alive);
    person.prestige = (person.prestige || 0) + 1;
    if (leader && leader.id !== person.id) leader.prestige = (leader.prestige || 0) + .2;
    person.assignment = null; person.lastRaidSuccess = false;
    if (community) {
      community.history.push(person.name + ' concluiu a tarefa delegada (' + task.title + ') e ganhou 1 prestígio; a liderança recebeu 0,2.');
      const record = (community.assignments || []).slice().reverse().find(item => item.personId === person.id && item.status === 'delegada');
      if (record) record.status = 'concluída';
      if (task.source === 'kingdom-strategy') {
        const kingdom = w.kingdoms.find(item => item.id === community.kingdomId);
        const result = { status: 'completed', day: w.day, goal: task.goal, action: task.action, personId: person.id };
        if (kingdom && kingdom.strategy) {
          kingdom.strategy.lastOutcome = result;
          kingdom.strategy.history.push({ ...result, reason: 'A tarefa delegada produziu o resultado esperado.' });
          if (kingdom.strategy.history.length > 12) kingdom.strategy.history.shift();
          log(w, kingdom.name + ' confirmou a tarefa estratégica de ' + person.name + ': ' + task.title + '.');
        }
      }
    }
    person.lastLesson = 'Concluir uma tarefa delegada aumentou o prestígio e reforçou a coordenação do reino.';
    return true;
  }
