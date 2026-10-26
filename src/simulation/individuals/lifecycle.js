import { COMMUNITY_FORMS, FOOD_RESERVE_PER_UNIT, HEIGHT, HUMAN_NAMES, PEOPLE_ACTIONS, PEOPLE_INPUTS, RULER_HIDDEN_NEURONS, WIDTH } from '../../config/ecosystem.js';
import { rand } from '../core/random.js';
import { createBrain, ensureBrainSize } from '../../controllers/individual/neural.js';
import { randomHabitatCell } from '../world/generation.js';
import { clamp, distance } from '../core/math.js';
import { cellAt } from '../world/spatial.js';
import { log } from '../core/events.js';
import { activeCommunity, getSocialLink } from '../society/communities.js';
import { addFoodReserve, communityFoodStock, consumeFoodReserve, transferFoodReserve, withdrawCommunityFood } from '../economy/inventories.js';
import { assignHome } from '../kingdoms/initialization.js';
import { moveOne } from './movement.js';
import { consumePersonEnergy } from './energy.js';
import { abandonSocialIntentionsForPerson } from '../society/social-evidence.js';

function availablePersonSpawn(w, x, y) {
  const origin = cellAt(w, Math.round(x), Math.round(y));
  if (!origin || !Array.isArray(w.people)) return { x, y };
  const occupied = tile => w.people.some(person => person.alive
    && Math.round(person.x) === tile.x && Math.round(person.y) === tile.y);
  const maxRadius = Math.max(w.width, w.height);
  for (let radius = 0; radius <= maxRadius; radius++) {
    const candidates = [];
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
      const tile = cellAt(w, origin.x + dx, origin.y + dy);
      if (tile && tile.terrain !== 'water' && tile.terrain !== 'rock' && !occupied(tile))
        candidates.push(tile);
    }
    candidates.sort((a, b) => Math.hypot(a.x - origin.x, a.y - origin.y)
      - Math.hypot(b.x - origin.x, b.y - origin.y) || a.y - b.y || a.x - b.x);
    if (candidates.length) return { x: candidates[0].x, y: candidates[0].y };
  }
  throw new Error('Não há uma célula livre para posicionar um personagem.');
}

export function makePerson(w, x, y, newborn) {
    ({ x, y } = availablePersonSpawn(w, x, y));
    const id = w.nextId++;
    const first = HUMAN_NAMES[Math.floor(rand(w) * HUMAN_NAMES.length)];
    const name = newborn ? first + ' ' + ['Filho', 'Filha', 'Júnior'][Math.floor(rand(w) * 3)] : first + ' ' + String.fromCharCode(65 + Math.floor(rand(w) * 26));
    const person = {
      id, name, x, y, alive: true, ageDays: newborn ? 0 : 1800 + rand(w) * 11000,
      sex: rand(w) < .5 ? 'F' : 'M',
      namingForm: COMMUNITY_FORMS[Math.floor(rand(w) * COMMUNITY_FORMS.length)], namingVoice: .4 + rand(w) * .6,
      energy: newborn ? 65 : 58 + rand(w) * 38, hydration: 55 + rand(w) * 43, foodReserve: 0
    };
    addFoodReserve(person, newborn ? 0 : 55 + rand(w) * 40, 'new-person-provisions');
    Object.assign(person, {
      socialNeed: 45 + rand(w) * 50, sociability: .25 + rand(w) * .75, trust: .2 + rand(w) * .65,
      physicalStrength: .35 + rand(w) * .65,
      communityId: null, kingdomId: null, homeId: null, role: 'resident', militaryClass: null, militaryCenterId: null, militaryDutyCenterId: null, militaryDutyPostId: null,
      lastSafeX: x, lastSafeY: y, territoryExposure: null, territoryAwareness: null, territoryWarnings: {},
      moveCooldown: 0, buildCooldown: 0, birthCooldown: newborn ? 280 : Math.floor(rand(w) * 70),
      health: newborn ? 82 : 82 + rand(w) * 18, injury: 0, carriedFood: 0, carriedFruit: 0, carriedMeat: 0, carriedMaterial: 0,
      carriedWood: 0, carriedStone: 0, carriedFeed: 0, carriedGold: 0, headingX: (rand(w) - .5) * 2, headingY: (rand(w) - .5) * 2,
      leadingSheepId: null, prestige: 0, loyalty: .8, assignment: null, dissatisfactionDays: 0,
      sensoryMemory: { actors: {}, water: [] }, perception: null,
      personalMemory: [], strategicPlan: null, strategicRequestPending: null, nextStrategicDecisionDay: (id * 19) % 60 + 1, nextUrgentStrategicDecisionDay: 1,
      parents: newborn ? [] : null, guardianId: null, awayDays: 0, conflictRisk: 0,
      skills: { forage: .12 + rand(w) * .32, hunt: .06 + rand(w) * .24, gather: .08 + rand(w) * .3, build: .05 + rand(w) * .24, care: .08 + rand(w) * .3, diplomacy: .08 + rand(w) * .35 },
      brain: createBrain(w, PEOPLE_ACTIONS, PEOPLE_INPUTS, id), lastReward: 0,
      lastLesson: 'Ainda está aprendendo com o ambiente.', state: 'observando'
    });
    return person;
  }

export function addIndividuals(w, count, initial) {
    const added = [];
    let arrivalFoodReservePoints = 0;
    for (let n = 0; n < count; n++) {
      const wanderingTile = initial ? null : randomHabitatCell(w, false);
      const kingdom = w.kingdoms && w.kingdoms.length
        ? initial ? w.kingdoms[Math.min(w.kingdoms.length - 1, Math.floor(n * w.kingdoms.length / count))]
          : w.kingdoms.slice().sort((a, b) => distance(a, wanderingTile) - distance(b, wanderingTile))[0]
        : null;
      const vacantHome = kingdom && kingdom.homeIds.map(id => w.structures.find(s => s.id === id && s.complete && s.destroyedDay == null && s.residentIds.length < s.capacity)).find(Boolean);
      const t = initial && vacantHome ? cellAt(w, vacantHome.x, vacantHome.y) : wanderingTile || randomHabitatCell(w, false);
      const jitterX = Math.floor((rand(w) - .5) * (initial ? 3 : 5)), jitterY = Math.floor((rand(w) - .5) * (initial ? 3 : 5));
      let x = clamp(t.x + jitterX, 1, w.width - 2), y = clamp(t.y + jitterY, 1, w.height - 2);
      let cell = cellAt(w, x, y);
      if (!cell || cell.terrain === 'water' || cell.terrain === 'rock') { x = t.x; y = t.y; }
      const person = makePerson(w, x, y, false);
      if (!initial) arrivalFoodReservePoints += person.foodReserve;
      if (kingdom) {
        person.kingdomId = kingdom.id;
        person.communityId = kingdom.communityId || null;
        if (vacantHome) { person.homeId = vacantHome.id; vacantHome.residentIds.push(person.id); }
        else if (!initial) assignHome(w, kingdom, person);
        kingdom.memberIds.push(person.id);
      }
      w.people.push(person); added.push(person.id);
    }
    if (initial) for (const kingdom of w.kingdoms || []) {
      const members = kingdom.memberIds.map(id => w.people.find(person => person.id === id && person.alive)).filter(Boolean);
      const ruler = members
        .sort((a, b) => b.ageDays - a.ageDays || a.id - b.id)[0];
      if (ruler) {
        kingdom.rulerId = ruler.id;
        ruler.role = 'ruler';
        ensureBrainSize(w, ruler, RULER_HIDDEN_NEURONS);
      }
      const group = w.communities.find(item => item.id === kingdom.communityId);
      if (group) { group.leaderId = kingdom.rulerId; group.memberIds = kingdom.memberIds.slice(); }

      const adults = members.filter(person => person.ageDays >= 12 * 365);
      for (const child of members.filter(person => person.ageDays < 12 * 365)) {
        const sameHouse = adults.filter(person => person.homeId === child.homeId);
        const guardian = (sameHouse.length ? sameHouse : adults)
          .slice().sort((a, b) => distance(a, child) - distance(b, child) || a.id - b.id)[0];
        if (guardian) child.guardianId = guardian.id;
      }
    }
    if (!initial && added.length) log(w, added.length + ' indivíduos chegaram ao mundo trazendo '
      + arrivalFoodReservePoints.toFixed(1) + ' pontos de reserva alimentar de fora do mapa e foram associados ao reino e à moradia mais próximos.');
    return added;
  }

export function killPerson(w, person, cause) {
    if (!person.alive) return;
    person.alive = false; w.deaths++;
    person.deathKingdomId = person.kingdomId;
    person.deathDay = w.day + 1;
    person.deathCause = cause;
    abandonSocialIntentionsForPerson(w, person, 'owner_dead');
    const recentHealth = summarizeRecentHealth(person, person.deathDay);
    person.deathDetails = {
      day: person.deathDay,
      cause,
      ageDays: person.ageDays,
      health: person.health,
      foodReserve: person.foodReserve,
      hydration: person.hydration,
      injury: person.injury,
      carriedFood: person.carriedFood || 0,
      recentHealth
    };
    delete person.healthHistory;
    const kingdom = w.kingdoms.find(item => item.id === person.kingdomId);
    if (kingdom) {
      kingdom.memberIds = kingdom.memberIds.filter(id => id !== person.id);
      if (kingdom.rulerId === person.id) kingdom.rulerId = null;
    }
    const militaryCenter = person.militaryCenterId && w.structures.find(item => item.id === person.militaryCenterId);
    if (militaryCenter) militaryCenter.soldierIds = (militaryCenter.soldierIds || []).filter(id => id !== person.id);
    const group = person.communityId && w.communities.find(item => item.id === person.communityId);
    if (group) group.memberIds = group.memberIds.filter(id => id !== person.id);
    if (person.homeId) {
      const home = w.structures.find(s => s.id === person.homeId && s.type === 'casa');
      if (home) home.residentIds = home.residentIds.filter(id => id !== person.id);
    }
    w.deathsByCause[cause] = (w.deathsByCause[cause] || 0) + 1;
    const tile = cellAt(w, person.x, person.y);
    if (tile) tile.detritusGPerM2 += 4800;
    const labels = { starvation: 'fome', dehydration: 'desidratação', age: 'idade avançada', injury: 'ferimentos', combat: 'combate', invasion: 'invasão territorial' };
    const conditions = person.deathDetails;
    const healthLabels = {
      starvation: 'falta de alimento', dehydration: 'desidratação', injury: 'ferimentos acumulados',
      raid: 'assalto', 'resource-conflict': 'disputa por recurso', battle: 'batalha',
      care: 'cuidado dependente', recovery: 'recuperação geral'
    };
    const recentLosses = Object.entries(recentHealth.losses)
      .map(([source, amount]) => (healthLabels[source] || source) + ' ' + amount.toFixed(2)).join(', ');
    const recentRecovery = Object.entries(recentHealth.recovery)
      .map(([source, amount]) => (healthLabels[source] || source) + ' ' + amount.toFixed(2)).join(', ');
    const recentHealthText = [
      recentLosses ? 'perdas de saúde nos últimos 30 dias: ' + recentLosses : '',
      recentRecovery ? 'recuperação de saúde no período: ' + recentRecovery : ''
    ].filter(Boolean).join('; ');
    log(w, person.name + ' morreu por ' + (labels[cause] || cause) + '. Valores observados no óbito: reserva alimentar '
      + conditions.foodReserve.toFixed(1) + '/100; água ' + conditions.hydration.toFixed(1) + '%; saúde '
      + conditions.health.toFixed(1) + '%; ferimentos ' + conditions.injury.toFixed(1) + '; idade '
      + (conditions.ageDays / 365).toFixed(1) + ' anos; alimento carregado ' + conditions.carriedFood.toFixed(1)
      + (recentHealthText ? '; ' + recentHealthText : '')
      + '. A perda afeta seu reino e sua família; a matéria retorna ao solo.');
  }

function summarizeRecentHealth(person, deathDay) {
  const cutoff = deathDay - 29;
  const losses = {}, recovery = {};
  for (const entry of person.healthHistory || []) {
    if (entry.day < cutoff || entry.day > deathDay) continue;
    const amount = entry.delta < 0 ? -entry.delta : entry.delta;
    const totals = entry.delta < 0 ? losses : recovery;
    totals[entry.source] = (totals[entry.source] || 0) + amount;
  }
  const round = totals => Object.fromEntries(Object.entries(totals)
    .sort(([a], [b]) => a.localeCompare(b)).map(([source, amount]) => [source, Number(amount.toFixed(2))]));
  return { days: 30, losses: round(losses), recovery: round(recovery) };
}

export function changePersonHealth(w, person, delta, source) {
  if (!Number.isFinite(delta) || delta === 0) return 0;
  if (delta < 0 && ['battle', 'raid', 'resource-conflict', 'invasion', 'combat'].includes(source)) {
    person.lastAttackSequence = (person.lastAttackSequence || 0) + 1;
    person.lastAttackedDay = w.day + 1;
  }
  const before = Number.isFinite(person.health) ? person.health : 0;
  const after = clamp(before + delta, 0, 100);
  const applied = after - before;
  person.health = after;
  if (Math.abs(applied) < 1e-12) return 0;
  if (applied < 0 && person.role !== 'soldier' && ['battle', 'raid', 'resource-conflict', 'invasion', 'combat'].includes(source)) {
    const projects = (w.structures || []).filter(s => !s.complete && s.destroyedDay == null
      && (s.workerIds?.includes(person.id) || s.id === person.constructionProjectId || s.id === person.assignment?.structureId
        || person.visualActivity?.kind === 'build' && distance(person, s) <= 2
          && (s.kingdomId === person.kingdomId || s.communityId === person.communityId)));
    if (projects.length) {
      person.constructionRetreating = true;
      person.constructionRecoveryHealth = Math.min(100, Math.max(85, before));
      person.constructionProjectId = null;
      person.visualActivity = null;
      person.assignment = null;
      person.state = 'abandonando obra após ser ferido';
      for (const project of projects) {
        project.workerIds = (project.workerIds || []).filter(id => id !== person.id);
        (project.blockedWorkerUntil ||= {})[person.id] = w.day + 7;
        if (project.lastConstructionWorkerId === person.id) {
          project.lastConstructionWorkerId = null;
          project.lastConstructionWorkDay = null;
        }
        if (!project.workerIds.length) project.escortIds = [];
      }
    }
  }

  const day = w.day + 1;
  const history = person.healthHistory || (person.healthHistory = []);
  const sameDaySource = history.find(entry => entry.day === day && entry.source === source);
  if (sameDaySource) sameDaySource.delta += applied;
  else history.push({ day, source, delta: applied });
  const cutoff = day - 29;
  const firstRecent = history.findIndex(entry => entry.day >= cutoff);
  if (firstRecent > 0) history.splice(0, firstRecent);
  else if (firstRecent < 0) history.length = 0;
  return applied;
}

export function updateDependent(w, child) {
    const adultAge = 12 * 365;
    const familyIds = new Set([...(child.parents || []), child.guardianId].filter(Number.isInteger));
    const family = w.people.filter(person => person.alive && person.ageDays >= adultAge && familyIds.has(person.id));
    const communityAdults = w.people.filter(person => person.alive && person.ageDays >= adultAge
      && person.id !== child.id
      && (child.kingdomId !== null && child.kingdomId !== undefined
        ? person.kingdomId === child.kingdomId
        : child.communityId !== null && child.communityId !== undefined && person.communityId === child.communityId));
    const nearbyAdults = communityAdults.filter(person => distance(person, child) <= 6);
    const familyCaregiver = family.filter(person => distance(person, child) <= 6)
      .sort((a, b) => b.foodReserve - a.foodReserve || distance(a, child) - distance(b, child))[0];
    const nearbyFedAdult = nearbyAdults.filter(person => !familyIds.has(person.id) && person.foodReserve >= .42)
      .sort((a, b) => distance(a, child) - distance(b, child) || b.foodReserve - a.foodReserve)[0];
    const distantFedAdult = communityAdults.filter(person => !familyIds.has(person.id) && person.campaignId == null
      && person.foodReserve >= .42)
      .sort((a, b) => distance(a, child) - distance(b, child) || b.foodReserve - a.foodReserve)[0];
    let caregiver = familyCaregiver && familyCaregiver.foodReserve >= .42 ? familyCaregiver
      : nearbyFedAdult || distantFedAdult || familyCaregiver
      || nearbyAdults.sort((a, b) => distance(a, child) - distance(b, child))[0]
      || family.sort((a, b) => distance(a, child) - distance(b, child))[0] || null;
    if (caregiver && distance(caregiver, child) > 6) {
      moveOne(w, child, cellAt(w, caregiver.x, caregiver.y), false);
      if (distance(caregiver, child) > 6) caregiver = null;
    }
    if (caregiver) child.guardianId = caregiver.id;
    const community = activeCommunity(w, child);
    const careFoodNeed = caregiver && distance(caregiver, child) <= 6 ? .42 : .32;
    consumeFoodReserve(child, careFoodNeed, 'dependent-consumption');
    const sharedFood = community ? Math.min(careFoodNeed, communityFoodStock(community) * FOOD_RESERVE_PER_UNIT,
      Math.max(0, 100 - child.foodReserve)) : 0;
    if (sharedFood > .001) {
      withdrawCommunityFood(w, community, sharedFood / FOOD_RESERVE_PER_UNIT, 'dependent-food-issue');
      addFoodReserve(child, sharedFood, 'dependent-community-meal');
      child.sharedMeals = (child.sharedMeals || 0) + sharedFood / FOOD_RESERVE_PER_UNIT;
    }
    const unmetNeed = Math.max(0, careFoodNeed - sharedFood);
    if (caregiver && distance(caregiver, child) <= 6) {
      child.guardianId = caregiver.id;
      consumePersonEnergy(caregiver, .1);
      const caregiverOffer = Math.min(unmetNeed, Math.max(0, 100 - child.foodReserve));
      const caregiverContribution = transferFoodReserve(caregiver, child, caregiverOffer, 'dependent-care-transfer');
      caregiver.skills.care = clamp(caregiver.skills.care + .0003, 0, 1);
      if (caregiverContribution > .001 && !familyIds.has(caregiver.id)) {
        const amount = caregiverContribution.toFixed(2);
        child.lastLesson = 'Recebeu ' + amount + ' pontos de alimento de ' + caregiver.name + ' para o cuidado diário.';
        log(w, caregiver.name + ' apoiou ' + child.name + ' e transferiu ' + amount
          + ' pontos de alimento de sua reserva para o cuidado diário.');
      }
      child.hydration = clamp(child.hydration + .4, 0, 100);
      changePersonHealth(w, child, .035, 'care');
      child.state = 'recebendo cuidado';
    } else {
      child.hydration = Math.max(0, child.hydration - .24);
      changePersonHealth(w, child, -.14, 'care');
      child.state = 'sem cuidador próximo';
    }
    if (child.health <= 0 || child.foodReserve <= .1 || child.hydration <= .1) {
      killPerson(w, child, child.hydration <= .1 ? 'dehydration' : 'starvation');
    }
  }

export function reproducePeople(w) {
    if ((w.day + 1) % 30 !== 0) return;
    const living = w.people.filter(p => p.alive && p.ageDays >= 18 * 365 && p.ageDays <= 45 * 365 && p.energy > 38 && p.foodReserve > 42 && p.hydration > 34 && p.health > 50 && p.birthCooldown <= 0);
    const candidates = [];
    for (const p of living) for (const q of living) {
      if (p.id >= q.id || p.sex === q.sex || distance(p, q) > 2.2) continue;
      const link = w.socialLinks[p.id + ':' + q.id] || w.socialLinks[q.id + ':' + p.id];
      if (!link || link.trust < .2) continue;
      if (p.communityId !== q.communityId && p.communityId !== null && q.communityId !== null) continue;
      const score = link.trust + Math.min(p.energy, q.energy) * .002 + Math.min(p.foodReserve, q.foodReserve) * .003;
      candidates.push({ p, q, score });
    }
    candidates.sort((a, b) => b.score - a.score || a.p.id - b.p.id);
    if (!candidates.length) return;
    const { p, q } = candidates[0];
    p.birthCooldown = q.birthCooldown = 280;
    consumePersonEnergy(p, 11); consumePersonEnergy(q, 8);
    p.hydration = Math.max(0, p.hydration - 2); q.hydration = Math.max(0, q.hydration - 2);
    const baby = makePerson(w, p.x, p.y, true);
    transferFoodReserve(p, baby, 7, 'birth-provisions');
    transferFoodReserve(q, baby, 5, 'birth-provisions');
    baby.parents = [p.id, q.id]; baby.guardianId = p.id;
    baby.kingdomId = p.kingdomId === q.kingdomId ? p.kingdomId : (p.kingdomId ?? q.kingdomId);
    baby.birthKingdomId = baby.kingdomId;
    baby.communityId = baby.kingdomId == null ? null : w.kingdoms.find(kingdom => kingdom.id === baby.kingdomId)?.communityId || null;
    if (baby.kingdomId !== null) {
      const kingdom = w.kingdoms.find(k => k.id === baby.kingdomId);
      if (kingdom) assignHome(w, kingdom, baby);
      if (kingdom && !kingdom.memberIds.includes(baby.id)) kingdom.memberIds.push(baby.id);
    }
    w.people.push(baby);
    const c = activeCommunity(w, p);
    if (c && baby.communityId === c.id) c.memberIds.push(baby.id);
    w.births++; w.birthsByKind.people++;
    const link = getSocialLink(w, p, q); link.trust = clamp(link.trust + .08, 0, 1);
    log(w, 'Nasceu ' + baby.name + '; ' + p.name + ' transferiu 7 pontos e ' + q.name
      + ' transferiu 5 pontos de suas reservas para financiar os 12 pontos da reserva inicial.');
  }
