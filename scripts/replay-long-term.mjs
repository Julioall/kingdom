import assert from 'node:assert/strict';
import Sim from '../src/simulation/engine.js';

const seeds = (process.env.REPLAY_SEEDS || '1,42,987,2026').split(',')
  .map(value => Number(value.trim())).filter(Number.isSafeInteger);
const days = Math.max(1, Math.floor(Number(process.env.REPLAY_DAYS || 730)));
const verificationSeeds = new Set((process.env.REPLAY_VERIFY_SEEDS || '42').split(',')
  .map(value => Number(value.trim())).filter(Number.isSafeInteger));

function deathsByCause(entities) {
  return entities.filter(entity => !entity.alive).reduce((result, entity) => {
    const cause = entity.deathCause || 'unknown';
    result[cause] = (result[cause] || 0) + 1;
    return result;
  }, {});
}

const CAUSAL_EVENT = /conflito|disputa|guerra|campanha|fronteira|tratado|armist[ií]cio|retir|ocup|territ[oó]rio|migra|deixou|assalt|saque|recrut|constru|obra|ro[cç]a|colhe|reserva|com[eé]rcio|troca|aliment|fome|separ|expuls|cultiv|batalh|recurso/i;

function observeCausalEvents(world) {
  const trace = [];
  const capture = event => {
    if (event && CAUSAL_EVENT.test(event.text || '')) trace.push({ day: event.day, text: event.text });
  };
  for (const event of [...(world.events || [])].reverse()) capture(event);

  // The live chronicle is a 64-entry ring. Capture causal entries as they are
  // written so a long replay does not lose the first half of its explanation.
  const events = world.events;
  const nativeUnshift = events.unshift;
  Object.defineProperty(events, 'unshift', {
    configurable: true,
    enumerable: false,
    writable: true,
    value(...entries) {
      for (const event of entries) capture(event);
      return nativeUnshift.apply(this, entries);
    }
  });
  return {
    trace,
    restore() { delete events.unshift; }
  };
}

function resourceStock(owner) {
  return Object.fromEntries(Object.entries(owner?.stock || owner?.stores || {}).map(([key, value]) => [
    key, Number.isFinite(value) ? Number(value.toFixed(2)) : value
  ]));
}

function campaignSupplyAudit(side) {
  const ledger = side.supplyLedger || {};
  const deployment = ledger.deployment || {};
  const resupply = ledger.resupply || {};
  const returned = ledger.returned || {};
  const battleLoss = ledger.battleEquipmentLoss || {};
  const current = side.supply?.stock || {};
  const round = value => Number((value || 0).toFixed(2));
  const supplyBalance = {
    food: (deployment.food || 0) + (resupply.food || 0) - (ledger.rationConsumptionFood || 0)
      - (returned.food || 0) - (current.food || 0),
    wood: (deployment.wood || 0) + (resupply.wood || 0) - (battleLoss.wood || 0)
      - (returned.wood || 0) - (current.wood || 0),
    gold: (deployment.gold || 0) + (resupply.gold || 0) - (battleLoss.gold || 0)
      - (returned.gold || 0) - (current.gold || 0)
  };
  return {
    deployment: resourceStock({ stock: deployment }),
    resupply: resourceStock({ stock: resupply }),
    resupplySources: {
      food: {
        treasury: round(ledger.resupplySources?.food?.treasury),
        community: round(ledger.resupplySources?.food?.community)
      }
    },
    rationConsumptionFood: round(ledger.rationConsumptionFood),
    personalReserveRationPoints: round(ledger.personalReserveRationPoints),
    battleEquipmentLoss: resourceStock({ stock: battleLoss }),
    returned: resourceStock({ stock: returned }),
    current: resourceStock({ stock: current }),
    unexplained: Object.fromEntries(Object.entries(supplyBalance).map(([resource, amount]) => [resource, round(amount)]))
  };
}

function causalSnapshot(world, communities, causalEvents) {
  const livingPeople = world.people.filter(person => person.alive);
  const kingdoms = world.kingdoms.map(kingdom => ({
    name: kingdom.name,
    livingMembers: kingdom.memberIds.filter(id => livingPeople.some(person => person.id === id)).length,
    territoryTiles: kingdom.territoryTileCount || 0,
    treasury: resourceStock(kingdom.treasury),
    market: {
      stock: resourceStock(kingdom.market),
      prices: { ...(kingdom.market?.prices || {}) }
    },
    strategy: {
      goal: kingdom.strategy?.goal || null,
      action: kingdom.strategy?.action || null,
      reason: kingdom.strategy?.reason || '',
      lastOutcome: kingdom.strategy?.lastOutcome || null,
      history: (kingdom.strategy?.history || []).slice(-12)
    },
    knownMilitaryEvidence: (kingdom.militaryIntel || []).slice(-16)
  }));
  const communityDetails = communities.map(community => ({
    name: community.name,
    stage: community.stage,
    memberCount: community.memberIds.filter(id => livingPeople.some(person => person.id === id)).length,
    satisfaction: Number((community.satisfaction || 0).toFixed(3)),
    stores: resourceStock(community),
    tradeCount: community.tradeCount || 0,
    recentTrades: (community.tradeLedger?.history || []).slice(-24),
    recentHistory: (community.history || []).slice(-30)
  }));
  const campaigns = (world.campaigns || []).map(campaign => ({
    id: campaign.id,
    cause: campaign.cause,
    evidence: campaign.evidence,
    target: campaign.target,
    startedDay: campaign.startedDay,
    resolvedDay: campaign.resolvedDay ?? null,
    status: campaign.status,
    outcome: campaign.outcome,
    outcomeReason: campaign.outcomeReason,
    battleCount: campaign.battleCount || 0,
    territorialChange: campaign.territorialChange || null,
    history: (campaign.history || []).slice(-24),
    sides: [campaign.attacker, campaign.defender].filter(Boolean).map(side => ({
      kingdomId: side.kingdomId,
      role: side.role,
      troopCount: side.troopIds?.length || 0,
      mobilizedTroopCount: side.mobilizedTroopCount ?? (side.troopIds?.length || 0),
      losses: side.losses || 0,
      battles: side.battles || 0,
      morale: side.morale,
      supply: resourceStock(side.supply),
      supplyAudit: campaignSupplyAudit(side)
    }))
  }));
  const departures = causalEvents.filter(event => /deixou|deixaram|migra|aus[eê]ncia/i.test(event.text));
  const independentPeople = livingPeople.filter(person => person.kingdomId == null).map(person => ({
    name: person.name,
    state: person.state,
    x: Number(person.x.toFixed(1)),
    y: Number(person.y.toFixed(1)),
    foodReserve: Number((person.foodReserve || 0).toFixed(1)),
    hydration: Number((person.hydration || 0).toFixed(1))
  }));

  return {
    kingdoms,
    communities: communityDetails,
    independentPeople,
    departures,
    causalEvents,
    wars: (world.wars || []).map(war => ({
      id: war.id, attackerId: war.attackerId, defenderId: war.defenderId,
      startedDay: war.startedDay, resolvedDay: war.resolvedDay ?? null,
      status: war.status, cause: war.cause, evidence: war.evidence,
      campaignId: war.campaignId ?? null, campaignStatus: war.campaignStatus ?? null
    })),
    campaigns,
    territoryClaims: (world.territoryClaims || []).map(claim => ({ ...claim })),
    treaties: (world.treaties || []).map(treaty => ({ ...treaty })),
    kingdomRelations: Object.values(world.kingdomRelations || {}).map(relation => ({ ...relation }))
  };
}

const results = [];
for (const seed of seeds) {
  const world = Sim.createWorld(seed);
  const causalObserver = observeCausalEvents(world);
  const adultReserveExposure = { personDays: 0, reservePoints: 0, below20PersonDays: 0, below42PersonDays: 0, zeroReservePersonDays: 0 };
  const startedAt = performance.now();
  for (let day = 0; day < days; day++) {
    Sim.stepDay(world, null, { includeSnapshot: false });
    for (const person of world.people) {
      if (!person.alive || person.ageDays < 12 * 365) continue;
      const reserve = Math.max(0, Number(person.foodReserve) || 0);
      adultReserveExposure.personDays++;
      adultReserveExposure.reservePoints += reserve;
      if (reserve < 20) adultReserveExposure.below20PersonDays++;
      if (reserve < 42) adultReserveExposure.below42PersonDays++;
      if (reserve <= .001) adultReserveExposure.zeroReservePersonDays++;
    }
  }
  const elapsedSeconds = (performance.now() - startedAt) / 1000;
  causalObserver.restore();
  const people = world.people.filter(person => person.alive);
  const adultFoodReserves = people.filter(person => person.ageDays >= 12 * 365)
    .map(person => Number((person.foodReserve || 0).toFixed(2)));
  const animals = world.animals.filter(animal => animal.alive);
  const communities = world.communities.filter(community => !community.dissolved);
  const farms = world.structures.filter(structure => structure.type === 'roça');
  const report = Sim.snapshot(world);
  let determinismVerification = { verified: false, reason: 'seed não selecionada para replay pareado' };
  if (verificationSeeds.has(seed)) {
    const replay = Sim.createWorld(seed);
    const replayObserver = observeCausalEvents(replay);
    for (let day = 0; day < days; day++) Sim.stepDay(replay, null, { includeSnapshot: false });
    replayObserver.restore();
    assert.deepEqual(world, replay, 'same seed must reproduce the complete world after the full replay');
    assert.deepEqual(causalObserver.trace, replayObserver.trace, 'same seed must reproduce causal chronicle events');
    determinismVerification = { verified: true, days, fullWorldState: true, causalEvents: true };
  }

  results.push({
    seed, days, elapsedSeconds: Number(elapsedSeconds.toFixed(2)),
    determinismVerification,
    population: { livingPeople: people.length, livingAnimals: animals.length,
      deathsByKind: { people: deathsByCause(world.people), animals: deathsByCause(world.animals) } },
    adultFoodReserves: {
      adults: adultFoodReserves.length,
      average: adultFoodReserves.length
        ? Number((adultFoodReserves.reduce((sum, reserve) => sum + reserve, 0) / adultFoodReserves.length).toFixed(2)) : 0,
      minimum: adultFoodReserves.length ? Math.min(...adultFoodReserves) : 0,
      below20: adultFoodReserves.filter(reserve => reserve < 20).length,
      below42: adultFoodReserves.filter(reserve => reserve < 42).length
    },
    adultFoodReserveExposure: {
      adultPersonDays: adultReserveExposure.personDays,
      average: adultReserveExposure.personDays
        ? Number((adultReserveExposure.reservePoints / adultReserveExposure.personDays).toFixed(2)) : 0,
      below20Percent: adultReserveExposure.personDays
        ? Number((adultReserveExposure.below20PersonDays * 100 / adultReserveExposure.personDays).toFixed(2)) : 0,
      below42Percent: adultReserveExposure.personDays
        ? Number((adultReserveExposure.below42PersonDays * 100 / adultReserveExposure.personDays).toFixed(2)) : 0,
      zeroReservePercent: adultReserveExposure.personDays
        ? Number((adultReserveExposure.zeroReservePersonDays * 100 / adultReserveExposure.personDays).toFixed(2)) : 0
    },
    economy: {
      plantFoodHarvested: Number((world.harvests.plantFoodBiomass || 0).toFixed(2)),
      cultivatedFoodHarvested: Number((world.harvests.cultivatedFoodBiomass || 0).toFixed(2)),
      foodRegrowth: Number((world.ecologyFlows.humanFoodRegrowth || 0).toFixed(2)),
      cultivatedFoodRegrowth: Number((world.ecologyFlows.humanFoodCultivatedRegrowth || 0).toFixed(2)),
      humanFoodBiomass: Number(report.humanFoodBiomass.toFixed(2)),
      cultivatedFoodBiomass: Number(report.cultivatedFoodBiomass.toFixed(2)),
      communityFoodStores: Number(communities.reduce((total, community) => total + (community.stores.food || 0), 0).toFixed(2)),
      farms: farms.map(farm => ({ complete: !!farm.complete, progress: farm.progress || 0,
        required: farm.required || 0, fieldCells: (farm.fieldTileIndices || []).length,
        cropHarvested: Number((farm.cropHarvested || 0).toFixed(2)) }))
    },
    society: {
      communityCount: communities.length,
      kingdomPopulations: world.kingdoms.map(kingdom => ({ name: kingdom.name,
        livingMembers: kingdom.memberIds.map(id => world.people.find(person => person.id === id && person.alive)).filter(Boolean).length })),
      conflicts: world.conflicts, borderIncidents: world.borderIncidents || 0,
      raids: { attempts: world.raidAttempts || 0, successful: world.successfulRaids || 0 },
      trades: world.trades, births: world.births, deaths: world.deaths,
      deathsByCause: { ...(world.deathsByCause || {}) }
    },
    causalEvidence: causalSnapshot(world, communities, causalObserver.trace)
  });
  console.error('Replay seed ' + seed + ' finished (' + days + ' days) in ' + elapsedSeconds.toFixed(1) + 's.');
}

console.log(JSON.stringify({ runtime: process.version, model: 'weekly finite-stock plant regeneration', results }, null, 2));
