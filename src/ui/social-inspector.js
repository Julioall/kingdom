const SOCIAL_EVENT_LABELS = Object.freeze({
  food_aid_transferred: 'partilha de alimento',
  military_pay_delayed: 'soldo atrasado',
  military_pay_recovered: 'soldo em atraso pago'
});

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function formatNumber(value, digits = 0) {
  return Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: digits });
}

export function renderSocialInspectorSections(person, world) {
  const facts = new Map((world.socialEvidence?.facts || []).map(fact => [fact.eventId, fact]));
  const memories = (person.socialMemories || []).slice(-3).reverse();
  const beliefs = (person.socialBeliefs || []).slice().reverse();

  const memoryRows = memories.map(memory => {
    const fact = facts.get(memory.rootEventId);
    const eventLabel = SOCIAL_EVENT_LABELS[memory.eventType]
      || String(memory.eventType || 'acontecimento').replaceAll('_', ' ');
    const sourcePerson = (world.people || []).find(candidate => String(candidate.id) === memory.sourcePersonId);
    const provenance = memory.source === 'reported'
      ? 'Relato recebido de ' + (sourcePerson?.name || 'pessoa ' + memory.sourcePersonId)
      : 'Observado diretamente';
    const outcome = fact?.outcome?.resource === 'food' && Number.isFinite(fact.outcome.amount)
      ? ' · ' + formatNumber(fact.outcome.amount, 1) + ' pontos de alimento'
      : fact?.outcome?.resource === 'gold' && Number.isFinite(fact.outcome.amount)
        ? ' · ' + formatNumber(fact.outcome.amount, 1) + ' ouro' : '';
    const eventDay = Number.isSafeInteger(fact?.outcome?.paymentDay)
      ? fact.outcome.paymentDay : fact?.day ?? memory.eventDay;
    const dueDay = Number.isSafeInteger(fact?.outcome?.dueDay)
      ? ' · vencimento no dia ' + fact.outcome.dueDay : '';
    const receivedDay = memory.source === 'reported' && memory.acquiredDay !== memory.eventDay
      ? ' · recebido no dia ' + memory.acquiredDay : '';
    return '<div class="note-card"><b>' + escapeHtml(provenance) + '</b><span>Dia ' + eventDay + ': '
      + escapeHtml(eventLabel) + outcome + dueDay + receivedDay + '</span></div>';
  }).join('');

  const beliefRows = beliefs.map(belief => {
    const targetId = belief.aboutId == null ? null : String(belief.aboutId);
    const targetName = targetId == null ? ''
      : (world.people || []).find(candidate => String(candidate.id) === targetId)?.name
        || (world.kingdoms || []).find(candidate => String(candidate.id) === targetId)?.name
        || 'entidade ' + targetId;
    const target = targetName ? ' sobre ' + escapeHtml(targetName) : '';
    const label = belief.topic === 'food_aid_reliability' ? 'Confiabilidade na ajuda alimentar'
      : belief.topic === 'military_pay_reliability' ? 'Regularidade do soldo'
        : String(belief.topic).replaceAll('_', ' ');
    const evaluation = Math.round((belief.evaluation + 1) * 50);
    const supporting = (belief.supportingEventIds || []).length;
    const opposing = (belief.opposingEventIds || []).length;
    return '<div class="data-row"><span>' + escapeHtml(label) + target + '</span><b>Avaliação '
      + evaluation + '% · certeza ' + Math.round(belief.certainty * 100) + '% · evidências favoráveis '
      + supporting + ' / contrárias ' + opposing + '</b></div>';
  }).join('');

  return {
    memoryRows,
    beliefRows,
    memorySection: memoryRows ? '<h3>Fatos e relatos conhecidos</h3>' + memoryRows : '',
    beliefSection: beliefRows ? '<h3>Interpretações pessoais</h3>' + beliefRows : ''
  };
}
