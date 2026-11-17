// Read-only diagnostics. This module never mutates authoritative simulation
// state, consumes RNG, or changes who can observe what during normal gameplay.
const TERMINAL_TYPES = new Set(['applied', 'rejected', 'fallback']);
const metric = value => Number.isFinite(value) ? value : 0;
const finite = value => Number.isFinite(value) ? value : null;

function sourceEvents(events) {
  return Array.isArray(events) ? events.filter(event => event && typeof event === 'object') : [];
}

export function summarizeDecisionHistory(events) {
  const history = sourceEvents(events);
  const requests = new Map();
  let minDay = Infinity, maxDay = -Infinity;
  for (const event of history) {
    if (!['request', 'proposal', ...TERMINAL_TYPES].includes(event.type)) continue;
    const id = event.requestId ?? event.request?.requestId;
    if (typeof id !== 'string' || !id.length) continue;
    if (Number.isFinite(event.day)) {
      minDay = Math.min(minDay, event.day);
      maxDay = Math.max(maxDay, event.day);
    }
    let item = requests.get(id);
    if (!item) requests.set(id, item = { requestDay: null, requested: false, proposed: false,
      terminal: null, reason: null, finalDay: null });
    if (event.type === 'request') {
      item.requested = true;
      item.requestDay = finite(event.day);
    } else if (event.type === 'proposal') item.proposed = true;
    else if (TERMINAL_TYPES.has(event.type)) {
      item.terminal = event.type;
      item.reason = typeof event.reason === 'string' ? event.reason.slice(0, 120) : null;
      item.finalDay = finite(event.day);
    }
  }

  const totals = { requested: 0, proposed: 0, applied: 0, rejected: 0, fallback: 0, unresolved: 0 };
  const reasons = Object.create(null), delays = [];
  for (const item of requests.values()) {
    if (item.requested) totals.requested++;
    if (item.proposed) totals.proposed++;
    if (item.terminal) {
      totals[item.terminal]++;
      if (item.terminal !== 'applied' && item.reason) reasons[item.reason] = (reasons[item.reason] || 0) + 1;
      if (item.requestDay !== null && item.finalDay !== null && item.finalDay >= item.requestDay)
        delays.push(item.finalDay - item.requestDay);
    } else if (item.requested) totals.unresolved++;
  }
  const totalOutcomes = totals.applied + totals.rejected + totals.fallback;
  return {
    ...totals, observedRequests: requests.size, retainedEvents: history.length,
    window: Number.isFinite(minDay) ? { firstDay: minDay, lastDay: maxDay } : null,
    // The simulation keeps only the most recent 120 events. This rate is for
    // the retained window, not proof of long-run correctness of the policy.
    truncatedWindowPossible: history.length >= 120,
    acceptedRate: totalOutcomes ? totals.applied / totalOutcomes : null,
    responseDaysMean: delays.length ? delays.reduce((sum, value) => sum + value, 0) / delays.length : null,
    responseDaysSamples: delays.length,
    failureReasons: Object.fromEntries(Object.entries(reasons).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
  };
}

export function observeAutonomousKingdoms(world) {
  if (!world || !Array.isArray(world.kingdoms)) throw new TypeError('Invalid Kingdom world');
  const peopleCounts = new Map();
  for (const person of world.people || []) {
    if (!person?.alive || person.kingdomId == null) continue;
    let counts = peopleCounts.get(person.kingdomId);
    if (!counts) peopleCounts.set(person.kingdomId, counts =
      { alive: 0, civilians: 0, soldiers: 0, woundedSoldiers: 0 });
    counts.alive++;
    if (person.role === 'soldier') {
      counts.soldiers++;
      if (metric(person.health) < 75) counts.woundedSoldiers++;
    } else counts.civilians++;
  }
  const communityById = new Map((world.communities || []).map(c => [c.id, c]));
  const wars = world.wars || [], campaigns = world.campaigns || [];
  return world.kingdoms.map(kingdom => {
    const kingdomWars = wars.filter(war => (war.a === kingdom.id || war.b === kingdom.id)
      && war.status === 'active');
    const kingdomCampaigns = campaigns.filter(campaign =>
      (campaign.attackerId === kingdom.id || campaign.defenderId === kingdom.id)
      && !['complete', 'withdrawing'].includes(campaign.status));
    return {
      id: kingdom.id, name: kingdom.name,
      population: peopleCounts.get(kingdom.id) ||
        { alive: 0, civilians: 0, soldiers: 0, woundedSoldiers: 0 },
      treasury: {
        food: metric(kingdom.treasury?.stock?.food),
        gold: metric(kingdom.treasury?.stock?.gold),
        wood: metric(kingdom.treasury?.stock?.wood),
        stone: metric(kingdom.treasury?.stock?.stone)
      },
      politics: {
        satisfaction: finite(kingdom.satisfaction),
        prestige: finite(kingdom.prestige),
        communityCohesion: finite(communityById.get(kingdom.communityId)?.cohesion)
      },
      strategy: {
        goal: kingdom.strategy?.goal || null,
        action: kingdom.strategy?.action || null,
        reason: kingdom.strategy?.reason || null,
        garrisonMode: kingdom.strategy?.garrisonMode || null
      },
      military: { activeWars: kingdomWars.length, activeCampaigns: kingdomCampaigns.length }
    };
  });
}

export function evaluateAiBehavior(world) {
  if (!world || !Number.isInteger(world.day)) throw new TypeError('Invalid Kingdom world');
  return {
    day: world.day, seed: world.seed ?? null,
    kingdoms: observeAutonomousKingdoms(world),
    warTotals: {
      active: (world.wars || []).filter(war => war.status === 'active').length,
      resolved: (world.wars || []).filter(war => war.status === 'resolved').length
    },
    decisions: {
      // External decision adapter is disabled by default. Deterministic king
      // and general plans are visible above, not counted as adapter approvals.
      kingAdapterEnabled: !!world.strategicAI?.enabled,
      king: summarizeDecisionHistory(world.strategicAI?.events),
      general: summarizeDecisionHistory(world.campaignGeneralAi?.events)
    }
  };
}
