// Reproducible, inspectable REAL Kingdom simulation replay for battlefield QA.
// Usage: node scripts/replay-medieval-battle.mjs --seed=42 --days=75 --interval=5 --output=out/battle-replay.html
import Sim from '../src/simulation/engine.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map(text => text.replace(/^--/, '').split('=')));
const seed = Math.max(1, Number(args.seed) || 42);
const days = Math.max(10, Math.min(120, Number(args.days) || 75));
const interval = Math.max(1, Math.min(20, Number(args.interval) || 5));
const output = resolve(args.output || 'out/battle-replay.html');
const radius = Math.max(14, Math.min(32, Number(args.radius) || 23));
const world = Sim.createWorld(seed, { tacticalCombat: 'hierarchical' });

function conflictAtMidpoint(world) {
  const [attacker, defender] = world.kingdoms;
  if (!attacker || !defender) throw Error('Kingdom replay requires two kingdoms');
  const requested = { x: (attacker.x + defender.x) / 2, y: (attacker.y + defender.y) / 2 };
  const tile = world.tiles.reduce((best, next) => next.terrain === 'land'
    && (!best || Math.hypot(next.x - requested.x, next.y - requested.y)
      < Math.hypot(best.x - requested.x, best.y - requested.y)) ? next : best, null);
  if (!tile) throw Error('No land battlefield');
  const point = { x: tile.x, y: tile.y }, id = world.nextId++;
  const key = Math.min(attacker.id, defender.id) + ':' + Math.max(attacker.id, defender.id);
  world.kingdomRelations[key] = { a: Math.min(attacker.id, defender.id),
    b: Math.max(attacker.id, defender.id), status: 'at-war', tension: 1,
    warId: id, startedDay: 0, borderIncidents: 1, resolvedDay: -1,
    ceasefireUntilDay: -1 };
  world.wars.push({ id, a: attacker.id, b: defender.id, attackerId: attacker.id,
    defenderId: defender.id, status: 'active', startedDay: 0,
    forceMobilization: true, cause: 'replay: combate observado na fronteira',
    evidence: { location: point, attacker: { source: 'sentinela', location: point },
      defender: { source: 'guarnição', location: point } } });
  return { id, point, attackerId: attacker.id, defenderId: defender.id };
}

const { id, point, attackerId, defenderId } = conflictAtMidpoint(world);
const snapshots = [];
function capture() {
  const campaign = (world.campaigns || []).find(c => c.warId === id);
  const troops = (world.people || []).filter(p => p.alive && p.role === 'soldier'
    && (p.kingdomId === attackerId || p.kingdomId === defenderId));
  const groups = [];
  for (const side of [campaign?.attacker, campaign?.defender]) {
    for (const squad of side?.squadTactics?.squads || []) {
      const commander = troops.find(p => p.id === squad.commanderId);
      groups.push({ id: squad.id, kingdomId: side.kingdomId, role: squad.role,
        phase: squad.phase, formation: squad.formationType,
        cohesion: squad.cohesion, rankIntegrity: squad.rankIntegrity,
        commanderId: squad.commanderId,
        commander: commander && { x: commander.x, y: commander.y },
        target: squad.target,
        wayPoint: squad.flankWaypoint,
        soldiers: squad.memberIds.filter(pid => pid !== squad.commanderId)
          .map(pid => ({ id: pid, slot: squad.worldSlots?.[pid] || null })) });
    }
  }
  snapshots.push({
    day: world.day, campaignStatus: campaign?.status || 'aguardando',
    battleCount: campaign?.battleCount || 0,
    losses: [campaign?.attacker?.losses || 0, campaign?.defender?.losses || 0],
    groups,
    people: troops.map(p => ({ id: p.id, x: p.x, y: p.y,
      kingdomId: p.kingdomId, militaryClass: p.militaryClass,
      militaryRank: p.militaryRank, tacticalRole: p.tacticalRole,
      tacticalPhase: p.tacticalPhase }))
  });
}
capture();
for (let day = 0; day < days; day++) {
  Sim.stepDay(world, { includeSnapshot: false });
  if (world.day % interval === 0 || day === days - 1) capture();
}
const minX = Math.max(0, Math.round(point.x - radius));
const minY = Math.max(0, Math.round(point.y - radius));
const maxX = Math.min(world.width - 1, Math.round(point.x + radius));
const maxY = Math.min(world.height - 1, Math.round(point.y + radius));
const palette = { land: '#727d53', rock: '#716b65', water: '#3e718c' };
const tileSvg = [];
const cell = 13;
for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
  const tile = world.tiles[y * world.width + x];
  tileSvg.push('<rect x="' + ((x - minX) * cell) + '" y="' + ((y - minY) * cell)
    + '" width="' + cell + '" height="' + cell + '" fill="'
    + (palette[tile.terrain] || '#656f4f') + '"/>');
}
const escapeHtml = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const json = JSON.stringify({ snapshots, point, minX, minY, maxX, maxY, cell, tileSvg: tileSvg.join('') })
  .replace(/</g, '\\u003c');
const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kingdom — replay de batalha medieval • seed ${seed}</title>
<style>
body{margin:0;background:#101a20;color:#e5e1cf;font:15px system-ui,Arial;line-height:1.5}
main{max-width:1120px;margin:28px auto;padding:0 18px}
h1{font:600 28px Georgia,serif;margin:0 0 6px}
p{color:#bcc8c3;max-width:850px}
.panel{background:#192832;border:1px solid #45545b;border-radius:12px;padding:16px;margin:16px 0}
input[type=range]{width:100%;accent-color:#e4c97c}
.grid{display:grid;grid-template-columns:minmax(300px,1.3fr) minmax(270px,1fr);gap:16px}
svg{max-width:100%;height:auto;background:#334d58;image-rendering:pixelated}
table{border-collapse:collapse;width:100%;font-size:13px}
td,th{border-bottom:1px solid #33444c;padding:7px;text-align:left}
th{color:#d5e1d6}
small{color:#a9bcb8}
.legend{display:flex;gap:13px;flex-wrap:wrap}
.legend span::before{content:'●';padding-right:5px}
@media(max-width:780px){.grid{grid-template-columns:1fr}}
</style></head><body><main>
<h1>Kingdom • Coreografia da batalha</h1>
<p>Replay produzido pela simulação real — posições, comandantes, destinos, reservas,
fileiras, terreno e contatos. Cada ponto é um soldado real, não uma animação inventada.
Linhas tracejadas são ordens; pequenos quadrados representam posições pretendidas.</p>
<div class="panel"><label for="day">Dia <strong id="currentDay">0</strong></label>
<input id="day" type="range" min="0" max="0" value="0" step="1">
<div class="legend">
<span style="color:#78bad1">Atacante</span><span style="color:#e89a78">Defensor</span>
<span style="color:#f1d878">Centro</span><span style="color:#e7a66f">Ala</span>
<span style="color:#b4d58b">Reserva</span>
</div></div>
<div class="grid">
<div class="panel"><svg id="battleMap" xmlns="http://www.w3.org/2000/svg" role="img"
aria-label="Mapa da batalha e posições reais dos soldados" viewBox="0 0 ${(maxX - minX + 1) * cell} ${(maxY - minY + 1) * cell}"></svg></div>
<div class="panel"><strong id="status"></strong><p id="combatInfo"></p>
<table><thead><tr><th>Unidade</th><th>Fase</th><th>Fileiras</th></tr></thead>
<tbody id="groups"></tbody></table>
<p><small>Coesão/rankIntegrity são medições do simulador, não provas de realismo.
A câmera mostra somente a área disputada; tropas fora dela continuam simuladas.</small></p></div>
</div></main>
<script id="battleData" type="application/json">${json}</script>
<script>
(() => {
  const data = JSON.parse(document.getElementById('battleData').textContent);
  const slider = document.getElementById('day');
  slider.max = String(data.snapshots.length - 1);
  const cx = x => (x - data.minX + .5) * data.cell;
  const cy = y => (y - data.minY + .5) * data.cell;
  const visible = pos => pos && pos.x >= data.minX && pos.x <= data.maxX
    && pos.y >= data.minY && pos.y <= data.maxY;
  const role = {vanguard:'Centro',support:'Apoio','flank-left':'Ala esquerda',
    'flank-right':'Ala direita',reserve:'Reserva'};
  const color = {vanguard:'#f1d878',support:'#8dcdf6',
    'flank-left':'#f18e7c','flank-right':'#e7a66f',reserve:'#b4d58b'};
  const circle = (x,y,r,fill,stroke='#101820') =>
    '<circle cx="'+cx(x)+'" cy="'+cy(y)+'" r="'+r+'" fill="'+fill
    +'" stroke="'+stroke+'" stroke-width="1"/>';
  function paint(index) {
    const frame = data.snapshots[index], people = new Map(frame.people.map(p => [p.id, p]));
    let svg = data.tileSvg;
    const x = cx(data.point.x), y = cy(data.point.y);
    svg += '<circle cx="'+x+'" cy="'+y+'" r="9" fill="none" stroke="#f4deaa" stroke-width="2"/>';
    for (const group of frame.groups) {
      if (!visible(group.commander)) continue;
      const baseColor = color[group.role] || '#e5dfd1';
      if (visible(group.target)) svg += '<path d="M'+cx(group.commander.x)+','+cy(group.commander.y)
        +' L'+cx(group.target.x)+','+cy(group.target.y)
        +'" fill="none" stroke="'+baseColor+'" stroke-width="1.5" stroke-dasharray="5,3" opacity=".8"/>';
      if (visible(group.wayPoint)) svg += '<rect x="'+(cx(group.wayPoint.x)-5)
        +'" y="'+(cy(group.wayPoint.y)-5)+'" width="10" height="10" fill="none" stroke="'+baseColor+'"/>';
      for (const soldier of group.soldiers) {
        const p = people.get(soldier.id);
        if (!p || !visible(p) || !visible(soldier.slot)) continue;
        svg += '<path d="M'+cx(p.x)+','+cy(p.y)+' L'+cx(soldier.slot.x)+','+cy(soldier.slot.y)
          +'" stroke="'+baseColor+'" opacity=".22" stroke-width=".8"/>';
        svg += '<rect x="'+(cx(soldier.slot.x)-2)+'" y="'+(cy(soldier.slot.y)-2)
          +'" width="4" height="4" fill="'+baseColor+'" opacity=".5"/>';
      }
    }
    for (const p of frame.people) if (visible(p)) {
      const fill = p.kingdomId === ${attackerId} ? '#78bad1' : '#e89a78';
      svg += circle(p.x,p.y,p.militaryRank === 'comandante' ? 4 : 3,fill);
      if (p.militaryRank === 'comandante' || p.militaryRank === 'general')
        svg += '<circle cx="'+cx(p.x)+'" cy="'+cy(p.y)+'" r="6.5" fill="none" stroke="'
          +(color[p.tacticalRole] || '#faf2d7')+'" stroke-width="1.5"/>';
    }
    document.getElementById('battleMap').innerHTML = svg;
    document.getElementById('currentDay').textContent = String(frame.day);
    document.getElementById('status').textContent = 'Campanha: ' + frame.campaignStatus;
    document.getElementById('combatInfo').textContent = 'Confrontos registrados: '+frame.battleCount
      +' • Baixas (atacante/defensor): '+frame.losses.join('/');
    document.getElementById('groups').innerHTML = frame.groups.map(group => '<tr><td>'
      +(role[group.role] || group.role)+'</td><td>'+group.phase+'</td><td>'
      +group.formation+' · '+Math.round((group.rankIntegrity || 0)*100)+'%</td></tr>').join('');
  }
  slider.addEventListener('input', () => paint(Number(slider.value)));
  paint(0);
})();
</script></body></html>`;
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, html, 'utf8');
console.log('BATTLE-REPLAY', JSON.stringify({
  output, seed, days, frames: snapshots.length, viewport: [minX,minY,maxX,maxY],
  phases: Object.fromEntries([...new Set(snapshots.flatMap(frame => frame.groups.map(s => s.phase)))]
    .map(phase => [phase, snapshots.reduce((n, frame) =>
      n + frame.groups.filter(s => s.phase === phase).length, 0)])),
  maxBattles: Math.max(...snapshots.map(frame => frame.battleCount))
}));
