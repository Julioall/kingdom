const SOCIAL_EVENT_LABELS = Object.freeze({
  social_meeting: 'conversa presencial',
  water_source_indicated: 'indicação de água',
  food_aid_transferred: 'partilha de alimento',
  food_aid_requested: 'pedido de alimento',
  food_aid_request_resolved: 'resposta ao pedido de ajuda',
  social_commitment_accepted: 'compromisso aceito',
  social_commitment_delivery: 'entrega parcial do compromisso',
  social_commitment_fulfilled: 'compromisso cumprido',
  social_commitment_breached: 'compromisso quebrado',
  social_commitment_rejected: 'compromisso recusado',
  social_commitment_cancelled: 'compromisso cancelado',
  social_commitment_expired: 'proposta vencida',
  social_intention_progressed: 'plano atualizado',
  social_intention_resolved: 'plano encerrado',
  military_pay_delayed: 'soldo atrasado',
  military_pay_recovered: 'soldo em atraso pago',
  military_service_evaluated: 'avaliação do serviço militar'
});

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function formatNumber(value, digits = 0) {
  return Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: digits });
}

const SOCIAL_DETAIL_LABELS = Object.freeze({
  seek_food_aid: 'buscar ajuda alimentar', evaluate_service: 'avaliar serviço militar',
  prepare_migration: 'preparar migração', food: 'alimento', gold: 'ouro',
  approach_helper: 'aproximar-se de quem pode ajudar', request_food: 'pedir alimento',
  receive_food: 'receber alimento', review_pay_history: 'revisar histórico do soldo',
  evaluate_outstanding_compensation: 'avaliar soldo pendente',
  select_viable_destination: 'escolher destino viável', reach_destination: 'chegar ao destino',
  route_infeasible: 'rota inviável', no_viable_destination: 'sem destino viável',
  critical_hunger: 'fome crítica', critical_thirst: 'sede crítica',
  critical_health: 'saúde crítica', critical_energy: 'exaustão', recent_attack: 'ataque recente',
  deadline_expired: 'prazo vencido', owner_dead: 'falecimento do titular',
  target_unavailable: 'pessoa indisponível', target_not_visible: 'pessoa fora de vista',
  helper_without_visible_surplus: 'sem excedente visível para ajudar',
  aid_temporarily_unavailable: 'ajuda temporariamente indisponível',
  need_satisfied: 'necessidade atendida', aid_delivered: 'alimento entregue',
  aid_refused: 'ajuda recusada', destination_reached: 'destino alcançado',
  remuneration_evaluated: 'revisão do soldo concluída',
  military_duty: 'ordem militar prioritária', urgent_needs: 'necessidade urgente',
  rest_required: 'recuperação necessária', cargo_delivery: 'entrega de carga prioritária',
  garrison_resupply: 'abastecimento na guarnição', participant_busy: 'participante ocupado'
});

function detailLabel(value) {
  return SOCIAL_DETAIL_LABELS[value] || String(value).replaceAll('_', ' ');
}

// Keep every open obligation visible; fill the remaining preview with recent history.
function openFirst(records, openStatuses) {
  const recent = records.slice().reverse();
  const open = recent.filter(record => openStatuses.includes(record.status));
  return open.concat(recent.filter(record => !openStatuses.includes(record.status))
    .slice(0, Math.max(0, 4 - open.length)));
}

export function renderSocialInspectorSections(person, world) {
  const facts = new Map((world.socialEvidence?.facts || []).map(fact => [fact.eventId, fact]));
  const memories = (person.socialMemories || []).slice(-6).reverse();
  const beliefs = (person.socialBeliefs || []).slice().reverse();
  const intentionStatusLabels = { active: 'em andamento', suspended: 'suspenso', completed: 'concluído', abandoned: 'abandonado' };
  const intentions = openFirst(person.socialIntentions || [], ['active', 'suspended']);
  const intentionRows = intentions.map(intention => {
    const steps = Array.isArray(intention.steps) ? intention.steps : [];
    const currentStep = steps[intention.progress]?.action;
    const progress = Math.min(intention.progress || 0, steps.length) + '/' + steps.length;
    const destination = intention.destination && Number.isFinite(intention.destination.x) && Number.isFinite(intention.destination.y)
      ? ' · destino (' + formatNumber(intention.destination.x, 1) + ', ' + formatNumber(intention.destination.y, 1) + ')' : '';
    const blocker = (intention.blockers || []).length
      ? ' · impedimento: ' + intention.blockers.map(detailLabel).join(', ') : '';
    const due = Number.isSafeInteger(intention.dueDay) ? ' · prazo dia ' + intention.dueDay : '';
    const next = intention.status === 'active' && currentStep
      ? ' · próximo passo: ' + detailLabel(currentStep) : '';
    const resolution = intention.terminationReason ? ' · motivo: ' + detailLabel(intention.terminationReason) : '';
    const targetPerson = (world.people || []).find(candidate => String(candidate.id) === String(intention.targetId));
    const target = targetPerson ? ' · com ' + targetPerson.name : '';
    return '<div class="data-row"><span>' + escapeHtml(detailLabel(intention.type || 'plano'))
      + ' · ' + escapeHtml(intentionStatusLabels[intention.status] || intention.status) + '</span><b>'
      + escapeHtml(progress + due + target + destination + next + blocker + resolution) + '</b></div>';
  }).join('');
  const commitmentStatusLabels = { proposed: 'proposto', accepted: 'aceito', fulfilled: 'cumprido', breached: 'quebrado',
    rejected: 'recusado', cancelled: 'cancelado', expired: 'vencido' };
  const commitments = openFirst((world.socialEvidence?.commitments || []).map(item => item.record)
    .filter(record => record?.parties?.includes(String(person.id))), ['proposed', 'accepted']);
  const commitmentRows = commitments.map(commitment => {
    const amount = formatNumber(commitment.deliveredQuantity || 0, 1) + '/' + formatNumber(commitment.quantity, 1);
    const due = Number.isSafeInteger(commitment.dueDay) ? ' · prazo dia ' + commitment.dueDay : '';
    const others = (commitment.parties || []).filter(id => String(id) !== String(person.id))
      .map(id => (world.people || []).find(candidate => String(candidate.id) === String(id))?.name || 'pessoa ' + id);
    return '<div class="data-row"><span>' + escapeHtml(detailLabel(commitment.object || 'compromisso'))
      + ' · ' + escapeHtml(commitmentStatusLabels[commitment.status] || commitment.status) + '</span><b>'
      + escapeHtml(amount + due + (others.length ? ' · com ' + others.join(', ') : '')) + '</b></div>';
  }).join('');

  const memoryRows = memories.map(memory => {
    const fact = facts.get(memory.rootEventId);
    const eventLabel = SOCIAL_EVENT_LABELS[memory.eventType]
      || String(memory.eventType || 'acontecimento').replaceAll('_', ' ');
    const sourcePerson = (world.people || []).find(candidate => String(candidate.id) === memory.sourcePersonId);
    const provenance = memory.source === 'reported'
      ? 'Relato recebido de ' + (sourcePerson?.name || 'pessoa ' + memory.sourcePersonId)
      : 'Observado diretamente';
    const outcome = fact?.outcome?.resource === 'food' && Number.isFinite(fact.outcome.amount)
      ? ' · ' + formatNumber(fact.outcome.amount, 1) + ' dias de alimento'
      : fact?.outcome?.resource === 'gold' && Number.isFinite(fact.outcome.amount)
        ? ' · ' + formatNumber(fact.outcome.amount, 1) + ' ouro' : '';
    const meetingResult = fact?.type === 'social_meeting' && fact.outcome?.result === 'conversation_completed'
      ? ' · resultado confirmado' : '';
    const waterResult = fact?.type === 'water_source_indicated' && fact.outcome?.result === 'reference_received'
      ? ' · referência de água recebida' : '';
    const aidRequestResult = fact?.type === 'food_aid_request_resolved' && fact.outcome?.result === 'accepted'
      ? ' · pedido aceito' : fact?.type === 'food_aid_request_resolved' && fact.outcome?.result === 'refused'
        ? ' · pedido recusado' : '';
    const commitmentResult = fact?.type === 'social_commitment_accepted'
      ? ' · aceito por ' + ((world.people || []).find(candidate => String(candidate.id) === String(fact.outcome?.acceptedBy))?.name || 'outra parte')
      : fact?.type === 'social_commitment_fulfilled' ? ' · quantidade entregue ' + formatNumber(fact.outcome?.deliveredQuantity, 1)
        : fact?.type === 'social_commitment_breached' ? ' · faltou ' + formatNumber(fact.outcome?.remainingQuantity, 1)
          : '';
    const intentionResult = fact?.type === 'social_intention_resolved'
      ? fact.outcome?.status === 'completed' ? ' · concluído'
        : fact.outcome?.terminationReason ? ' · motivo: ' + escapeHtml(detailLabel(fact.outcome.terminationReason)) : ' · abandonado'
      : '';
    const serviceResult = fact?.type === 'military_service_evaluated'
      ? Number(fact.outcome?.outstandingArrears) > .001
        ? ' · soldo pendente ' + formatNumber(fact.outcome.outstandingArrears, 1) + ' ouro'
        : ' · soldo em dia' : '';
    const progressResult = fact?.type === 'social_intention_progressed'
      ? ' · ' + escapeHtml(detailLabel(fact.outcome?.type || 'plano'))
        + ' · passos realizados: ' + formatNumber(fact.outcome?.progress)
        + ((fact.outcome?.blockers || []).length ? ' · impedimento: '
          + escapeHtml(fact.outcome.blockers.map(detailLabel).join(', ')) : '') : '';
    const meetingLocation = ['social_meeting', 'water_source_indicated'].includes(fact?.type) && fact.location
      ? ' · posição (' + formatNumber(fact.location.x, 1) + ', ' + formatNumber(fact.location.y, 1) + ')' : '';
    const eventDay = Number.isSafeInteger(fact?.outcome?.paymentDay)
      ? fact.outcome.paymentDay : fact?.day ?? memory.eventDay;
    const dueDay = Number.isSafeInteger(fact?.outcome?.dueDay)
      ? ' · vencimento no dia ' + fact.outcome.dueDay : '';
    const receivedDay = memory.source === 'reported' && memory.acquiredDay !== memory.eventDay
      ? ' · recebido no dia ' + memory.acquiredDay : '';
    return '<div class="note-card"><b>' + escapeHtml(provenance) + '</b><span>Dia ' + eventDay + ': '
      + escapeHtml(eventLabel) + outcome + dueDay + receivedDay + meetingResult + waterResult + aidRequestResult
      + commitmentResult + intentionResult + serviceResult + progressResult + meetingLocation + '</span></div>';
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
    intentionRows,
    commitmentRows,
    planSection: intentionRows ? '<h3>Planos individuais</h3>' + intentionRows : '',
    commitmentSection: commitmentRows ? '<h3>Compromissos</h3>' + commitmentRows : '',
    memorySection: memoryRows ? '<h3>Fatos e relatos conhecidos</h3>' + memoryRows : '',
    beliefSection: beliefRows ? '<h3>Interpretações pessoais</h3>' + beliefRows : ''
  };
}
