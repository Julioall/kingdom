import { cellAt, idx } from '../world/spatial.js';
import { clamp, distance } from '../core/math.js';
import { communityRelation, ensureCommunityGovernanceState, selectCommunityLeader } from './governance.js';
import { COLORS, COMMUNITY_FORMS } from '../../config/ecosystem.js';
import { rand } from '../core/random.js';
import { log } from '../core/events.js';
import { plantBiomass } from '../ecology/plants.js';
import { communityFoodStock, transferStores } from '../economy/inventories.js';
import { releaseSeedCargo, reassignMergedSeedOwnership } from '../economy/seed-cargo.js';

export function activeCommunity(w, person) {
    return person.communityId === null ? null : w.communities.find(c => c.id === person.communityId && !c.dissolved) || null;
  }

export function getSocialLink(w, a, b) {
    const low = Math.min(a.id, b.id), high = Math.max(a.id, b.id), key = low + ':' + high;
    return w.socialLinks[key] || (w.socialLinks[key] = { a: low, b: high, meetings: 0, trust: 0, sharedFood: 0 });
  }

export function recordCommunityUse(w, person) {
    if (!person || person.communityId === null) return;
    const community = w.communities.find(c => c.id === person.communityId && !c.dissolved);
    if (!community) return;
    if (!community.usedCells) community.usedCells = {};
    community.usedCells[idx(Math.round(person.x), Math.round(person.y))] = w.day;
  }

export function updateSocialLinks(w) {
    const people = w.people.filter(p => p.alive);
    for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) {
      const a = people[i], b = people[j], d = distance(a, b);
      if (d > 2.2) continue;
      const key = a.id + ':' + b.id;
      const link = w.socialLinks[key] || (w.socialLinks[key] = { a: a.id, b: b.id, meetings: 0, trust: 0, sharedFood: 0 });
      link.meetings++;
      const mutualHelp = (a.foodReserve > 48 && b.foodReserve > 48 ? .018 : .004);
      link.trust = clamp(link.trust + .045 * Math.min(a.sociability, b.sociability) + mutualHelp, 0, 1);
      if (a.state === 'conversando' && b.state === 'conversando') {
        a.socialNeed = Math.max(0, a.socialNeed - 3); b.socialNeed = Math.max(0, b.socialNeed - 3);
      }
      if (link.meetings < 3 || link.trust < .18) continue;
      if (a.kingdomId != null && a.kingdomId === b.kingdomId) {
        const kingdomGroup = w.communities.find(group => group.isKingdomGroup && group.kingdomId === a.kingdomId);
        if (kingdomGroup && a.communityId !== kingdomGroup.id) joinCommunity(w, a, kingdomGroup.id);
        if (kingdomGroup && b.communityId !== kingdomGroup.id) joinCommunity(w, b, kingdomGroup.id);
      }
      if (a.communityId && b.communityId && a.communityId !== b.communityId) {
        const ca = activeCommunity(w, a), cb = activeCommunity(w, b);
        if (ca && cb) { const relation = communityRelation(w, ca, cb); relation.trust = clamp(relation.trust + link.trust * .004, 0, 1); }
      }
    }
  }

export function createCommunity(w, members) {
    if (!members.length || members.some(person => person.kingdomId == null || person.kingdomId !== members[0].kingdomId)) return null;
    const kingdomGroup = w.communities.find(group => group.isKingdomGroup && group.kingdomId === members[0].kingdomId);
    if (kingdomGroup) {
      for (const person of members) joinCommunity(w, person, kingdomGroup.id);
      return kingdomGroup;
    }
    const id = w.nextId++, center = { x: (members[0].x + members[1].x) / 2, y: (members[0].y + members[1].y) / 2 };
    const naming = communityName(w, members);
    const c = { id, name: naming.name, nameSource: naming.source, color: COLORS[(id + Math.floor(rand(w) * COLORS.length)) % COLORS.length], memberIds: [], stage: 'vínculo', previousStage: 'vínculo', x: center.x, y: center.y, cohesion: .2, satisfaction: .5, leaderId: null, leadershipChallenge: null, assignments: [], properties: [], lastGovernanceDay: -999, lastPropertyDay: -999, createdDay: w.day, history: [], usedCells: {}, grounds: { hunting: null, fishing: null }, lastBuildDay: -999, stores: { food: 0, meat: 0, wood: 0, stone: 0, feed: 0, gold: 0, seeds: 0 }, tradeCount: 0, splitCooldown: 0 };
    w.communities.push(c);
    for (const p of members) {
      if (p.communityId != null && p.communityId !== id) releaseSeedCargo(w, p, { reason: 'community-change' });
      p.communityId = id;
      if (!c.memberIds.includes(p.id)) c.memberIds.push(p.id);
      recordCommunityUse(w, p);
    }
    selectCommunityLeader(w, c, members);
    c.history.push('Nome escolhido pelos primeiros membros a partir da paisagem próxima.');
    log(w, naming.source + ' propôs o nome ' + naming.name + ' após encontros repetidos entre os primeiros membros.');
    return c;
  }

export function joinCommunity(w, person, communityId) {
    const c = w.communities.find(g => g.id === communityId);
    if (!c || !person.alive) return;
    if (c.isKingdomGroup && person.kingdomId !== c.kingdomId) return;
    if (person.communityId != null && person.communityId !== c.id)
      releaseSeedCargo(w, person, { reason: 'community-change' });
    if (person.assignment && person.assignment.communityId !== c.id) person.assignment = null;
    person.communityId = c.id;
    if (!c.memberIds.includes(person.id)) c.memberIds.push(person.id);
    recordCommunityUse(w, person);
    log(w, person.name + ' passou a viver com ' + c.name + '.');
  }

export function mergeCommunities(w, aId, bId) {
    const a = w.communities.find(c => c.id === aId), b = w.communities.find(c => c.id === bId);
    if (!a || !b || a.id === b.id || a.isKingdomGroup || b.isKingdomGroup || a.kingdomId !== b.kingdomId) return;
    const keep = a.createdDay <= b.createdDay ? a : b, lose = keep === a ? b : a;
    // A merger succeeds to all seed obligations; do not abandon physical bags
    // or leave parcels owned by a dissolved community.
    reassignMergedSeedOwnership(w, lose.id, keep.id);
    for (const p of w.people) if (p.communityId === lose.id) { p.communityId = keep.id; if (!keep.memberIds.includes(p.id)) keep.memberIds.push(p.id); }
    keep.usedCells = Object.assign(keep.usedCells || {}, lose.usedCells || {});
    for (const key of ['food', 'meat', 'wood', 'stone', 'feed', 'gold', 'seeds']) {
      transferStores(lose, keep, key, lose.stores[key] || 0);
    }
    ensureCommunityGovernanceState(keep); ensureCommunityGovernanceState(lose);
    keep.properties.push(...lose.properties.map(property => Object.assign({}, property, { communityId: keep.id })));
    keep.assignments.push(...lose.assignments);
    for (const person of w.people) if (person.assignment && person.assignment.communityId === lose.id) person.assignment.communityId = keep.id;
    if (!keep.grounds) keep.grounds = { hunting: null, fishing: null };
    if (!lose.grounds) lose.grounds = { hunting: null, fishing: null };
    for (const kind of ['hunting', 'fishing']) if (!keep.grounds[kind] && lose.grounds[kind]) keep.grounds[kind] = lose.grounds[kind];
    for (const structure of w.structures) if (structure.communityId === lose.id) structure.communityId = keep.id;
    lose.memberIds = []; lose.dissolved = true;
    const naming = communityName(w, keep.memberIds.map(id => w.people.find(p => p.id === id)).filter(Boolean));
    keep.name = naming.name; keep.nameSource = naming.source;
    log(w, keep.name + ' e ' + lose.name + ' se reuniram e escolheram um novo nome comum.');
  }

export function localNameFeature(w, x, y) {
    const t = cellAt(w, Math.round(x), Math.round(y));
    if (!t) return 'Vale Vivo';
    if (t.waterDist < 3 || t.soilType === 'riparian') return 'Rio ' + (t.heightM > 380 ? 'Claro' : 'Sereno');
    if (t.heightM > 760) return 'Serra ' + (t.slope > .4 ? 'Alta' : 'Verde');
    if (plantBiomass(t, ['broadleaf', 'conifer']) > 220) return 'Mata ' + (t.heightM > 450 ? 'Alta' : 'Verde');
    if (t.soilType === 'shallow') return 'Pedra ' + (t.heightM > 450 ? 'Dourada' : 'Clara');
    return 'Vale ' + (t.soilWaterMm > 55 ? 'Vivo' : 'Aberto');
  }

export function communityName(w, members) {
    const proposals = new Map();
    for (const p of members) {
      const form = p.namingForm || COMMUNITY_FORMS[Math.floor(rand(w) * COMMUNITY_FORMS.length)];
      const proposal = form + localNameFeature(w, p.x, p.y);
      const vote = p.namingVoice || .5;
      const current = proposals.get(proposal) || { score: 0, source: p.name };
      current.score += vote;
      if (vote > (current.strongest || 0)) { current.source = p.name; current.strongest = vote; }
      proposals.set(proposal, current);
    }
    if (!proposals.size) return { name: 'Gente do Vale', source: 'A comunidade' };
    const ranked = [...proposals.entries()].sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0], 'pt-BR'));
    const [name, result] = ranked[0];
    return { name, source: result.source };
  }

export function updateCommunityStages(w) {
    for (const c of w.communities) {
      if (c.dissolved) continue;
      const members = w.people.filter(p => p.alive && p.communityId === c.id);
      c.memberIds = members.map(p => p.id);
      if (!members.length) {
        if (c.isKingdomGroup) continue;
        c.dissolved = true; log(w, c.name + ' deixou de existir; não restaram membros vivos.'); continue;
      }
      if (c.isKingdomGroup) {
        const kingdom = w.kingdoms.find(item => item.id === c.kingdomId);
        const seat = w.structures.find(s => s.kingdomId === c.kingdomId && s.complete
          && s.type === 'castelo' && s.destroyedDay == null && s.integrity !== 0) || kingdom;
        if (seat) { c.x = seat.x; c.y = seat.y; }
      } else {
        c.x += (members.reduce((s, p) => s + p.x, 0) / members.length - c.x) * .12;
        c.y += (members.reduce((s, p) => s + p.y, 0) / members.length - c.y) * .12;
      }
      for (const p of members) recordCommunityUse(w, p);
      if (c.isKingdomGroup) continue;
      const links = Object.values(w.socialLinks).filter(l => members.some(p => p.id === l.a) && members.some(p => p.id === l.b));
      c.cohesion = links.length ? links.reduce((s, l) => s + l.trust, 0) / links.length : .1;
      const next = members.length >= 12 && c.cohesion > .24 ? 'reino'
        : members.length >= 6 ? 'tribo' : members.length >= 3 ? 'grupo' : 'vínculo';
      if (next !== c.stage) {
        const old = c.stage; c.previousStage = old; c.stage = next;
        if (next !== 'vínculo') {
          c.history.push('A comunidade passou de ' + old + ' para ' + next + '.');
          log(w, c.name + ' agora se organiza como ' + next + ' (' + members.length + ' indivíduos).');
        }
      }
      c.splitCooldown = Math.max(0, c.splitCooldown - 1);
    }
  }

export function splitCommunities(w) {
    for (const c of w.communities) {
      if (c.dissolved || c.isKingdomGroup || c.splitCooldown > 0) continue;
      const members = c.memberIds.map(id => w.people.find(p => p.id === id && p.alive)).filter(Boolean);
      if (members.length < 8) continue;
      const distant = members.filter(p => distance(p, c) > 9.5);
      if (distant.length < 3 || distant.length >= members.length - 2) continue;
      let trustTotal = 0, pairCount = 0;
      for (let i = 0; i < distant.length; i++) for (let j = i + 1; j < distant.length; j++) {
        const link = getSocialLink(w, distant[i], distant[j]); trustTotal += link.trust || 0; pairCount++;
      }
      const trust = pairCount ? trustTotal / pairCount : 0;
      const lowFood = communityFoodStock(c) < 3;
      const tense = Object.values(w.communityRelations).some(r => (r.a === c.id || r.b === c.id) && r.tension > .5);
      if (trust < .32 || (!lowFood && !tense)) continue;
      const share = distant.length / members.length;
      // A splitting group may not transport another community's commissioned
      // seed bags as its own property. Drop at the current position for recovery.
      for (const person of distant) releaseSeedCargo(w, person, { reason: 'community-split' });
      const newGroup = createCommunity(w, distant.slice(0, 2));
      for (const p of distant.slice(2)) { p.communityId = newGroup.id; newGroup.memberIds.push(p.id); }
      ensureCommunityGovernanceState(c); ensureCommunityGovernanceState(newGroup);
      const distantCenter = { x: distant.reduce((sum, person) => sum + person.x, 0) / distant.length,
        y: distant.reduce((sum, person) => sum + person.y, 0) / distant.length };
      const retainedProperties = [];
      for (const property of c.properties) {
        if (distance(property, distantCenter) < distance(property, c)) {
          property.communityId = newGroup.id; newGroup.properties.push(property);
        } else retainedProperties.push(property);
      }
      c.properties = retainedProperties;
      for (const person of distant) if (person.assignment) person.assignment.communityId = newGroup.id;
      for (const key of ['food', 'meat', 'wood', 'stone', 'feed', 'gold']) {
        transferStores(c, newGroup, key, (c.stores[key] || 0) * share);
      }
      c.memberIds = members.filter(p => !distant.includes(p)).map(p => p.id);
      c.splitCooldown = 365; newGroup.splitCooldown = 365; w.splits++;
      const cause = lowFood ? 'a reserva de alimento se esgotou' : 'a tensão por recursos afastou os membros';
      const message = distant.length + ' membros deixaram ' + c.name + ' e formaram ' + newGroup.name + ' porque ' + cause + '.';
      c.history.push(message); newGroup.history.push('Separou-se de ' + c.name + ' após ' + cause + '.');
      log(w, message + ' As reservas e os locais de uso também foram divididos.');
    }
  }
