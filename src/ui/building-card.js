import { corralSummary, resourceSummary } from './gameplay-data.js';
import { towerVitality } from '../simulation/kingdoms/fortifications.js';
import { PLANTS } from '../config/ecosystem.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = n => (Number(n) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
export const row = (label, value) => `<div class="data-row"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;
const note = text => `<p class="quiet">${esc(text)}</p>`;

export function kingdomOverview(world, kingdom) {
  const data = resourceSummary(world, kingdom.id);
  const incidents = Object.values(world.kingdomRelations || {}).filter(r => r.a === kingdom.id || r.b === kingdom.id)
    .reduce((sum, r) => sum + (r.borderIncidents || 0), 0);
  return '<h3>Sobrevivência e prosperidade</h3>' +
    row('Comida nas contas do reino', fmt(data.food) + ' dias equivalentes') +
    row('No estoque comunitário', fmt(data.foodByAccount.community) + ' dias equivalentes') +
    row('No tesouro', fmt(data.foodByAccount.treasury) + ' dias equivalentes') +
    row('No mercado local', fmt(data.foodByAccount.market) + ' dias equivalentes') +
    row('Riqueza total', fmt(data.gold) + ' ouro') +
    row('População', data.people + ' pessoas') + row('Reserva abaixo de 30 dias', data.hungry + ' pessoas') +
    row('Com pouca água / energia', data.thirsty + ' / ' + data.tired) + row('Sem moradia', data.homeless) +
    row('Satisfação do reino', Math.round(data.satisfaction * 100) + '%') +
    row('Nascimentos / mortes', data.births + ' / ' + data.deaths + ' · desde o início') +
    row('Incidentes de fronteira', incidents) + note('O total soma estoques de contas diferentes, não a comida imediatamente acessível a um morador. O mercado geral sem vínculo não entra no total deste reino. cada unidade de comida vale um dia adulto e cada unidade de carne vale 2,5 dias. Reservas pessoais e biomassa ainda no campo não entram nesta soma.') +
    '<details class="gameplay-details"><summary>Construções do reino</summary><div class="building-picker">' + world.structures.filter(s => s.kingdomId === kingdom.id && s.destroyedDay == null).map(s => '<button type="button" data-inspect-structure="' + s.id + '">' + esc(({ centro_militar: 'Centro militar', monasterio: 'Convento', arquearia: 'Arquearia', roça: 'Roça' })[s.type] || s.type.charAt(0).toUpperCase() + s.type.slice(1)) + '</button>').join('') + '</div></details>';
}

export function buildingCard(world, s) {
  const kingdom = world.kingdoms.find(k => k.id === s.kingdomId);
  const community = world.communities.find(c => c.id === s.communityId && !c.dissolved);
  const living = world.people.filter(p => p.alive);
  let html = '';
  if (s.destroyedDay != null) return row('Construção destruída', 'Dia ' + s.destroyedDay);
  if (!s.complete) {
    const progress = Math.min(100, Math.floor((s.progress || 0) / Math.max(1, s.required || 1) * 100));
    return row('Progresso da obra', progress + '%') + '<div class="construction-meter" data-progress="' + progress + '"></div>' +
      row('Trabalhadores designados', (s.workerIds || []).length || living.filter(p => p.assignment?.structureId === s.id).length) +
      row('Atividade', s.siegeBlocked ? 'Interrompida por ataque' : s.constructionStatus || ({ delegated: 'Trabalhador designado', 'not-delegated': 'Aguardando trabalhador', blocked: 'Acesso bloqueado', 'worker-out-of-range': 'Trabalhador distante', 'worker-approaching': 'Trabalhador a caminho', 'worker-paused': 'Trabalho pausado' })[s.workStatus] || 'Aguardando trabalho no local');
  }
  if (s.type === 'curral') {
    const data = corralSummary(world, s);
    html = row('Ovelhas neste curral', data.sheep + ' / ' + data.capacity) + row('Ração disponível', fmt(data.feed) + ' un. · reserva compartilhada') +
      row('Consumo previsto de ração', fmt(data.dailyFeed) + ' un./dia') +
      row('Duração da ração', data.feedDays == null ? 'Sem rebanho' : fmt(data.feedDays) + ' dias') +
      row('Comida produzida', '0 un./dia') + note('O curral mantém e reproduz o rebanho. Ainda não existe produção de leite nem abate de ovelhas domesticadas.') +
      row('Nascimentos neste curral', data.births) + row('Último nascimento', data.lastBirthDay == null ? 'Nenhum registrado' : 'Dia ' + data.lastBirthDay) +
      row('Ovelhas aptas à reprodução', data.breedingReady) + note('Nascimentos dependem de alimentação, energia e parceiro próximo; não há data de parto agendada.');
  } else if (s.type === 'castelo' && kingdom) {
    html = kingdomOverview(world, kingdom);
  } else if (s.type === 'casa' || s.type === 'abrigo') {
    const residents = living.filter(p => (s.residentIds || []).includes(p.id));
    const capacity = Number.isFinite(s.capacity) ? s.capacity : s.type === 'abrigo' ? 13 : 0;
    html = row('Moradores / vagas totais', residents.length + ' / ' + capacity) +
      row('Descansando aqui', living.filter(p => p.restingStructureId === s.id).length) +
      (s.type === 'abrigo' ? row('Frutos guardados', fmt(s.fruitStored) + ' dias de alimento') + row('Carne guardada', fmt(s.meatStored) + ' un. físicas · 2,5 dias/un.') +
        note('Os frutos e a carne guardados aqui já fazem parte do estoque comunitário; o abrigo mostra a localização registrada, não comida adicional.') : '') +
      (residents.length ? row('Moradores', residents.map(p => p.name).join(' · ')) : '');
  } else if (s.type === 'roça') {
    const cropIndex = PLANTS.findIndex(p => p.id === 'cultivated-root');
    const tiles = (s.fieldTileIndices || []).map(i => world.tiles[i]).filter(Boolean);
    html = row('Comida potencial no campo', fmt(tiles.reduce((n, t) => n + Math.max(0, (t.plants[cropIndex] || 0) - 1.2), 0)) + ' dias de alimento potenciais') +
      row('Colhido até hoje (histórico)', fmt(s.cropHarvested) + ' dias de alimento') + row('Área cultivada', tiles.length + ' células') +
      row('Sementes reservadas para plantio', fmt(s.cropSeedStored) + ' un. físicas') + note('Uma unidade colhida representa um dia de alimento para um adulto. O potencial ainda está no campo, não no estoque; colhido até hoje é histórico, não inventário. Sementes são contadas à parte.');
  } else if (['centro_militar', 'arquearia', 'monasterio'].includes(s.type)) {
    const units = living.filter(p => p.kingdomId === s.kingdomId && p.role === 'soldier' &&
      (s.type === 'centro_militar' ? (s.soldierIds || []).includes(p.id) : p.militaryClass === (s.type === 'arquearia' ? 'arqueiro' : 'monge')));
    html = row(s.type === 'centro_militar' ? 'Guarnição / capacidade' : 'Especialistas no reino', units.length + (s.type === 'centro_militar' ? ' / ' + (s.capacity || 8) : '')) +
      row('Em treinamento neste centro', living.filter(p => p.recruitmentOrder?.militaryCenterId === s.id).length) +
      row('Descansando aqui', living.filter(p => p.restingStructureId === s.id).length) +
      row('Precisam de recuperação', units.filter(p => p.health < 60 || p.energy < 30).length);
  } else if (s.type === 'torre') {
    html = row('Arqueiro de guarda', living.find(p => p.id === s.archerId)?.name || 'Posto vazio') +
      row('Alcance territorial', (s.territoryRadius || 13) + ' células') +
      (s.captureProgressDays > 0 ? row('Captura inimiga', s.captureProgressDays + ' / 5 dias') : '');
  } else if (s.type === 'mercado' && kingdom) {
    const stock = kingdom.market.stock;
    html = row('Comida à venda', fmt(stock.food) + ' dias alimentares') + row('Ouro no mercado', fmt(stock.gold)) +
      row('Preço da comida', fmt(kingdom.market.prices.food) + ' ouro/dia alimentar') +
      row('Madeira / pedra disponíveis', fmt(stock.wood) + ' / ' + fmt(stock.stone));
  } else if (community) {
    html = row('Comida compartilhada', fmt(community.stores.food) + ' dias alimentares') +
      row('Carne compartilhada', fmt(community.stores.meat) + ' un. físicas · 2,5 dias/un.') +
      row('Madeira / pedra', fmt(community.stores.wood) + ' / ' + fmt(community.stores.stone)) +
      note('O saldo alimentar é contado em dias equivalentes de um adulto. Carne é um estoque físico separado e fornece 2,5 dias por unidade.');
  } else html = note('Nenhuma atividade produtiva registrada nesta construção.');
  if (s.maxHealth) {
    const life = towerVitality(s);
    html += row('Integridade', fmt(life.health) + ' / ' + fmt(life.maxHealth)) +
      (life.health < life.maxHealth * .7 ? '<p class="gameplay-alert">Precisa de reparos</p>' : '');
  }
  return html;
}
