import { clamp, distance, hash01 } from '../core/math.js';
import { communityFoodStock } from '../economy/inventories.js';
import { domesticatedSheep } from '../ecology/animals.js';
import { canCommunityBuild, communityBuildingNeed } from '../settlements/construction.js';
import { bestPeopleFoodCell } from '../individuals/actions.js';
import { plantBiomass } from '../ecology/plants.js';
import { localNameFeature } from './communities.js';
import { log } from '../core/events.js';

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
    // Protect the people before investing labor in livestock or buildings. A common
    // reserve is a buffer; personal reserves still determine who is in immediate danger.
    if (foodPerMember < 8 || peopleNeedFood) return {
      action: 'forage', title: 'buscar alimento para o reino', skill: 'forage', priority: 'urgent'
    };
    if (hasPen && herd.length && (community.stores.feed || 0) < Math.max(8, herd.length * 5)) return { action: 'collect_feed', title: 'repor brotos para o rebanho', skill: 'care' };
    const taggedHerdSize = w.animals.filter(animal => animal.alive && animal.speciesId === 'sheep' && animal.herdCommunityId === community.id).length;
    const observedWildSheep = hasPen && taggedHerdSize < 4 && members.some(person => (person.perception && person.perception.animals || []).some(sighting => {
      const sheep = w.animals.find(animal => animal.id === sighting.id && animal.alive);
      return sighting.speciesId === 'sheep' && sighting.visible && sighting.distance <= 5.5 && sheep && sheep.herdCommunityId === null && !sheep.beingLedBy;
    }));
    if (observedWildSheep) return { action: 'capture_sheep', title: 'capturar e conduzir uma ovelha ao curral', skill: 'care' };
    if (canCommunityBuild(w, community, size)) return { action: 'build', title: 'construir uma estrutura comunitária', skill: 'build' };
    if (size >= 3 && communityBuildingNeed(w, community, size) > .08) return { action: 'gather', title: 'reunir materiais para a construção', skill: 'gather' };
    return null;
  }

export function assignCommunityTasks(w, community, leader, members) {
    const desired = taskForCommunity(w, community, members);
    if (!desired || members.length < 2) return;
    const capacity = desired.priority === 'urgent'
      ? Math.min(5, Math.max(1, Math.ceil(members.length / 3)))
      : Math.min(3, Math.max(1, Math.ceil(members.length / 5)));
    const active = members.filter(person => person.assignment && person.assignment.expiresDay >= w.day);
    let open = Math.max(0, capacity - active.length);
    while (open > 0) {
      const hasPen = w.structures.some(structure => structure.complete && structure.type === 'curral' && structure.communityId === community.id);
      const eligible = person => {
        if (person.ageDays < 12 * 365) return false;
        // Do not assign already depleted people to work that could be done by a
        // healthier member. If everyone is depleted, their own survival policy wins.
        if (person.hydration < 24 || person.energy < 14 || person.health < 28 || person.foodReserve < 14) return false;
        if (desired.action === 'build') return person.energy > 27 && person.hydration > 18 && person.foodReserve > 16
          && person.buildCooldown <= 0 && canCommunityBuild(w, community, members.length);
        if (desired.action === 'collect_feed') return hasPen && person.energy > 12 && (person.perception && person.perception.resources || []).some(item => item.visible && (item.biomass.browse || 0) > 1);
        if (desired.action === 'capture_sheep') return hasPen && !person.leadingSheepId && person.energy > 18
          && (person.perception && person.perception.animals || []).some(sighting => sighting.speciesId === 'sheep' && sighting.visible && sighting.distance <= 5.5
            && w.animals.some(animal => animal.id === sighting.id && animal.alive && animal.herdCommunityId === null && !animal.beingLedBy));
        if (desired.action === 'gather') return person.energy > 12 && (person.perception && person.perception.resources || []).some(item => item.visible
          && (item.stone > 0 || item.goldOre > 0 || (item.biomass.broadleaf || 0) + (item.biomass.conifer || 0) > 260));
        if (desired.action === 'forage') return person.energy > 8 && !!bestPeopleFoodCell(w, person, 5);
        return true;
      };
      const candidate = members.filter(person => person.id !== leader.id && eligible(person) && !(person.assignment && person.assignment.expiresDay >= w.day))
        .sort((a, b) => (b.skills[desired.skill] || 0) + b.energy * .003 - (a.skills[desired.skill] || 0) - a.energy * .003 || a.id - b.id)[0];
      if (!candidate) break;
      candidate.assignment = { action: desired.action, title: desired.title, skill: desired.skill, assignedBy: leader.id,
        assignedDay: w.day, expiresDay: w.day + (desired.priority === 'urgent' ? 7 : 21), communityId: community.id,
        priority: desired.priority || 'normal', pauseReason: null, lastPausedDay: null };
      community.assignments.push({ personId: candidate.id, action: desired.action, assignedDay: w.day, status: 'delegada' });
      if (community.assignments.length > 16) community.assignments.shift();
      community.history.push(leader.name + ' delegou a ' + candidate.name + ' a tarefa: ' + desired.title + '.');
      open--;
    }
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
    community.stores.gold -= 3; community.stores.wood -= 20; community.stores.stone -= 8;
    const property = { id: w.nextId++, communityId: community.id, x: best.x, y: best.y, radius: 5, acquiredDay: w.day,
      feature: localNameFeature(w, best.x, best.y) };
    community.properties.push(property); community.lastPropertyDay = w.day;
    const message = community.name + ' adquiriu uma nova propriedade perto de ' + property.feature + ' por 3 ouro, 20 madeira e 8 pedra.';
    community.history.push(message); log(w, message);
    return property;
  }

export function updateCommunityGovernance(w) {
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
          assignCommunityTasks(w, community, leader, members);
          community.lastGovernanceDay = w.day;
        }
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
    if (task.action === 'forage' && action === 'forage') succeeded = afterState.food > beforeState.food + .02;
    else if (task.action === 'collect_feed' && action === 'collect_feed') {
      if (afterState.carriedFeed > beforeState.carriedFeed + .02) { task.action = 'deliver'; return false; }
    } else if (task.action === 'gather' && (action === 'gather' || action === 'collect_log')) {
      if (afterState.carriedWood > beforeState.carriedWood + .02 || afterState.carriedStone > beforeState.carriedStone + .02 || afterState.carriedGold > beforeState.carriedGold + .02) {
        task.action = 'deliver'; return false;
      }
    } else if (task.action === 'capture_sheep' && action === 'capture_sheep' && person.leadingSheepId) { task.action = 'lead_sheep'; return false; }
    else if (task.action === 'build' && action === 'build') succeeded = afterState.buildProgress > beforeState.buildProgress;
    else if (task.action === 'raid' && action === 'raid' && person.lastRaidSuccess) { task.action = 'deliver'; person.lastRaidSuccess = false; return false; }
    else if (task.action === 'deliver' && action === 'deliver') succeeded = afterState.food > beforeState.food + .02 || afterState.feed > beforeState.feed + .02
      || afterState.wood > beforeState.wood + .02 || afterState.stone > beforeState.stone + .02 || afterState.gold > beforeState.gold + .02;
    else if (task.action === 'lead_sheep' && action === 'lead_sheep') succeeded = beforeState.leadingSheepId && !person.leadingSheepId;
    if (!succeeded) return false;
    const community = w.communities.find(group => group.id === person.communityId && !group.dissolved);
    const leader = community && w.people.find(member => member.id === community.leaderId && member.alive);
    person.prestige = (person.prestige || 0) + 1;
    if (leader && leader.id !== person.id) leader.prestige = (leader.prestige || 0) + .2;
    person.assignment = null; person.lastRaidSuccess = false;
    if (community) {
      community.history.push(person.name + ' concluiu a tarefa delegada (' + task.title + ') e ganhou 1 prestígio; a liderança recebeu 0,2.');
      const record = (community.assignments || []).slice().reverse().find(item => item.personId === person.id && item.status === 'delegada');
      if (record) record.status = 'concluída';
    }
    person.lastLesson = 'Concluir uma tarefa delegada aumentou o prestígio e reforçou a coordenação do reino.';
    return true;
  }
