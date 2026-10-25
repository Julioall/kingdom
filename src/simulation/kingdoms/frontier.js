import { log } from '../core/events.js';
import { FRONTIER_OUTPOST_COST, buildKingdomStructure, chooseKingdomBuildSite } from './commands.js';

const FRONTIER_DECISION_INTERVAL_DAYS = 30;
const FRONTIER_OUTPOST_COOLDOWN_DAYS = 60;
const FRONTIER_MAINTENANCE_RESERVE_CYCLES = 12;
const MAX_AUTONOMOUS_OUTPOSTS = 6;
const OUTPOST_RESERVES = Object.freeze({ wood: 12, stone: 12, gold: 8 });

function frontierState(kingdom) {
  return kingdom.frontierExpansion ||= {
    enabled: true,
    outpostIds: [],
    nextDecisionDay: 31,
    lastProjectStartedDay: null,
    pendingProjectId: null,
    status: 'observing',
    reason: 'O reino observa a fronteira e só avança com recursos do próprio tesouro.',
    lastOutcome: null
  };
}

function kingdomHasActiveCampaign(world, kingdomId) {
  return (world.campaigns || []).some(campaign => campaign.status !== 'complete'
    && (campaign.attackerId === kingdomId || campaign.defenderId === kingdomId));
}

function kingdomHasActiveWar(world, kingdomId) {
  return (world.wars || []).some(war => war.status === 'active'
    && (war.a === kingdomId || war.b === kingdomId || war.attackerId === kingdomId || war.defenderId === kingdomId));
}

function canSpendOutpostCost(world, kingdom) {
  const stock = kingdom.treasury && kingdom.treasury.stock || {};
  const cost = FRONTIER_OUTPOST_COST;
  const monthlyMaintenance = world.structures.filter(structure => structure.kingdomId === kingdom.id && structure.complete
    && ['castelo', 'torre', 'centro_militar'].includes(structure.type))
    .reduce((total, structure) => {
      const rate = structure.frontierOutpost ? { wood: .2, stone: .1 }
        : structure.type === 'castelo' ? { wood: .8, stone: .4 }
          : structure.type === 'centro_militar' ? { wood: .6, stone: .3 } : { wood: .4, stone: .2 };
      total.wood += rate.wood;
      total.stone += rate.stone;
      return total;
    }, { wood: .2, stone: .1 });
  return Object.entries(cost).every(([resource, amount]) => {
    const maintenanceReserve = (monthlyMaintenance[resource] || 0) * FRONTIER_MAINTENANCE_RESERVE_CYCLES;
    const reserve = Math.max(OUTPOST_RESERVES[resource] || 0, maintenanceReserve);
    return Number.isFinite(stock[resource]) && stock[resource] >= amount + reserve;
  });
}

function scheduleNextDecision(state, day) {
  state.nextDecisionDay = day + FRONTIER_DECISION_INTERVAL_DAYS;
}

function isEstablishedOrBuildingOutpost(structure) {
  return structure.frontierOutpost && (structure.complete
    || structure.integrity > 0 && structure.builtDay == null && (structure.progress || 0) < (structure.required || 1));
}

export function updateKingdomFrontierExpansion(world, day = world.day + 1) {
  for (const kingdom of world.kingdoms || []) {
    const state = frontierState(kingdom);
    if (!state.enabled || day < (state.nextDecisionDay || 1)) continue;
    scheduleNextDecision(state, day);

    const outposts = world.structures.filter(structure => structure.kingdomId === kingdom.id
      && isEstablishedOrBuildingOutpost(structure));
    state.outpostIds = outposts.map(structure => structure.id);
    const activeOutpost = outposts.find(structure => !structure.complete);
    if (activeOutpost) {
      state.pendingProjectId = activeOutpost.id;
      state.status = 'constructing';
      state.reason = 'O posto de fronteira está sendo construído com materiais debitados do tesouro.';
      continue;
    }
    state.pendingProjectId = null;

    if (outposts.length >= MAX_AUTONOMOUS_OUTPOSTS) {
      state.status = 'limit-reached';
      state.reason = 'O reino já estabeleceu o limite atual de postos autônomos de fronteira.';
      continue;
    }
    if (state.lastProjectStartedDay != null && day - state.lastProjectStartedDay < FRONTIER_OUTPOST_COOLDOWN_DAYS) {
      state.status = 'cooldown';
      state.reason = 'O reino aguarda recuperar o tesouro e consolidar a última expansão.';
      continue;
    }
    if (kingdomHasActiveWar(world, kingdom.id) || kingdomHasActiveCampaign(world, kingdom.id)) {
      state.status = 'paused-war';
      state.reason = 'A expansão foi adiada enquanto o reino está em guerra ou conduz uma campanha.';
      continue;
    }
    if (!canSpendOutpostCost(world, kingdom)) {
      state.status = 'awaiting-resources';
      state.reason = 'O tesouro precisa cobrir a obra e manter as reservas para doze ciclos de manutenção.';
      continue;
    }

    const distanceToCenter = Math.hypot(world.width / 2 - kingdom.x, world.height / 2 - kingdom.y);
    const desiredDistance = Math.min(distanceToCenter + 4, 31 + outposts.length * 10);
    const siteOptions = {
      requireNeutral: true,
      desiredDistance,
      minProjection: Math.max(24, desiredDistance - 7),
      maxProjection: desiredDistance + 7,
      minDistance: Math.max(24, desiredDistance - 8),
      maxDistance: desiredDistance + 9,
      frontierOutpost: true
    };
    const site = chooseKingdomBuildSite(world, kingdom, 'torre', siteOptions);
    if (!site) {
      state.status = 'no-neutral-site';
      state.reason = 'Não há uma célula neutra segura na faixa de expansão voltada ao centro do mapa.';
      continue;
    }

    const result = buildKingdomStructure(world, kingdom.id, 'torre', { ...siteOptions, frontierOutpost: true });
    if (!result.ok) {
      state.status = 'blocked';
      state.reason = result.reason;
      continue;
    }
    result.structure.frontierOutpost = true;
    state.outpostIds.push(result.structure.id);
    state.pendingProjectId = result.structure.id;
    state.lastProjectStartedDay = day;
    state.status = 'constructing';
    state.reason = 'Um posto foi planejado em terreno neutro para ampliar a fronteira e apoiar a patrulha.';
    state.lastOutcome = { status: 'planned', day, projectId: result.structure.id,
      site: { x: site.x, y: site.y }, cost: { ...result.structure.cost } };
  }
}

export function recordKingdomFrontierOutcomes(world, day = world.day) {
  for (const kingdom of world.kingdoms || []) {
    const state = kingdom.frontierExpansion;
    if (!state) continue;
    const completed = world.structures.filter(structure => structure.kingdomId === kingdom.id
      && structure.frontierOutpost && structure.complete && structure.expansionEvidence
      && structure.expansionRecordedDay == null);
    for (const structure of completed) {
      const previousTiles = structure.expansionEvidence.territoryBefore || 0;
      const gained = Math.max(0, (kingdom.territoryTileCount || 0) - previousTiles);
      structure.expansionRecordedDay = day;
      state.status = 'established';
      state.pendingProjectId = null;
      state.lastOutcome = { status: 'completed', day, projectId: structure.id,
        territoryTilesGained: gained, site: { ...structure.expansionEvidence.site }, cost: { ...structure.cost } };
      const message = kingdom.name + ' concluiu o posto de fronteira e incorporou ' + gained
        + ' células ao domínio; a guarnição existente pode patrulhar a nova área.';
      log(world, message);
      const community = world.communities.find(item => item.id === kingdom.communityId && !item.dissolved);
      if (community) community.history.push(message);
    }
  }
}

