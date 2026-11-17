// Tactical inspector presenters: given a snapshot and a selected soldier,
// produce escaped markup without accessing the DOM or changing the battle.
export function formationInspectionHtml(p, world, getPerson, esc) {
  if (p.campaignId == null) return '';

            const campaign = (world.campaigns || []).find(item => item.id === p.campaignId);
            const side = [campaign?.attacker, campaign?.defender]
              .find(item => item?.kingdomId === p.kingdomId);
            const index = side?.squadTactics?.memberToSquad?.[p.id];
            const squad = Number.isInteger(index) ? side.squadTactics.squads[index] : null;
            if (!squad) return '';
            const names = {
              column: 'Coluna de marcha', line: 'Linha', shield_wall: 'Muralha de escudos',
              spear_line: 'Linha de lanças', wedge: 'Cunha', square: 'Quadrado'
            };
            const phases = {
              marching: 'Marchando', deploying: 'Abrindo fileiras', contact: 'Linha em contato',
              charging: 'Investida coordenada',
              flanking: 'Contornando o flanco', striking: 'Investindo pelo flanco',
              holding: 'Mantendo reserva/posição', rally: 'Reagrupando',
              reforming: 'Aguardando os soldados atrasados', rout: 'Rompida: retirada'
            };
            const commander = getPerson(squad.commanderId);
            return '<div class="note-card"><b>Formação da unidade</b><span>'
              + esc(names[squad.formationType] || squad.formationType)
              + ' · ' + esc(phases[squad.phase] || squad.phase)
              + ' · função: ' + esc(squad.role)
              + ' · comando: ' + esc(commander?.name || 'sucessor')
              + ' · coesão ' + Math.round((squad.cohesion || 0) * 100) + '%'
              + ' · moral ' + Math.round(squad.morale || 0) + '%</span></div>';
}

export function fieldCommandInspectionHtml(p, getPerson, esc) {
  if (p.campaignId == null || !p.fieldCommand) return '';
  return '<div class="note-card"><b>' + (p.fieldCommand.issuerId === p.id ? 'Ordem emitida' : 'Ordem recebida de ' + esc(getPerson(p.fieldCommand.issuerId)?.name || 'general')) + '</b><span>' + esc(p.fieldCommand.reason) + ' Formação: ' + (p.fieldCommand.formationType === 'line' ? 'linha' : 'coluna') + '. Alvo: ' + p.fieldCommand.target.x + ',' + p.fieldCommand.target.y + '.</span></div>';
}
