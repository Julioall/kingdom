// Optional battlefield-observation overlay for real browser QA.
// All coordinates are taken from the authoritative Worker snapshot; no
// artificial soldier movement or simulation decisions are introduced here.
const ROLE_COLOR = {
  vanguard: '#f1d878', support: '#8dcdf6',
  'flank-left': '#f18e7c', 'flank-right': '#e7a66f',
  reserve: '#b4d58b'
};
const ROLE_LABEL = {
  vanguard: 'CENTRO', support: 'APOIO',
  'flank-left': 'ALA E', 'flank-right': 'ALA D', reserve: 'RESERVA'
};

export function battlefieldDebugData(world) {
  const people = new Map((world?.people || []).filter(p => p?.alive).map(p => [p.id, p]));
  const result = [];
  for (const campaign of world?.campaigns || []) {
    if (['withdrawing', 'complete', 'ended'].includes(campaign.status)) continue;
    for (const side of [campaign.attacker, campaign.defender]) {
      for (const squad of side?.squadTactics?.squads || []) {
        const leader = people.get(squad.commanderId);
        if (!leader) continue;
        const soldiers = squad.memberIds.filter(id => id !== squad.commanderId)
          .map(id => ({ person: people.get(id), slot: squad.worldSlots?.[id] || null }))
          .filter(entry => entry.person);
        result.push({
          campaignId: campaign.id, kingdomId: side.kingdomId,
          unitId: squad.unitId, role: squad.role, formation: squad.formationType,
          phase: squad.phase, cohesion: squad.cohesion,
          leader, target: squad.target, flankWaypoint: squad.flankWaypoint,
          terrainBlockedSlots: squad.terrainBlockedSlots || 0,
          soldiers
        });
      }
    }
  }
  return result;
}

export function drawBattlefieldDebug(ctx, world, tileSize) {
  if (!ctx || !world) return;
  const groups = battlefieldDebugData(world);
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'left';
  for (const squad of groups) {
    const color = ROLE_COLOR[squad.role] || '#e4e2d8';
    const center = { x: (squad.leader.x + .5) * tileSize,
      y: (squad.leader.y + .5) * tileSize };
    if (squad.target) {
      const goal = { x: (squad.target.x + .5) * tileSize,
        y: (squad.target.y + .5) * tileSize };
      ctx.strokeStyle = color;
      ctx.globalAlpha = .6;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(center.x, center.y); ctx.lineTo(goal.x, goal.y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(goal.x, goal.y, 4, 0, Math.PI * 2); ctx.stroke();
    }
    // The outward flank waypoint must be inspectable separately from
    // the immediate target during the second (inward strike) stage.
    if (squad.flankWaypoint) {
      ctx.strokeStyle = color;
      ctx.globalAlpha = .4;
      const point = squad.flankWaypoint;
      ctx.strokeRect((point.x + .5) * tileSize - 5, (point.y + .5) * tileSize - 5, 10, 10);
    }
    for (const entry of squad.soldiers) {
      if (!entry.slot) continue;
      const from = { x: (entry.person.x + .5) * tileSize, y: (entry.person.y + .5) * tileSize };
      const to = { x: (entry.slot.x + .5) * tileSize, y: (entry.slot.y + .5) * tileSize };
      ctx.strokeStyle = color; ctx.globalAlpha = .24;
      ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
      ctx.fillStyle = color; ctx.globalAlpha = .5;
      ctx.fillRect(to.x - 2, to.y - 2, 4, 4);
    }
    ctx.strokeStyle = color; ctx.globalAlpha = .95;
    ctx.beginPath(); ctx.arc(center.x, center.y, 7, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#101a21'; ctx.globalAlpha = .85;
    const name = ROLE_LABEL[squad.role] || squad.role;
    const label = name + ' · ' + squad.phase + ' · ' + Math.round((squad.cohesion || 0) * 100)
      + '%' + (squad.terrainBlockedSlots ? ' !' + squad.terrainBlockedSlots : '');
    const width = ctx.measureText(label).width + 8;
    ctx.fillRect(center.x + 10, center.y - 17, width, 16);
    ctx.globalAlpha = 1; ctx.fillStyle = color;
    ctx.fillText(label, center.x + 14, center.y - 5);
  }
  ctx.restore();
}
