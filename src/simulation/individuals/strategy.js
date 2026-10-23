import { PEOPLE_ACTIONS, SEASONS } from '../../config/ecosystem.js';
import { clamp, distance } from '../core/math.js';
import { communityFoodStock } from '../economy/inventories.js';
import { nearestWater } from './actions.js';
import { calendarDate } from '../ecology/climate.js';

export function setStrategicAiEnabled(w, enabled) {
    if (!w.strategicAI) w.strategicAI = { enabled: false, requests: [], enqueuedDay: -1, enqueuedToday: 0, decisions: 0, failures: 0 };
    w.strategicAI.enabled = !!enabled;
    if (!w.strategicAI.enabled) {
      w.strategicAI.requests.length = 0;
      for (const person of w.people) { person.strategicRequestPending = null; person.strategicPlan = null; }
    }
    return w.strategicAI.enabled;
  }

export function pullStrategicAiRequests(w, limit) {
    if (!w.strategicAI || !w.strategicAI.enabled) return [];
    const ai = w.strategicAI;
    const count = Math.max(1, Math.min(3, Math.floor(limit || 1)));
    const ready = [];
    while (ready.length < count && ai.requests.length) {
      const request = ai.requests.shift();
      const person = w.people.find(item => item.id === request.personId && item.alive);
      if (!person || !person.strategicRequestPending || person.strategicRequestPending.day !== request.requestedDay) continue;
      if (w.day > request.requestedDay + 18) {
        person.strategicRequestPending = null;
        person.nextStrategicDecisionDay = Math.max(person.nextStrategicDecisionDay || 0, w.day + 10);
        ai.failures++;
        continue;
      }
      ready.push(request);
    }
    return ready;
  }

export function applyStrategicAiDecision(w, personId, requestedDay, decision) {
    const person = w.people.find(item => item.id === personId && item.alive);
    const ai = w.strategicAI;
    if (!person || !ai || !ai.enabled) return false;
    const pending = person.strategicRequestPending;
    if (!pending || pending.day !== requestedDay) return false;
    person.strategicRequestPending = null;
    if (w.day > requestedDay + 18) {
      ai.failures++;
      person.nextStrategicDecisionDay = Math.max(person.nextStrategicDecisionDay || 0, w.day + 10);
      return false;
    }
    const action = String(decision && decision.action || '').trim();
    if (!PEOPLE_ACTIONS.includes(action) || !pending.candidates.includes(action)) {
      ai.failures++;
      person.nextStrategicDecisionDay = Math.max(person.nextStrategicDecisionDay || 0, w.day + 10);
      return false;
    }
    const confidence = Number(decision.confidence);
    person.strategicPlan = {
      action,
      confidence: Number.isFinite(confidence) ? clamp(confidence, 0, 1) : .5,
      reason: String(decision.reason || '').replace(/[<>\u0000-\u001f]/g, ' ').trim().slice(0, 150),
      createdDay: w.day,
      expiresDay: requestedDay + 18
    };
    ai.decisions++;
    return true;
  }

export function failStrategicAiRequest(w, personId, requestedDay) {
    const person = w.people.find(item => item.id === personId);
    const ai = w.strategicAI;
    if (!person || !ai) return false;
    if (person.strategicRequestPending && person.strategicRequestPending.day === requestedDay) {
      person.strategicRequestPending = null;
      person.nextStrategicDecisionDay = Math.max(person.nextStrategicDecisionDay || 0, w.day + 10);
      ai.failures++;
      return true;
    }
    return false;
  }

export function recordPersonalMemory(person, day) {
    if (!person.personalMemory) person.personalMemory = [];
    const state = String(person.state || '').slice(0, 50);
    const lesson = String(person.lastLesson || '').slice(0, 135);
    const previous = person.personalMemory[person.personalMemory.length - 1];
    if (previous && previous.state === state && previous.lesson === lesson && day - previous.day < 4) return;
    person.personalMemory.push({ day, state, lesson });
    if (person.personalMemory.length > 4) person.personalMemory.shift();
  }

export function queueStrategicAiRequest(w, person, community, utility) {
    const ai = w.strategicAI;
    if (!ai || !ai.enabled || person.strategicRequestPending) return;
    const day = w.day + 1;
    const urgent = person.foodReserve < 20 || person.hydration < 20 || person.health < 32 || person.conflictRisk > .72;
    const scheduled = day >= (person.nextStrategicDecisionDay || 1);
    const urgentDue = urgent && day >= (person.nextUrgentStrategicDecisionDay || 1);
    if (!scheduled && !urgentDue) return;
    if (ai.requests.length >= 12) return;
    if (ai.enqueuedDay !== day) { ai.enqueuedDay = day; ai.enqueuedToday = 0; }
    if (ai.enqueuedToday >= 2) return;

    const candidates = PEOPLE_ACTIONS.map((action, i) => ({ action, score: utility[i] }))
      .filter(item => item.action !== 'deliver' && item.score > -.1)
      .sort((a, b) => b.score - a.score).slice(0, 8).map(item => item.action);
    if (!candidates.length) return;
    const perception = person.perception || {};
    const resources = (perception.resources || []).filter(item => item.visible);
    const fruitPatches = resources.map(item => ({
      distance: Math.round(item.distance * 10) / 10,
      berries: Math.round(item.biomass && item.biomass.berry || 0),
      grass: Math.round(item.biomass && item.biomass.grass || 0)
    })).filter(item => item.berries > 4 || item.grass > 4).sort((a, b) => a.distance - b.distance).slice(0, 3);
    const water = resources.filter(item => item.waterSource).sort((a, b) => a.distance - b.distance)[0];
    const flock = (perception.animals || []).filter(item => item.speciesId === 'sheep' && item.distance < 10)
      .slice(0, 3).map(item => ({ distance: Math.round(item.distance * 10) / 10, visible: !!item.visible }));
    const logs = (perception.logs || []).filter(item => item.amount > .05).slice(0, 3)
      .map(item => ({ distance: Math.round(item.distance * 10) / 10, amount: Math.round(item.amount * 10) / 10, confidence: Math.round(item.confidence * 100) / 100 }));
    const isRuler = w.kingdoms.some(item => item.rulerId === person.id);
    const rulerDate = isRuler ? calendarDate(day) : null;
    const kingdomCalendar = rulerDate ? {
      year: rulerDate.year, dayOfYear: rulerDate.dayOfYear, season: SEASONS[rulerDate.season],
      dayOfSeason: rulerDate.dayOfSeason, daysInSeason: rulerDate.daysInSeason,
      nextSeason: SEASONS[rulerDate.nextSeason], daysUntilNextSeason: rulerDate.daysUntilNextSeason
    } : null;
    const request = {
      personId: person.id,
      requestedDay: day,
      candidateActions: candidates,
      context: {
        ...(kingdomCalendar ? { kingdomCalendar } : {}),
        person: {
          name: person.name, ageYears: Math.floor(person.ageDays / 365),
          needs: { food: Math.round(person.foodReserve), water: Math.round(person.hydration), energy: Math.round(person.energy), health: Math.round(person.health), social: Math.round(person.socialNeed) },
          traits: { sociability: Math.round(person.sociability * 100), trust: Math.round(person.trust * 100), strength: Math.round(person.physicalStrength * 100) },
          skills: Object.fromEntries(Object.entries(person.skills || {}).map(([key, value]) => [key, Math.round(value * 100)]))
        },
        kingdom: community ? {
          name: community.name,
          size: community.memberIds.filter(id => w.people.some(item => item.id === id && item.alive)).length,
          stores: { food: Math.round(communityFoodStock(community)), wood: Math.round(community.stores.wood || 0), stone: Math.round(community.stores.stone || 0), feed: Math.round(community.stores.feed || 0), gold: Math.round(community.stores.gold || 0) },
          hasShelter: w.structures.some(item => item.complete && item.type === 'abrigo' && item.communityId === community.id),
          hasCorral: w.structures.some(item => item.complete && item.type === 'curral' && item.communityId === community.id)
        } : null,
        perceived: { fruitPatches, nearestWater: water ? Math.round(water.distance * 10) / 10 : null, sheep: flock, looseLogs: logs,
          territorialAwareness: perception.territorialAwareness },
        recentExperience: (person.personalMemory || []).slice(-3),
        candidateActions: candidates
      }
    };
    person.strategicRequestPending = { day, candidates };
    if (scheduled) person.nextStrategicDecisionDay = day + 60;
    person.nextUrgentStrategicDecisionDay = day + 12;
    ai.requests.push(request);
    ai.enqueuedToday++;
  }
