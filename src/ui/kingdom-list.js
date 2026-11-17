// Pure HTML presenter for the realm list. Simulation reports and formatting
// are injected; this module never reads DOM, Workers or mutable UI state.
export function kingdomCardsHtml(world, { getPerson, resourceSummary, fmt, esc }) {
  return world.kingdoms.map(kingdom => {
      const residents = kingdom.memberIds.map(id => getPerson(id)).filter(Boolean);
      const resources = resourceSummary(world, kingdom.id);
      const ruler = getPerson(kingdom.rulerId);
      const soldiers = residents.filter(person => person.role === 'soldier').length;
      const campaign = (world.campaigns || []).find(item => item.status !== 'complete'
        && (item.attackerId === kingdom.id || item.defenderId === kingdom.id));
      const campaignStatus = campaign ? ' · campanha ' + (campaign.status === 'engaged' ? 'em combate' : campaign.status === 'withdrawing' ? 'retirada' : 'em marcha') : '';
      const metrics = [
        ['food', 'Comida', fmt(resources.food), 'Comida disponível nas contas vinculadas ao reino, em dias alimentares equivalentes.'],
        ['wealth', 'Riqueza', fmt(resources.gold, 0), 'Ouro nas contas vinculadas ao reino e com moradores vivos.'],
        ['people', 'Pessoas', fmt(resources.people), 'Moradores vivos deste reino.'],
        ['births', 'Nascimentos', fmt(resources.births), 'Nascimentos registrados para este reino desde o início.'],
        ['deaths', 'Mortes', fmt(resources.deaths), 'Mortes registradas para este reino desde o início.']
      ].map(([key, label, value, title]) => '<span class="kingdom-card-stat" data-kingdom-stat="' + key + '" title="' + title + '"><small>' + label + '</small><b>' + value + '</b></span>').join('');
      return '<button class="community-card" data-kingdom="' + kingdom.id + '" title="Inspecionar reino, moradias, tesouro e mercado" style="--community:' + esc(kingdom.color) + '">' +
        '<i class="color-dot"></i><span class="kingdom-card-body"><strong>' + esc(kingdom.name) + '</strong><small>' + soldiers + ' soldados' + esc(campaignStatus) + ' · ' + (kingdom.homeIds || []).length + ' casas · ' + kingdom.towerIds.map(id => world.structures.find(structure => structure.id === id && structure.complete)).filter(Boolean).length + ' torres · rei ' + esc(ruler ? ruler.name : 'sem governante') + '</small><span class="kingdom-card-stats" aria-label="Indicadores de ' + esc(kingdom.name) + '">' + metrics + '</span></span><em>' + fmt(kingdom.territoryTileCount) + ' células</em></button>';
    }).join('');
}
