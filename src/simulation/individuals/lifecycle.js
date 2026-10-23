import { COMMUNITY_FORMS, FOOD_RESERVE_PER_UNIT, HEIGHT, HUMAN_NAMES, PEOPLE_ACTIONS, PEOPLE_INPUTS, WIDTH } from '../../config/ecosystem.js';
import { rand } from '../core/random.js';
import { createBrain } from '../../controllers/individual/neural.js';
import { randomHabitatCell } from '../world/generation.js';
import { clamp, distance } from '../core/math.js';
import { cellAt } from '../world/spatial.js';
import { log } from '../core/events.js';
import { activeCommunity, getSocialLink } from '../society/communities.js';
import { communityFoodStock, withdrawCommunityFood } from '../economy/inventories.js';
import { assignHome } from '../kingdoms/initialization.js';
import { moveOne } from './movement.js';

export function makePerson(w, x, y, newborn) {
    const id = w.nextId++;
    const first = HUMAN_NAMES[Math.floor(rand(w) * HUMAN_NAMES.length)];
    const name = newborn ? first + ' ' + ['Filho', 'Filha', 'Júnior'][Math.floor(rand(w) * 3)] : first + ' ' + String.fromCharCode(65 + Math.floor(rand(w) * 26));
    return {
      id, name, x, y, alive: true, ageDays: newborn ? 0 : 1800 + rand(w) * 11000,
      sex: rand(w) < .5 ? 'F' : 'M',
      namingForm: COMMUNITY_FORMS[Math.floor(rand(w) * COMMUNITY_FORMS.length)], namingVoice: .4 + rand(w) * .6,
      energy: newborn ? 65 : 58 + rand(w) * 38, hydration: 55 + rand(w) * 43, foodReserve: 55 + rand(w) * 40,
      socialNeed: 45 + rand(w) * 50, sociability: .25 + rand(w) * .75, trust: .2 + rand(w) * .65,
      physicalStrength: .35 + rand(w) * .65,
      communityId: null, kingdomId: null, homeId: null, role: 'resident', militaryClass: null, militaryCenterId: null, militaryDutyCenterId: null,
      lastSafeX: x, lastSafeY: y, territoryExposure: null, territoryAwareness: null,
      moveCooldown: 0, buildCooldown: 0, birthCooldown: newborn ? 280 : Math.floor(rand(w) * 70),
      health: newborn ? 82 : 82 + rand(w) * 18, injury: 0, carriedFood: 0, carriedFruit: 0, carriedMeat: 0, carriedMaterial: 0,
      carriedWood: 0, carriedStone: 0, carriedFeed: 0, carriedGold: 0, headingX: (rand(w) - .5) * 2, headingY: (rand(w) - .5) * 2,
      leadingSheepId: null, prestige: 0, assignment: null, dissatisfactionDays: 0,
      sensoryMemory: { actors: {}, water: [] }, perception: null,
      personalMemory: [], strategicPlan: null, strategicRequestPending: null, nextStrategicDecisionDay: (id * 19) % 60 + 1, nextUrgentStrategicDecisionDay: 1,
      parents: newborn ? [] : null, guardianId: null, awayDays: 0, conflictRisk: 0,
      skills: { forage: .12 + rand(w) * .32, hunt: .06 + rand(w) * .24, gather: .08 + rand(w) * .3, build: .05 + rand(w) * .24, care: .08 + rand(w) * .3, diplomacy: .08 + rand(w) * .35 },
      brain: createBrain(w, PEOPLE_ACTIONS, PEOPLE_INPUTS, id), lastReward: 0,
      lastLesson: 'Ainda está aprendendo com o ambiente.', state: 'observando'
    };
  }

export function addIndividuals(w, count, initial) {
    const added = [];
    for (let n = 0; n < count; n++) {
      const wanderingTile = initial ? null : randomHabitatCell(w, false);
      const kingdom = w.kingdoms && w.kingdoms.length
        ? initial ? w.kingdoms[Math.min(w.kingdoms.length - 1, Math.floor(n * w.kingdoms.length / count))]
          : w.kingdoms.slice().sort((a, b) => distance(a, wanderingTile) - distance(b, wanderingTile))[0]
        : null;
      const vacantHome = kingdom && kingdom.homeIds.map(id => w.structures.find(s => s.id === id && s.residentIds.length < s.capacity)).find(Boolean);
      const t = initial && vacantHome ? cellAt(w, vacantHome.x, vacantHome.y) : wanderingTile || randomHabitatCell(w, false);
      const jitterX = Math.floor((rand(w) - .5) * (initial ? 3 : 5)), jitterY = Math.floor((rand(w) - .5) * (initial ? 3 : 5));
      let x = clamp(t.x + jitterX, 1, w.width - 2), y = clamp(t.y + jitterY, 1, w.height - 2);
      let cell = cellAt(w, x, y);
      if (!cell || cell.terrain === 'water' || cell.terrain === 'rock') { x = t.x; y = t.y; }
      const person = makePerson(w, x, y, false);
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
      if (ruler) { kingdom.rulerId = ruler.id; ruler.role = 'ruler'; }
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
    if (!initial && added.length) log(w, added.length + ' indivíduos chegaram ao mundo e foram associados ao reino e à moradia mais próximos.');
    return added;
  }

export function killPerson(w, person, cause) {
    if (!person.alive) return;
    person.alive = false; w.deaths++;
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
    const labels = { starvation: 'fome', dehydration: 'desidratação', age: 'idade avançada', injury: 'ferimentos', invasion: 'invasão territorial' };
    log(w, person.name + ' morreu por ' + (labels[cause] || cause) + '. A perda afeta seu reino e sua família; a matéria retorna ao solo.');
  }

export function updateDependent(w, child) {
    const adultAge = 12 * 365;
    const familyIds = new Set([...(child.parents || []), child.guardianId].filter(Number.isInteger));
    const family = w.people.filter(person => person.alive && person.ageDays >= adultAge && familyIds.has(person.id));
    const nearbyAdults = w.people.filter(person => person.alive && person.ageDays >= adultAge
      && person.id !== child.id && distance(person, child) <= 6
      && (child.kingdomId !== null && child.kingdomId !== undefined
        ? person.kingdomId === child.kingdomId
        : child.communityId !== null && child.communityId !== undefined && person.communityId === child.communityId));
    const familyCaregiver = family.filter(person => distance(person, child) <= 6)
      .sort((a, b) => distance(a, child) - distance(b, child))[0];
    let caregiver = familyCaregiver || nearbyAdults.sort((a, b) => distance(a, child) - distance(b, child))[0]
      || family.sort((a, b) => distance(a, child) - distance(b, child))[0] || null;
    if (caregiver && distance(caregiver, child) > 6) {
      moveOne(w, child, cellAt(w, caregiver.x, caregiver.y), false);
      if (distance(caregiver, child) > 6) caregiver = null;
    }
    if (caregiver) child.guardianId = caregiver.id;
    const community = activeCommunity(w, child);
    const careFoodNeed = caregiver && distance(caregiver, child) <= 6 ? .42 : .32;
    const sharedFood = community ? Math.min(careFoodNeed, communityFoodStock(community) * FOOD_RESERVE_PER_UNIT,
      Math.max(0, 100 - child.foodReserve)) : 0;
    if (sharedFood > .001) {
      withdrawCommunityFood(w, community, sharedFood / FOOD_RESERVE_PER_UNIT);
      child.foodReserve = clamp(child.foodReserve + sharedFood, 0, 100);
      child.sharedMeals = (child.sharedMeals || 0) + sharedFood / FOOD_RESERVE_PER_UNIT;
    }
    if (caregiver && distance(caregiver, child) <= 6) {
      child.guardianId = caregiver.id;
      child.x = caregiver.x; child.y = caregiver.y;
      caregiver.energy = Math.max(0, caregiver.energy - .1);
      caregiver.foodReserve = Math.max(0, caregiver.foodReserve - Math.max(0, .42 - sharedFood));
      caregiver.skills.care = clamp(caregiver.skills.care + .0003, 0, 1);
      child.foodReserve = clamp(child.foodReserve + Math.max(0, .42 - sharedFood), 0, 100);
      child.hydration = clamp(child.hydration + .4, 0, 100);
      child.health = clamp(child.health + .035, 0, 100);
      child.state = 'recebendo cuidado';
    } else {
      child.foodReserve = Math.max(0, child.foodReserve - Math.max(0, .32 - sharedFood));
      child.hydration = Math.max(0, child.hydration - .24);
      child.health = Math.max(0, child.health - .14);
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
    p.energy = Math.max(0, p.energy - 11); q.energy = Math.max(0, q.energy - 8);
    p.foodReserve = Math.max(0, p.foodReserve - 7); q.foodReserve = Math.max(0, q.foodReserve - 5);
    p.hydration = Math.max(0, p.hydration - 2); q.hydration = Math.max(0, q.hydration - 2);
    const baby = makePerson(w, p.x, p.y, true);
    baby.parents = [p.id, q.id]; baby.guardianId = p.id;
    baby.kingdomId = p.kingdomId === q.kingdomId ? p.kingdomId : (p.kingdomId ?? q.kingdomId);
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
    log(w, 'Nasceu ' + baby.name + '; ' + p.name + ' e ' + q.name + ' assumiram custos de cuidado e reduziram suas próprias reservas.');
  }
