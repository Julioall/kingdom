import Sim from '../src/simulation/engine.js';
import { recomputeKingdomTerritories } from '../src/simulation/kingdoms/territories.js';

const seeds = (process.env.CAMPAIGN_SEEDS || '1,42,987,2026')
  .split(',').map(value => Number(value.trim())).filter(Number.isFinite);
const days = Math.max(1, Math.floor(Number(process.env.CAMPAIGN_DAYS || 365)));
const layout = process.env.CAMPAIGN_LAYOUT || 'default';

function moveKingdom(world, kingdom, x, y) {
  const dx = x - kingdom.x, dy = y - kingdom.y;
  kingdom.x = x;
  kingdom.y = y;
  const community = world.communities.find(item => item.id === kingdom.communityId);
  if (community) { community.x += dx; community.y += dy; }
  for (const structure of world.structures.filter(item => item.kingdomId === kingdom.id)) {
    structure.x += dx;
    structure.y += dy;
  }
  for (const settlement of world.settlements.filter(item => item.kingdomId === kingdom.id)) {
    settlement.x += dx;
    settlement.y += dy;
  }
  for (const person of world.people.filter(item => item.kingdomId === kingdom.id)) {
    person.x += dx;
    person.y += dy;
    person.lastSafeX += dx;
    person.lastSafeY += dy;
    person.perception = null;
  }
}

const results = [];
for (const seed of seeds) {
  const world = Sim.createWorld(seed);
  if (layout === 'central') {
    moveKingdom(world, world.kingdoms[0], 33, 33);
    moveKingdom(world, world.kingdoms[1], 59, 59);
    recomputeKingdomTerritories(world);
  } else if (layout === 'frontier') {
    moveKingdom(world, world.kingdoms[0], 31, 31);
    moveKingdom(world, world.kingdoms[1], 60, 60);
    recomputeKingdomTerritories(world);
  } else if (layout === 'frontline') {
    moveKingdom(world, world.kingdoms[0], 31, 31);
    moveKingdom(world, world.kingdoms[1], 55, 55);
    recomputeKingdomTerritories(world);
  }
  for (let day = 0; day < days; day++) Sim.stepDay(world);

  results.push({
    seed,
    days: world.day,
    livingPeople: world.people.filter(person => person.alive).length,
    livingAnimals: world.animals.filter(animal => animal.alive).length,
    borderIncidents: world.borderIncidents || 0,
    relations: Object.values(world.kingdomRelations || {}).map(relation => ({
      a: relation.a,
      b: relation.b,
      status: relation.status,
      tension: Number((relation.tension || 0).toFixed(2)),
      borderIncidents: relation.borderIncidents || 0,
      resourceDisputes: relation.resourceDisputes || 0
    })),
    kingdoms: (world.kingdoms || []).map(kingdom => {
      const community = (world.communities || []).find(item => item.id === kingdom.communityId);
      const members = world.people.filter(person => person.alive && person.kingdomId === kingdom.id);
      return {
        id: kingdom.id,
        name: kingdom.name,
        center: { x: kingdom.x, y: kingdom.y },
        territoryTileCount: kingdom.territoryTileCount,
        population: members.length,
        soldiers: members.filter(person => person.role === 'soldier').length,
        treasury: { ...(kingdom.treasury && kingdom.treasury.stock || {}) },
        communityFood: community && community.stores.food || 0,
        currentActions: members.reduce((counts, person) => {
          const action = person.brain && person.brain.lastAction || 'unknown';
          counts[action] = (counts[action] || 0) + 1;
          return counts;
        }, {})
      };
    }),
    currentTerritoryExposure: world.people.filter(person => person.alive && person.territoryExposure).map(person => ({
      personId: person.id,
      kingdomId: person.kingdomId,
      ownerId: person.territoryExposure.ownerId,
      x: person.x,
      y: person.y,
      enteredDay: person.territoryExposure.enteredDay
    })),
    wars: (world.wars || []).map(war => ({
      id: war.id,
      startedDay: war.startedDay,
      resolvedDay: war.resolvedDay ?? null,
      status: war.status,
      campaignStatus: war.campaignStatus ?? null,
      cause: war.cause,
      evidence: war.evidence
    })),
    campaigns: (world.campaigns || []).map(campaign => ({
      id: campaign.id,
      startedDay: campaign.startedDay,
      status: campaign.status,
      outcome: campaign.outcome,
      outcomeReason: campaign.outcomeReason,
      battleCount: campaign.battleCount,
      territorialChange: campaign.territorialChange ?? null,
      history: campaign.history.map(event => ({ day: event.day, type: event.type, text: event.text }))
    })),
    treaties: (world.treaties || []).map(treaty => ({
      day: treaty.day,
      kind: treaty.kind,
      territorialChange: treaty.territorialChange ?? null,
      cause: treaty.reason ?? treaty.outcome
    })),
    deathsByCause: world.deathsByCause
  });
}

if (process.env.CAMPAIGN_SUMMARY === '1') {
  console.log(JSON.stringify({ days, layout, results: results.map(result => ({
    seed: result.seed,
    borderIncidents: result.borderIncidents,
    relations: result.relations,
    wars: result.wars.map(war => ({ day: war.startedDay, status: war.status, cause: war.cause,
      campaignStatus: war.campaignStatus, resolvedDay: war.resolvedDay })),
    campaigns: result.campaigns.map(campaign => ({ day: campaign.startedDay, status: campaign.status,
      outcome: campaign.outcome, outcomeReason: campaign.outcomeReason, battleCount: campaign.battleCount,
      history: campaign.history.map(event => event.type) })),
    treaties: result.treaties.map(treaty => ({ day: treaty.day, kind: treaty.kind, cause: treaty.cause })),
    deathsByCause: result.deathsByCause,
    livingPeople: result.livingPeople
  })) }, null, 2));
} else console.log(JSON.stringify({ days, layout, results }, null, 2));
