import Sim from '../src/simulation/engine.js';
import { campaignOrderFor } from '../src/simulation/kingdoms/campaigns.js';
import { cellAt } from '../src/simulation/world/spatial.js';

const seed = Number(process.env.CAMPAIGN_SEED || 42);
const days = Number(process.env.CAMPAIGN_DAYS || 60);
const world = Sim.createWorld(seed);
world.day = 99;
const observations = [];
for (let step = 0; step < days; step++) {
  Sim.stepDay(world);
  if (step % 10 !== 0 && step !== days - 1) continue;
  console.error('Campaign replay day ' + world.day);
  observations.push({ day: world.day, campaigns: world.campaigns.map(campaign => ({
    id: campaign.id, status: campaign.status, battles: campaign.battleCount,
    target: campaign.target,
    sides: [campaign.attacker, campaign.defender].map(side => ({
      role: side.role, deployed: !!side.formation?.deployed, cohesion: side.formation?.metrics?.cohesion,
      troops: side.troopIds.map(id => world.people.find(p => p.id === id && p.alive)).filter(Boolean).map(p => {
        const order = campaignOrderFor(world, p), tile = order?.target && cellAt(world, order.target.x, order.target.y);
        return { id: p.id, class: p.militaryClass, x: p.x, y: p.y, state: p.state,
          lastAttack: p.lastMilitaryAttackDay, target: order?.target, terrain: tile?.terrain,
          replans: p.navigationReplans };
      })
    }))
  })) });
}
console.log(JSON.stringify({ seed, days, observations }, null, 2));
